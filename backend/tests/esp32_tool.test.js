const { handleEsp32Tool } = require('../tools/esp32_tool');

describe('ESP32 Tool Tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends POST request successfully to ESP32 with authorization header', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, pin: 2, value: 1 })
    });

    const result = await handleEsp32Tool('192.168.1.15', 3000, 'write', { pin: 2, value: 1 }, 'secret-key');
    
    expect(global.fetch).toHaveBeenCalledWith('http://192.168.1.15:3000/api/gpio/write', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret-key'
      },
      body: JSON.stringify({ pin: 2, value: 1 })
    });
    expect(JSON.parse(result)).toEqual({ success: true, pin: 2, value: 1 });
  });

  test('sends POST request successfully to ESP32 without authorization header', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, pin: 5, value: 0 })
    });

    const result = await handleEsp32Tool('192.168.1.15', 3000, 'write', { pin: 5, value: 0 });
    
    expect(global.fetch).toHaveBeenCalledWith('http://192.168.1.15:3000/api/gpio/write', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ pin: 5, value: 0 })
    });
    expect(JSON.parse(result)).toEqual({ success: true, pin: 5, value: 0 });
  });

  test('handles bad response status', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400
    });

    const result = await handleEsp32Tool('192.168.1.15', 3000, 'write', { pin: 2, value: 1 });
    expect(result).toContain('Failed to communicate with ESP32');
    expect(result).toContain('ESP32 responded with status: 400');
  });

  test('handles fetch network error throws', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network offline'));

    const result = await handleEsp32Tool('192.168.1.15', 3000, 'write', { pin: 2, value: 1 });
    expect(result).toContain('Failed to communicate with ESP32');
    expect(result).toContain('Network offline');
  });
});
