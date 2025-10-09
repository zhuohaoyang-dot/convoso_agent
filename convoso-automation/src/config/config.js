require('dotenv').config();

/**
 * Configuration management for Convoso automation
 */
class Config {
  constructor() {
    // Validate required environment variables
    this.validateEnv();
  }

  validateEnv() {
    const required = ['CONVOSO_USERNAME', 'CONVOSO_PASSWORD', 'CAMPAIGN_ID'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  // Convoso credentials
  get username() {
    return process.env.CONVOSO_USERNAME;
  }

  get password() {
    return process.env.CONVOSO_PASSWORD;
  }

  get trustedDeviceCookie() {
    return process.env.TRUSTED_DEVICE_COOKIE || '';
  }

  // Campaign settings
  get campaignId() {
    return process.env.CAMPAIGN_ID;
  }

  get campaignName() {
    return process.env.CAMPAIGN_NAME || 'Default Campaign';
  }

  get campaignDialMethod() {
    return process.env.CAMPAIGN_DIAL_METHOD || 'RATIO';
  }

  // Agent settings
  get callDuration() {
    return parseInt(process.env.CALL_DURATION_SECONDS || '15') * 1000;
  }

  get pollInterval() {
    return parseInt(process.env.POLL_INTERVAL_MS || '2000');
  }

  get maxCalls() {
    return parseInt(process.env.MAX_CALLS_PER_SESSION || '0');
  }

  // Availability codes
  get availabilityReady() {
    return process.env.AVAILABILITY_READY || '2';
  }

  get availabilityNotReady() {
    return process.env.AVAILABILITY_NOT_READY || '1066';
  }

  // Disposition
  get dispositionStatus() {
    return process.env.DISPOSITION_STATUS || 'NOCONT';
  }

  // Logging
  get logLevel() {
    return process.env.LOG_LEVEL || 'info';
  }

  get logToFile() {
    return process.env.LOG_TO_FILE === 'true';
  }

  // Logout code
  get logoutCode() {
    return process.env.LOGOUT_CODE || '20';
  }

  // API endpoints
  get endpoints() {
    return {
      login: 'https://agent.convoso.com/login/check-login',
      phoneLogin: 'https://agent-dt.convoso.com/phone/login',
      availabilityChange: 'https://agent-dt.convoso.com/phone/availability-change',
      resume: 'https://agent-dt.convoso.com/phone/resume',
      checkAutoIncoming: 'https://agent-dt.convoso.com/phone/check-auto-incoming',
      hangup: 'https://agent-dt.convoso.com/phone/hangup',
      leadDisposition: 'https://agent-dt.convoso.com/phone/lead-disposition',
      phoneLogout: 'https://agent-dt.convoso.com/phone/logout'
    };
  }
}

module.exports = new Config();