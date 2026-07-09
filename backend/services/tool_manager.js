const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { getDb } = require('../db');
const logger = require('../utils/logger');

class ToolManager {
  constructor() {
    this.registryLocalPath = process.env.TOOL_REGISTRY_LOCAL_PATH || path.join(__dirname, '../../tool_registry');
    this.dynamicToolsPath = path.join(__dirname, '../tools/dynamic');
  }

  async syncRegistry() {
    logger.info(`[Tool Manager] Syncing registry at: ${this.registryLocalPath}`);
    // If it's a git repo, we could pull it. For local dev/testing, we verify the folder exists.
    if (!fs.existsSync(this.registryLocalPath)) {
      fs.mkdirSync(this.registryLocalPath, { recursive: true });
    }

    const registryJsonPath = path.join(this.registryLocalPath, 'registry.json');
    if (!fs.existsSync(registryJsonPath)) {
      fs.writeFileSync(registryJsonPath, JSON.stringify({ version: '1.0.0', tools: [] }, null, 2));
    }
    
    return true;
  }

  async getRegistry() {
    await this.syncRegistry();
    const registryJsonPath = path.join(this.registryLocalPath, 'registry.json');
    try {
      const content = fs.readFileSync(registryJsonPath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      logger.error(`[Tool Manager] Failed to read registry.json: ${err.message}`);
      return { version: '1.0.0', tools: [] };
    }
  }

  async discoverTools(filter = {}) {
    const registry = await this.getRegistry();
    let tools = registry.tools || [];

    if (filter.agent) {
      tools = tools.filter(t => t.target_agents && t.target_agents.includes(filter.agent));
    }
    if (filter.platform) {
      tools = tools.filter(t => t.compatible_platforms && t.compatible_platforms.includes(filter.platform));
    }

    return tools;
  }

  async installTool(toolName) {
    logger.info(`[Tool Manager] Installing tool: ${toolName}`);
    await this.syncRegistry();

    const registry = await this.getRegistry();
    const toolMeta = registry.tools.find(t => t.name === toolName);

    // Support both registry-listed and local dynamic template installing for dev
    const sourceToolPath = path.join(this.registryLocalPath, 'tools', toolMeta ? toolMeta.path.replace(/^tools\//, '') : toolName);
    const manifestPath = path.join(sourceToolPath, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Tool "${toolName}" not found in registry path: ${sourceToolPath}`);
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    // 1. Create target directory
    const targetDir = path.join(this.dynamicToolsPath, toolName);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 2. Copy files (manifest, handler, test)
    const filesToCopy = [manifest.entry_point, manifest.test_file, 'manifest.json'];
    for (const file of filesToCopy) {
      if (file) {
        const src = path.join(sourceToolPath, file);
        const dest = path.join(targetDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
    }

    // 3. Install dependencies if any
    if (manifest.dependencies && manifest.dependencies.length > 0) {
      logger.info(`[Tool Manager] Installing npm dependencies for ${toolName}: ${manifest.dependencies.join(', ')}`);
      try {
        const workspaceRoot = path.resolve(__dirname, '..');
        const deps = manifest.dependencies.join(' ');
        await execPromise(`npm install ${deps}`, { cwd: workspaceRoot });
      } catch (err) {
        logger.error(`[Tool Manager] Failed to install dependencies: ${err.message}`);
        throw new Error(`Dependency installation failed: ${err.message}`);
      }
    }

    // 4. Update Database
    const db = await getDb();
    await db.run(
      `INSERT INTO installed_tools (tool_name, version, target_agent, manifest, status, updated_at)
       VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
       ON CONFLICT(tool_name) DO UPDATE SET
         version = excluded.version,
         target_agent = excluded.target_agent,
         manifest = excluded.manifest,
         updated_at = CURRENT_TIMESTAMP`,
      [toolName, manifest.version, JSON.stringify(manifest.target_agents), JSON.stringify(manifest)]
    );

    // Register capabilities for targeted agents
    // Delete existing capabilities for this tool first to avoid duplicates or stale actions
    await db.run('DELETE FROM agent_capabilities WHERE tool_name = ?', [toolName]);

    for (const agentName of manifest.target_agents) {
      const description = manifest.description;
      const parameters = manifest.tool_declaration ? JSON.stringify(manifest.tool_declaration) : '{}';
      await db.run(
        `INSERT INTO agent_capabilities (agent_name, tool_name, description, parameters)
         VALUES (?, ?, ?, ?)`,
        [agentName, toolName, description, parameters]
      );
    }

    logger.info(`[Tool Manager] Tool "${toolName}" installed successfully.`);
    return manifest;
  }

  async uninstallTool(toolName) {
    logger.info(`[Tool Manager] Uninstalling tool: ${toolName}`);
    const db = await getDb();

    // 1. Delete DB registrations
    await db.run('DELETE FROM installed_tools WHERE tool_name = ?', [toolName]);
    await db.run('DELETE FROM agent_capabilities WHERE tool_name = ?', [toolName]);

    // 2. Remove files
    const targetDir = path.join(this.dynamicToolsPath, toolName);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    logger.info(`[Tool Manager] Tool "${toolName}" uninstalled successfully.`);
    return true;
  }

  async getInstalledTools() {
    const db = await getDb();
    const rows = await db.all('SELECT * FROM installed_tools');
    return rows.map(r => ({
      ...r,
      manifest: JSON.parse(r.manifest)
    }));
  }

  async getToolCapabilities() {
    const db = await getDb();
    const rows = await db.all('SELECT * FROM agent_capabilities');
    return rows.map(r => ({
      ...r,
      parameters: JSON.parse(r.parameters || '{}')
    }));
  }

  async runToolTests(toolName) {
    const targetDir = path.join(this.dynamicToolsPath, toolName);
    const manifestPath = path.join(targetDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Tool "${toolName}" is not installed.`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const testFilePath = path.join(targetDir, manifest.test_file);

    if (!fs.existsSync(testFilePath)) {
      return { success: true, message: 'No tests defined for this tool.' };
    }

    logger.info(`[Tool Manager] Running tests for tool: ${toolName}`);
    try {
      const workspaceRoot = path.resolve(__dirname, '..');
      // Run jest specifically on this test file
      const relativeTestPath = path.relative(workspaceRoot, testFilePath).replace(/\\/g, '/');
      const { stdout, stderr } = await execPromise(`npx jest ${relativeTestPath} --runInBand --forceExit`, { cwd: workspaceRoot });
      return {
        success: true,
        output: stdout || stderr
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        stdout: err.stdout,
        stderr: err.stderr
      };
    }
  }

  async createRegistryTool(toolName, manifest, codeContent, testContent = '') {
    const toolDir = path.join(this.registryLocalPath, 'tools', toolName);
    fs.mkdirSync(toolDir, { recursive: true });

    const manifestObj = typeof manifest === 'string' ? JSON.parse(manifest) : manifest;
    fs.writeFileSync(path.join(toolDir, 'manifest.json'), JSON.stringify(manifestObj, null, 2), 'utf8');

    const entryFile = manifestObj.entry_point || 'handler.js';
    fs.writeFileSync(path.join(toolDir, entryFile), codeContent, 'utf8');

    const testFile = manifestObj.test_file || 'handler.test.js';
    if (testContent) {
      fs.writeFileSync(path.join(toolDir, testFile), testContent, 'utf8');
    }

    const registry = await this.getRegistry();
    if (!registry.tools.some(t => t.name === toolName)) {
      registry.tools.push({
        name: toolName,
        path: `tools/${toolName}`,
        version: manifestObj.version || '1.0.0',
        description: manifestObj.description || '',
        target_agents: manifestObj.target_agents || [],
        compatible_platforms: manifestObj.compatible_platforms || ['linux', 'darwin', 'win32']
      });
      fs.writeFileSync(path.join(this.registryLocalPath, 'registry.json'), JSON.stringify(registry, null, 2), 'utf8');
    }

    return { success: true, message: `Tool files created under registry path: tools/${toolName}` };
  }

  async validateRegistryTool(toolName) {
    const toolDir = path.join(this.registryLocalPath, 'tools', toolName);
    const manifestPath = path.join(toolDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Validation failed: manifest.json not found in ${toolDir}`);
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      throw new Error(`Validation failed: manifest.json is not valid JSON: ${e.message}`);
    }

    if (!manifest.name || !manifest.version || !manifest.entry_point || !manifest.target_agents) {
      throw new Error('Validation failed: manifest.json must contain name, version, entry_point, and target_agents.');
    }

    const entryFile = path.join(toolDir, manifest.entry_point);
    if (!fs.existsSync(entryFile)) {
      throw new Error(`Validation failed: entry point file "${manifest.entry_point}" not found.`);
    }

    const code = fs.readFileSync(entryFile, 'utf8');
    try {
      const vm = require('vm');
      new vm.Script(code);
    } catch (e) {
      throw new Error(`Validation failed: syntax error in handler code: ${e.message}`);
    }

    return { success: true, manifest };
  }

  async mountRegistryTool(toolName) {
    const val = await this.validateRegistryTool(toolName);
    if (!val.success) {
      throw new Error(`Validation failed before mounting: ${val.error}`);
    }

    const manifest = await this.installTool(toolName);
    return { success: true, manifest, message: `Tool "${toolName}" validated and mounted successfully.` };
  }
}

module.exports = new ToolManager();
