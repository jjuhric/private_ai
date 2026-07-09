const { handleRemoteNodeTool } = require('../tools/remote_node_tool');
const mqttService = require('../services/mqtt_service');

// Mock db
let mockDb = {
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn()
};
jest.mock('../db', () => ({
  getDb: jest.fn(() => Promise.resolve(mockDb))
}));

// Mock mqttService
jest.mock('../services/mqtt_service', () => ({
  publishAndAwaitResponse: jest.fn()
}));

// Mock host_machine_tool
let mockHandleHostMachineTool = jest.fn();
jest.mock('../tools/host_machine_tool', () => ({
  handleHostMachineTool: (...args) => mockHandleHostMachineTool(...args)
}));

describe('remote_node_tool.js Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('get_system_info: node not found', async () => {
    mockDb.get.mockResolvedValueOnce(null);
    mockDb.all.mockResolvedValueOnce([]);
    
    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'unknown' }, { userId: 1 });
    expect(res).toContain('not found in registered network nodes');
  });

  test('get_system_info: main host node', async () => {
    mockDb.get.mockResolvedValueOnce({
      id: 1,
      node_name: 'parent',
      device_type: 'windows',
      ip_address: 'localhost',
      is_main_host: 1
    });
    mockHandleHostMachineTool.mockResolvedValueOnce('45 C');
    mockHandleHostMachineTool.mockResolvedValueOnce('12V, 2A');

    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'parent' }, { userId: 1 });
    expect(res).toContain('Main Host System Telemetry');
    expect(res).toContain('CPU Temperature');
  });

  test('get_system_info: remote MQTT node success', async () => {
    mockDb.get.mockResolvedValueOnce({
      id: 2,
      node_name: 'Pi5-LivingRoom',
      device_type: 'rpi-5-8gb',
      ip_address: '192.168.1.150',
      mqtt_topic: 'nodes/node_livingroom/responses',
      is_main_host: 0
    });

    mqttService.publishAndAwaitResponse.mockResolvedValueOnce({
      status: 'success',
      data: {
        os: 'Linux 6.1 arm64',
        ip_address: '192.168.1.150',
        timezone: 'America/New_York',
        timestamp: '2026-07-09T07:00:00Z',
        temperature: 41.5,
        power: {
          voltage_v: 5.1,
          power_w: 2.3,
          battery_percent: 100.0
        }
      }
    });

    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'Pi5-LivingRoom' }, { userId: 1 });
    expect(res).toContain('Remote Node Telemetry: "Pi5-LivingRoom"');
    expect(res).toContain('41.5 °C');
    expect(res).toContain('Voltage: 5.1V');
  });
});
