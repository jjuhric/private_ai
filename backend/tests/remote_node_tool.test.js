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

  test('unknown action validation', async () => {
    const res = await handleRemoteNodeTool('invalid_action', { nodeId: 'PiNode' }, { userId: 1 });
    expect(res).toContain('Unknown action');
  });

  test('missing nodeId validation', async () => {
    const res = await handleRemoteNodeTool('get_system_info', {}, { userId: 1 });
    expect(res).toContain('parameter is required');
  });

  test('get_system_info: node not found', async () => {
    mockDb.get.mockResolvedValue(null);
    mockDb.all.mockResolvedValueOnce([]);
    
    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'unknown' }, { userId: 1 });
    expect(res).toContain('not found in registered network nodes');
  });

  test('get_system_info: flexible name lookup', async () => {
    mockDb.get.mockResolvedValue(null);
    mockDb.all.mockResolvedValueOnce([
      { id: 3, node_name: 'test_node_3', device_type: 'esp32-wroom', is_main_host: 0 }
    ]);
    mqttService.publishAndAwaitResponse.mockResolvedValueOnce({
      status: 'success',
      data: { os: 'Espressif', temperature: 'Unavailable', power: 'Unavailable' }
    });

    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'test_node_3' }, { userId: 1 });
    expect(res).toContain('Remote Node Telemetry: "test_node_3"');
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

  test('get_system_info: remote MQTT node success with average temperature', async () => {
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
        temperature: {
          average: {
            celsius: 42.1,
            fahrenheit: 107.8
          }
        },
        power: {
          voltage_v: 5.1,
          power_w: 2.3,
          battery_percent: 100.0
        }
      }
    });

    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'Pi5-LivingRoom' }, { userId: 1 });
    expect(res).toContain('Remote Node Telemetry: "Pi5-LivingRoom"');
    expect(res).toContain('42.1 °C (107.8 °F)');
  });

  test('get_system_info: remote MQTT esp32 node with topic parsing', async () => {
    mockDb.get.mockResolvedValueOnce({
      id: 4,
      node_name: 'esp32_device',
      device_type: 'esp32-wroom',
      ip_address: '192.168.1.200',
      mqtt_topic: 'nodes/esp32_aabbcc/responses',
      is_main_host: 0
    });

    mqttService.publishAndAwaitResponse.mockResolvedValueOnce({
      status: 'success',
      data: {
        os: 'MicroPython',
        temperature: 'Unavailable',
        power: 'Unavailable'
      }
    });

    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'esp32_device' }, { userId: 1 });
    expect(res).toContain('esp32_device');
  });

  test('get_system_info: MQTT client timeout/error', async () => {
    mockDb.get.mockResolvedValueOnce({
      id: 2,
      node_name: 'Pi5-LivingRoom',
      device_type: 'rpi-5-8gb',
      ip_address: '192.168.1.150',
      mqtt_topic: 'node_livingroom',
      is_main_host: 0
    });

    mqttService.publishAndAwaitResponse.mockRejectedValueOnce(new Error('Timeout'));

    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'Pi5-LivingRoom' }, { userId: 1 });
    expect(res).toContain('is offline, unreachable, or timed out');
  });

  test('get_system_info: remote returns malformed status', async () => {
    mockDb.get.mockResolvedValueOnce({
      id: 2,
      node_name: 'Pi5-LivingRoom',
      device_type: 'rpi-5-8gb',
      ip_address: '192.168.1.150',
      mqtt_topic: 'node_livingroom',
      is_main_host: 0
    });

    mqttService.publishAndAwaitResponse.mockResolvedValueOnce({
      status: 'failed'
    });

    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'Pi5-LivingRoom' }, { userId: 1 });
    expect(res).toContain('Received unexpected or malformed response');
  });

  test('get_system_info: database error handling', async () => {
    mockDb.get.mockRejectedValueOnce(new Error('DB connection failed'));

    const res = await handleRemoteNodeTool('get_system_info', { nodeId: 'PiNode' }, { userId: 1 });
    expect(res).toContain('Error processing remote node request');
  });
});
