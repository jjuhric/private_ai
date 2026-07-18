const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const toolManager = require('../services/tool_manager');
const logger = require('../utils/logger');

async function handleDevPipelineTool(action, params, options = {}) {
  const db = await getDb();
  const userId = options.userId || 1;

  // Build standard settings object for sub-agents
  const settings = {
    provider: process.env.PREFERRED_ONLINE_MODEL ? 'online' : 'local',
    modelName: process.env.PREFERRED_ONLINE_MODEL || process.env.PREFERRED_LOCAL_MODEL,
    onlineProvider: 'gemini',
    onlineKey: process.env.GEMINI_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY,
    localBaseUrl: process.env.LOCAL_LLM_URL,
    localApiKey: process.env.LOCAL_LLM_KEY,
    localApiStyle: 'openai',
    onToolCall: options.onToolCall,
    onAgentStatus: options.onAgentStatus,
    onCommandApprovalRequired: options.onCommandApprovalRequired,
    abortSignal: options.abortSignal
  };

  try {
    switch (action) {
      case 'create_tool': {
        const { toolName, targetNode, targetAgent, originalPrompt } = params;
        if (!toolName) return 'Error: "toolName" parameter is required.';
        if (!targetAgent) return 'Error: "targetAgent" parameter is required.';
        if (!originalPrompt) return 'Error: "originalPrompt" parameter is required.';

        const requestId = 'req_' + Math.random().toString(36).substring(2, 15);
        logger.info(`[Dev Pipeline] Starting development pipeline for tool "${toolName}" (${requestId})`);

        // Insert initial pipeline status
        await db.run(
          `INSERT INTO dev_pipeline (request_id, original_prompt, target_node, target_agent, tool_name, status)
           VALUES (?, ?, ?, ?, ?, 'developing')`,
          [requestId, originalPrompt, targetNode || 'all', targetAgent, toolName]
        );

        // Dynamically import runWorkerAgent to avoid circular dependencies
        const { runWorkerAgent } = require('../utils/agents');

        // Step 1: Develop Tool
        logger.info(`[Dev Pipeline] Dispatching to Developer Agent for tool: ${toolName}`);
        const devTask = `You need to design and write a new tool named "${toolName}" for the target agent "${targetAgent}".
Target Node/Device: ${targetNode || 'general system'}
Original user request: "${originalPrompt}"

Instructions:
1. Create a folder under "tool_registry/tools/${toolName}/" relative to workspace root.
2. In that folder, write:
   - "manifest.json" with all correct tool declarations
   - "handler.js" containing the tool logic
   - "handler.test.js" containing Jest tests
3. Use only safe path resolution and correct handleXxxTool export pattern.
4. When finished, write the files to the registry and summarize your design.`;

        let devAgentOutput = '';
        try {
          devAgentOutput = await runWorkerAgent('developer_agent', settings, devTask, db, userId);
        } catch (err) {
          logger.error(`[Dev Pipeline] Developer agent failed: ${err.message}`);
          await db.run('UPDATE dev_pipeline SET status = "failed" WHERE request_id = ?', [requestId]);
          return `Error: Developer Agent failed: ${err.message}`;
        }

        await db.run(
          'UPDATE dev_pipeline SET dev_agent_output = ?, status = "testing" WHERE request_id = ?',
          [devAgentOutput, requestId]
        );

        // Step 2: Testing Phase
        logger.info(`[Dev Pipeline] Commencing local tests for tool: ${toolName}`);
        // First sync/install local copy of the tool to run tests
        try {
          await toolManager.installTool(toolName);
        } catch (installErr) {
          logger.error(`[Dev Pipeline] Local installation for testing failed: ${installErr.message}`);
          await db.run('UPDATE dev_pipeline SET status = "failed" WHERE request_id = ?', [requestId]);
          return `Error: Failed to install tool locally for tests: ${installErr.message}`;
        }

        const testResult = await toolManager.runToolTests(toolName);
        if (!testResult.success) {
          logger.warn(`[Dev Pipeline] Tests failed for new tool: ${testResult.error || testResult.stderr}`);
          await db.run('UPDATE dev_pipeline SET status = "failed" WHERE request_id = ?', [requestId]);
          return `Error: Tool tests failed:\n${testResult.error || testResult.stderr || testResult.output}`;
        }

        await db.run('UPDATE dev_pipeline SET status = "qa_review" WHERE request_id = ?', [requestId]);

        // Step 3: QA Review
        logger.info(`[Dev Pipeline] Dispatching to QA Agent for review: ${toolName}`);
        const qaTask = `Please perform QA code review on the newly created tool "${toolName}" located in "tool_registry/tools/${toolName}/".
Here is the Developer Agent's design summary:
${devAgentOutput}

Verify:
1. Security (no command injections, path traversals, or eval).
2. Adherence to manifest schema.
3. Test correctness and pass rate.

If the tool is safe, fully complete, and ready for production, end your review with "APPROVE". Otherwise, list the issues and end with "REJECT".`;

        let qaAgentOutput = '';
        try {
          qaAgentOutput = await runWorkerAgent('qa_engineer', settings, qaTask, db, userId);
        } catch (err) {
          logger.error(`[Dev Pipeline] QA agent failed: ${err.message}`);
          await db.run('UPDATE dev_pipeline SET status = "failed" WHERE request_id = ?', [requestId]);
          return `Error: QA Agent failed: ${err.message}`;
        }

        const approved = qaAgentOutput.toUpperCase().includes('APPROVE');
        const nextStatus = approved ? 'approved' : 'rejected';

        await db.run(
          'UPDATE dev_pipeline SET qa_agent_output = ?, status = ? WHERE request_id = ?',
          [qaAgentOutput, nextStatus, requestId]
        );

        if (!approved) {
          return `QA Review Rejected for tool "${toolName}". Review details:\n${qaAgentOutput}`;
        }

        // Step 4: Local Deployment Only (Bypass Git flow for private_ai_tools repo)
        logger.info(`[Dev Pipeline] Tool approved! Registering tool locally: ${toolName}`);

        await db.run(
          'UPDATE dev_pipeline SET status = "deployed" WHERE request_id = ?',
          [requestId]
        );

        return `Successfully developed, tested, and QA-approved tool "${toolName}" locally.`;
      }

      case 'get_pipeline_status': {
        const { requestId } = params;
        if (!requestId) return 'Error: "requestId" is required.';
        const row = await db.get('SELECT * FROM dev_pipeline WHERE request_id = ?', [requestId]);
        if (!row) return `Error: Pipeline request "${requestId}" not found.`;
        return JSON.stringify(row, null, 2);
      }

      case 'list_pipelines': {
        const rows = await db.all('SELECT * FROM dev_pipeline ORDER BY created_at DESC LIMIT 10');
        return JSON.stringify(rows, null, 2);
      }

      default:
        return `Error: Unknown dev pipeline action "${action}".`;
    }
  } catch (err) {
    return `Error: Dev pipeline action failed: ${err.message}`;
  }
}

module.exports = { handleDevPipelineTool };
