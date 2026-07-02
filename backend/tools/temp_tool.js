const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const execPromise = util.promisify(exec);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getSingleCpuTemp() {
  // 1. Try vcgencmd (Raspberry Pi specific)
  try {
    const { stdout } = await execPromise('vcgencmd measure_temp');
    // Expected format: temp=45.2'C
    const match = stdout.match(/temp=([\d.]+)/);
    if (match && match[1]) {
      return { temp: parseFloat(match[1]), simulated: false };
    }
  } catch (err) {
    // Ignore and try fallback
  }

  // 2. Try sysfs thermal zone (standard Linux / Raspberry Pi alternative)
  try {
    if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
      const content = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
      const tempMilli = parseInt(content.trim(), 10);
      if (!isNaN(tempMilli)) {
        return { temp: tempMilli / 1000, simulated: false };
      }
    }
  } catch (err) {
    // Ignore and try fallback
  }

  // 3. Fallback to simulated temp (Windows/Mac/dev environments)
  const baseTemp = 42.5;
  const fluctuation = (Math.random() - 0.5) * 2; // -1 to +1
  return { temp: baseTemp + fluctuation, simulated: true };
}

async function measureCpuTemp() {
  const readings = [];
  let isSimulated = false;

  try {
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await sleep(1000); // 1-second delay between readings
      }
      const result = await getSingleCpuTemp();
      if (result.simulated) {
        isSimulated = true;
      }
      const c = result.temp;
      const f = c * 1.8 + 32;
      readings.push({
        celsius: Number(c.toFixed(1)),
        fahrenheit: Number(f.toFixed(1))
      });
    }

    const avgC = readings.reduce((acc, r) => acc + r.celsius, 0) / 3;
    const avgF = readings.reduce((acc, r) => acc + r.fahrenheit, 0) / 3;

    return {
      success: true,
      simulated: isSimulated,
      readings,
      average: {
        celsius: Number(avgC.toFixed(1)),
        fahrenheit: Number(avgF.toFixed(1))
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      readings: [],
      average: { celsius: 0, fahrenheit: 0 }
    };
  }
}

module.exports = {
  measureCpuTemp
};
