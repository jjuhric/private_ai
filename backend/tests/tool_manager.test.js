const fs = require('fs');
const path = require('path');
const toolManager = require('../services/tool_manager');
const { getDb } = require('../db');

describe('Tool Manager Service Tests', () => {
  const testDbPath = path.join(__dirname, 'tool_mgr_test.db');
  let db;

  // Set up temp registry paths
  const tempRegistryPath = path.join(__dirname, 'temp_registry');
  const tempDynamicToolsPath = path.join(__dirname, '../tools/dynamic');

  function cleanupFiles() {
    // DB cleanup
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = testDbPath + suffix;
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }
    // Temp registry cleanup
    if (fs.existsSync(tempRegistryPath)) {
      fs.rmSync(tempRegistryPath, { recursive: true, force: true });
    }
    // Dynamic tools cleanup
    const tempToolPath = path.join(tempDynamicToolsPath, 'test_tool');
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

    // Create a mock tool in temp registry
    const mockToolPath = path.join(tempRegistryPath, 'tools/test_tool');
    fs.mkdirSync(mockToolPath, { recursive: true });

    const manifest = {
      name: 'test_tool',
      version: '1.2.3',
      description: 'A mock test tool',
      target_agents: ['coder', 'supervisor'],
      compatible_platforms: ['windows', 'linux'],
      entry_point: 'handler.js',
      test_file: 'handler.test.js',
      exported_function: 'handleTestTool',
      tool_declaration: {
        actions: ['hello'],
        parameters: { hello: { name: 'string' } }
      },
      dependencies: []
    };

    fs.writeFileSync(path.join(mockToolPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(mockToolPath, 'handler.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(mockToolPath, 'handler.test.js'), 'describe("Mock Test", () => { test("pass", () => expect(1).toBe(1)) });');

    // Write global registry.json
    const registry = {
      version: '1.0.0',
      tools: [
        {
          name: 'test_tool',
          version: '1.2.3',
          description: 'A mock test tool',
          target_agents: ['coder', 'supervisor'],
          compatible_platforms: ['windows', 'linux'],
          path: 'tools/test_tool'
        }
      ]
    };
    fs.writeFileSync(path.join(tempRegistryPath, 'registry.json'), JSON.stringify(registry, null, 2));
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
    cleanupFiles();
  });

  test('should discover tools from registry', async () => {
    const tools = await toolManager.discoverTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('test_tool');

    const coderTools = await toolManager.discoverTools({ agent: 'coder' });
    expect(coderTools).toHaveLength(1);

    const nonExistentAgentTools = await toolManager.discoverTools({ agent: 'non_existent' });
    expect(nonExistentAgentTools).toHaveLength(0);
  });

  test('should install and uninstall tool successfully', async () => {
    // Install
    const manifest = await toolManager.installTool('test_tool');
    expect(manifest.version).toBe('1.2.3');

    // Check files copied
    const installedPath = path.join(tempDynamicToolsPath, 'test_tool');
    expect(fs.existsSync(path.join(installedPath, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(installedPath, 'handler.js'))).toBe(true);

    // Check DB entry
    const installedRow = await db.get('SELECT * FROM installed_tools WHERE tool_name = ?', ['test_tool']);
    expect(installedRow).toBeDefined();
    expect(installedRow.version).toBe('1.2.3');

    // Check Agent Capabilities DB entry
    const capabilities = await db.all('SELECT * FROM agent_capabilities WHERE tool_name = ?', ['test_tool']);
    expect(capabilities).toHaveLength(2); // coder and supervisor
    expect(capabilities.map(c => c.agent_name)).toContain('coder');
    expect(capabilities.map(c => c.agent_name)).toContain('supervisor');

    // Run tests
    const testResult = await toolManager.runToolTests('test_tool');
    expect(testResult.success).toBe(true);

    // Uninstall
    await toolManager.uninstallTool('test_tool');
    expect(fs.existsSync(installedPath)).toBe(false);

    // Check DB cleared
    const uninstalledRow = await db.get('SELECT * FROM installed_tools WHERE tool_name = ?', ['test_tool']);
    expect(uninstalledRow).toBeUndefined();

    const capabilitiesCleared = await db.all('SELECT * FROM agent_capabilities WHERE tool_name = ?', ['test_tool']);
    expect(capabilitiesCleared).toHaveLength(0);
  });

  test('should create, validate, and mount dynamic tools at runtime', async () => {
    const dynamicToolName = 'dynamic_test_tool';
    const manifest = {
      name: dynamicToolName,
      version: '2.0.0',
      description: 'A dynamically created tool',
      target_agents: ['coder'],
      compatible_platforms: ['linux'],
      entry_point: 'handler.js',
      test_file: 'handler.test.js',
      exported_function: 'run',
      tool_declaration: {
        actions: ['run'],
        parameters: {}
      },
      dependencies: []
    };
    const code = 'module.exports = { run: () => "dynamic output" };';
    const testCode = 'describe("Dynamic", () => { test("pass", () => expect(1).toBe(1)) });';

    // 1. Create registry tool
    const createRes = await toolManager.createRegistryTool(dynamicToolName, manifest, code, testCode);
    expect(createRes.success).toBe(true);

    const toolDir = path.join(tempRegistryPath, 'tools', dynamicToolName);
    expect(fs.existsSync(path.join(toolDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(toolDir, 'handler.js'))).toBe(true);

    // 2. Validate registry tool
    const valRes = await toolManager.validateRegistryTool(dynamicToolName);
    expect(valRes.success).toBe(true);
    expect(valRes.manifest.name).toBe(dynamicToolName);

    // Test invalid manifest validation error
    fs.writeFileSync(path.join(toolDir, 'manifest.json'), 'invalid json');
    await expect(toolManager.validateRegistryTool(dynamicToolName)).rejects.toThrow();

    // Restore manifest
    fs.writeFileSync(path.join(toolDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 3. Mount tool
    const mountRes = await toolManager.mountRegistryTool(dynamicToolName);
    expect(mountRes.success).toBe(true);
    expect(mountRes.manifest.version).toBe('2.0.0');

    // Check DB registration
    const mountedRow = await db.get('SELECT * FROM installed_tools WHERE tool_name = ?', [dynamicToolName]);
    expect(mountedRow).toBeDefined();

    // Cleanup
    await toolManager.uninstallTool(dynamicToolName);
    const registryPath = path.join(tempRegistryPath, 'tools', dynamicToolName);
    if (fs.existsSync(registryPath)) {
      fs.rmSync(registryPath, { recursive: true, force: true });
    }
  });
});
