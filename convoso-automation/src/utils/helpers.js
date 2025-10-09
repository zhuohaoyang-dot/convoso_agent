const { v4: uuidv4 } = require('uuid');

/**
 * Helper utility functions
 */
class Helpers {
  /**
   * Sleep for specified milliseconds
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate UUID v4
   */
  static generateUUID() {
    return uuidv4();
  }

  /**
   * Format duration in seconds to readable string
   */
  static formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  /**
   * Get current timestamp for logging
   */
  static getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Format phone number
   */
  static formatPhoneNumber(phoneCode, phoneNumber) {
    return `+${phoneCode} ${phoneNumber}`;
  }

  /**
   * Safe JSON parse with fallback
   */
  static safeJSONParse(str, fallback = null) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return fallback;
    }
  }

  /**
   * Extract error message from various error types
   */
  static getErrorMessage(error) {
    if (error.response) {
      // Axios error with response
      return error.response.data?.message || error.response.statusText || error.message;
    } else if (error.request) {
      // Axios error without response
      return 'No response received from server';
    } else {
      // Other errors
      return error.message || 'Unknown error';
    }
  }

  /**
   * Retry function with exponential backoff
   */
  static async retry(fn, maxRetries = 3, delayMs = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        const delay = delayMs * Math.pow(2, i);
        await this.sleep(delay);
      }
    }
  }

  /**
   * Get current date string
   */
  static getCurrentDate() {
    return new Date().toISOString().split('T')[0];
  }
}

module.exports = Helpers;