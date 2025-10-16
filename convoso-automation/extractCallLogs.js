const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Convoso Call Log Extractor
 * Pulls call logs from Convoso API and exports to CSV
 */
class ConvosoLogExtractor {
  constructor(authToken, campaignId) {
    this.authToken = authToken;
    this.campaignId = campaignId;
    this.baseUrl = 'https://api.convoso.com/v1';
  }

  /**
   * Fetch call logs from Convoso API
   */
  async fetchCallLogs(options = {}) {
    try {
      const {
        startTime = null,
        endTime = null,
        callType = 'OUTBOUND',
        limit = 1000,
        offset = 0,
        includeRecordings = 0
      } = options;

      console.log('📡 Fetching call logs from Convoso API...');
      console.log(`   Campaign ID: ${this.campaignId}`);
      if (startTime) console.log(`   Start Time: ${startTime}`);
      if (endTime) console.log(`   End Time: ${endTime}`);
      console.log(`   Call Type: ${callType}`);
      console.log(`   Limit: ${limit}`);

      // Build query parameters
      const params = new URLSearchParams({
        auth_token: this.authToken,
        campaign_id: this.campaignId,
        limit: limit.toString(),
        offset: offset.toString(),
        include_recordings: includeRecordings.toString()
      });

      if (startTime) params.append('start_time', startTime);
      if (endTime) params.append('end_time', endTime);
      if (callType) params.append('call_type', callType);

      const url = `${this.baseUrl}/log/retrieve?${params.toString()}`;

      const response = await axios.get(url, {
        timeout: 30000 // 30 second timeout
      });

      if (response.data.success && response.data.data) {
        const { total_found, entries, results } = response.data.data;
        
        console.log('✅ Call logs retrieved successfully');
        console.log(`   Total Found: ${total_found}`);
        console.log(`   Retrieved: ${entries}`);
        
        return results;
      } else {
        throw new Error('Failed to retrieve call logs - invalid response');
      }

    } catch (error) {
      if (error.response) {
        console.error('❌ API Error:', error.response.status, error.response.data);
        throw new Error(`API Error: ${error.response.data.text || error.response.statusText}`);
      } else if (error.request) {
        console.error('❌ No response from API');
        throw new Error('No response from Convoso API');
      } else {
        console.error('❌ Error:', error.message);
        throw error;
      }
    }
  }

  /**
   * Fetch all call logs with pagination
   */
  async fetchAllCallLogs(options = {}) {
    const allResults = [];
    let offset = 0;
    const limit = 500; // API limit per request
    let hasMore = true;

    console.log('📊 Fetching all call logs (with pagination)...');

    while (hasMore) {
      const results = await this.fetchCallLogs({
        ...options,
        limit,
        offset
      });

      if (results && results.length > 0) {
        allResults.push(...results);
        console.log(`   Retrieved ${allResults.length} calls so far...`);
        
        if (results.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Total calls retrieved: ${allResults.length}`);
    return allResults;
  }

  /**
   * Convert call logs to CSV format
   */
  convertToCSV(callLogs) {
    if (!callLogs || callLogs.length === 0) {
      return '';
    }

    console.log('📝 Converting to CSV format...');

    // Define CSV headers (all available fields)
    const headers = [
      'id',
      'lead_id',
      'list_id',
      'campaign_id',
      'campaign',
      'user',
      'user_id',
      'phone_number',
      'number_dialed',
      'first_name',
      'last_name',
      'status',
      'status_name',
      'call_length',
      'call_date',
      'agent_comment',
      'queue_id',
      'called_count',
      'caller_id_displayed',
      'term_reason',
      'call_type',
      'queue_position',
      'queue_seconds',
      'originating_agent_id'
    ];

    // Create CSV rows
    const rows = [headers.join(',')];

    callLogs.forEach(log => {
      const row = headers.map(header => {
        let value = log[header];
        
        // Handle null/undefined values
        if (value === null || value === undefined) {
          return '';
        }
        
        // Escape commas and quotes in string values
        value = String(value);
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          value = `"${value.replace(/"/g, '""')}"`;
        }
        
        return value;
      });
      
      rows.push(row.join(','));
    });

    console.log(`✅ Converted ${callLogs.length} records to CSV`);
    return rows.join('\n');
  }

  /**
   * Save CSV to file
   */
  saveCSV(csvContent, filename = null) {
    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
      filename = `convoso_calls_${this.campaignId}_${timestamp}.csv`;
    }

    const outputDir = path.join(process.cwd(), 'output');
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filepath = path.join(outputDir, filename);
    
    fs.writeFileSync(filepath, csvContent, 'utf8');
    
    console.log(`✅ CSV saved to: ${filepath}`);
    return filepath;
  }

  /**
   * Main extraction method
   */
  async extractAndSave(options = {}) {
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🚀 Starting Convoso Call Log Extraction');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Fetch call logs
      const callLogs = await this.fetchAllCallLogs(options);

      if (!callLogs || callLogs.length === 0) {
        console.log('⚠️  No call logs found for the specified criteria');
        return null;
      }

      // Convert to CSV
      const csvContent = this.convertToCSV(callLogs);

      // Save to file
      const filepath = this.saveCSV(csvContent, options.filename);

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Extraction Complete!');
      console.log(`   Total Records: ${callLogs.length}`);
      console.log(`   File: ${filepath}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return {
        filepath,
        recordCount: callLogs.length,
        callLogs
      };

    } catch (error) {
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('❌ Extraction Failed!');
      console.error(`   Error: ${error.message}`);
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      throw error;
    }
  }

  /**
   * Get today's call logs
   */
  async extractTodaysCalls(filename = null) {
    const today = new Date();
    const startTime = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const endTime = today.toISOString().split('T')[0];

    return this.extractAndSave({
      startTime,
      endTime,
      filename: filename || `convoso_calls_today_${startTime}.csv`
    });
  }

  /**
   * Get call logs for a date range
   */
  async extractDateRange(startDate, endDate, filename = null) {
    return this.extractAndSave({
      startTime: startDate,
      endTime: endDate,
      filename
    });
  }
}

// Export for use as module
module.exports = ConvosoLogExtractor;

// CLI Usage - runs if executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  const authToken = process.env.CONVOSO_AUTH_TOKEN || args[0];
  const campaignId = process.env.CONVOSO_CAMPAIGN_ID || args[1] || '1173';
  const startTime = args[2]; // Optional: YYYY-MM-DD
  const endTime = args[3]; // Optional: YYYY-MM-DD

  if (!authToken) {
    console.error('❌ Error: Missing auth token');
    console.error('\nUsage:');
    console.error('  node extractCallLogs.js <auth_token> [campaign_id] [start_date] [end_date]');
    console.error('\nOr set environment variables:');
    console.error('  CONVOSO_AUTH_TOKEN=your_token');
    console.error('  CONVOSO_CAMPAIGN_ID=1173');
    console.error('\nExamples:');
    console.error('  node extractCallLogs.js dmjhrjn17ou4k7s0u64m7qgwci4v9efd 1173');
    console.error('  node extractCallLogs.js dmjhrjn17ou4k7s0u64m7qgwci4v9efd 1173 2025-10-03 2025-10-10');
    process.exit(1);
  }

  const extractor = new ConvosoLogExtractor(authToken, campaignId);

  // Run extraction
  (async () => {
    try {
      if (startTime && endTime) {
        await extractor.extractDateRange(startTime, endTime);
      } else if (startTime) {
        await extractor.extractDateRange(startTime, startTime);
      } else {
        await extractor.extractTodaysCalls();
      }
    } catch (error) {
      process.exit(1);
    }
  })();
}