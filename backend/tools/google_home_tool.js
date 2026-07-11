const os = require('os');
const { getDb } = require('../db');
const { generateTTS } = require('../utils/tts');
const path = require('path');
const fs = require('fs');

async function executeViaAssistantSDK(command) {
  const credentialsPath = path.resolve(__dirname, '../credentials.json');
  const tokensPath = path.resolve(__dirname, '../tokens.json');
  
  if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokensPath)) {
    return { success: false, reason: 'missing_credentials' };
  }

  const GoogleAssistant = require('google-assistant');
  const config = {
    auth: {
      keyFilePath: credentialsPath,
      savedTokensPath: tokensPath,
    },
    conversation: {
      lang: 'en-US',
      isNew: true,
      textQuery: command,
    },
  };

  return new Promise((resolve) => {
    try {
      const assistant = new GoogleAssistant(config.auth);
      assistant.on('ready', () => {
        assistant.start(config.conversation, (conversation) => {
          let responseText = '';
          conversation
            .on('response', (text) => {
              responseText += text + ' ';
            })
            .on('ended', (error, continueConversation) => {
              if (error) {
                resolve({ success: false, error: error.message || error });
              } else {
                resolve({ success: true, response: responseText.trim() });
              }
            })
            .on('error', (error) => {
              resolve({ success: false, error: error.message || error });
            });
        });
      });
      assistant.on('error', (err) => {
        resolve({ success: false, error: err.message || err });
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        if (net.address.startsWith('192.168.') || net.address.startsWith('10.') || net.address.startsWith('172.')) {
          return net.address;
        }
      }
    }
  }
  return 'localhost';
}

/**
 * Executes a home automation command via local Google Cast connection.
 */
async function handleGoogleHomeTool(db, userId, action, params) {
  if (action === 'list_devices') {
    try {
      const mDnsSd = require('node-dns-sd');
      const deviceList = await mDnsSd.discover({ name: '_googlecast._tcp.local', timeout: 3 });
      const devices = deviceList.map(device => ({
        fqdn: device.fqdn,
        address: device.address,
        modelName: device.modelName
      }));
      return JSON.stringify({
        success: true,
        devices: devices
      });
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: `Failed to discover devices: ${err.message}`
      });
    }
  }

  if (action !== 'send_command') {
    return JSON.stringify({ error: `Unknown action: ${action}` });
  }

  const { command } = params;
  if (!command) {
    return JSON.stringify({ error: 'Command string is required' });
  }

  // 1. Fetch saved configuration settings and check if enabled
  const settings = await db.get('SELECT google_home_enabled, google_home_ip, google_home_name FROM user_settings WHERE user_id = ?', [userId]) || {};
  if (!settings.google_home_enabled) {
    return JSON.stringify({
      success: false,
      error: 'Google Home speaker integration is disabled. You can optionally enable it in the Assistant Settings modal.'
    });
  }

  // 2. Try to execute via Assistant SDK first
  const sdkResult = await executeViaAssistantSDK(command);
  
  let ttsText = '';
  let commandExecuted = false;

  if (sdkResult.success) {
    // SDK execution worked. The command was actually executed!
    // We will just cast a confirmation response to the Nest Mini.
    ttsText = sdkResult.response || 'Action completed.';
    commandExecuted = true;
  } else {
    // Fallback or failed. Use the old behavior of speaking the command.
    if (sdkResult.reason === 'missing_credentials') {
      console.warn('Google Assistant SDK credentials missing. Falling back to simple TTS broadcasting.');
    } else {
      console.error(`Google Assistant SDK error: ${sdkResult.error}. Falling back to simple TTS.`);
    }
    
    // Prepend activation phrase if not already present
    ttsText = command.trim();
    if (!/^ok\s+google/i.test(ttsText) && !/^hey\s+google/i.test(ttsText)) {
      ttsText = `Ok Google, ${ttsText}`;
    }
  }

  try {
    // 3. Generate local TTS file path
    const ttsUrl = await generateTTS(ttsText);
    const localIp = getLocalIpAddress();
    const port = process.env.PORT || 3000;
    const mediaUrl = `http://${localIp}:${port}${ttsUrl}`;

    let targetIp = settings.google_home_ip;
    const targetName = settings.google_home_name;

    // 3. Scan & dynamic resolution if friendly name is configured
    let resolvedDevice = null;
    const ChromecastAPI = require('chromecast-api');

    if (targetName) {
      const client = new ChromecastAPI();
      resolvedDevice = await new Promise((resolve) => {
        let found = false;
        const timeout = setTimeout(() => {
          try {
            if (client.browser && typeof client.browser.destroy === 'function') {
              client.browser.destroy();
            }
          } catch (e) {}
          resolve(null);
        }, 2500);

        client.on('device', (device) => {
          if (device && (device.friendlyName === targetName || device.name === targetName)) {
            found = true;
            clearTimeout(timeout);
            try {
              if (client.browser && typeof client.browser.destroy === 'function') {
                client.browser.destroy();
              }
            } catch (e) {}
            resolve(device);
          }
        });
      });
    }

    if (resolvedDevice) {
      targetIp = resolvedDevice.host;
      if (targetIp !== settings.google_home_ip) {
        await db.run('UPDATE user_settings SET google_home_ip = ? WHERE user_id = ?', [targetIp, userId]);
      }
    } else {
      // Fallback to database configured IP or hardcoded default
      targetIp = targetIp || '192.168.1.60';
    }

    // 4. Instantiation & direct play
    const Device = require('chromecast-api/lib/device');
    const device = new Device({
      host: targetIp,
      name: targetName || 'Google Home',
      friendlyName: targetName || 'Google Home'
    });

    device.on('error', (err) => {
      console.error('[Chromecast Device Error]:', err.message);
    });

    await new Promise((resolve, reject) => {
      device.play(mediaUrl, { startTime: 0 }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    return JSON.stringify({
      success: true,
      message: commandExecuted 
        ? `Successfully executed command via Assistant SDK and casted confirmation to speaker (${targetName || 'Default'}) at ${targetIp}.`
        : `Successfully casted command to Google Home speaker (${targetName || 'Default'}) at ${targetIp}.`,
      command_sent: commandExecuted ? command : ttsText,
      assistant_response: sdkResult.response || null
    });

  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Failed to cast command: ${error.message}`
    });
  }
}

module.exports = { handleGoogleHomeTool };
