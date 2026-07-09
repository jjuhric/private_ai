const fs = require('fs');
const path = require('path');

function getCustomizationsPrompt(agentName, basePrompt) {
  let customizedPrompt = basePrompt;

  // 1. Read .agents/AGENTS.md
  try {
    const agentsMdPath = path.resolve(__dirname, '../../.agents/AGENTS.md');
    if (fs.existsSync(agentsMdPath)) {
      const agentsMd = fs.readFileSync(agentsMdPath, 'utf8');
      customizedPrompt += `\n\n### ADDITIONAL GLOBAL AGENT RULES & CONTEXT (from customizations/AGENTS.md):\n${agentsMd}`;
    }
  } catch (err) {
    // Silently ignore or log warning
  }

  // 2. Read Tool Registries (dynamic tools)
  try {
    const toolManager = require('../services/tool_manager');
    const registryJsonPath = path.join(toolManager.registryLocalPath, 'registry.json');
    if (fs.existsSync(registryJsonPath)) {
      const content = fs.readFileSync(registryJsonPath, 'utf8');
      const registry = JSON.parse(content);
      const tools = registry.tools || [];
      
      const agentTools = tools.filter(t => 
        t.target_agents && 
        (t.target_agents.includes(agentName) || 
         t.target_agents.includes(agentName.replace('_agent', '')) ||
         t.target_agents.includes(agentName.replace('_handler', '')))
      );
      if (agentTools.length > 0) {
        customizedPrompt += `\n\n### SYSTEM TOOL REGISTRY AWARENESS:\nYou are aware of the following dynamically registered tools which you can call:\n`;
        agentTools.forEach(t => {
          customizedPrompt += `- **${t.name}**: ${t.description} (Version: ${t.version})\n`;
        });
      }
    }
  } catch (err) {
    // Ignore silently
  }

  return customizedPrompt;
}

module.exports = { getCustomizationsPrompt };
