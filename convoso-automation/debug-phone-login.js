require('dotenv').config();
const axios = require('axios');
const config = require('./src/config/config');

async function debugPhoneLogin() {
  console.log('🔍 Enhanced Debug - Phone Login Issue\n');
  
  // Step 1: Login with trusted device
  console.log('Step 1: Login with Trusted Device');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const cookies = {};
  
  // Add trusted device cookie first
  if (config.trustedDeviceCookie) {
    cookies['trusted_device'] = config.trustedDeviceCookie;
    console.log('✅ Trusted device cookie added');
  }
  
  const loginHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
  
  if (config.trustedDeviceCookie) {
    loginHeaders['Cookie'] = `trusted_device=${config.trustedDeviceCookie}`;
  }
  
  const loginResponse = await axios.post(
    config.endpoints.login,
    `username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}`,
    {
      headers: loginHeaders,
      maxRedirects: 0,
      validateStatus: (status) => status === 302 || status === 200
    }
  );
  
  console.log('Login Status:', loginResponse.status);
  console.log('Redirect URL:', loginResponse.headers.location);
  
  // Extract cookies
  const setCookieHeaders = loginResponse.headers['set-cookie'];
  if (setCookieHeaders) {
    setCookieHeaders.forEach(cookie => {
      const [nameValue] = cookie.split(';');
      const [name, value] = nameValue.split('=');
      cookies[name] = value;
    });
  }
  
  console.log('Cookies after login:', Object.keys(cookies));
  
  // Step 2: Follow redirect
  console.log('\n\nStep 2: Follow Redirect to Complete Auth');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const redirectUrl = loginResponse.headers.location;
  const cookieString = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
  
  console.log('Following:', redirectUrl);
  console.log('With cookies:', Object.keys(cookies).join(', '));
  
  const redirectResponse = await axios.get(redirectUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': cookieString,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    maxRedirects: 5
  });
  
  console.log('Redirect Status:', redirectResponse.status);
  
  // Extract new cookies
  const redirectSetCookie = redirectResponse.headers['set-cookie'];
  if (redirectSetCookie) {
    console.log('\n✅ New cookies from redirect:');
    redirectSetCookie.forEach(cookie => {
      const [nameValue] = cookie.split(';');
      const [name, value] = nameValue.split('=');
      cookies[name] = value;
      console.log(`   ${name}`);
    });
  } else {
    console.log('\n⚠️  No new cookies from redirect');
  }
  
  console.log('\nTotal cookies now:', Object.keys(cookies));
  console.log('Cookie names:', Object.keys(cookies).join(', '));
  
  // Check if we got the essential cookies
  const essentialCookies = ['PROJECTXSESS', 'ACCOUNT_ID', 'CLUSTER'];
  const missingCookies = essentialCookies.filter(c => !cookies[c]);
  
  if (missingCookies.length > 0) {
    console.log('\n⚠️  MISSING ESSENTIAL COOKIES:', missingCookies.join(', '));
  } else {
    console.log('\n✅ All essential cookies present!');
  }
  
  // Step 3: Phone Login
  console.log('\n\nStep 3: Phone System Login');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const finalCookieString = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
  
  console.log('Using cookies:', Object.keys(cookies).join(', '));
  
  const phonePayload = {
    CurrentConnectionOptions: {
      value: config.campaignId,
      name: config.campaignName,
      type: 'campaign',
      dial_method: config.campaignDialMethod
    },
    login_type: 'login',
    selected_channels: ['VOICE']
  };
  
  console.log('\nPayload:', JSON.stringify(phonePayload, null, 2));
  
  try {
    const phoneResponse = await axios.post(
      config.endpoints.phoneLogin,
      phonePayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': finalCookieString,
          'Accept': 'application/json, text/plain, */*',
          'Origin': 'https://agent-dt.convoso.com',
          'Referer': 'https://agent-dt.convoso.com/'
        }
      }
    );
    
    console.log('\n✅ Phone Login Response:');
    console.log('Status:', phoneResponse.status);
    console.log('Content-Type:', phoneResponse.headers['content-type']);
    
    // Check if response is JSON or HTML
    if (typeof phoneResponse.data === 'string') {
      if (phoneResponse.data.includes('<!DOCTYPE html>')) {
        console.log('\n❌ Got HTML page (not authenticated)');
        if (phoneResponse.data.includes('Sign in')) {
          console.log('   Response is login page - session not valid!');
        }
      } else {
        console.log('Response:', phoneResponse.data.substring(0, 500));
      }
    } else {
      console.log('\n✅ Got JSON response!');
      console.log('Data:', JSON.stringify(phoneResponse.data, null, 2));
    }
    
  } catch (error) {
    console.log('\n❌ Phone Login Error:');
    console.log('Status:', error.response?.status);
    console.log('Content-Type:', error.response?.headers['content-type']);
    
    if (typeof error.response?.data === 'string') {
      if (error.response.data.includes('<!DOCTYPE html>')) {
        console.log('Got HTML page (session invalid)');
      } else {
        console.log('Response:', error.response.data.substring(0, 200));
      }
    } else {
      console.log('Response:', error.response?.data);
    }
  }
}

debugPhoneLogin().catch(console.error);