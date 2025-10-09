require('dotenv').config();
const ConvosoAPI = require('./src/services/ConvosoAPI');
const config = require('./src/config/config');

/**
 * API Health Check Test Suite
 * Tests each endpoint individually
 */
class APIHealthCheck {
  constructor() {
    this.api = new ConvosoAPI();
    this.results = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  /**
   * Print test header
   */
  printHeader(testName) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST: ${testName}`);
    console.log('='.repeat(60));
  }

  /**
   * Print test result
   */
  printResult(success, message, data = null) {
    const icon = success ? '✅' : '❌';
    const status = success ? 'PASS' : 'FAIL';
    
    console.log(`${icon} [${status}] ${message}`);
    
    if (data) {
      console.log('Response:', JSON.stringify(data, null, 2));
    }
    
    this.results.tests.push({ success, message, data });
    if (success) {
      this.results.passed++;
    } else {
      this.results.failed++;
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test 1: Basic Login
   */
  async testLogin() {
    this.printHeader('1. Basic Login');
    
    try {
      console.log(`   Username: ${config.username}`);
      console.log(`   Password: ${'*'.repeat(config.password.length)}`);
      console.log('   Attempting login...\n');
      
      const result = await this.api.login(config.username, config.password);
      
      if (result) {
        this.printResult(true, 'Login successful - redirect received');
        console.log(`   Cookies captured: ${Object.keys(this.api.cookies).length}`);
        return true;
      } else {
        this.printResult(false, 'Login failed - no redirect');
        return false;
      }
    } catch (error) {
      this.printResult(false, `Login failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Test 2: Phone System Login
   */
  async testPhoneLogin() {
    this.printHeader('2. Phone System Login');
    
    try {
      console.log(`   Campaign ID: ${config.campaignId}`);
      console.log(`   Campaign Name: ${config.campaignName}`);
      console.log(`   Dial Method: ${config.campaignDialMethod}`);
      console.log('   Logging into phone system...\n');
      
      const result = await this.api.phoneLogin(
        config.campaignId,
        config.campaignName,
        config.campaignDialMethod
      );
      
      if (result && result.success) {
        this.printResult(true, 'Phone login successful');
        console.log(`   Session ID: ${this.api.sessionId}`);
        console.log(`   Agent Log ID: ${this.api.agentLogId}`);
        console.log(`   Extension: ${result.data.extension}`);
        return true;
      } else {
        this.printResult(false, 'Phone login failed - invalid response', result);
        return false;
      }
    } catch (error) {
      this.printResult(false, `Phone login failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Test 3: Set Availability to Available
   */
  async testSetAvailable() {
    this.printHeader('3. Set Availability - Available');
    
    try {
      console.log(`   Availability Code: ${config.availabilityReady}`);
      console.log('   Setting availability to Available...\n');
      
      const result = await this.api.changeAvailability(
        config.campaignId,
        config.availabilityReady
      );
      
      if (result && result.success) {
        this.printResult(true, 'Availability set to Available');
        console.log(`   User Log ID: ${result.data.user_log_id}`);
        return true;
      } else {
        this.printResult(false, 'Failed to set availability', result);
        return false;
      }
    } catch (error) {
      this.printResult(false, `Set availability failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Test 4: Check for Incoming Calls (Poll Test)
   */
  async testCheckIncoming() {
    this.printHeader('4. Check Incoming Calls (Polling)');
    
    try {
      console.log('   Polling for calls (will check 3 times)...\n');
      
      for (let i = 1; i <= 3; i++) {
        console.log(`   Attempt ${i}/3...`);
        
        const result = await this.api.checkAutoIncoming(
          config.campaignId,
          config.campaignDialMethod
        );
        
        if (result.found) {
          this.printResult(true, `Call detected on attempt ${i}!`);
          console.log('   Call Info:');
          console.log(`     Lead ID: ${result.callInfo.lead_id}`);
          console.log(`     Call Log ID: ${result.callInfo.call_log_id}`);
          console.log(`     Phone: ${result.callInfo.phone_number}`);
          console.log(`     Name: ${result.callInfo.first_name} ${result.callInfo.last_name}`);
          
          // Store call info for next tests
          this.testCallInfo = result.callInfo;
          return true;
        }
        
        if (i < 3) {
          await this.sleep(2000);
        }
      }
      
      this.printResult(true, 'Polling works (no call detected - this is OK for testing)');
      console.log('   ℹ️  No active call found. This is normal if campaign is not dialing.');
      console.log('   ℹ️  Skipping hangup and disposition tests.');
      return false; // No call, but test passed
      
    } catch (error) {
      this.printResult(false, `Check incoming failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Test 5: Hangup Call (only if call detected)
   */
  async testHangup() {
    if (!this.testCallInfo) {
      this.printHeader('5. Hangup Call');
      console.log('   ⏭️  SKIPPED - No active call to hangup');
      return false;
    }

    this.printHeader('5. Hangup Call');
    
    try {
      console.log('   ⚠️  WARNING: This will hangup the active call!');
      console.log('   Hanging up in 3 seconds...');
      await this.sleep(3000);
      
      const result = await this.api.hangup(
        config.campaignId,
        this.testCallInfo,
        15000 // 15 second call duration
      );
      
      if (result && result.ishangup) {
        this.printResult(true, 'Call hung up successfully');
        return true;
      } else {
        this.printResult(false, 'Hangup failed', result);
        return false;
      }
    } catch (error) {
      this.printResult(false, `Hangup failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Test 6: Set Disposition (only if call was hung up)
   */
  async testDisposition() {
    if (!this.testCallInfo) {
      this.printHeader('6. Set Disposition');
      console.log('   ⏭️  SKIPPED - No call to set disposition for');
      return false;
    }

    this.printHeader('6. Set Disposition');
    
    try {
      console.log(`   Disposition: ${config.dispositionStatus}`);
      console.log(`   Lead ID: ${this.testCallInfo.lead_id}`);
      console.log('   Setting disposition...\n');
      
      const result = await this.api.setDisposition(
        config.campaignId,
        this.testCallInfo.lead_id,
        this.testCallInfo.phone_code,
        this.testCallInfo.phone_number,
        config.dispositionStatus
      );
      
      if (result && result.success) {
        this.printResult(true, 'Disposition set successfully');
        console.log(`   New Agent Log ID: ${result.data.agentLogId}`);
        return true;
      } else {
        this.printResult(false, 'Set disposition failed', result);
        return false;
      }
    } catch (error) {
      this.printResult(false, `Set disposition failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Test 7: Set Availability to Not Ready
   */
  async testSetNotReady() {
    this.printHeader('7. Set Availability - Not Ready');
    
    try {
      console.log(`   Availability Code: ${config.availabilityNotReady}`);
      console.log('   Setting availability to Not Ready - Break...\n');
      
      const result = await this.api.changeAvailability(
        config.campaignId,
        config.availabilityNotReady
      );
      
      if (result && result.success) {
        this.printResult(true, 'Availability set to Not Ready');
        return true;
      } else {
        this.printResult(false, 'Failed to set not ready', result);
        return false;
      }
    } catch (error) {
      this.printResult(false, `Set not ready failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Test 8: Logout
   */
  async testLogout() {
    this.printHeader('8. Phone System Logout');
    
    try {
      console.log(`   Logout Code: ${config.logoutCode}`);
      console.log('   Logging out...\n');
      
      const result = await this.api.phoneLogout(config.campaignId);
      
      if (result) {
        this.printResult(true, 'Logout successful');
        return true;
      } else {
        this.printResult(false, 'Logout failed', result);
        return false;
      }
    } catch (error) {
      this.printResult(false, `Logout failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Print final summary
   */
  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('HEALTH CHECK SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`📊 Total:  ${this.results.passed + this.results.failed}`);
    console.log('='.repeat(60));
    
    if (this.results.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! System is healthy and ready to run.');
    } else {
      console.log('\n⚠️  Some tests failed. Please fix issues before running automation.');
    }
  }

  /**
   * Run all tests
   */
  async runAll() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║        🧪 CONVOSO API HEALTH CHECK TEST SUITE 🧪          ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    try {
      // Test 1: Login
      const loginOk = await this.testLogin();
      if (!loginOk) {
        console.log('\n❌ Login failed. Cannot proceed with other tests.');
        this.printSummary();
        return;
      }
      await this.sleep(1000);

      // Test 2: Phone Login
      const phoneLoginOk = await this.testPhoneLogin();
      if (!phoneLoginOk) {
        console.log('\n❌ Phone login failed. Cannot proceed with other tests.');
        this.printSummary();
        return;
      }
      await this.sleep(1000);

      // Test 3: Set Available
      const availableOk = await this.testSetAvailable();
      if (!availableOk) {
        console.log('\n⚠️  Set availability failed. Continuing with other tests...');
      }
      await this.sleep(1000);

      // Test 4: Check Incoming (polling)
      const callDetected = await this.testCheckIncoming();
      await this.sleep(1000);

      // Test 5 & 6: Only run if call was detected
      if (callDetected) {
        await this.testHangup();
        await this.sleep(1000);
        await this.testDisposition();
        await this.sleep(1000);
      }

      // Test 7: Set Not Ready
      await this.testSetNotReady();
      await this.sleep(1000);

      // Test 8: Logout
      await this.testLogout();

      // Print summary
      this.printSummary();
      
    } catch (error) {
      console.error('\n🚨 Test suite error:', error);
    }
  }

  /**
   * Run quick test (without call handling)
   */
  async runQuick() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║         🚀 QUICK API HEALTH CHECK (No Calls) 🚀           ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    
    try {
      // Test 1: Login
      const loginOk = await this.testLogin();
      if (!loginOk) {
        this.printSummary();
        return;
      }
      await this.sleep(1000);

      // Test 2: Phone Login
      const phoneLoginOk = await this.testPhoneLogin();
      if (!phoneLoginOk) {
        this.printSummary();
        return;
      }
      await this.sleep(1000);

      // Test 3: Set Available
      await this.testSetAvailable();
      await this.sleep(1000);

      // Test 4: Check Incoming (1 poll only)
      this.printHeader('4. Check Incoming Calls (Quick Poll)');
      console.log('   Testing polling endpoint (1 attempt)...\n');
      const result = await this.api.checkAutoIncoming(
        config.campaignId,
        config.campaignDialMethod
      );
      this.printResult(true, 'Polling endpoint works');
      console.log(`   Call found: ${result.found ? 'Yes' : 'No'}`);
      await this.sleep(1000);

      // Test 5: Set Not Ready
      await this.testSetNotReady();
      await this.sleep(1000);

      // Test 6: Logout
      await this.testLogout();

      // Print summary
      this.printSummary();
      
    } catch (error) {
      console.error('\n🚨 Test suite error:', error);
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'quick';

  const healthCheck = new APIHealthCheck();

  if (mode === 'full') {
    console.log('⚠️  FULL TEST MODE - Will handle actual calls if detected');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await healthCheck.sleep(5000);
    await healthCheck.runAll();
  } else {
    console.log('🚀 QUICK TEST MODE - Safe, no call handling\n');
    await healthCheck.runQuick();
  }
}

// Run
main().catch(console.error);