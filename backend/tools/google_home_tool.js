const os = require('os');
const { getDb } = require('../db');
const { generateTTS } = require('../utils/tts');

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
  if (action !== 'send_command') {
    return JSON.stringify({ error: `Unknown action: ${action}` });
  }

  const { command } = params;
  if (!command) {
    return JSON.stringify({ error: 'Command string is required' });
  }

  // Prepend activation phrase if not already present
  let voiceCommand = command.trim();
  if (!/^ok\s+google/i.test(voiceCommand) && !/^hey\s+google/i.test(voiceCommand)) {
    voiceCommand = `Ok Google, ${voiceCommand}`;
  }

  try {
    // 1. Generate local TTS file path
    const ttsUrl = await generateTTS(voiceCommand);
    const localIp = getLocalIpAddress();
    const port = process.env.PORT || 3000;
    const mediaUrl = `http://${localIp}:${port}${ttsUrl}`;

    // 2. Fetch saved configuration settings
    const settings = await db.get('SELECT google_home_ip, google_home_name FROM user_settings WHERE user_id = ?', [userId]) || {};
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
      targetIp = targetIp || '192.168.1.199';
    }

    // 4. Instantiation & direct play
    const Device = require('chromecast-api/lib/device');
    const device = new Device({
      host: targetIp,
      name: targetName || 'Google Home',
      friendlyName: targetName || 'Google Home'
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
      message: `Successfully casted command to Google Home speaker (${targetName || 'Default'}) at ${targetIp}.`,
      command_sent: voiceCommand
    });

  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Failed to cast command: ${error.message}`
    });
  }
}

module.exports = { handleGoogleHomeTool };
