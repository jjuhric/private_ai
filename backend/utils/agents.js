const { GoogleGenerativeAI } = require('@google/generative-ai');

async function resolveLocalModelName(baseUrl, apiKey, requestedModel) {
  try {
    const urlObj = new URL(baseUrl);
    const origin = urlObj.origin;
    let endpoint = `${origin}/api/v1/models`;
    const headers = {};
    if (apiKey && apiKey !== 'lm-studio') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    let response = await fetch(endpoint, { headers }).catch(() => null);
    if (!response || !response.ok) {
      endpoint = `${baseUrl.replace(/\/$/, '')}/models`;
      response = await fetch(endpoint, { headers }).catch(() => null);
    }
    
    if (response && response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.data) && data.data.length > 0) {
        const loadedModels = data.data.map(m => m.id);
        if (requestedModel && loadedModels.includes(requestedModel)) {
          return requestedModel;
        }
        return loadedModels[0];
      }
    }
  } catch (err) {
    console.error('Failed to resolve local model name:', err.message);
  }
  return requestedModel;
}

const AGENT_PROMPTS = {
  supervisor: `You are the Supervisor Agent of the Private AI system.
Your job is to orchestrate, delegate tasks to specialized sub-agents, gather their findings, and compile the final response.

### Available Sub-Agents & Their Expertise:
1. delegate_to_memory_agent (params: { task }): Best for recalling past memories/preferences, remembering new facts, or forgetting/deleting obsolete facts. Use this to search memories if you need past user context or previously stored details to answer.
2. delegate_to_web_searcher (params: { query }): Best for web searching, reading/scraping external links, and finding recent news.
3. delegate_to_calendar_handler (params: { action, params }): Best for managing meetings, appointments, and event scheduling (list, add, delete).
4. delegate_to_coder (params: { task }): Best for reading/writing local workspace files, git/GitHub integrations, and executing shell commands.
5. delegate_to_qa_engineer (params: { task }): Best for reviewing code quality, finding bugs/vulnerabilities, and running project tests.
6. delegate_to_weather_expert (params: { action, zipcode, country }): Best for retrieving current, hourly, or daily forecasts.
7. delegate_to_host_specialist (params: { query }): Best for inspecting local computer system details (CPU, memory, disk, OS, networks, processes), checking power/battery status, restarting services, and running scripts.
8. delegate_to_document_vault (params: { query }): Best for querying local private files, notes, or uploaded documents in the Vault.
9. delegate_to_node_agent (params: { task }): Best for listing remote network nodes, querying their system information, or executing commands/files remotely on them (RPi, ESP32, etc.).

### Direct Core Tools:
- time (action: 'current_time' or 'lookup_timezone'): Use to find the current date/time.

### CRITICAL RULES:
1. Delegation first: Do not answer questions yourself if they require external actions (searching, coding, calendar, host specs, weather, vault query, remote node execution). Always delegate to the appropriate specialized agent.
2. Inspect Memories & Profile: You will receive the user's profile details and core identity/location memories. If you need other custom user facts or past context, delegate to the memory agent first to recall them.
3. Iterative Decision: Review the sub-agent's structured report. Decide if it has compiled enough information to answer the user request or if further delegation/turns are needed.`,

  node_agent: `You are the Network Node Routing Agent.
Your job is to list remote network nodes and route commands, files, or queries to them.

### Available Tools:
- list_network_nodes (params: {})
- remote_node_bridge (params: { nodeId, action, actionParams: { command, filePath, content } })

### CRITICAL RULES:
1. You can execute actions on remote nodes like Raspberry Pi or ESP32 by passing the appropriate action ('system_info', 'run_command', 'write_file', 'read_file', 'update_node').
2. NOTHING is allowed to run commands on the Parent Node (the machine running the LLM). Any attempt to target the Parent Node must be rejected with access denied.
3. If a command requires sudo, the system will automatically prompt the user on the Main Host for approval. Do not attempt to bypass this.`,

  memory_agent: `You are the Memory Agent.
Your job is to manage the user's memories (recall facts, save new memories, or forget old ones).
Available Tools:
- memory (action: 'remember' | 'recall' | 'forget', params: { query, content, level, expiresAt, days, memoryId })

Rules:
- To find memories, use 'recall' with a search query.
- To store new user information/preferences, use 'remember' with content.
- Format your findings cleanly. Explicitly state what was found, remembered, or forgotten so the Supervisor can route the next steps.`,

  web_searcher: `You are the Web Searching Agent.
Your job is to gather and summarize information from the web or news.
Available Tools:
- search_web (params: { query })
- google_news (params: { query })
- memory (action: 'recall', params: { query })

Rules:
- User Interests Alignment: Before performing web searches or news retrieval, you MUST use the 'memory' tool (action: 'recall', query: 'interests' or 'preferences' / 'hobbies') to check if you have any stored memories of the user's interests.
- If user interest memories are found, customize and align the topics of your web search/news queries to match those interests.
- If no user interest memories are found, fall back to searching for general news or the requested topic directly.
- Deep Scraping: If you have a specific URL to inspect or scrape, pass that URL directly as the 'query' parameter to the 'search_web' tool.
- Summarize and format your findings clearly. State whether you have successfully gathered enough information for the Supervisor or if further searches are needed.`,

  calendar_handler: `You are the Calendar Handling Agent.
Your job is to manage calendar events.
Available Tools:
- calendar (action: 'list' | 'add' | 'delete', params: { title, start_time, end_time, description, eventId, date })
- time (action: 'current_time'): Best for retrieving the current date/time to resolve relative date terms (e.g. tomorrow, next week, etc.).

Rules:
- At the start of a task, if the user or supervisor uses relative date terms (like "tomorrow", "next week", "next year", "last month", etc.), you MUST first call the \`time\` tool with action \`current_time\` to determine the current date/time. Use this current date/time to resolve the target date/time precisely before listing, adding, or deleting calendar events.
- Perform the requested calendar actions and check the outcomes.
- Format your output clearly (listing events, confirming additions, etc.), stating if the task was completed successfully.`,

  coder: `You are the Coding Agent (Superior Developer).
Your job is to read/write files and execute shell commands inside the workspace directory.
Available Tools:
- read_file (params: { filePath })
- write_file (params: { filePath, content })
- list_dir (params: { dirPath })
- execute_command (params: { command, safety_analysis: { risk_level, reason, potential_harm, recommendation } })
- github (action: 'list_repos' | 'get_repo' | 'list_issues', params: { owner, repo })

Rules:
- Safety Rule: Before calling execute_command, you MUST populate the 'safety_analysis' parameter. Specify risk_level ("low" | "medium" | "high"), reason (what this does in plain English), potential_harm (what could go wrong if run incorrectly), and recommendation ("safe_to_approve" | "review_carefully" | "do_not_approve").
- Execute coding actions carefully and verify changes (e.g. running tests via execute_command if applicable).
- Format your findings, outputting relevant files, build outputs, or repo details, and clearly state whether the coding task is complete.`,

  qa_engineer: `You are the Quality Assurance Agent.
Your job is to inspect code for vulnerabilities, bugs, and verify quality standards.
Available Tools:
- read_file (params: { filePath })
- list_dir (params: { dirPath })
- execute_command (params: { command, safety_analysis: { risk_level, reason, potential_harm, recommendation } })

Rules:
- Safety Rule: Before calling execute_command, you MUST populate the 'safety_analysis' parameter. Specify risk_level ("low" | "medium" | "high"), reason (what this does in plain English), potential_harm (what could go wrong if run incorrectly), and recommendation ("safe_to_approve" | "review_carefully" | "do_not_approve").
- Review the code files or run tests/linting.
- Compile and format a clean structured report detailing any vulnerabilities, test results, and whether the review is completed.`,

  weather_expert: `You are the Weather Expert Agent.
Your job is to gather current, hourly, or daily forecasts.
Available Tools:
- weather (action: 'current' | 'hourly' | 'daily' | 'onecall', params: { zipcode, country })

Rules:
- Fetch the forecasts using the weather tool.
- Format the forecast details (temperatures, wind, precipitation) cleanly for the Supervisor.`,

  host_specialist: `You are the Host Specialist Agent.
Your job is to query the local computer's specifications, battery/power telemetry, CPU temperature, networks, and run scripting tasks on the system.
Available Tools:
- host_machine (action: 'get_specifications' | 'get_power' | 'get_temperature' | 'get_network_info' | 'get_process_list' | 'get_service_status' | 'get_journal_logs' | 'restart_service' | 'run_script' | 'check_updates', params: { service, lines, scriptPath, command, safety_analysis: { risk_level, reason, potential_harm, recommendation } })

Rules:
- Safety Rule: Before calling restart_service or run_script, you MUST populate the 'safety_analysis' parameter. Specify risk_level ("low" | "medium" | "high"), reason (what this does in plain English), potential_harm (what could go wrong if run incorrectly), and recommendation ("safe_to_approve" | "review_carefully" | "do_not_approve").
- Retrieve host specs or control services/scripts using the host_machine tool.
- Format the specifications (CPU, memory usage, disk details, power telemetry) clearly.`,

  document_vault: `You are the Document Vault Agent.
Your job is to search the user's private vault files to answer questions using retrieved document context.
Available Tools:
- query_vault (params: { query })

Rules:
- Use 'query_vault' with a specific search query.
- Summarize the matched document snippets clearly, citing the filenames.`
};

// Reusable function to execute a single LLM decision turn
async function runAgentTurn(agentName, systemPrompt, settings, userMessage, history) {
  const {
    provider,
    modelName,
    onlineProvider,
    onlineKey,
    geminiKey,
    localBaseUrl,
    localApiKey,
    localApiStyle,
    onlineUrl
  } = settings;

  const isGemini = provider === 'gemini' || (provider === 'online' && onlineProvider === 'gemini');
  let respText = '';

  const fullPrompt = `${systemPrompt}

You MUST output your decision in this exact JSON format:
{
  "thought": "your step-by-step reasoning",
  "tool": "tool_name_or_none",
  "action": "action_name_if_any",
  "params": {}
}

If you are done, set "tool" to "none". Do NOT output anything else but valid JSON.

User Message: ${userMessage}
History Context: ${JSON.stringify(history.slice(-10))}`;

  if (isGemini) {
    const activeKey = provider === 'gemini' ? (geminiKey || onlineKey) : onlineKey;
    if (!activeKey) throw new Error('Gemini API key is not configured.');
    const genAI = new GoogleGenerativeAI(activeKey);
    const model = genAI.getGenerativeModel({
      model: modelName || 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });
    const result = await model.generateContent(fullPrompt);
    respText = result.response.text();
  } else {
    let targetUrl = provider === 'local' 
      ? (localBaseUrl || (process.platform === 'win32' ? 'http://localhost:1234/v1' : 'http://192.168.1.42:1234/v1')) 
      : (onlineUrl || 'https://api.openai.com/v1');
    let targetKey = provider === 'local' ? localApiKey : onlineKey;
    let targetStyle = provider === 'local' ? (localApiStyle || 'openai') : (onlineProvider || 'openai');

    let resolvedModelName = modelName;
    if (provider === 'local') {
      resolvedModelName = await resolveLocalModelName(targetUrl, targetKey, modelName);
    }

    let endpoint = '';
    let headers = { 'Content-Type': 'application/json' };
    if (targetKey && targetKey !== 'lm-studio') {
      if (targetStyle === 'anthropic') {
        headers['x-api-key'] = targetKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${targetKey}`;
      }
    }

    try {
      const urlObj = new URL(targetUrl);
      const origin = urlObj.origin;
      if (targetStyle === 'lm-studio') {
        endpoint = `${origin}/v1/chat/completions`;
      } else if (targetStyle === 'anthropic') {
        endpoint = `${origin}/v1/messages`;
      } else {
        endpoint = `${targetUrl.replace(/\/$/, '')}/chat/completions`;
      }
    } catch (e) {
      endpoint = `${targetUrl.replace(/\/$/, '')}/chat/completions`;
    }

    let body = {};
    if (targetStyle === 'anthropic') {
      body = {
        model: resolvedModelName,
        system: systemPrompt,
        messages: [{ role: 'user', content: fullPrompt }],
        max_tokens: 1024
      };
    } else {
      body = {
        model: resolvedModelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fullPrompt }
        ],
        temperature: 0.1,
        max_tokens: 2048,
        response_format: { type: "json_object" }
      };
    }

    let res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: settings.abortSignal
    });

    if (!res.ok && body.response_format) {
      console.warn("Local/OpenAI LLM failed with response_format, retrying without it...");
      delete body.response_format;
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: settings.abortSignal
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM Error: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    respText = targetStyle === 'anthropic' ? (data.content?.[0]?.text || '') : (data.choices?.[0]?.message?.content || '');
  }

  respText = respText
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
    .trim();

  try {
    return JSON.parse(respText);
  } catch (err) {
    const firstBrace = respText.indexOf('{');
    const lastBrace = respText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(respText.substring(firstBrace, lastBrace + 1));
      } catch (e) {}
    }
    console.warn(`Failed to parse agent JSON, falling back to none: ${respText}`);
    return {
      thought: `Parsing failed. Raw response: ${respText}`,
      tool: 'none',
      action: '',
      params: {}
    };
  }
}

async function runAgentResponse(agentName, systemPrompt, settings, userMessage, history, toolOutputs) {
  const {
    provider,
    modelName,
    onlineProvider,
    onlineKey,
    geminiKey,
    localBaseUrl,
    localApiKey,
    localApiStyle,
    onlineUrl
  } = settings;

  const isGemini = provider === 'gemini' || (provider === 'online' && onlineProvider === 'gemini');
  const responderInstruction = `${systemPrompt}

Based on the task: "${userMessage}"
And these tool outputs:
${JSON.stringify(toolOutputs)}

Generate a detailed final report summarizing your actions and findings. Make it clear and production-ready.`;

  if (isGemini) {
    const activeKey = provider === 'gemini' ? (geminiKey || onlineKey) : onlineKey;
    const genAI = new GoogleGenerativeAI(activeKey);
    const model = genAI.getGenerativeModel({ model: modelName || 'gemini-2.5-flash' });
    const result = await model.generateContent(responderInstruction);
    return result.response.text();
  } else {
    let targetUrl = provider === 'local' 
      ? (localBaseUrl || (process.platform === 'win32' ? 'http://localhost:1234/v1' : 'http://192.168.1.42:1234/v1')) 
      : (onlineUrl || 'https://api.openai.com/v1');
    let targetKey = provider === 'local' ? localApiKey : onlineKey;
    let targetStyle = provider === 'local' ? (localApiStyle || 'openai') : (onlineProvider || 'openai');

    let endpoint = '';
    let headers = { 'Content-Type': 'application/json' };
    if (targetKey && targetKey !== 'lm-studio') {
      if (targetStyle === 'anthropic') {
        headers['x-api-key'] = targetKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${targetKey}`;
      }
    }

    try {
      const urlObj = new URL(targetUrl);
      const origin = urlObj.origin;
      if (targetStyle === 'lm-studio') {
        endpoint = `${origin}/v1/chat/completions`;
      } else if (targetStyle === 'anthropic') {
        endpoint = `${origin}/v1/messages`;
      } else {
        endpoint = `${targetUrl.replace(/\/$/, '')}/chat/completions`;
      }
    } catch (e) {
      endpoint = `${targetUrl.replace(/\/$/, '')}/chat/completions`;
    }

    let body = {};
    if (targetStyle === 'anthropic') {
      body = {
        model: modelName,
        system: responderInstruction,
        messages: [{ role: 'user', content: 'Generate report.' }],
        max_tokens: 1024
      };
    } else {
      body = {
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Based on the task: "${userMessage}"\nAnd these tool outputs:\n${JSON.stringify(toolOutputs)}\n\nGenerate a detailed final report summarizing your actions and findings. Make it clear and production-ready.` }
        ],
        temperature: 0.2,
        max_tokens: 2048
      };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: settings.abortSignal
    });

    if (!res.ok) {
      throw new Error(`LLM Error: ${res.status}`);
    }

    const data = await res.json();
    return targetStyle === 'anthropic' ? (data.content?.[0]?.text || '') : (data.choices?.[0]?.message?.content || '');
  }
}

async function runWorkerAgent(agentName, settings, task, db, userId, githubToken) {
  const systemPrompt = AGENT_PROMPTS[agentName];
  if (!systemPrompt) throw new Error(`Unknown agent: ${agentName}`);

  const history = [];
  const toolOutputs = [];
  let turn = 0;
  const maxTurns = 5;

  while (turn < maxTurns) {
    if (settings.abortSignal?.aborted) {
      break;
    }
    const decision = await runAgentTurn(agentName, systemPrompt, settings, task, history);
    
    if (!decision.tool || decision.tool === 'none') {
      break;
    }

    if (settings.onToolCall) {
      settings.onToolCall({ tool: decision.tool, action: decision.action || 'execute', params: decision.params, agent: agentName });
    }

    let output = '';
    if (decision.tool === 'weather') {
      const { handleWeatherTool } = require('../tools/weather_tool');
      output = await handleWeatherTool(db, userId, decision.action, decision.params);
    } else if (decision.tool === 'host_machine') {
      const { handleHostMachineTool } = require('../tools/host_machine_tool');
      output = await handleHostMachineTool(decision.action, decision.params);
    } else if (['read_file', 'write_file', 'list_dir', 'execute_command'].includes(decision.tool)) {
      const { handleCoderTool } = require('../tools/coder_tools');
      output = await handleCoderTool(decision.tool, decision.params, {
        userId,
        onCommandApprovalRequired: settings.onCommandApprovalRequired
      });
    } else if (decision.tool === 'github') {
      const { handleGitHubTool } = require('../tools/github_tool');
      output = await handleGitHubTool(githubToken, decision.action, decision.params);
    } else if (decision.tool === 'calendar') {
      const { handleCalendarTool } = require('../tools/calendar_tool');
      output = await handleCalendarTool(db, userId, decision.action, decision.params);
    } else if (decision.tool === 'time') {
      const { handleTimeTool } = require('../tools/time_tool');
      output = await handleTimeTool(db, userId, decision.action, decision.params);
    } else if (decision.tool === 'search_web') {
      const { handleWebSearchTool } = require('../tools/web_search_tool');
      const q = decision.params?.query || task;
      output = await handleWebSearchTool(db, userId, q);
    } else if (decision.tool === 'google_news') {
      const { handleGoogleNewsTool } = require('../tools/google_news_tool');
      output = await handleGoogleNewsTool(decision.params?.query);
    } else if (decision.tool === 'memory') {
      const { handleMemoryTool } = require('../tools/memory_tool');
      const toolParams = { ...decision.params, agentName };
      output = await handleMemoryTool(db, userId, decision.action, toolParams);
    } else if (decision.tool === 'query_vault') {
      const { handleVaultTool } = require('../tools/vault_tool');
      output = await handleVaultTool(db, userId, 'query', decision.params);
    } else if (['list_network_nodes', 'remote_node_bridge'].includes(decision.tool)) {
      const { handleNetworkNodeTool } = require('../tools/network_node_tool');
      output = await handleNetworkNodeTool(decision.tool, decision.params, {
        userId,
        onCommandApprovalRequired: settings.onCommandApprovalRequired
      });
    } else {
      output = `Error: Tool "${decision.tool}" is not accessible to this agent.`;
    }

    toolOutputs.push({ tool: decision.tool, action: decision.action, output });
    
    history.push({
      role: 'assistant',
      content: `Thought: ${decision.thought}\nCalling tool: ${decision.tool} with parameters: ${JSON.stringify(decision.params)}`
    });
    history.push({
      role: 'user',
      content: `[Tool Output for ${decision.tool}]:\n${output}`
    });

    turn++;
  }

  return await runAgentResponse(agentName, systemPrompt, settings, task, history, toolOutputs);
}

module.exports = {
  AGENT_PROMPTS,
  runAgentTurn,
  runWorkerAgent
};
