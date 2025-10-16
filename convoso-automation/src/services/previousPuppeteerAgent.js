const puppeteer = require('puppeteer');
const config = require('../config/config');
const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');
const ConvosoAPI = require('./ConvosoAPI');

/**
 * Puppeteer-based Convoso Agent
 * Uses real browser to handle Janus WebRTC and UI interactions
 */
class PuppeteerAgent {
  constructor() {
    this.browser = null;
    this.page = null;
    this.api = new ConvosoAPI();
    this.isRunning = false;
    this.callCount = 0;
    this.startTime = null;
    this.inCall = false;
    this.lastLeadId = null;
    this.lastCallLogId = null; // Track call_log_id to prevent duplicate operations
  }

  /**
   * Start the browser and login
   */
  async start() {
    try {
      logger.info('🚀 Starting Puppeteer-based Convoso Agent...');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      this.startTime = Date.now();
      this.isRunning = true;

      // Launch browser
      logger.info('🌐 Launching browser...');
      this.browser = await puppeteer.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream'
        ],
        defaultViewport: { width: 1400, height: 900 }
      });

      this.page = await this.browser.newPage();

      // Enable console logging from page for debugging
      this.page.on('console', msg => {
        const text = msg.text();
        if (text.includes('CALL INCOMING') || 
            text.includes('WRAPUP') || 
            text.includes('lead_id') || 
            text.includes('setAvailability') ||
            text.includes('phone state') ||
            text.includes('FINISHED LEAD DISPOSITION') ||
            text.includes('hangup')) {
          logger.info(`🌐 Browser: ${text}`);
        }
      });

      // Set cookies including trusted_device
      if (config.trustedDeviceCookie) {
        await this.page.setCookie({
          name: 'trusted_device',
          value: config.trustedDeviceCookie,
          domain: '.convoso.com'
        });
        logger.info('🔑 Trusted device cookie set');
      }

      // Navigate to login page
      logger.info('🔐 Navigating to login page...');
      await this.page.goto('https://agent.convoso.com/login', {
        waitUntil: 'networkidle2'
      });

      // Fill login form
      await this.page.waitForSelector('#username');
      await this.page.type('#username', config.username);
      await this.page.type('#password', config.password);

      // Click login
      logger.info('📝 Submitting login...');
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
        this.page.click('input[type="submit"]')
      ]);

      logger.info('✅ Login successful');

      // Wait for campaign selection modal
      await Helpers.sleep(3000);

      // Select campaign and set availability
      await this.selectCampaignAndSetAvailable();

      // Start monitoring for calls
      await this.monitorCalls();

    } catch (error) {
      logger.error('❌ Failed to start agent:', Helpers.getErrorMessage(error));
      await this.stop();
      throw error;
    }
  }

  /**
   * Select campaign, login, and set availability to Available
   */
  async selectCampaignAndSetAvailable() {
    try {
      logger.info('📞 Selecting campaign and logging in...');

      // Wait for modal or form to appear
      await Helpers.sleep(2000);

      // Step 1: Select campaign from dropdown
      logger.info(`🎯 Selecting campaign: ${config.campaignName}`);
      
      const campaignSelected = await this.page.evaluate((campaignName) => {
        const selects = Array.from(document.querySelectorAll('select'));
        for (const select of selects) {
          const options = Array.from(select.options);
          const option = options.find(o => o.text.includes(campaignName));
          if (option) {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, config.campaignName);

      if (!campaignSelected) {
        throw new Error(`Campaign "${config.campaignName}" not found`);
      }

      logger.info('✅ Campaign selected');
      await Helpers.sleep(1000);

      // Step 2: Click the login button to enter the campaign
      logger.info('🔘 Clicking login button...');
      
      await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        const loginBtn = buttons.find(b => 
          b.textContent.toLowerCase().includes('login') ||
          b.value?.toLowerCase().includes('login')
        );
        if (loginBtn) {
          loginBtn.click();
        }
      });

      logger.info('✅ Campaign login button clicked');
      
      // Wait for the phone system to initialize
      logger.info('⏳ Waiting for phone system to initialize...');
      await Helpers.sleep(5000);

      // Step 3: Change availability from "Not Ready - Break" to "Available"
      logger.info('🟢 Changing availability to Available...');
      
      const availabilityChanged = await this.page.evaluate((readyCode) => {
        try {
          if (window.angular) {
            const scope = angular.element(document.body).scope();
            
            if (typeof scope.setAvailability === 'function') {
              console.log('Found setAvailability in scope, calling it with code:', readyCode);
              scope.setAvailability(readyCode);
              scope.$apply();
              return true;
            }
            
            if (typeof scope.$root.setAvailability === 'function') {
              console.log('Found setAvailability in rootScope, calling it with code:', readyCode);
              scope.$root.setAvailability(readyCode);
              scope.$apply();
              return true;
            }
            
            let currentScope = scope;
            while (currentScope) {
              if (typeof currentScope.setAvailability === 'function') {
                console.log('Found setAvailability in parent scope, calling it with code:', readyCode);
                currentScope.setAvailability(readyCode);
                scope.$apply();
                return true;
              }
              currentScope = currentScope.$parent;
            }
          }
          
          console.log('Could not find setAvailability function in Angular scope');
          return false;
        } catch (e) {
          console.error('Error calling setAvailability:', e);
          return false;
        }
      }, config.availabilityReady);

      if (availabilityChanged) {
        logger.info('✅ Availability changed via Angular scope');
      } else {
        logger.info('⚠️ Angular method failed, trying UI click method...');
        
        const uiClicked = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const statusBtn = buttons.find(b => 
            b.textContent.includes('Not Ready - Break') || 
            (b.textContent.includes('Not Ready') && !b.classList.contains('ng-hide'))
          );
          
          if (statusBtn) {
            console.log('Found status button, clicking it...');
            statusBtn.click();
            return true;
          }
          
          console.log('Could not find status button');
          return false;
        });

        if (uiClicked) {
          logger.info('✅ Opened availability dropdown');
          await Helpers.sleep(1500);
          
          const availableClicked = await this.page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('button, a, li, [role="menuitem"]'));
            const availableOption = elements.find(o => {
              const text = o.textContent.trim();
              return text === 'Available' && !text.includes('Not') && o.offsetParent !== null;
            });
            
            if (availableOption) {
              console.log('Clicking Available option...');
              availableOption.click();
              return true;
            }
            
            console.log('Could not find Available option');
            return false;
          });
          
          if (availableClicked) {
            logger.info('✅ Clicked Available from dropdown');
          }
        }
      }

      await Helpers.sleep(3000);

      const currentStatus = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const statusBtn = buttons.find(b => 
          b.textContent.includes('Available') || 
          b.textContent.includes('Not Ready')
        );
        return statusBtn ? statusBtn.textContent.trim() : 'Unknown';
      });

      logger.info(`📊 Current availability: ${currentStatus}`);

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('✅ Agent is now ready and listening for calls...');
      logger.info(`⚙️  Call duration: ${config.callDuration / 1000}s`);
      logger.info(`⚙️  Max calls: ${config.maxCalls === 0 ? 'Unlimited' : config.maxCalls}`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
      logger.error('❌ Campaign selection/availability failed:', Helpers.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Monitor for calls using page evaluation
   */
  async monitorCalls() {
    while (this.isRunning) {
      try {
        if (config.maxCalls > 0 && this.callCount >= config.maxCalls) {
          logger.info(`🎯 Maximum calls (${config.maxCalls}) reached. Stopping...`);
          await this.stop();
          break;
        }

        if (this.inCall) {
          await Helpers.sleep(1000);
          continue;
        }

        // Check phone state
        const phoneState = await this.page.evaluate(() => {
          try {
            if (window.angular) {
              const scope = angular.element(document.body).scope();
              return scope.phoneState || scope.$root.phoneState || 0;
            }
            return 0;
          } catch (e) {
            return 0;
          }
        });

        // Only accept calls when in Available state (2)
        if (phoneState !== 2) {
          await Helpers.sleep(2000);
          continue;
        }

        // Check for active call
        const callInfo = await this.page.evaluate(() => {
          try {
            if (window.lead_id && window.lead_id > 0) {
              if (window.angular) {
                const scope = angular.element(document.body).scope();
                if (scope && scope.leadInfo) {
                  return scope.leadInfo;
                }
              }
              
              if (window.leadInfo) {
                return window.leadInfo;
              }
              
              return { lead_id: window.lead_id };
            }
            return null;
          } catch (e) {
            return null;
          }
        });

        if (callInfo && callInfo.lead_id) {
          // Check if this is a truly new call
          if (this.lastLeadId === callInfo.lead_id && 
              this.lastCallLogId === callInfo.call_log_id) {
            await Helpers.sleep(1000);
            continue;
          }
          
          // New call detected!
          this.inCall = true;
          this.lastLeadId = callInfo.lead_id;
          this.lastCallLogId = callInfo.call_log_id;
          await this.handleCall(callInfo);
          this.inCall = false;
        } else {
          await Helpers.sleep(2000);
        }

      } catch (error) {
        logger.error('❌ Error in monitor loop:', Helpers.getErrorMessage(error));
        this.inCall = false;
        await Helpers.sleep(5000);
      }
    }
  }

  /**
   * Handle detected call - LET ANGULAR DO THE WORK
   */
  async handleCall(callInfo) {
    const callStartTime = Date.now();
    this.callCount++;

    try {
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info(`📞 Call #${this.callCount} Connected!`);
      logger.info(`   Lead: ${callInfo.first_name || 'Unknown'} ${callInfo.last_name || ''}`);
      logger.info(`   Phone: ${callInfo.phone_number ? Helpers.formatPhoneNumber(callInfo.phone_code, callInfo.phone_number) : 'Unknown'}`);
      logger.info(`   Lead ID: ${callInfo.lead_id}`);
      if (callInfo.call_log_id) {
        logger.info(`   Call Log ID: ${callInfo.call_log_id}`);
      }

      // Wait configured duration
      logger.info(`⏳ In call for ${config.callDuration / 1000}s...`);
      await Helpers.sleep(config.callDuration);

      // CRITICAL: Click WRAPUP only ONCE and let Angular handle everything
      logger.info('📴 Initiating call end (clicking WRAPUP once)...');
      
      const wrapupClicked = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const wrapupBtn = buttons.find(b => {
          const text = b.textContent.trim();
          return (text === 'WRAPUP' || text === 'Wrapup') && 
                 !b.disabled && 
                 b.offsetParent !== null;
        });
        
        if (wrapupBtn) {
          console.log('Clicking WRAPUP button once...');
          wrapupBtn.click();
          return true;
        }
        return false;
      });

      if (!wrapupClicked) {
        logger.warn('⚠️ WRAPUP button not found, may already be in wrapup state');
      } else {
        logger.info('✅ WRAPUP clicked');
      }

      // CRITICAL: Wait for Angular to complete hangup and show disposition panel
      logger.info('⏳ Waiting for disposition panel to appear...');
      await Helpers.sleep(4000); // Give Angular time to process hangup and render panel

      // CRITICAL: Set disposition ONLY ONCE
      logger.info('📝 Setting disposition...');
      
      const dispositionSet = await this.page.evaluate((dispositionStatus) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        
        // Log what's visible for debugging
        const visibleButtons = buttons
          .filter(b => b.offsetParent !== null && b.textContent.trim().length > 0)
          .map(b => b.textContent.trim());
        console.log('Visible buttons:', visibleButtons.slice(0, 10));
        
        const dispoBtn = buttons.find(b => {
          const text = b.textContent.trim();
          return (text === dispositionStatus || 
                  text === 'Not Contacted' ||
                  text === 'NOCONT') && 
                 !b.disabled && 
                 b.offsetParent !== null;
        });
        
        if (dispoBtn) {
          console.log('Clicking disposition:', dispoBtn.textContent.trim());
          dispoBtn.click();
          return true;
        }
        
        console.log('Disposition button not found');
        return false;
      }, config.dispositionStatus);

      if (!dispositionSet) {
        logger.warn('⚠️ Disposition button not found, trying to open panel...');
        
        // Try to open disposition panel
        const panelOpened = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const dispoBtn = buttons.find(b => 
            b.textContent.trim() === 'Disposition' && 
            !b.disabled && 
            b.offsetParent !== null
          );
          if (dispoBtn) {
            console.log('Opening Disposition panel...');
            dispoBtn.click();
            return true;
          }
          return false;
        });
        
        if (panelOpened) {
          logger.info('✅ Disposition panel opened, waiting...');
          await Helpers.sleep(2000);
          
          // Try again
          const retryDispo = await this.page.evaluate((dispositionStatus) => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const dispoBtn = buttons.find(b => {
              const text = b.textContent.trim();
              return (text === dispositionStatus || text === 'Not Contacted') && 
                     !b.disabled && 
                     b.offsetParent !== null;
            });
            if (dispoBtn) {
              console.log('Clicking disposition (retry):', dispoBtn.textContent.trim());
              dispoBtn.click();
              return true;
            }
            return false;
          }, config.dispositionStatus);
          
          if (retryDispo) {
            logger.info('✅ Disposition set (retry)');
          } else {
            logger.error('❌ Could not set disposition via UI, using API...');
            await this.setDispositionViaAPI(callInfo);
          }
        } else {
          logger.error('❌ Could not open disposition panel, using API...');
          await this.setDispositionViaAPI(callInfo);
        }
      } else {
        logger.info('✅ Disposition set successfully');
      }

      // CRITICAL: Wait for Angular to process disposition and return to Available state
      logger.info('⏳ Waiting for system to return to Available state...');
      
      const availableStateReached = await this.waitForPhoneState(2, 10000);
      
      if (!availableStateReached) {
        logger.warn('⚠️ Did not return to Available state in time');
      } else {
        logger.info('✅ Ready for next call');
      }

      const totalDuration = Date.now() - callStartTime;
      logger.info(`✅ Call #${this.callCount} completed in ${Helpers.formatDuration(Math.floor(totalDuration / 1000))}`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Reset tracking
      this.lastLeadId = null;
      this.lastCallLogId = null;

      // Minimum wait between calls
      logger.info('⏳ Waiting 3s before next call...');
      await Helpers.sleep(3000);

    } catch (error) {
      logger.error(`❌ Error handling call #${this.callCount}:`, Helpers.getErrorMessage(error));
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.lastLeadId = null;
      this.lastCallLogId = null;
      await Helpers.sleep(5000);
    }
  }

  /**
   * Wait for specific phone state
   */
  async waitForPhoneState(expectedState, timeoutMs) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const currentState = await this.page.evaluate(() => {
        try {
          if (window.angular) {
            const scope = angular.element(document.body).scope();
            return scope.phoneState || scope.$root.phoneState || 0;
          }
          return 0;
        } catch (e) {
          return 0;
        }
      });
      
      if (currentState === expectedState) {
        return true;
      }
      
      await Helpers.sleep(500);
    }
    
    return false;
  }

  /**
   * Set disposition via API (fallback)
   */
  async setDispositionViaAPI(callInfo) {
    try {
      const cookies = await this.page.cookies();
      const cookieObj = {};
      cookies.forEach(cookie => {
        cookieObj[cookie.name] = cookie.value;
      });
      
      this.api.cookies = cookieObj;
      
      const sessionInfo = await this.page.evaluate(() => {
        if (window.angular) {
          const scope = angular.element(document.body).scope();
          return {
            session_id: scope.sessionId,
            agent_log_id: scope.agentLogId
          };
        }
        return {};
      });
      
      this.api.sessionId = sessionInfo.session_id;
      this.api.agentLogId = sessionInfo.agent_log_id;
      
      await this.api.setDisposition(
        config.campaignId,
        callInfo.lead_id,
        callInfo.phone_code,
        callInfo.phone_number,
        config.dispositionStatus
      );
      
      logger.info('✅ Disposition set via API');
      return true;
    } catch (error) {
      logger.error('❌ API disposition failed:', Helpers.getErrorMessage(error));
      return false;
    }
  }

  /**
   * Stop the agent
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('🛑 Stopping agent...');
    this.isRunning = false;

    try {
      logger.info('📴 Setting availability to Not Ready - Break...');
      
      const availabilitySet = await this.page.evaluate((notReadyCode) => {
        try {
          if (window.angular) {
            const scope = angular.element(document.body).scope();
            
            if (typeof scope.setAvailability === 'function') {
              console.log('Setting availability to Not Ready via Angular:', notReadyCode);
              scope.setAvailability(notReadyCode);
              scope.$apply();
              return true;
            }
            
            if (typeof scope.$root.setAvailability === 'function') {
              console.log('Setting availability to Not Ready via rootScope:', notReadyCode);
              scope.$root.setAvailability(notReadyCode);
              scope.$apply();
              return true;
            }
          }
          return false;
        } catch (e) {
          console.error('Error setting availability:', e);
          return false;
        }
      }, config.availabilityNotReady);

      if (availabilitySet) {
        logger.info('✅ Availability set to Not Ready');
      }

      await Helpers.sleep(2000);

      logger.info('🚪 Logging out from phone system...');
      
      const logoutSuccess = await this.page.evaluate((logoutCode) => {
        try {
          if (window.angular) {
            const scope = angular.element(document.body).scope();
            
            if (typeof scope.logout === 'function') {
              console.log('Calling logout via Angular');
              scope.logout(logoutCode);
              scope.$apply();
              return true;
            }
            
            if (typeof scope.$root.logout === 'function') {
              console.log('Calling logout via rootScope');
              scope.$root.logout(logoutCode);
              scope.$apply();
              return true;
            }
          }
          return false;
        } catch (e) {
          console.error('Error during logout:', e);
          return false;
        }
      }, config.logoutCode);

      if (logoutSuccess) {
        logger.info('✅ Phone logout successful');
      }

      await Helpers.sleep(2000);

      if (this.browser) {
        await this.browser.close();
        logger.info('✅ Browser closed');
      }

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
      if (this.browser) {
        await this.browser.close();
      }
    }
  }
}

module.exports = PuppeteerAgent;