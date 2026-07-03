const logger = require('../utils/logger');

describe('Logger Utility Tests', () => {
  test('logger should have standard level functions defined', () => {
    expect(logger.info).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.debug).toBeDefined();
  });

  test('logger methods can be called without throwing errors', () => {
    expect(() => {
      logger.info('Test info logging output');
      logger.error(new Error('Test error logging output'));
    }).not.toThrow();
  });
});
