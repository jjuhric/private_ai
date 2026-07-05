const { handleToolManagerTool } = require('../tools/tool_manager_tool');
const toolManager = require('../services/tool_manager');

jest.mock('../services/tool_manager', () => ({
  discoverTools: jest.fn(),
  getInstalledTools: jest.fn(),
  installTool: jest.fn(),
  uninstallTool: jest.fn(),
}));

describe('Tool Manager Agent Tool Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('list_available action', async () => {
    toolManager.discoverTools.mockResolvedValue([
      { name: 'email_sender', version: '1.0.0', description: 'Send email', target_agents: ['coder'] }
    ]);

    const res = await handleToolManagerTool('list_available', {});
    expect(res).toContain('Available Registry Tools');
    expect(res).toContain('email_sender');
    expect(toolManager.discoverTools).toHaveBeenCalled();
  });

  test('list_installed action', async () => {
    toolManager.getInstalledTools.mockResolvedValue([
      { tool_name: 'email_sender', version: '1.0.0', target_agent: '["coder"]', status: 'active' }
    ]);

    const res = await handleToolManagerTool('list_installed', {});
    expect(res).toContain('Installed Dynamic Tools');
    expect(res).toContain('email_sender');
  });

  test('install_tool action', async () => {
    toolManager.installTool.mockResolvedValue({ version: '1.0.0' });

    const res = await handleToolManagerTool('install_tool', { toolName: 'email_sender' });
    expect(res).toContain('Successfully installed tool "email_sender"');
    expect(toolManager.installTool).toHaveBeenCalledWith('email_sender');
  });

  test('uninstall_tool action', async () => {
    const res = await handleToolManagerTool('uninstall_tool', { toolName: 'email_sender' });
    expect(res).toContain('Successfully uninstalled tool "email_sender"');
    expect(toolManager.uninstallTool).toHaveBeenCalledWith('email_sender');
  });

  test('get_manifest action', async () => {
    toolManager.discoverTools.mockResolvedValue([
      { name: 'email_sender', version: '1.0.0', description: 'Send email', target_agents: ['coder'] }
    ]);

    const res = await handleToolManagerTool('get_manifest', { toolName: 'email_sender' });
    const manifest = JSON.parse(res);
    expect(manifest.name).toBe('email_sender');
  });
});
