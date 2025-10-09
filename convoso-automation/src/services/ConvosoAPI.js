const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');

/**
 * Convoso API Client
 * Handles all HTTP requests to Convoso platform
 */
class ConvosoAPI {
  constructor() {
    this.cookies = {};
    this.sessionId = null;
    this.agentLogId = null;
    this.userId = null;
  }

  /**
   * Create axios instance with cookies
   */
  createAxiosInstance() {
    const cookieString = Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');

    return axios.create({
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookieString
      },
      maxRedirects: 0,
      validateStatus: (status) => status < 400
    });
  }

  /**
   * Extract and store cookies from response
   */
  extractCookies(response) {
    const setCookieHeaders = response.headers['set-cookie'];
    if (setCookieHeaders) {
      setCookieHeaders.forEach(cookie => {
        const [nameValue] = cookie.split(';');
        const [name, value] = nameValue.split('=');
        this.cookies[name] = value;
      });
    }
  }

  /**
   * Step 1: Initial login
   */
  async login(username, password) {
    try {
      logger.info('🔐 Attempting login...');

      // Add trusted device cookie if available
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      };

      if (config.trustedDeviceCookie) {
        headers['Cookie'] = `trusted_device=${config.trustedDeviceCookie}`;
        this.cookies['trusted_device'] = config.trustedDeviceCookie;
        logger.info('🔑 Using trusted device cookie');
      }

      const response = await axios.post(
        config.endpoints.login,
        `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
        {
          headers,
          maxRedirects: 0,
          validateStatus: (status) => status === 302 || status === 200
        }
      );

      this.extractCookies(response);

      if (response.status === 302 && response.headers.location) {
        logger.info('✅ Login successful - received redirect');
        
        // Follow the redirect to get session cookies
        let redirectUrl = response.headers.location;
        logger.info('🔄 Following redirect to complete authentication...');
        
        // First redirect - may return another 302
        const axiosInstance = this.createAxiosInstance();
        const verifyResponse = await axiosInstance.get(redirectUrl, {
          maxRedirects: 0,
          validateStatus: (status) => status < 400
        });
        
        this.extractCookies(verifyResponse);
        logger.info(`   Cookies after first redirect: ${Object.keys(this.cookies).length}`);
        
        // Check if there's another redirect (302 to /)
        if (verifyResponse.status === 302 && verifyResponse.headers.location) {
          logger.info('🔄 Following second redirect...');
          const secondRedirect = verifyResponse.headers.location;
          
          // Build full URL if relative
          const finalUrl = secondRedirect.startsWith('http') 
            ? secondRedirect 
            : `https://agent-dt.convoso.com${secondRedirect}`;
          
          const axiosInstance2 = this.createAxiosInstance();
          const finalResponse = await axiosInstance2.get(finalUrl, {
            maxRedirects: 5,
            validateStatus: (status) => status < 400
          });
          
          this.extractCookies(finalResponse);
        }
        
        logger.info('✅ Authentication completed');
        logger.info(`   Total cookies: ${Object.keys(this.cookies).length}`);
        
        // Verify we have essential cookies
        const essentialCookies = ['PROJECTXSESS', 'ACCOUNT_ID', 'CLUSTER'];
        const hasCookies = essentialCookies.every(c => this.cookies[c]);
        
        if (hasCookies) {
          logger.info(`   ✅ All essential cookies present`);
        } else {
          const missing = essentialCookies.filter(c => !this.cookies[c]);
          logger.warn(`   ⚠️  Missing cookies: ${missing.join(', ')}`);
        }
        
        return true;
      }

      throw new Error('Login failed - no redirect received');
    } catch (error) {
      logger.error('❌ Login failed:', Helpers.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Step 2: Phone system login
   */
  async phoneLogin(campaignId, campaignName, dialMethod) {
    try {
      logger.info('📞 Logging into phone system...');

      const axiosInstance = this.createAxiosInstance();
      const response = await axiosInstance.post(config.endpoints.phoneLogin, {
        CurrentConnectionOptions: {
          value: campaignId,
          name: campaignName,
          type: 'campaign',
          dial_method: dialMethod
        },
        login_type: 'login',
        selected_channels: ['VOICE']
      });

      this.extractCookies(response);

      if (response.data.success && response.data.data) {
        this.sessionId = response.data.data.session_id;
        this.agentLogId = response.data.data.agent_log_id;

        logger.info(`✅ Phone login successful`);
        logger.info(`   Session ID: ${this.sessionId}`);
        logger.info(`   Agent Log ID: ${this.agentLogId}`);

        return response.data;
      }

      throw new Error('Phone login failed - invalid response');
    } catch (error) {
      logger.error('❌ Phone login failed:', Helpers.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Step 3: Change availability
   */
  async changeAvailability(campaignId, availabilityCode) {
    try {
      const status = availabilityCode === config.availabilityReady ? 'Available' : 'Not Ready';
      logger.info(`🟢 Setting availability to: ${status}`);

      const axiosInstance = this.createAxiosInstance();
      
      // If setting to Available, call resume first
      if (availabilityCode === config.availabilityReady) {
        logger.info('📞 Calling resume endpoint...');
        
        try {
          await axiosInstance.post(config.endpoints.resume, {
            campaign: campaignId,
            campaign_uids: [campaignId],
            session_id: this.sessionId,
            agent_log_id: this.agentLogId
          });
          logger.info('✅ Resume successful');
        } catch (resumeError) {
          logger.warn('⚠️ Resume call failed, continuing anyway...');
        }
        
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Then call availability-change
      const response = await axiosInstance.post(config.endpoints.availabilityChange, {
        campaign: availabilityCode === config.availabilityReady ? '' : campaignId,
        campaign_uids: [campaignId],
        availability: availabilityCode,
        uid: Helpers.generateUUID()
      });

      this.extractCookies(response);

      if (response.data.success) {
        logger.info(`✅ Availability set to: ${status}`);
        return response.data;
      }

      throw new Error('Availability change failed');
    } catch (error) {
      logger.error('❌ Availability change failed:', Helpers.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Step 4: Check for incoming calls (polling)
   */
  async checkAutoIncoming(campaignId, dialMethod) {
    try {
      const axiosInstance = this.createAxiosInstance();
      const response = await axiosInstance.post(config.endpoints.checkAutoIncoming, {
        campaign: '',
        campaign_uids: [campaignId],
        campaign_dial_method: dialMethod,
        agent_log_id: this.agentLogId,
        session_id: this.sessionId,
        agent_setting_sources: 'source_campaign',
        preview_inbound_call_state: 0,
        uid: Helpers.generateUUID()
      });

      if (response.data.success && response.data.data.found === 1) {
        return {
          found: true,
          callInfo: response.data.data.info
        };
      }

      return { found: false };
    } catch (error) {
      logger.error('❌ Check auto incoming failed:', Helpers.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Step 5: Hangup call
   */
  async hangup(campaignId, callInfo, callDuration, sessionId = null, agentLogId = null) {
    try {
      logger.info(`📴 Hanging up call to ${Helpers.formatPhoneNumber(callInfo.phone_code, callInfo.phone_number)}`);

      const axiosInstance = this.createAxiosInstance();
      const response = await axiosInstance.post(config.endpoints.hangup, {
        campaign: campaignId,
        session_id: sessionId || this.sessionId,
        agent_log_id: agentLogId || this.agentLogId,
        call_time: Math.floor(callDuration / 1000).toString(),
        caller_id: '',
        conference: 0,
        max_hold_time_reached: 0,
        term_reason: 'AGENT',
        lead_info: callInfo
      });

      if (response.data.ishangup) {
        logger.info('✅ Call hung up successfully');
        return response.data;
      }

      throw new Error('Hangup failed');
    } catch (error) {
      logger.error('❌ Hangup failed:', Helpers.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Step 6: Set lead disposition
   */
  async setDisposition(campaignId, leadId, phoneCode, phoneNumber, status) {
    try {
      logger.info(`📝 Setting disposition: ${status} for lead ${leadId}`);

      const axiosInstance = this.createAxiosInstance();
      const response = await axiosInstance.put(config.endpoints.leadDisposition, {
        campaign: campaignId,
        lead_id: leadId,
        status: status,
        agent_log_id: this.agentLogId,
        phone_code: phoneCode,
        phone_number: phoneNumber,
        call_type: 'OUT',
        comments: '',
        audio_quality: '',
        blended: '0',
        callback_recipient: '1',
        callback_time: '',
        callback_time_zone: '-5.00',
        dispo_callback: '',
        pause_dialer: '',
        queue_id: null,
        script_json_data: {
          user_id: this.userId || 0,
          date: Helpers.getCurrentDate()
        },
        selected_dispo_note: '',
        voice_off: false
      });

      this.extractCookies(response);

      if (response.data.success) {
        // Update agent_log_id from response
        if (response.data.data?.agentLogId) {
          this.agentLogId = response.data.data.agentLogId;
        }

        logger.info(`✅ Disposition set: ${status}`);
        return response.data;
      }

      throw new Error('Disposition failed');
    } catch (error) {
      logger.error('❌ Set disposition failed:', Helpers.getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Step 7: Logout from phone system
   */
  async phoneLogout(campaignId) {
    try {
      logger.info('🚪 Logging out from phone system...');

      const axiosInstance = this.createAxiosInstance();
      const response = await axiosInstance.post(config.endpoints.phoneLogout, {
        logout_code: config.logoutCode,
        campaign: campaignId,
        campaign_uids: [campaignId],
        agent_log_id: this.agentLogId,
        session_id: this.sessionId
      });

      if (response.data.success || response.status === 200) {
        logger.info('✅ Phone logout successful');
        return response.data;
      }

      throw new Error('Phone logout failed');
    } catch (error) {
      logger.error('❌ Phone logout failed:', Helpers.getErrorMessage(error));
      throw error;
    }
  }
}

module.exports = ConvosoAPI;