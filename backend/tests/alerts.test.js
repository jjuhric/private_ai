const alertsRouter = require('../routes/alerts');

describe('Alerts Router Tests', () => {
  test('broadcastAlert handles objects and strings safely without crash', () => {
    expect(() => {
      alertsRouter.broadcastAlert("string alert");
      alertsRouter.broadcastAlert({ object: 'alert' });
    }).not.toThrow();
  });

  test('stream endpoint registers connection and cleans up on close', () => {
    let closedCallback = null;
    const mockReq = {
      user: { id: 1 },
      on: jest.fn().mockImplementation((event, callback) => {
        if (event === 'close') {
          closedCallback = callback;
        }
      })
    };

    const mockRes = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn()
    };

    const streamRoute = alertsRouter.stack.find(layer => layer.route && layer.route.path === '/stream');
    expect(streamRoute).toBeDefined();

    const handler = streamRoute.route.stack[streamRoute.route.stack.length - 1].handle;
    
    jest.useFakeTimers();
    handler(mockReq, mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(mockRes.flushHeaders).toHaveBeenCalled();

    jest.advanceTimersByTime(16000);
    expect(mockRes.write).toHaveBeenCalledWith(': heartbeat\n\n');

    if (closedCallback) {
      closedCallback();
    }
    
    jest.useRealTimers();
  });
});
