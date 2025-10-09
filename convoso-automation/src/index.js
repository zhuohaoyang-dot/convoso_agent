const PuppeteerAgent = require('./services/PuppeteerAgent');
const logger = require('./utils/logger');
const config = require('./config/config');

/**
 * Main entry point for Convoso Agent Automation
 */
class Application {
  constructor() {
    this.agent = new PuppeteerAgent();
    this.setupSignalHandlers();
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupSignalHandlers() {
    // Handle Ctrl+C
    process.on('SIGINT', async () => {
      logger.info('\n⚠️  Received SIGINT (Ctrl+C)');
      await this.shutdown();
    });

    // Handle kill command
    process.on('SIGTERM', async () => {
      logger.info('\n⚠️  Received SIGTERM');
      await this.shutdown();
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.error('🚨 Uncaught Exception:', error);
      await this.shutdown(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      logger.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
      await this.shutdown(1);
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(exitCode = 0) {
    try {
      await this.agent.stop();
      process.exit(exitCode);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Display banner
   */
  displayBanner() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║                                                ║');
    console.log('║      🤖 CONVOSO AGENT AUTOMATION 🤖           ║');
    console.log('║                                                ║');
    console.log('║           Production Ready v1.0.0              ║');
    console.log('║                                                ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log('\n');
    console.log('Configuration:');
    console.log(`  Username: ${config.username}`);
    console.log(`  Campaign: ${config.campaignName}`);
    console.log(`  Call Duration: ${config.callDuration / 1000}s`);
    console.log(`  Max Calls: ${config.maxCalls === 0 ? 'Unlimited' : config.maxCalls}`);
    console.log('\n');
  }

  /**
   * Run the application
   */
  async run() {
    try {
      this.displayBanner();
      await this.agent.start();
    } catch (error) {
      logger.error('🚨 Application failed:', error);
      process.exit(1);
    }
  }
}

// Create and run application
const app = new Application();
app.run();