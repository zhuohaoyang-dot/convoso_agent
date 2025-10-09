const ConvosoAPI = require('./ConvosoAPI');
const config = require('../config/config');
const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');

/**
 * Convoso Agent Automation
 * Main business logic for automated agent
 */
class ConvosoAgent {
  constructor() {
    this.api = new ConvosoAPI();
    this.isRunning = false;
    this.callCount = 0;
    this.startTime = null;
  }

  /**
   * Initialize and start the agent
   */
  async start() {
    try {
      logger.info('🚀 Starting Convoso Agent Automation...');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      this.startTime = Date.now();
      this.isRunning = true;

      // Step 1: Login
      await this.api.login(config.username, config.password);
      await Helpers.sleep(1000);

      // Step 2: Phone login
      await this.api.phoneLogin(
        config.campaignId,
        config.campaignName,
        config.campaignDialMethod
      );
      await Helpers.sleep(1000);

      // Step 3: Set availability to ready
      await this.api.changeAvailability(
        config.campaignId,
        config.availabilityReady
      );

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('✅ Agent is now ready and listening for calls...');
      logger.info(`⚙️  Call duration: ${config.callDuration / 1000}s`);
      logger.info(`⚙️  Poll interval: ${config.pollInterval}ms`);
      logger.info(`⚙️  Max calls: ${config.maxCalls === 0 ? 'Unlimited' : config.maxCalls}`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Start call handling loop
      await this.handleCallsLoop();

    } catch (error) {
      logger.error('❌ Failed to start agent:', Helpers.getErrorMessage(error));
      await this.stop();
      throw error;
    }
  }

  /**
   * Main call handling loop
   */
  async handleCallsLoop() {
    while (this.isRunning) {
      try {
        // Check if max calls reached
        if (config.maxCalls > 0 && this.callCount >= config.maxCalls) {
          logger.info(`🎯 Maximum calls (${config.maxCalls}) reached. Stopping...`);
          await this.stop();
          break;
        }

        // Poll for incoming call
        const result = await this.api.checkAutoIncoming(
          config.campaignId,
          config.campaignDialMethod
        );

        if (result.found) {
          // Call connected!
          await this.handleCall(result.callInfo);
        } else {
          // No call yet, wait and poll again
          await Helpers.sleep(config.pollInterval);
        }

      } catch (error) {
        logger.error('❌ Error in call loop:', Helpers.getErrorMessage(error));
        
        // If critical error, stop
        if (error.message.includes('authentication') || error.message.includes('session')) {
          logger.error('🚨 Critical error detected. Stopping agent...');
          await this.stop();
          break;
        }

        // Otherwise wait and retry
        await Helpers.sleep(5000);
      }
    }
  }

  /**
   * Handle individual call
   */
  async handleCall(callInfo) {
    const callStartTime = Date.now();
    this.callCount++;

    try {
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info(`📞 Call #${this.callCount} Connected!`);
      logger.info(`   Lead: ${callInfo.first_name} ${callInfo.last_name}`);
      logger.info(`   Phone: ${Helpers.formatPhoneNumber(callInfo.phone_code, callInfo.phone_number)}`);
      logger.info(`   Lead ID: ${callInfo.lead_id}`);
      logger.info(`   Call Log ID: ${callInfo.call_log_id}`);

      // Wait for configured duration
      logger.info(`⏳ Waiting ${config.callDuration / 1000}s before hangup...`);
      await Helpers.sleep(config.callDuration);

      // Calculate actual call duration
      const actualDuration = Date.now() - callStartTime;

      // Hangup
      await this.api.hangup(
        config.campaignId,
        callInfo,
        actualDuration
      );

      // Set disposition
      await this.api.setDisposition(
        config.campaignId,
        callInfo.lead_id,
        callInfo.phone_code,
        callInfo.phone_number,
        config.dispositionStatus
      );

      const totalDuration = Date.now() - callStartTime;
      logger.info(`✅ Call #${this.callCount} completed in ${Helpers.formatDuration(Math.floor(totalDuration / 1000))}`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // No delay needed - system will auto-dial next call
      // We immediately return to polling loop to detect the next call

    } catch (error) {
      logger.error(`❌ Error handling call #${this.callCount}:`, Helpers.getErrorMessage(error));
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Continue to next call despite error
      await Helpers.sleep(5000);
    }
  }

  /**
   * Gracefully stop the agent
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('🛑 Stopping agent...');
    this.isRunning = false;

    try {
      // Step 1: Set availability to not ready (break)
      logger.info('📴 Setting availability to Not Ready - Break...');
      await this.api.changeAvailability(
        config.campaignId,
        config.availabilityNotReady
      );
      
      await Helpers.sleep(1000);

      // Step 2: Logout from phone system
      await this.api.phoneLogout(config.campaignId);

      const totalTime = Date.now() - this.startTime;
      const minutes = Math.floor(totalTime / 60000);
      const seconds = Math.floor((totalTime % 60000) / 1000);

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('📊 Session Summary:');
      logger.info(`   Total calls handled: ${this.callCount}`);
      logger.info(`   Total time: ${minutes}m ${seconds}s`);
      if (this.callCount > 0) {
        const avgTime = Math.floor(totalTime / this.callCount / 1000);
        logger.info(`   Average call time: ${Helpers.formatDuration(avgTime)}`);
      }
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('✅ Agent stopped successfully');

    } catch (error) {
      logger.error('❌ Error during stop:', Helpers.getErrorMessage(error));
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    const runTime = this.startTime ? Date.now() - this.startTime : 0;
    return {
      isRunning: this.isRunning,
      callCount: this.callCount,
      runTimeMs: runTime,
      averageCallTime: this.callCount > 0 ? runTime / this.callCount : 0
    };
  }
}

module.exports = ConvosoAgent;