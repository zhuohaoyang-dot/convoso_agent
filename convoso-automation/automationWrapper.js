const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

/**
 * Complete Automation Wrapper
 * Orchestrates the full call automation workflow:
 * 1. Start OCR spam recorder (Python)
 * 2. Start Puppeteer agent (makes calls)
 * 3. Extract call logs from Convoso API
 * 4. Stop OCR recorder
 */
class AutomationOrchestrator {
  constructor() {
    this.pythonProcess = null;
    this.puppeteerProcess = null;
    this.logExtractor = null;
    
    // Paths
    this.pythonScriptPath = path.join(__dirname, '..', 'call_logs_auto', 'auto_spam_recorder.py');
    this.puppeteerScriptPath = path.join(__dirname, 'index.js');
    
    // Config
    this.authToken = process.env.CONVOSO_AUTH_TOKEN || 'dmjhrjn17ou4k7s0u64m7qgwci4v9efd';
    this.campaignId = process.env.CAMPAIGN_ID || '1173';
    
    this.setupSignalHandlers();
  }

  /**
   * Setup graceful shutdown
   */
  setupSignalHandlers() {
    process.on('SIGINT', async () => {
      console.log('\n⚠️  Received SIGINT - shutting down...');
      await this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n⚠️  Received SIGTERM - shutting down...');
      await this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Start Python OCR spam recorder
   */
  startOCRRecorder() {
    return new Promise((resolve, reject) => {
      console.log('📱 Starting OCR Spam Recorder...');
      
      // Check if Python script exists
      if (!fs.existsSync(this.pythonScriptPath)) {
        console.log('⚠️  OCR script not found, skipping...');
        resolve(null);
        return;
      }

      this.pythonProcess = spawn('python3', [this.pythonScriptPath]);

      this.pythonProcess.stdout.on('data', (data) => {
        console.log(`[OCR] ${data.toString().trim()}`);
      });

      this.pythonProcess.stderr.on('data', (data) => {
        console.error(`[OCR Error] ${data.toString().trim()}`);
      });

      this.pythonProcess.on('error', (error) => {
        console.error('❌ Failed to start OCR recorder:', error.message);
        reject(error);
      });

      // Give it time to initialize
      setTimeout(() => {
        console.log('✅ OCR Recorder started');
        resolve(this.pythonProcess);
      }, 2000);
    });
  }

  /**
   * Start Puppeteer agent
   */
  startPuppeteerAgent() {
    return new Promise((resolve, reject) => {
      console.log('🤖 Starting Puppeteer Agent...');
      
      this.puppeteerProcess = spawn('node', [this.puppeteerScriptPath], {
        stdio: 'inherit' // Pass through all output
      });

      this.puppeteerProcess.on('error', (error) => {
        console.error('❌ Failed to start Puppeteer agent:', error.message);
        reject(error);
      });

      this.puppeteerProcess.on('exit', (code) => {
        console.log(`\n🤖 Puppeteer Agent exited with code ${code}`);
        resolve(code);
      });
    });
  }

  /**
   * Extract call logs from Convoso
   */
  async extractCallLogs() {
    try {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 Extracting Call Logs from Convoso...');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const ConvosoLogExtractor = require('./extractCallLogs');
      const extractor = new ConvosoLogExtractor(this.authToken, this.campaignId);

      // Extract today's calls
      const result = await extractor.extractTodaysCalls();

      if (result) {
        console.log('\n✅ Call logs extracted successfully!');
        console.log(`   File: ${result.filepath}`);
        console.log(`   Records: ${result.recordCount}`);
        return result;
      } else {
        console.log('\n⚠️  No call logs found');
        return null;
      }

    } catch (error) {
      console.error('\n❌ Failed to extract call logs:', error.message);
      return null;
    }
  }

  /**
   * Stop OCR recorder
   */
  stopOCRRecorder() {
    if (this.pythonProcess && !this.pythonProcess.killed) {
      console.log('📱 Stopping OCR Recorder...');
      this.pythonProcess.kill('SIGINT');
      return new Promise(resolve => {
        this.pythonProcess.on('exit', () => {
          console.log('✅ OCR Recorder stopped');
          resolve();
        });
        // Force kill after 5 seconds
        setTimeout(() => {
          if (!this.pythonProcess.killed) {
            this.pythonProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);
      });
    }
  }

  /**
   * Cleanup all processes
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    if (this.puppeteerProcess && !this.puppeteerProcess.killed) {
      console.log('🤖 Stopping Puppeteer Agent...');
      this.puppeteerProcess.kill('SIGINT');
    }
    
    await this.stopOCRRecorder();
    
    console.log('✅ Cleanup complete');
  }

  /**
   * Run the complete automation workflow
   */
  async run() {
    try {
      console.log('\n');
      console.log('╔════════════════════════════════════════════════╗');
      console.log('║                                                ║');
      console.log('║     🎯 COMPLETE CALL AUTOMATION SYSTEM 🎯     ║');
      console.log('║                                                ║');
      console.log('╚════════════════════════════════════════════════╝');
      console.log('\n');
      console.log('This will:');
      console.log('  1. Start OCR spam label recorder');
      console.log('  2. Start Puppeteer call automation');
      console.log('  3. Extract call logs when complete');
      console.log('  4. Generate CSV reports');
      console.log('\n');

      // Step 1: Start OCR recorder
      await this.startOCRRecorder();
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 2: Run Puppeteer agent
      const exitCode = await this.startPuppeteerAgent();

      // Step 3: Extract call logs (after Puppeteer completes)
      await this.extractCallLogs();

      // Step 4: Stop OCR recorder
      await this.stopOCRRecorder();

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ Complete automation workflow finished!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      console.log('📁 Output files:');
      console.log('   - Spam labels: call_logs_auto/spam_calls.csv');
      console.log('   - Call logs: convoso-automation/output/*.csv');
      console.log('\n');

      return exitCode;

    } catch (error) {
      console.error('\n❌ Automation workflow failed:', error.message);
      await this.cleanup();
      process.exit(1);
    }
  }
}

// Run if executed directly
if (require.main === module) {
  const orchestrator = new AutomationOrchestrator();
  orchestrator.run().then(exitCode => {
    process.exit(exitCode || 0);
  });
}

module.exports = AutomationOrchestrator;