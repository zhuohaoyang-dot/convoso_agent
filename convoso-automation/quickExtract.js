#!/usr/bin/env node

/**
 * Quick Extract Script
 * Simple script to pull call logs right after making calls
 * 
 * Usage:
 *   node quickExtract.js
 *   node quickExtract.js 2025-10-03 2025-10-10
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  authToken: 'dmjhrjn17ou4k7s0u64m7qgwci4v9efd',
  campaignId: '1173',
  campaignName: 'Convoso Test Campaign'
};

/**
 * Fetch call logs
 */
async function fetchCallLogs(startTime = null, endTime = null) {
  try {
    console.log('📡 Fetching call logs from Convoso API...');
    console.log(`   Campaign: ${CONFIG.campaignName} (ID: ${CONFIG.campaignId})`);
    
    const params = new URLSearchParams({
      auth_token: CONFIG.authToken,
      campaign_id: CONFIG.campaignId,
      call_type: 'OUTBOUND',
      limit: '1000',
      include_recordings: '0'
    });

    if (startTime) {
      params.append('start_time', startTime);
      console.log(`   Start: ${startTime}`);
    }
    if (endTime) {
      params.append('end_time', endTime);
      console.log(`   End: ${endTime}`);
    }

    const url = `https://api.convoso.com/v1/log/retrieve?${params.toString()}`;
    const response = await axios.get(url, { timeout: 30000 });

    if (response.data.success && response.data.data) {
      const { total_found, entries, results } = response.data.data;
      
      console.log(`✅ Retrieved ${entries} of ${total_found} calls`);
      return results;
    } else {
      throw new Error('Invalid API response');
    }
  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:', error.response.data);
    } else {
      console.error('❌ Error:', error.message);
    }
    throw error;
  }
}

/**
 * Convert to CSV
 */
function convertToCSV(calls) {
  if (!calls || calls.length === 0) return '';

  const headers = [
    'Call ID',
    'Lead ID',
    'Campaign',
    'Agent',
    'Phone Number',
    'First Name',
    'Last Name',
    'Status',
    'Status Name',
    'Call Length (sec)',
    'Call Date',
    'Called Count',
    'Caller ID Displayed',
    'Term Reason',
    'Agent Comment'
  ];

  const rows = [headers.join(',')];

  calls.forEach(call => {
    const row = [
      call.id,
      call.lead_id,
      call.campaign,
      call.user,
      call.phone_number,
      call.first_name,
      call.last_name,
      call.status,
      call.status_name,
      call.call_length,
      call.call_date,
      call.called_count,
      call.caller_id_displayed,
      call.term_reason,
      call.agent_comment || ''
    ].map(val => {
      const str = String(val || '');
      return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
    });

    rows.push(row.join(','));
  });

  return rows.join('\n');
}

/**
 * Save CSV
 */
function saveCSV(csvContent) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
  const filename = `convoso_calls_${CONFIG.campaignId}_${timestamp}.csv`;
  
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, csvContent, 'utf8');
  
  console.log(`📁 Saved to: ${filepath}`);
  return filepath;
}

/**
 * Display summary
 */
function displaySummary(calls) {
  console.log('\n📊 Call Summary:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Count by status
  const statusCounts = {};
  let totalDuration = 0;

  calls.forEach(call => {
    const status = call.status_name || call.status;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    totalDuration += parseInt(call.call_length) || 0;
  });

  console.log(`Total Calls: ${calls.length}`);
  console.log(`Total Duration: ${Math.floor(totalDuration / 60)}m ${totalDuration % 60}s`);
  console.log(`Average Duration: ${Math.floor(totalDuration / calls.length)}s`);
  console.log('\nBy Status:');
  
  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

/**
 * Main
 */
async function main() {
  try {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║     📞 CONVOSO CALL LOG EXTRACTOR 📞          ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    // Parse date arguments
    const args = process.argv.slice(2);
    const startTime = args[0]; // YYYY-MM-DD
    const endTime = args[1] || startTime; // YYYY-MM-DD

    // If no dates provided, use today
    const today = new Date().toISOString().split('T')[0];
    const start = startTime || today;
    const end = endTime || today;

    // Fetch logs
    const calls = await fetchCallLogs(start, end);

    if (!calls || calls.length === 0) {
      console.log('\n⚠️  No call logs found');
      return;
    }

    // Convert to CSV
    console.log('📝 Converting to CSV...');
    const csv = convertToCSV(calls);

    // Save
    const filepath = saveCSV(csv);

    // Display summary
    displaySummary(calls);

    console.log('\n✅ Extraction complete!\n');

  } catch (error) {
    console.error('\n❌ Failed:', error.message);
    process.exit(1);
  }
}

main();