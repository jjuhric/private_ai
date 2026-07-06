const { handleTemplateTool } = require('./handler');

describe('Template Tool Tests', () => {
  test('should execute action successfully', async () => {
    const res = await handleTemplateTool('execute_action', { param1: 'hello' });
    expect(res).toBe('Template executed successfully with param1: hello');
  });

  test('should return error if param1 is missing', async () => {
    const res = await handleTemplateTool('execute_action', {});
    expect(res).toContain('Error');
  });

  test('should return error for unknown action', async () => {
    const res = await handleTemplateTool('invalid_action', {});
    expect(res).toContain('Error: Unknown action');
  });
});
