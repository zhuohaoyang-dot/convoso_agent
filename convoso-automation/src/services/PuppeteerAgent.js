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
        if (text.includes('CALL INCOMING') || text.includes('WRAPUP') || text.includes('lead_id') || text.includes('setAvailability')) {
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
      
      // Method 1: Try using Angular scope directly (MOST RELIABLE - from your working version)
      const availabilityChanged = await this.page.evaluate((readyCode) => {
        try {
          if (window.angular) {
            const scope = angular.element(document.body).scope();
            
            // Try to find setAvailability function in scope
            if (typeof scope.setAvailability === 'function') {
              console.log('Found setAvailability in scope, calling it with code:', readyCode);
              scope.setAvailability(readyCode);
              scope.$apply();
              return true;
            }
            
            // Try rootScope
            if (typeof scope.$root.setAvailability === 'function') {
              console.log('Found setAvailability in rootScope, calling it with code:', readyCode);
              scope.$root.setAvailability(readyCode);
              scope.$apply();
              return true;
            }
            
            // Try to find it in any parent scope
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
        
        // Method 2: Click the UI dropdown
        const uiClicked = await this.page.evaluate(() => {
          // Find the status button in navbar (usually has red background for "Not Ready")
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
          
          // Click "Available" from dropdown
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
          } else {
            logger.warn('⚠️ Could not click Available option');
          }
        } else {
          logger.warn('⚠️ UI click failed, trying API...');
          
          // Method 3: Fall back to API
          const cookies = await this.page.cookies();
          const cookieObj = {};
          cookies.forEach(cookie => {
            cookieObj[cookie.name] = cookie.value;
          });
          
          this.api.cookies = cookieObj;
          
          const sessionInfo = await this.page.evaluate(() => {
            if (window.angular) {
              const scope = angular.element(document.body).scope();
              const rootScope = scope.$root;
              return {
                session_id: rootScope.sessionId || window.sessionId,
                agent_log_id: rootScope.agentLogId || window.agentLogId
              };
            }
            return {};
          });
          
          this.api.sessionId = sessionInfo.session_id;
          this.api.agentLogId = sessionInfo.agent_log_id;
          
          await this.api.changeAvailability(config.campaignId, config.availabilityReady);
        }
      }

      // Wait for availability change to take effect
      await Helpers.sleep(3000);

      // Verify current status
      const currentStatus = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const statusBtn = buttons.find(b => 
          b.textContent.includes('Available') || 
          b.textContent.includes('Not Ready')
        );
        return statusBtn ? statusBtn.textContent.trim() : 'Unknown';
      });

      logger.info(`📊 Current availability: ${currentStatus}`);

      if (currentStatus !== 'Available') {
        logger.warn('⚠️ Availability may not be set correctly. Please check the browser.');
      }

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
        // Check if max calls reached
        if (config.maxCalls > 0 && this.callCount >= config.maxCalls) {
          logger.info(`🎯 Maximum calls (${config.maxCalls}) reached. Stopping...`);
          await this.stop();
          break;
        }

        // Skip if already in a call
        if (this.inCall) {
          await Helpers.sleep(1000);
          continue;
        }

        // Check for active call by looking for window.lead_id
        const callInfo = await this.page.evaluate(() => {
          try {
            if (window.lead_id && window.lead_id > 0) {
              // Get lead info from Angular scope
              if (window.angular) {
                const scope = angular.element(document.body).scope();
                if (scope && scope.leadInfo) {
                  return scope.leadInfo;
                }
              }
              
              // Fallback: try window.leadInfo
              if (window.leadInfo) {
                return window.leadInfo;
              }
              
              // Last resort: return just the lead_id
              return { lead_id: window.lead_id };
            }
            return null;
          } catch (e) {
            return null;
          }
        });

        if (callInfo && callInfo.lead_id) {
          // Check if this is a new call (not duplicate)
          if (this.lastLeadId === callInfo.lead_id) {
            await Helpers.sleep(1000);
            continue;
          }
          
          // New call detected!
          this.inCall = true;
          this.lastLeadId = callInfo.lead_id;
          await this.handleCall(callInfo);
          this.inCall = false;
        } else {
          // No call detected, reset last lead ID
          this.lastLeadId = null;
          await Helpers.sleep(2000);
        }

      } catch (error) {
        logger.error('❌ Error in monitor loop:', Helpers.getErrorMessage(error));
        this.inCall = false;
        this.lastLeadId = null;
        await Helpers.sleep(5000);
      }
    }
  }

  /**
   * Handle detected call
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

      // Wait configured duration (simulating talking)
      logger.info(`⏳ In call for ${config.callDuration / 1000}s...`);
      await Helpers.sleep(config.callDuration);

      // Step 1: Click WRAPUP button
      logger.info('📴 Looking for WRAPUP button...');
      
      const wrapupClicked = await this.page.evaluate(() => {
        // Find the WRAPUP button (exact text match)
        const buttons = Array.from(document.querySelectorAll('button'));
        
        const wrapupBtn = buttons.find(b => {
          const text = b.textContent.trim();
          return text === 'WRAPUP' && !b.disabled && b.offsetParent !== null;
        });
        
        if (wrapupBtn) {
          console.log('Found WRAPUP button, clicking...');
          wrapupBtn.click();
          return true;
        }
        
        console.log('WRAPUP button not found');
        return false;
      });

      if (wrapupClicked) {
        logger.info('✅ WRAPUP button clicked');
      } else {
        logger.warn('⚠️ WRAPUP button not found - waiting for voicemail detection...');
        
        // Wait for voicemail to be detected (system shows WRAPUP button after detection)
        logger.info('⏳ Waiting 3s for voicemail detection...');
        await Helpers.sleep(3000);
        
        // Try again
        const retryWrapup = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const wrapupBtn = buttons.find(b => 
            b.textContent.trim() === 'WRAPUP' && !b.disabled && b.offsetParent !== null
          );
          if (wrapupBtn) {
            console.log('Found WRAPUP button on retry, clicking...');
            wrapupBtn.click();
            return true;
          }
          return false;
        });
        
        if (retryWrapup) {
          logger.info('✅ WRAPUP button clicked (retry)');
        } else {
          logger.warn('⚠️ Still cannot find WRAPUP button');
          logger.info('💡 Checking for Wrapup/Reconnect modal...');
          
          // Sometimes a modal appears with "Reconnect" and "Wrapup" options
          const modalWrapup = await this.page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            
            // Look for "Wrapup" button (capitalized differently) in modal
            const wrapupBtn = buttons.find(b => {
              const text = b.textContent.trim();
              return (text === 'Wrapup' || text === 'WRAPUP') && !b.disabled;
            });
            
            if (wrapupBtn) {
              console.log('Found Wrapup in modal, clicking...');
              wrapupBtn.click();
              return true;
            }
            
            return false;
          });
          
          if (modalWrapup) {
            logger.info('✅ Wrapup button clicked from modal');
          } else {
            logger.error('❌ Could not find WRAPUP button anywhere, using API hangup...');
            
            const actualDuration = Date.now() - callStartTime;
            const sessionInfo = await this.page.evaluate(() => {
              if (window.angular) {
                const scope = angular.element(document.body).scope();
                return {
                  session_id: scope.sessionId || scope.session_id,
                  agent_log_id: scope.agentLogId || scope.agent_log_id
                };
              }
              return {};
            });

            await this.api.hangup(
              config.campaignId,
              callInfo,
              actualDuration,
              sessionInfo.session_id,
              sessionInfo.agent_log_id
            );
          }
        }
      }

      // Wait for wrapup to complete
      await Helpers.sleep(2000);

      // Step 2: Click "Not Contacted" disposition button
      logger.info(`📝 Looking for "${config.dispositionStatus}" button...`);
      
      const dispositionClicked = await this.page.evaluate((dispositionStatus) => {
        // Find the "Not Contacted" button (exact text match)
        const buttons = Array.from(document.querySelectorAll('button'));
        
        const dispoBtn = buttons.find(b => {
          const text = b.textContent.trim();
          return (text === dispositionStatus || text === 'Not Contacted') && 
                 !b.disabled && 
                 b.offsetParent !== null;
        });
        
        if (dispoBtn) {
          console.log('Found disposition button:', dispoBtn.textContent.trim());
          dispoBtn.click();
          return true;
        }
        
        console.log('Disposition button not found. Visible buttons:', 
          buttons.filter(b => b.offsetParent !== null && b.textContent.trim().length > 0)
                 .map(b => b.textContent.trim())
                 .slice(0, 20)
        );
        return false;
      }, config.dispositionStatus);

      if (dispositionClicked) {
        logger.info('✅ Disposition button clicked');
      } else {
        logger.warn('⚠️ Disposition button not found in main view');
        logger.info('💡 Checking if we need to open Disposition panel...');
        
        // Try to find and click "Disposition" button to open panel
        const dispositionPanelOpened = await this.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const dispoBtn = buttons.find(b => 
            b.textContent.trim() === 'Disposition' && 
            !b.disabled && 
            b.offsetParent !== null
          );
          if (dispoBtn) {
            console.log('Found Disposition panel button, clicking...');
            dispoBtn.click();
            return true;
          }
          return false;
        });
        
        if (dispositionPanelOpened) {
          logger.info('✅ Disposition panel opened');
          await Helpers.sleep(1500);
          
          // Now try to find the actual disposition status
          const dispositionSet = await this.page.evaluate((dispositionStatus) => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const dispoBtn = buttons.find(b => 
              b.textContent.trim() === dispositionStatus || 
              b.textContent.trim() === 'Not Contacted'
            );
            if (dispoBtn && !dispoBtn.disabled) {
              console.log('Found disposition in panel:', dispoBtn.textContent.trim());
              dispoBtn.click();
              return true;
            }
            return false;
          }, config.dispositionStatus);
          
          if (dispositionSet) {
            logger.info('✅ Disposition set from panel');
          } else {
            logger.warn('⚠️ Still cannot find disposition, using API...');
            await this.setDispositionViaAPI(callInfo);
          }
        } else {
          logger.warn('⚠️ Could not open disposition panel, using API...');
          await this.setDispositionViaAPI(callInfo);
        }
      }

      // Wait for disposition to be saved
      await Helpers.sleep(2000);

      const totalDuration = Date.now() - callStartTime;
      logger.info(`✅ Call #${this.callCount} completed in ${Helpers.formatDuration(Math.floor(totalDuration / 1000))}`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Reset last lead ID so next call can be detected
      this.lastLeadId = null;

      // Wait for system to auto-dial next call
      logger.info('⏳ Waiting for next call...');
      await Helpers.sleep(3000);

    } catch (error) {
      logger.error(`❌ Error handling call #${this.callCount}:`, Helpers.getErrorMessage(error));
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      this.lastLeadId = null;
      await Helpers.sleep(5000);
    }
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
    } catch (error) {
      logger.error('❌ API disposition failed:', Helpers.getErrorMessage(error));
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
      // Click the current status button to open dropdown
      logger.info('📴 Setting availability to Not Ready - Break...');
      
      await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const statusBtn = buttons.find(b => 
          b.textContent.includes('Available') || 
          b.textContent.includes('Not Ready')
        );
        if (statusBtn) {
          statusBtn.click();
        }
      });

      await Helpers.sleep(1000);

      // Click "Not Ready - Break" from dropdown
      await this.page.evaluate(() => {
        const options = Array.from(document.querySelectorAll('button, a, li, [role="menuitem"]'));
        const breakOption = options.find(o => 
          o.textContent.includes('Not Ready - Break')
        );
        if (breakOption) {
          breakOption.click();
        }
      });

      await Helpers.sleep(2000);

      if (this.browser) {
        await this.browser.close();
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