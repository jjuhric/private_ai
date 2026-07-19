const { handleEsp32Tool } = require('../tools/esp32_tool');
const http = require('http');
jest.mock('http');

describe('ESP32 Tool Tests', () => {
  const originalFetch = global.fetch;
  let mockRequest;
  let mockResponse;

  beforeEach(() => {
    global.fetch = jest.fn();
    mockRequest = {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn()
    };
    mockResponse = {
      statusCode: 200,
      on: jest.fn((event, cb) => {
        if (event === 'data') {
          cb(JSON.stringify({ success: true }));
        }
        if (event === 'end') {
          cb();
        }
      })
    };
    http.request = jest.fn((options, callback) => {
      callback(mockResponse);
      return mockRequest;
    });
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

  test('sends message successfully to ESP32 /message endpoint', async () => {
    const result = await handleEsp32Tool('192.168.1.117', null, 'send_message', { message: 'hello' });
    
    expect(http.request).toHaveBeenCalled();
    const mockCallArgs = http.request.mock.calls[0][0];
    expect(mockCallArgs.hostname).toBe('192.168.1.117');
    expect(mockCallArgs.path).toBe('/message');
    expect(mockCallArgs.method).toBe('POST');
    expect(mockCallArgs.headers['Content-Type']).toBe('application/json');
    expect(mockCallArgs.headers['Content-Length']).toBe(Buffer.byteLength(JSON.stringify({ message: 'hello' })));
    expect(JSON.parse(result)).toEqual({ success: true });
  });

  test('handles /message endpoint unreachable error', async () => {
    http.request.mockImplementationOnce((options, callback) => {
      return {
        on: jest.fn((event, cb) => {
          if (event === 'error') {
            process.nextTick(() => cb(new Error('Connect timeout')));
          }
        }),
        write: jest.fn(),
        end: jest.fn()
      };
    });

    const result = await handleEsp32Tool('192.168.1.117', null, 'send_message', { message: 'hello' });
    expect(result).toContain('Error: Failed to communicate with ESP32 at 192.168.1.117');
    expect(result).toContain('Connect timeout');
  });

  test('handles /message endpoint too long validation error', async () => {
    mockResponse.statusCode = 400;
    mockResponse.on = jest.fn((event, cb) => {
      if (event === 'data') {
        cb(JSON.stringify({ ok: false, error: 'message exceeds max length 240 by 10 characters' }));
      }
      if (event === 'end') {
        cb();
      }
    });

    const result = await handleEsp32Tool('192.168.1.117', null, 'send_message', { message: 'long...' });
    expect(result).toContain('Error: Failed to communicate with ESP32 at 192.168.1.117');
    expect(result).toContain('message exceeds max length 240 by 10 characters');
  });

  test('toggles screen successfully via raw HTTP POST /screen with the expected body', async () => {
    // Uses the same raw http.request path as send_message (not fetch) -
    // minimal embedded HTTP servers like the ESP32's don't reliably parse
    // fetch()'s request encoding, and need an explicit Content-Length.
    mockResponse.on = jest.fn((event, cb) => {
      if (event === 'data') {
        cb(JSON.stringify({ ok: true, screenOn: true }));
      }
      if (event === 'end') {
        cb();
      }
    });

    const result = await handleEsp32Tool('192.168.1.117', null, 'toggle_screen', {});

    expect(http.request).toHaveBeenCalled();
    const mockCallArgs = http.request.mock.calls[0][0];
    expect(mockCallArgs.hostname).toBe('192.168.1.117');
    expect(mockCallArgs.path).toBe('/screen');
    expect(mockCallArgs.method).toBe('POST');
    expect(mockCallArgs.headers['Content-Type']).toBe('application/json');
    const expectedBody = JSON.stringify({ action: 'toggle screen' });
    expect(mockCallArgs.headers['Content-Length']).toBe(Buffer.byteLength(expectedBody));
    expect(mockRequest.write).toHaveBeenCalledWith(expectedBody);
    expect(JSON.parse(result)).toEqual({ ok: true, screenOn: true });
  });

  test('handles /screen endpoint unreachable error', async () => {
    http.request.mockImplementationOnce((options, callback) => {
      return {
        on: jest.fn((event, cb) => {
          if (event === 'error') {
            process.nextTick(() => cb(new Error('Network offline')));
          }
        }),
        write: jest.fn(),
        end: jest.fn()
      };
    });

    const result = await handleEsp32Tool('192.168.1.117', null, 'toggle_screen', {});
    expect(result).toContain('Failed to communicate with ESP32');
    expect(result).toContain('Network offline');
  });

  test('handles /screen endpoint bad response status', async () => {
    mockResponse.statusCode = 500;
    mockResponse.on = jest.fn((event, cb) => {
      if (event === 'data') {
        cb(JSON.stringify({ error: 'expected JSON body' }));
      }
      if (event === 'end') {
        cb();
      }
    });

    const result = await handleEsp32Tool('192.168.1.117', null, 'toggle_screen', {});
    expect(result).toContain('Failed to communicate with ESP32');
    expect(result).toContain('expected JSON body');
  });
});
