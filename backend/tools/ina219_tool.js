const REG_CONFIG = 0x00;
const REG_SHUNTVOLTAGE = 0x01;
const REG_BUSVOLTAGE = 0x02;
const REG_POWER = 0x03;
const REG_CURRENT = 0x04;
const REG_CALIBRATION = 0x05;

const BusVoltageRange = {
  RANGE_16V: 0x00,
  RANGE_32V: 0x01,
};

const Gain = {
  DIV_1_40MV: 0x00,
  DIV_2_80MV: 0x01,
  DIV_4_160MV: 0x02,
  DIV_8_320MV: 0x03,
};

const ADCResolution = {
  ADCRES_9BIT_1S: 0x00,
  ADCRES_10BIT_1S: 0x01,
  ADCRES_11BIT_1S: 0x02,
  ADCRES_12BIT_1S: 0x03,
  ADCRES_12BIT_2S: 0x09,
  ADCRES_12BIT_4S: 0x0A,
  ADCRES_12BIT_8S: 0x0B,
  ADCRES_12BIT_16S: 0x0C,
  ADCRES_12BIT_32S: 0x0D,
  ADCRES_12BIT_64S: 0x0E,
  ADCRES_12BIT_128S: 0x0F,
};

const Mode = {
  POWERDOW: 0x00,
  SVOLT_TRIGGERED: 0x01,
  BVOLT_TRIGGERED: 0x02,
  SANDBVOLT_TRIGGERED: 0x03,
  ADCOFF: 0x04,
  SVOLT_CONTINUOUS: 0x05,
  BVOLT_CONTINUOUS: 0x06,
  SANDBVOLT_CONTINUOUS: 0x07,
};

class INA219 {
  constructor(i2cBus = 1, addr = 0x41) {
    this.addr = addr;
    this.i2cBus = i2cBus;
    this._cal_value = 0;
    this._current_lsb = 0;
    this._power_lsb = 0;
    this.simulated = false;
    this.bus = null;

    try {
      const i2c = require('i2c-bus');
      this.bus = i2c.openSync(i2cBus);
    } catch (err) {
      this.simulated = true;
    }

    this.set_calibration_16V_5A();
  }

  read(address) {
    if (this.simulated) {
      return 0;
    }
    const buffer = Buffer.alloc(2);
    this.bus.readI2cBlockSync(this.addr, address, 2, buffer);
    return (buffer[0] * 256) + buffer[1];
  }

  write(address, data) {
    if (this.simulated) {
      return;
    }
    const buffer = Buffer.from([(data & 0xFF00) >> 8, data & 0xFF]);
    this.bus.writeI2cBlockSync(this.addr, address, 2, buffer);
  }

  set_calibration_16V_5A() {
    this._current_lsb = 0.1524;
    this._cal_value = 26868;
    this._power_lsb = 0.003048;

    this.write(REG_CALIBRATION, this._cal_value);

    this.bus_voltage_range = BusVoltageRange.RANGE_16V;
    this.gain = Gain.DIV_2_80MV;
    this.bus_adc_resolution = ADCResolution.ADCRES_12BIT_32S;
    this.shunt_adc_resolution = ADCResolution.ADCRES_12BIT_32S;
    this.mode = Mode.SANDBVOLT_CONTINUOUS;
    this.config = (this.bus_voltage_range << 13) |
                  (this.gain << 11) |
                  (this.bus_adc_resolution << 7) |
                  (this.shunt_adc_resolution << 3) |
                  this.mode;
    this.write(REG_CONFIG, this.config);
  }

  getShuntVoltage_mV() {
    if (this.simulated) {
      // Simulate shunt voltage: current is ~203mA, resistor is 0.01 ohm, so shunt is ~2.03mV
      // add a small fluctuation
      return 2.03 + (Math.random() - 0.5) * 0.05;
    }
    this.write(REG_CALIBRATION, this._cal_value);
    let value = this.read(REG_SHUNTVOLTAGE);
    if (value > 32767) {
      value -= 65535;
    }
    return value * 0.01;
  }

  getBusVoltage_V() {
    if (this.simulated) {
      // Simulate bus voltage: ~12.08V + fluctuation
      return 12.08 + (Math.random() - 0.5) * 0.1;
    }
    this.write(REG_CALIBRATION, this._cal_value);
    // Read twice to clear/refresh
    this.read(REG_BUSVOLTAGE);
    return (this.read(REG_BUSVOLTAGE) >> 3) * 0.004;
  }

  getCurrent_mA() {
    if (this.simulated) {
      // Simulate current: ~203mA + fluctuation
      return 203 + (Math.random() - 0.5) * 5;
    }
    let value = this.read(REG_CURRENT);
    if (value > 32767) {
      value -= 65535;
    }
    return value * this._current_lsb;
  }

  getPower_W() {
    if (this.simulated) {
      // Simulate power: bus_voltage * (current / 1000)
      return this.getBusVoltage_V() * (this.getCurrent_mA() / 1000);
    }
    this.write(REG_CALIBRATION, this._cal_value);
    let value = this.read(REG_POWER);
    if (value > 32767) {
      value -= 65535;
    }
    return value * this._power_lsb;
  }

  close() {
    if (this.bus && typeof this.bus.closeSync === 'function') {
      try {
        this.bus.closeSync();
      } catch (err) {
        // ignore close errors
      }
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function measurePower() {
  const readings = [];
  const ina219 = new INA219(1, 0x41);

  try {
    for (let i = 0; i < 3; i++) {
      if (i > 0) {
        await sleep(2000); // 2 seconds between readings, matching Python's sleep
      }

      const bus_voltage = ina219.getBusVoltage_V();
      const shunt_voltage = ina219.getShuntVoltage_mV() / 1000;
      const current = ina219.getCurrent_mA();
      const power = ina219.getPower_W();
      
      let p = ((bus_voltage - 9) / 3.6) * 100;
      if (p > 100) p = 100;
      if (p < 0) p = 0;

      readings.push({
        battery_percent: p,
        power_w: power,
        voltage_v: bus_voltage,
        current_a: current / 1000,
        shunt_voltage_v: shunt_voltage,
        success: !ina219.simulated
      });
    }

    // Compute average
    const avg = {
      battery_percent: 0,
      power_w: 0,
      voltage_v: 0,
      current_a: 0,
      shunt_voltage_v: 0
    };

    for (const r of readings) {
      avg.battery_percent += r.battery_percent;
      avg.power_w += r.power_w;
      avg.voltage_v += r.voltage_v;
      avg.current_a += r.current_a;
      avg.shunt_voltage_v += r.shunt_voltage_v;
    }

    avg.battery_percent /= 3;
    avg.power_w /= 3;
    avg.voltage_v /= 3;
    avg.current_a /= 3;
    avg.shunt_voltage_v /= 3;

    return {
      success: true,
      simulated: ina219.simulated,
      readings: readings.map(r => ({
        battery_percent: Number(r.battery_percent.toFixed(1)),
        power_w: Number(r.power_w.toFixed(3)),
        voltage_v: Number(r.voltage_v.toFixed(3)),
        current_a: Number(r.current_a.toFixed(6))
      })),
      average: {
        battery_percent: Number(avg.battery_percent.toFixed(1)),
        power_w: Number(avg.power_w.toFixed(3)),
        voltage_v: Number(avg.voltage_v.toFixed(3)),
        current_a: Number(avg.current_a.toFixed(6))
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      battery_percent: 0,
      power_w: 0,
      voltage_v: 0,
      current_a: 0
    };
  } finally {
    ina219.close();
  }
}

module.exports = {
  INA219,
  measurePower
};
