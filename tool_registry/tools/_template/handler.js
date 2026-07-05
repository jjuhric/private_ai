/**
 * Template Tool implementation
 */
async function handleTemplateTool(action, params) {
  if (action === 'execute_action') {
    const { param1 } = params;
    if (!param1) return 'Error: param1 is required.';
    return `Template executed successfully with param1: ${param1}`;
  }
  return `Error: Unknown action "${action}".`;
}

module.exports = { handleTemplateTool };
