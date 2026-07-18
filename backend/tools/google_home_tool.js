const os = require('os');
const { getDb } = require('../db');
const { generateTTS } = require('../utils/tts');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

async function executeViaAssistantSDK(command) {
  const credentialsPath = path.resolve(__dirname, '../credentials.json');
  const tokensPath = path.resolve(__dirname, '../tokens.json');
  
  if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokensPath)) {
    return { success: false, reason: 'missing_credentials' };
  }

  let GoogleAssistant;
  try {
    GoogleAssistant = require('google-assistant');
  } catch (e) {
    logger.error(`[Google Assistant SDK] Failed to load module: ${e.message}`);
    return { success: false, error: `Assistant SDK module failed to load: ${e.message}` };
  }

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
 * Executes a Google Home command or speaks a text message.
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

  if (action === 'speak_text') {
    const { text, device_name, device_ip } = params;
    if (!text) {
      return JSON.stringify({ error: 'Text/message parameter is required' });
    }

    const settings = await db.get('SELECT google_home_enabled, google_home_ip, google_home_name FROM user_settings WHERE user_id = ?', [userId]) || {};
    if (!settings.google_home_enabled) {
      return JSON.stringify({
        success: false,
        error: 'Google Home speaker integration is disabled. You can optionally enable it in the Assistant Settings modal.'
      });
    }

    try {
      const ttsText = text.trim();
      const ttsUrl = await generateTTS(ttsText);
      const localIp = getLocalIpAddress();
      const port = process.env.PORT || 3000;
      const mediaUrl = `http://${localIp}:${port}${ttsUrl}`;

      let targetIp = device_ip || settings.google_home_ip;
      let targetName = device_name || settings.google_home_name;

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
      } else {
        targetIp = targetIp || process.env.GOOGLE_HOME_IP || null;
        if (!targetIp) {
          const latestNest = await db.get("SELECT ip_address FROM network_nodes WHERE device_type = 'google_home' ORDER BY last_seen DESC LIMIT 1");
          if (latestNest) targetIp = latestNest.ip_address;
        }
      }

      const Device = require('chromecast-api/lib/device');
      const device = new Device({
        host: targetIp,
        name: targetName || 'Google Home',
        friendlyName: targetName || 'Google Home'
      });

      device.on('error', (err) => {
        logger.error(`[Chromecast Device Error]: ${err.message}`);
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
        message: `Successfully spoke message on Google Home speaker (${targetName || 'Default'}) at ${targetIp}.`,
        text_spoken: ttsText
      });

    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Failed to speak message: ${error.message}`
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

  const settings = await db.get('SELECT google_home_enabled, google_home_ip, google_home_name FROM user_settings WHERE user_id = ?', [userId]) || {};
  if (!settings.google_home_enabled) {
    return JSON.stringify({
      success: false,
      error: 'Google Home speaker integration is disabled. You can optionally enable it in the Assistant Settings modal.'
    });
  }

  const sdkResult = await executeViaAssistantSDK(command);
  
  let ttsText = '';
  let commandExecuted = false;

  if (sdkResult.success) {
    ttsText = sdkResult.response || 'Action completed.';
    commandExecuted = true;
  } else {
    if (sdkResult.reason === 'missing_credentials') {
      console.warn('Google Assistant SDK credentials missing. Falling back to simple TTS broadcasting.');
    } else {
      console.error(`Google Assistant SDK error: ${sdkResult.error}. Falling back to simple TTS.`);
    }
    
    ttsText = command.trim();
    if (!/^ok\s+google/i.test(ttsText) && !/^hey\s+google/i.test(ttsText)) {
      ttsText = `Ok Google, ${ttsText}`;
    }
  }

  try {
    const ttsUrl = await generateTTS(ttsText);
    const localIp = getLocalIpAddress();
    const port = process.env.PORT || 3000;
    const mediaUrl = `http://${localIp}:${port}${ttsUrl}`;

    let targetIp = settings.google_home_ip;
    const targetName = settings.google_home_name;

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
      targetIp = targetIp || process.env.GOOGLE_HOME_IP || null;
      if (!targetIp) {
        const latestNest = await db.get("SELECT ip_address FROM network_nodes WHERE device_type = 'google_home' ORDER BY last_seen DESC LIMIT 1");
        if (latestNest) targetIp = latestNest.ip_address;
      }
    }

    const Device = require('chromecast-api/lib/device');
    const device = new Device({
      host: targetIp,
      name: targetName || 'Google Home',
      friendlyName: targetName || 'Google Home'
    });

    device.on('error', (err) => {
      logger.error(`[Chromecast Device Error]: ${err.message}`);
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
