require('dotenv').config();
const ConvosoAPI = require('./src/services/ConvosoAPI');
const config = require('./src/config/config');

async function testPolling() {
  console.log('🔍 Testing Call Polling\n');
  
  const api = new ConvosoAPI();
  
  // Login
  await api.login(config.username, config.password);
  await new Promise(r => setTimeout(r, 1000));
  
  // Phone login
  await api.phoneLogin(config.campaignId, config.campaignName, config.campaignDialMethod);
  await new Promise(r => setTimeout(r, 1000));
  
  // Set available
  await api.changeAvailability(config.campaignId, config.availabilityReady);
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('\n📡 Starting to poll for calls...');
  console.log('Press Ctrl+C to stop\n');
  
  let pollCount = 0;
  
  while (true) {
    pollCount++;
    
    try {
      const result = await api.checkAutoIncoming(config.campaignId, config.campaignDialMethod);
      
      const timestamp = new Date().toLocaleTimeString();
      
      if (result.found) {
        console.log(`\n🎉 [${timestamp}] CALL DETECTED!`);
        console.log('Lead:', result.callInfo.first_name, result.callInfo.last_name);
        console.log('Phone:', result.callInfo.phone_number);
        console.log('Lead ID:', result.callInfo.lead_id);
        break;
      } else {
        // Show a dot every 10 polls to show it's working
        if (pollCount % 10 === 0) {
          process.stdout.write(`[${timestamp}] Polling... (${pollCount} attempts)\n`);
        } else {
          process.stdout.write('.');
        }
      }
      
      await new Promise(r => setTimeout(r, 2000));
      
    } catch (error) {
      console.error('\n❌ Error:', error.message);
      break;
    }
  }
  
  // Cleanup
  await api.changeAvailability(config.campaignId, config.availabilityNotReady);
  await api.phoneLogout(config.campaignId);
}

testPolling().catch(console.error);