const toolManager = require('../services/tool_manager');

async function handleToolManagerTool(action, params) {
  try {
    switch (action) {
      case 'list_available': {
        const tools = await toolManager.discoverTools();
        if (tools.length === 0) {
          return 'No tools found in registry.';
        }
        const details = tools.map(t => 
          `- **${t.name}** (v${t.version}): ${t.description} | Agents: ${t.target_agents.join(', ')}`
        );
        return `### Available Registry Tools:\n${details.join('\n')}`;
      }
      
      case 'list_installed': {
        const tools = await toolManager.getInstalledTools();
        if (tools.length === 0) {
          return 'No dynamic tools currently installed on this node.';
        }
        const details = tools.map(t => 
          `- **${t.tool_name}** (v${t.version}) | Target Agents: ${t.target_agent} | Status: ${t.status}`
        );
        return `### Installed Dynamic Tools:\n${details.join('\n')}`;
      }
      
      case 'install_tool': {
        const { toolName } = params;
        if (!toolName) return 'Error: "toolName" is required.';
        const manifest = await toolManager.installTool(toolName);
        return `Successfully installed tool "${toolName}" (v${manifest.version}) on this node.`;
      }
      
      case 'uninstall_tool': {
        const { toolName } = params;
        if (!toolName) return 'Error: "toolName" is required.';
        await toolManager.uninstallTool(toolName);
        return `Successfully uninstalled tool "${toolName}" from this node.`;
      }
      
      case 'get_manifest': {
        const { toolName } = params;
        if (!toolName) return 'Error: "toolName" is required.';
        const tools = await toolManager.discoverTools();
        const tool = tools.find(t => t.name === toolName);
        if (!tool) return `Error: Tool "${toolName}" not found in registry.`;
        return JSON.stringify(tool, null, 2);
      }
      
      default:
        return `Error: Unknown tool manager action "${action}".`;
    }
  } catch (err) {
    return `Error: Tool Manager action failed: ${err.message}`;
  }
}

module.exports = { handleToolManagerTool };
