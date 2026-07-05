const { handleDevPipelineTool } = require('../tools/dev_pipeline_tool');
const { getDb } = require('../db');
const toolManager = require('../services/tool_manager');
const path = require('path');
const fs = require('fs');

// Mock agents module
jest.mock('../utils/agents', () => ({
  runWorkerAgent: jest.fn()
}));

// Mock GitHub Tool
jest.mock('../tools/github_tool', () => ({
  handleGitHubTool: jest.fn()
}));

describe('Development Pipeline Tool Tests', () => {
  const testDbPath = path.join(__dirname, 'dev_pipeline_test.db');
  let db;

  const tempRegistryPath = path.join(__dirname, 'temp_registry_pipeline');
  const tempDynamicToolsPath = path.join(__dirname, '../tools/dynamic');

  function cleanupFiles() {
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = testDbPath + suffix;
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }
    if (fs.existsSync(tempRegistryPath)) {
      fs.rmSync(tempRegistryPath, { recursive: true, force: true });
    }
    const tempToolPath = path.join(tempDynamicToolsPath, 'email_sender');
    if (fs.existsSync(tempToolPath)) {
      fs.rmSync(tempToolPath, { recursive: true, force: true });
    }
  }

  beforeAll(async () => {
    cleanupFiles();
    process.env.DB_PATH = testDbPath;
    db = await getDb();

    // Set ToolManager paths to our temp paths for testing
    toolManager.registryLocalPath = tempRegistryPath;
    toolManager.dynamicToolsPath = tempDynamicToolsPath;
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
    cleanupFiles();
  });

  test('should successfully develop, test, QA, and commit a tool', async () => {
    const { runWorkerAgent } = require('../utils/agents');
    const { handleGitHubTool } = require('../tools/github_tool');

    // Mock Developer Agent output
    runWorkerAgent.mockImplementation(async (agentName) => {
      if (agentName === 'developer_agent') {
        // Developer agent writes files to tool registry
        const mockToolPath = path.join(tempRegistryPath, 'tools/email_sender');
        fs.mkdirSync(mockToolPath, { recursive: true });
        
        fs.writeFileSync(path.join(mockToolPath, 'manifest.json'), JSON.stringify({
          name: 'email_sender',
          version: '1.0.0',
          description: 'Send email',
          target_agents: ['coder'],
          compatible_platforms: ['windows'],
          entry_point: 'handler.js',
          test_file: 'handler.test.js',
          exported_function: 'handleEmailSender'
        }, null, 2));

        fs.writeFileSync(path.join(mockToolPath, 'handler.js'), 'module.exports = { handleEmailSender: () => {} };');
        fs.writeFileSync(path.join(mockToolPath, 'handler.test.js'), 'test("mock", () => {});');

        // Write global registry index
        fs.writeFileSync(path.join(tempRegistryPath, 'registry.json'), JSON.stringify({
          version: '1.0.0',
          tools: [{ name: 'email_sender', path: 'tools/email_sender' }]
        }, null, 2));

        return 'Developed files successfully';
      }
      if (agentName === 'qa_engineer') {
        return 'QA Report: APPROVE';
      }
      return '';
    });

    // Mock GitHub responses
    handleGitHubTool.mockResolvedValue(JSON.stringify({ success: true, url: 'https://github.com/pr/1' }));

    const res = await handleDevPipelineTool('create_tool', {
      toolName: 'email_sender',
      targetNode: 'windows',
      targetAgent: 'coder',
      originalPrompt: 'Build me a tool to send email'
    });

    expect(res).toContain('Successfully developed, tested, and QA-approved');
    expect(res).toContain('https://github.com/pr/1');

    // Verify DB entry
    const row = await db.get('SELECT * FROM dev_pipeline WHERE tool_name = ?', ['email_sender']);
    expect(row).toBeDefined();
    expect(row.status).toBe('deployed');
  });
});
