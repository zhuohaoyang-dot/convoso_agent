#!/usr/bin/env node

/**
 * Merge Convoso Call Logs with Spam Labels
 * 
 * Matches calls by phone number and adds spam label information
 * 
 * Usage:
 *   node mergeCallLogs.js
 *   node mergeCallLogs.js <convoso_csv> <spam_csv> [output_csv]
 */

const fs = require('fs');
const path = require('path');

class CallLogMerger {
  constructor() {
    this.convosoFile = null;
    this.spamFile = null;
    this.outputFile = null;
  }

  /**
   * Find latest Convoso CSV file
   */
  findLatestConvosoFile() {
    const outputDir = path.join(__dirname, 'convoso-automation', 'output');
    
    if (!fs.existsSync(outputDir)) {
      throw new Error(`Output directory not found: ${outputDir}`);
    }

    const files = fs.readdirSync(outputDir)
      .filter(f => f.startsWith('convoso_calls_') && f.endsWith('.csv'))
      .map(f => ({
        name: f,
        path: path.join(outputDir, f),
        time: fs.statSync(path.join(outputDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length === 0) {
      throw new Error('No Convoso call log files found in output directory');
    }

    console.log(`📁 Found latest Convoso file: ${files[0].name}`);
    return files[0].path;
  }

  /**
   * Find spam_calls.csv
   */
  findSpamFile() {
    const possiblePaths = [
      path.join(__dirname, 'call_logs_auto', 'spam_calls.csv'),
      path.join(__dirname, '..', 'call_logs_auto', 'spam_calls.csv'),
      path.join(__dirname, 'spam_calls.csv')
    ];

    for (const filePath of possiblePaths) {
      if (fs.existsSync(filePath)) {
        console.log(`📁 Found spam labels file: ${path.basename(filePath)}`);
        return filePath;
      }
    }

    throw new Error('spam_calls.csv not found. Searched in: ' + possiblePaths.join(', '));
  }

  /**
   * Parse CSV file
   */
  parseCSV(filepath) {
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.trim().split('\n');
    
    if (lines.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle quoted values
      const values = [];
      let current = '';
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      rows.push(row);
    }

    return { headers, rows };
  }

  /**
   * Normalize phone number - remove all non-digits except leading +
   */
  normalizePhone(phone) {
    if (!phone) return '';
    
    let normalized = phone.toString().trim();
    
    // Fix +7 to +1 (as requested)
    if (normalized.startsWith('+7')) {
      normalized = '+1' + normalized.substring(2);
      console.log(`  🔧 Fixed: ${phone} → ${normalized}`);
    }
    
    // Remove all non-digits except leading +
    if (normalized.startsWith('+')) {
      normalized = '+' + normalized.substring(1).replace(/\D/g, '');
    } else {
      normalized = normalized.replace(/\D/g, '');
      // Add +1 if it's a 10-digit US number
      if (normalized.length === 10) {
        normalized = '+1' + normalized;
      } else if (normalized.length === 11 && normalized.startsWith('1')) {
        normalized = '+' + normalized;
      }
    }
    
    return normalized;
  }

  /**
   * Create spam label lookup map
   */
  createSpamLookup(spamRows) {
    const lookup = new Map();
    
    console.log('\n📊 Processing spam labels...');
    
    spamRows.forEach(row => {
      const phone = this.normalizePhone(row.Number);
      
      if (phone) {
        // Store the most recent label for each number
        if (!lookup.has(phone) || row.Date + ' ' + row.Time > lookup.get(phone).timestamp) {
          lookup.set(phone, {
            label: row.Label,
            date: row.Date,
            time: row.Time,
            timestamp: row.Date + ' ' + row.Time
          });
        }
      }
    });

    console.log(`✅ Processed ${lookup.size} unique phone numbers with labels`);
    
    // Show label distribution
    const labelCounts = {};
    lookup.forEach(data => {
      labelCounts[data.label] = (labelCounts[data.label] || 0) + 1;
    });
    
    console.log('\n📈 Label Distribution:');
    Object.entries(labelCounts).forEach(([label, count]) => {
      console.log(`   ${label}: ${count}`);
    });
    
    return lookup;
  }

  /**
   * Merge call logs with spam labels
   */
  mergeLogs(convosoRows, spamLookup) {
    console.log('\n🔗 Merging call logs with spam labels...');
    
    let matchCount = 0;
    let noMatchCount = 0;
    
    const mergedRows = convosoRows.map(call => {
      // Try multiple phone number fields
      const phoneFields = [
        call.caller_id_displayed,
        call.phone_number,
        call.number_dialed
      ];
      
      let spamData = null;
      let matchedPhone = null;
      
      for (const phoneField of phoneFields) {
        const normalizedPhone = this.normalizePhone(phoneField);
        if (normalizedPhone && spamLookup.has(normalizedPhone)) {
          spamData = spamLookup.get(normalizedPhone);
          matchedPhone = normalizedPhone;
          break;
        }
      }
      
      if (spamData) {
        matchCount++;
        return {
          ...call,
          spam_label: spamData.label,
          spam_detected_date: spamData.date,
          spam_detected_time: spamData.time,
          matched_phone: matchedPhone
        };
      } else {
        noMatchCount++;
        return {
          ...call,
          spam_label: 'No Label',
          spam_detected_date: '',
          spam_detected_time: '',
          matched_phone: ''
        };
      }
    });
    
    console.log(`✅ Matched: ${matchCount} calls`);
    console.log(`⚠️  No match: ${noMatchCount} calls`);
    
    return mergedRows;
  }

  /**
   * Convert merged data to CSV
   */
  toCSV(headers, rows) {
    const csvRows = [headers.join(',')];
    
    rows.forEach(row => {
      const values = headers.map(header => {
        let value = row[header] || '';
        value = String(value);
        
        // Escape commas and quotes
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          value = `"${value.replace(/"/g, '""')}"`;
        }
        
        return value;
      });
      csvRows.push(values.join(','));
    });
    
    return csvRows.join('\n');
  }

  /**
   * Generate summary report
   */
  generateSummary(mergedRows) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 MERGE SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const total = mergedRows.length;
    const labelCounts = {};
    const statusCounts = {};
    
    mergedRows.forEach(row => {
      const label = row.spam_label || 'No Label';
      const status = row.status_name || row.status;
      
      labelCounts[label] = (labelCounts[label] || 0) + 1;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    console.log(`\nTotal Calls: ${total}`);
    
    console.log('\n📱 By Spam Label:');
    Object.entries(labelCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([label, count]) => {
        const pct = ((count / total) * 100).toFixed(1);
        console.log(`   ${label}: ${count} (${pct}%)`);
      });
    
    console.log('\n📞 By Call Status:');
    Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        const pct = ((count / total) * 100).toFixed(1);
        console.log(`   ${status}: ${count} (${pct}%)`);
      });
    
    // Cross-tabulation: Spam Label vs Status
    console.log('\n🔍 Spam Label vs Call Status:');
    const crosstab = {};
    mergedRows.forEach(row => {
      const label = row.spam_label || 'No Label';
      const status = row.status_name || row.status;
      const key = `${label}::${status}`;
      crosstab[key] = (crosstab[key] || 0) + 1;
    });
    
    Object.entries(labelCounts).forEach(([label]) => {
      console.log(`\n   ${label}:`);
      Object.entries(statusCounts).forEach(([status]) => {
        const count = crosstab[`${label}::${status}`] || 0;
        if (count > 0) {
          console.log(`     - ${status}: ${count}`);
        }
      });
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  /**
   * Main merge process
   */
  async merge(convosoFile = null, spamFile = null, outputFile = null) {
    try {
      console.log('\n╔════════════════════════════════════════════════╗');
      console.log('║   📊 CALL LOG & SPAM LABEL MERGER 📊         ║');
      console.log('╚════════════════════════════════════════════════╝\n');

      // Find input files
      this.convosoFile = convosoFile || this.findLatestConvosoFile();
      this.spamFile = spamFile || this.findSpamFile();
      
      // Parse both files
      console.log('\n📖 Reading files...');
      const convoso = this.parseCSV(this.convosoFile);
      const spam = this.parseCSV(this.spamFile);
      
      console.log(`✅ Convoso logs: ${convoso.rows.length} calls`);
      console.log(`✅ Spam labels: ${spam.rows.length} records`);

      // Create spam lookup
      const spamLookup = this.createSpamLookup(spam.rows);

      // Merge data
      const mergedRows = this.mergeLogs(convoso.rows, spamLookup);

      // Add new headers for spam data
      const newHeaders = [
        ...convoso.headers,
        'spam_label',
        'spam_detected_date',
        'spam_detected_time',
        'matched_phone'
      ];

      // Convert to CSV
      const csvContent = this.toCSV(newHeaders, mergedRows);

      // Determine output file
      if (!outputFile) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
        outputFile = path.join(__dirname, `merged_calls_${timestamp}.csv`);
      }

      // Save file
      fs.writeFileSync(outputFile, csvContent, 'utf8');
      
      console.log(`\n💾 Merged file saved to:`);
      console.log(`   ${outputFile}`);

      // Generate summary
      this.generateSummary(mergedRows);

      console.log('\n✅ Merge complete!\n');

      return outputFile;

    } catch (error) {
      console.error('\n❌ Merge failed:', error.message);
      throw error;
    }
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  const convosoFile = args[0];
  const spamFile = args[1];
  const outputFile = args[2];

  const merger = new CallLogMerger();
  
  merger.merge(convosoFile, spamFile, outputFile)
    .then(output => {
      console.log(`📁 Output: ${output}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}

module.exports = CallLogMerger;