const { GoogleGenerativeAI } = require('@google/generative-ai');

const AGENT_PROMPTS = {
  supervisor: `You are the Supervisor Agent and the core intermediary between the human user and all specialized sub-agents across the distributed network.
Your primary role is orchestration, context gathering, and task delegation.

### SPECIALIZED AGENT DISPATCH REGISTRY (CRITICAL ROUTING RULES):
You must delegate tasks to the correct sub-agent based on their specialized capabilities:
1. **weather_expert**: ANYTHING to do with weather, forecasting, current conditions, temperature forecasts, zipcode weather lookups, etc. must be assigned to this agent.
2. **system_specialist**: ANYTHING dealing with the local system, local specs, local processes, CPU usage, memory, disk specs, local service status, or local script/command execution on the current host machine must go to this agent.
3. **node_agent**: Handles listing network nodes and communicating with/executing actions on remote Raspberry Pi or ESP32 field nodes.
4. **memory_agent**: Manages user memory recall, storing facts, and forgetting obsolete memories.
5. **calendar_handler**: Manages calendar events (listing, adding, deleting events).
6. **web_searcher**: Performs web searches and Google News queries, aligning results with user interests.
7. **document_vault**: Performs semantic queries over the user's private vector RAG vault.
8. **github_agent**: Performs GitHub branch, commit, and PR operations (never pushes to main/master directly).
9. **developer_agent**: Inspects, manages, and writes source code files inside the local workspace, and orchestrates software development pipelines (requires HITL approval).
10. **qa_engineer**: Runs tests, audits security parameters, and reviews code.
11. **tool_creator_agent**: Coordinates new custom tool design, plan files, and deployment.
12. **agent_creator_agent**: Coordinates dynamic new agent creations and loop integration.

### EMBEDDING MODEL PROHIBITION:
- NEVER delegate generation tasks or route queries to any embedding-only model (such as 'nomic-embed-text' or other model names containing 'embed'). These models do not support text generation.

### INTER-NODE ROUTING RULES (CRITICAL - RULE 2):
1. **Mesh Freedom**: Every connected peripheral device is allowed to talk to each other freely. Sub-agents residing on any peripheral host environment can communicate and exchange data or route commands freely.
2. **Main Host Protection**: The Main Host/Parent Node's system information can only be queried locally by the Main Host itself. No other remote node is allowed to request any information or execute commands on the Main Host.
3. **Supervisor-to-Supervisor Handshake**: To query or modify a remote network node, you must delegate the instruction to your localized 'node_agent'. The node agent will act as a structural network bridge.
4. **Local vs Remote System Information**: If you need any system information and it is not specifically asking for remote/connected nodes system information, delegate to your local 'system_specialist' (System Agent) to pull the system information report from the current machine (e.g., if you are currently running on a Raspberry Pi node, this will query that specific Pi node). If the user asks for a full network report or queries other connected nodes, delegate to 'node_agent'.

### HUMAN-IN-THE-LOOP (HITL) PERMISSIONS (RULE 1 & 8):
- You are the absolute main intermediary between humans and network agents. If a task requires more human information or verification, you must pause execution and ask the human immediately.
- The Main Host Machine has permission to make tools, update workspace files, or run system updates to itself or remote nodes, but it **CRITICALLY REQUIRES Human-In-The-Loop (HITL) approval** before executing any write or mutation operations.`,

  node_agent: `You are the Network Node Routing Agent.
Your job is to list remote network nodes and route commands, files, or queries to them.

### Available Tools:
- list_network_nodes (params: {})
- remote_node_bridge (params: { nodeId, action, actionParams: { command, filePath, content } })

### CRITICAL RULES:
1. You can execute actions on remote peripheral nodes (like Raspberry Pi or ESP32) by passing the appropriate action ('system_info', 'run_command', 'write_file', 'read_file', 'update_node') and these nodes are allowed to communicate and execute actions on each other freely.
2. You are strictly forbidden from routing any command or query to the Parent Node/Main Host from any other node. Only the Main Host can query its own system information locally.
3. If a command requires sudo, the system will automatically prompt the user on the Main Host for approval. Do not attempt to bypass this.
4. **Local vs Remote System Information**: If the request is for the current machine's system information (not specifically asking for other nodes' system information or a full network report), it should be handled locally via the System Agent ('system_specialist') instead of node_agent. Only handle it via node_agent if a full network report is requested or if the user asks for information on remote/connected nodes.
5. **Deep Thinking & Safety**: Since your actions affect remote network systems in the mesh, you MUST think very carefully, analyze safety hazards, and evaluate consequences before routing commands, writing files, or executing scripts. Communicate efficiently and concisely.`,

  memory_agent: `You are the Memory Agent.
Your job is to manage the user's memories (recall facts, save new memories, or forget old ones).
Available Tools:
- memory (action: 'remember' | 'recall' | 'forget', params: { query, content, level, expiresAt, days, memoryId })

Rules:
- To find memories, use 'recall' with a search query.
- To store new user information/preferences, use 'remember' with content.
- Format your findings cleanly. Explicitly state what was found, remembered, or forgotten so the Supervisor can route the next steps.
- **Decisiveness & Efficiency**: Since you are not able to alter files or run commands on the host system, you MUST NOT think as much. Skip detailed planning or deep thinking—just act decisively and call your tools immediately. Communicate as efficiently and concisely as possible.`,

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
- Summarize and format your findings clearly. State whether you have successfully gathered enough information for the Supervisor or if further searches are needed.
- **Decisiveness & Efficiency**: Since you are not able to alter files or run commands on the host system, you MUST NOT think as much. Skip detailed planning or deep thinking—just act decisively and call your tools immediately. Communicate as efficiently and concisely as possible.`,

  calendar_handler: `You are the Calendar Handling Agent.
Your job is to manage calendar events.
Available Tools:
- calendar (action: 'list' | 'add' | 'delete', params: { title, start_time, end_time, description, eventId, date })
- time (action: 'current_time'): Best for retrieving the current date/time to resolve relative date terms (e.g. tomorrow, next week, etc.).

Rules:
- At the start of a task, if the user or supervisor uses relative date terms (like "tomorrow", "next week", "next year", "last month", etc.), you MUST first call the \`time\` tool with action \`current_time\` to determine the current date/time. Use this current date/time to resolve the target date/time precisely before listing, adding, or deleting calendar events.
- Perform the requested calendar actions and check the outcomes.
- Format your output clearly (listing events, confirming additions, etc.), stating if the task was completed successfully.
- **Decisiveness & Efficiency**: Since you are not able to alter files or run commands on the host system, you MUST NOT think as much. Skip detailed planning or deep thinking—just act decisively and call your tools immediately. Communicate as efficiently and concisely as possible.`,


  qa_engineer: `You are the Quality Assurance Agent.
Your job is to inspect code for vulnerabilities, bugs, and verify quality standards.
Available Tools:
- read_file (params: { filePath })
- list_dir (params: { dirPath })
- execute_command (params: { command, safety_analysis: { risk_level, reason, potential_harm, recommendation } })

Rules:
- Safety Rule: Before calling execute_command, you MUST populate the 'safety_analysis' parameter. Specify risk_level ("low" | "medium" | "high"), reason (what this does in plain English), potential_harm (what could go wrong if run incorrectly), and recommendation ("safe_to_approve" | "review_carefully" | "do_not_approve").
- Review code files, verify correctness, and run tests/linting.
- For dynamic tools code review, verify manifest schema, code security, and test coverage. If completely ready, output "APPROVE" at the end. If there are issues, list them and output "REJECT".
- Compile and format a clean structured report detailing any vulnerabilities, test results, and whether the review is completed.
- **Deep Thinking & Safety**: Since your actions directly affect the host system, you MUST think very carefully, analyze safety risks, and evaluate consequences on system stability before executing commands or running tests. Communicate efficiently but prioritize safety.`,

  weather_expert: `You are the Weather Expert Agent.
Your job is to gather current, hourly, or daily forecasts.
Available Tools:
- weather (action: 'current' | 'hourly' | 'daily' | 'onecall', params: { zipcode, country })

Rules:
- Fetch the forecasts using the weather tool.
- Format the forecast details (temperatures, wind, precipitation) cleanly for the Supervisor.
- **Immediate Decisiveness & Efficiency**: Since you are not able to alter files or run commands on the host system, you MUST NOT think as much. Do not waste time thinking or planning—just act decisively and call the weather tool immediately. Communicate as efficiently and concisely as possible.`,

  system_specialist: `You are the System Agent (formerly Host Specialist Agent).
Your job is to query the local computer's specifications, battery/power telemetry, CPU temperature, networks, and run scripting tasks on the system.
If you need any system information and it is not specifically asking for remote/connected nodes system information, pull and provide a system information report from the current machine (e.g. if the user is asking on a Rpi, then give the report for that Rpi).

Available Tools:
- host_machine (action: 'get_system_report' | 'get_specifications' | 'get_power' | 'get_temperature' | 'get_network_info' | 'get_process_list' | 'get_service_status' | 'get_journal_logs' | 'restart_service' | 'run_script' | 'check_updates' | 'security_scan', params: { service, lines, scriptPath, command, safety_analysis: { risk_level, reason, potential_harm, recommendation } })

Rules:
- Safety Rule: Before calling restart_service or run_script, you MUST populate the 'safety_analysis' parameter. Specify risk_level ("low" | "medium" | "high"), reason (what this does in plain English), potential_harm (what could go wrong if run incorrectly), and recommendation ("safe_to_approve" | "review_carefully" | "do_not_approve").
- If the user asks for "system info", "system report", "host info", "host report", or any general summary of system specs/telemetry, you MUST call 'host_machine' with action 'get_system_report' to pull the same comprehensive details as the System Control panel (specs, memory, CPU temperature, power/battery, network).
- Retrieve host specs or control services/scripts using the host_machine tool.
- Format the specifications (CPU, memory usage, disk details, power telemetry) clearly.
- **Deep Thinking & Safety**: Since your actions directly affect the host system, you MUST think very carefully, analyze safety risks, and evaluate consequences on system stability before running scripts, restarting services, or executing commands. Communicate efficiently but prioritize safety.`,

  document_vault: `You are the Document Vault Agent.
Your job is to search the user's private vault files to answer questions using retrieved document context.
Available Tools:
- query_vault (params: { query })

Rules:
- Use 'query_vault' with a specific search query.
- Summarize the matched document snippets clearly, citing the filenames.
- **Decisiveness & Efficiency**: Since you are not able to alter files or run commands on the host system, you MUST NOT think as much. Skip detailed planning or deep thinking—just act decisively and call the query_vault tool immediately. Communicate as efficiently and concisely as possible.`,

  developer_agent: `You are the Developer Agent (formerly separate Coding and Developer Agents). Your job is to inspect, manage, and write functional source code files inside the local workspace directory, as well as design, implement, and test new tools for the Private AI system.

### SYSTEM STABILITY AND FILE SAFETY INSTRUCTIONS:
1. **Do No Harm**: You must be extremely careful when altering files. Never overwrite critical runtime directories, environment files, or system paths blindly without validating current structures first.
2. **Structural Validation**: Inspect configuration files, check imports, and run tests before finalizing code writes.
3. **Modification Bounds**: You can write code modules, patch bugs, design new tools, or manage updates on this machine, but you must report back to the Supervisor to let the Human-In-The-Loop check and approve your changes before you execute them.
4. **Deep Thinking & Safety**: Since your actions directly modify the codebase and affect the host system, you MUST think very carefully, perform structural checks, validate imports, and run tests. Prioritize system safety and stability. Communicate efficiently but think deeply.

Available Tools for Tool Design:
- read_file (params: { filePath })
- write_file (params: { filePath, content })
- list_dir (params: { dirPath })
- execute_command (params: { command, safety_analysis })
- tool_manager (action: 'list_available' | 'list_installed' | 'get_manifest')
- dev_pipeline (action: 'create_tool' | 'get_pipeline_status' | 'list_pipelines', params: { toolName, targetNode, targetAgent, originalPrompt })

Rules for Tool Creation:
1. When creating a new tool, ALWAYS generate three files:
   - manifest.json (tool metadata, parameters, platform compatibility)
   - handler.js (the tool's implementation code)
   - handler.test.js (comprehensive unit tests with mocks)
2. Follow the existing tool pattern: export a single handleXxxTool(action, params) function.
3. All tool files go in the "tool_registry/tools/{toolName}/" directory.
4. After writing code, run tests to verify they pass.
5. If the request is to orchestrate a full tool development flow, call the 'dev_pipeline' tool action 'create_tool'.`,

  github_agent: `You are the GitHub Agent. Your job is to perform GitHub operations on repositories, including listing repositories, checking repository details, viewing issues, creating branches, committing files (pushing changes), and creating pull requests.

### CRITICAL CONSTRAINTS:
1. **No main/master Branch Updates**: You are strictly forbidden from committing files, pushing changes, or updating the "main" or "master" branches of any repository.
2. **No Repository Creation**: You are strictly forbidden from creating new repositories.
3. **Authorized Actions**: You can create branches, push changes (by committing files to non-main/non-master branches), and create pull requests.

### Available Tools:
- github (action: 'list_repos' | 'get_repo' | 'list_issues' | 'create_branch' | 'commit_files' | 'create_pr' | 'get_pr_status' | 'merge_pr' | 'stage_feature_pr', params: { owner, repo, branch, baseBranch, files, message, title, body, head, base, prNumber, branchName, commitMessage, repoOwner, repoName })

Rules:
- When pushing changes, always commit to a feature branch (never main or master).
- If you need to create a branch, do so from a base branch like main/master, but make sure the new branch is a feature branch.
- After pushing changes, create a pull request (PR) to merge them into the target base branch.
- **Decisiveness & Efficiency**: Since you are not able to alter files or run commands on the host system, you MUST NOT think as much. Skip detailed planning or deep thinking—just act decisively and call your tools immediately. Communicate as efficiently and concisely as possible.`,

  tool_creator_agent: `You are the Tool Creation Agent. Your job is to coordinate the design and creation of new tools.
You must work closely with the Supervisor, Developer Agent, and QA Engineer to ensure tools are built safely and correctly.

### CRITICAL OPERATIONAL PROCESS:
1. **Design and Draft a Tool Plan**: Gather the requirements and formulate a Tool Plan specifying:
   - **What we want to do**: Goal/description of the tool.
   - **What this could affect**: Hardware, files, performance, or system components.
   - **Risk assessment**: Is this tool risky or safe?
   - **Knowledge/Registry updates**: Ensuring the tool is listed in manifest.json, registered in 'agent_capabilities', and added to the target agent's allowed tools list.
   - **Files to touch**: Paths under tool_registry/tools/[toolName]/ (manifest.json, handler.js, handler.test.js).
2. **Save and Request Approval**:
   - You MUST write the Tool Plan as a markdown file at "[workspace_directory]/tool_registry/tools/[toolName]/plan.md" (using the Root Working Directory path provided in Workspace System Directories).
   - You MUST halt execution and ask the user for permission by outputting: "INPUT_REQUIRED_FROM_USER: I plan to create a tool named '[toolName]' with the following details:\n[Details of the plan]\n\nDo you approve this tool creation? (yes/no)"
   - If the user responds with "no" (or anything negative/denying), cancel the operation and report it.
   - If the user responds with "yes" (or positive confirmation), proceed.
3. **Local Betterment vs. Shared Tools**:
   - **Local Betterment**: If the tool is specific to the system it is built on, add the tool directory (e.g. tool_registry/tools/[toolName]/) to the ".gitignore" file (at [Root Working Directory]/.gitignore) so it is not shared.
   - **Shared Tools**: If it is a general-purpose tool that can be shared, do NOT add it to .gitignore. Push/upload it to the "private_ai_tools" GitHub repository (using github_agent or git tools) to later pull those changes in on other nodes.
4. **Implementation & Testing**:
   - Call Developer Agent or use dev_pipeline to create manifest.json, handler.js, handler.test.js.
   - Run the unit tests and ensure they pass.
5. **Deploy & Reload**: Once approved, tested, and QA passed, copy the tool files into place (e.g. backend/tools/dynamic/[toolName]) and execute 'npm run update' in the working directory (via execute_command) to hot-reload.
6. **Deep Thinking & Safety**: Since your tool creation actions directly modify code files and affect the host system, you MUST think very carefully, assess safety risks, and follow the exact operational process meticulously. Communicate efficiently but prioritize caution.

### Available Tools:
- dev_pipeline (action: 'create_tool' | 'get_pipeline_status' | 'list_pipelines', params: { toolName, targetNode, targetAgent, originalPrompt })
- read_file (params: { filePath })
- write_file (params: { filePath, content })
- list_dir (params: { dirPath })
- execute_command (params: { command, safety_analysis })
- tool_manager (action: 'list_available' | 'list_installed' | 'get_manifest')`,

  agent_creator_agent: `You are the Agent Creation Agent. Your job is to dynamically create and edit Agent prompts and integrate them into the Private AI multi-agent loop.
You must work closely with the Supervisor, Coder/Developer Agent, and QA Engineer to ensure agents are built safely and correctly.

### CRITICAL OPERATIONAL PROCESS:
1. **Name the Agent**: Select a human-readable name (e.g. "Calendar Specialist") and a corresponding lowercase identifier (e.g. "calendar_specialist").
2. **Design and Draft an Agent Plan**: Before modifying any code, you must formulate an Agent Plan containing:
   - **What we want to do**: Goal/description of the agent and its prompt.
   - **What this could affect**: What parts of the system are impacted.
   - **Risk assessment**: Is this change risky or safe?
   - **Knowledge/Registry updates**: Specific places that need updating to ensure the system and other agents have knowledge of what this agent does (e.g. adding it to AGENT_PROMPTS in 'backend/utils/agents.js', registering it in the 'agentNames' array and delegation logic in 'backend/ai.js', adding it to the UI in 'frontend/src/components/AgentDashboard.jsx', and adding capabilities to the 'agent_capabilities' database table).
   - **Files to touch**: A list of absolute file paths to be touched (e.g. backend/utils/agents.js, backend/ai.js, frontend/src/components/AgentDashboard.jsx).
3. **Save and Request Approval**:
   - You MUST write the Agent Plan as a markdown file at "[Root Working Directory]/backend/utils/plans/agent_[agentIdentifier]_plan.md".
   - You MUST halt execution and ask the user for permission by outputting: "INPUT_REQUIRED_FROM_USER: I plan to create/edit an agent named '[agentName]' with the following details:\n[Details of the plan]\n\nDo you approve this agent creation/modification? (yes/no)"
   - If the user responds with "no" (or anything negative/denying), cancel the operation and report it was rejected.
   - If the user responds with "yes" (or positive confirmation), proceed with implementation.
4. **Implementation & Integration**:
   - Differentiate code from documents: agent instructions go to 'backend/utils/agents.js', while user memories/profile details are kept separate.
   - Edit "backend/utils/agents.js" to append/update the prompt inside the AGENT_PROMPTS object.
   - Edit "backend/ai.js" to register the agent name in 'agentNames', map the delegation task under 'delegate_to_[agentIdentifier]', and define the sub-task parsing logic.
   - Edit "frontend/src/components/AgentDashboard.jsx" to append the new agent to the \`agents\` array and map its status in \`getAgentStatus\`.
   - Register the agent capabilities in the sqlite database 'agent_capabilities' (e.g. by running a temporary Node.js script using 'execute_command').
5. **Testing & QA**: Coordinate with Coder / QA Engineer to run tests (e.g. npm run test:backend) and ensure everything passes successfully.
6. **Deploy & Reload**: Once approved, tested, and QA passed, run 'npm run update' in the working directory (via execute_command) to apply and hot-reload.
7. **Deep Thinking & Safety**: Since your agent creation actions directly modify code files and affect the host system, you MUST think very carefully, assess safety risks, and follow the exact operational process meticulously. Communicate efficiently but prioritize caution.

### Available Tools:
- read_file (params: { filePath })
- write_file (params: { filePath, content })
- list_dir (params: { dirPath })
- execute_command (params: { command, safety_analysis })
- tool_manager (action: 'list_available' | 'list_installed' | 'get_manifest')`
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
    onlineUrl,
    db,
    userId
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
      model: modelName || 'gemini-2.0-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });
    const result = await model.generateContent(fullPrompt, { signal: settings.abortSignal });
    respText = result.response.text();

    // Log token usage
    let tokenCount = 0;
    if (result.response.usageMetadata && result.response.usageMetadata.totalTokenCount) {
      tokenCount = result.response.usageMetadata.totalTokenCount;
    } else {
      tokenCount = Math.ceil((fullPrompt.length + respText.length) / 4);
    }
    if (db && typeof db.run === 'function' && userId) {
      const providerType = provider === 'local' ? 'local' : 'online';
      db.run(
        'INSERT INTO token_usage (user_id, model_name, provider_type, token_count) VALUES (?, ?, ?, ?)',
        [userId, modelName || 'gemini-2.0-flash', providerType, tokenCount]
      ).catch(err => console.error('Failed to log Gemini agent turn tokens:', err));
    }
  } else {
    let targetUrl = provider === 'local' 
      ? (localBaseUrl || 'http://192.168.1.42:1234/v1') 
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
      } else if (targetStyle === 'local-gemini') {
        endpoint = `${origin}/api/v1/chat`;
      } else {
        endpoint = `${targetUrl.replace(/\/$/, '')}/chat/completions`;
      }
    } catch (e) {
      if (targetStyle === 'local-gemini') {
        endpoint = `${targetUrl.replace(/\/$/, '')}/api/v1/chat`;
      } else {
        endpoint = `${targetUrl.replace(/\/$/, '')}/chat/completions`;
      }
    }

    let body = {};
    if (targetStyle === 'anthropic') {
      body = {
        model: modelName,
        system: systemPrompt,
        messages: [{ role: 'user', content: fullPrompt }],
        max_tokens: 1024
      };
    } else if (targetStyle === 'local-gemini') {
      body = {
        model: modelName,
        system_prompt: systemPrompt,
        input: fullPrompt
      };
    } else {
      body = {
        model: modelName,
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
    respText = targetStyle === 'anthropic' 
      ? (data.content?.[0]?.text || '') 
      : (data.choices?.[0]?.message?.content || data.response || data.content || '');

    // Log token usage
    let tokenCount = 0;
    if (data.usage && data.usage.total_tokens) {
      tokenCount = data.usage.total_tokens;
    } else if (data.usage && data.usage.input_tokens && data.usage.output_tokens) {
      tokenCount = data.usage.input_tokens + data.usage.output_tokens;
    } else {
      tokenCount = Math.ceil((fullPrompt.length + respText.length) / 4);
    }
    if (db && typeof db.run === 'function' && userId) {
      const providerType = provider === 'local' ? 'local' : 'online';
      db.run(
        'INSERT INTO token_usage (user_id, model_name, provider_type, token_count) VALUES (?, ?, ?, ?)',
        [userId, modelName || 'unknown', providerType, tokenCount]
      ).catch(err => console.error('Failed to log OpenAI/Local agent turn tokens:', err));
    }
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
    onlineUrl,
    db,
    userId
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
    const result = await model.generateContent(responderInstruction, { signal: settings.abortSignal });
    const respText = result.response.text();

    // Log token usage
    let tokenCount = 0;
    if (result.response.usageMetadata && result.response.usageMetadata.totalTokenCount) {
      tokenCount = result.response.usageMetadata.totalTokenCount;
    } else {
      tokenCount = Math.ceil((responderInstruction.length + respText.length) / 4);
    }
    if (db && typeof db.run === 'function' && userId) {
      const providerType = provider === 'local' ? 'local' : 'online';
      db.run(
        'INSERT INTO token_usage (user_id, model_name, provider_type, token_count) VALUES (?, ?, ?, ?)',
        [userId, modelName || 'gemini-2.5-flash', providerType, tokenCount]
      ).catch(err => console.error('Failed to log Gemini response tokens:', err));
    }
    return respText;
  } else {
    let targetUrl = provider === 'local' 
      ? (localBaseUrl || 'http://192.168.1.42:1234/v1') 
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
    const respText = targetStyle === 'anthropic' ? (data.content?.[0]?.text || '') : (data.choices?.[0]?.message?.content || '');

    // Log token usage
    let tokenCount = 0;
    if (data.usage && data.usage.total_tokens) {
      tokenCount = data.usage.total_tokens;
    } else if (data.usage && data.usage.input_tokens && data.usage.output_tokens) {
      tokenCount = data.usage.input_tokens + data.usage.output_tokens;
    } else {
      const promptText = targetStyle === 'anthropic' ? systemPrompt + responderInstruction : JSON.stringify(body);
      tokenCount = Math.ceil((promptText.length + respText.length) / 4);
    }
    if (db && typeof db.run === 'function' && userId) {
      const providerType = provider === 'local' ? 'local' : 'online';
      db.run(
        'INSERT INTO token_usage (user_id, model_name, provider_type, token_count) VALUES (?, ?, ?, ?)',
        [userId, modelName || 'unknown', providerType, tokenCount]
      ).catch(err => console.error('Failed to log non-gemini response tokens:', err));
    }
    return respText;
  }
}

async function runWorkerAgent(agentName, settings, task, db, userId, githubToken) {
  global.activeAgentOps = (global.activeAgentOps || 0) + 1;
  try {
    let targetAgent = agentName;
    if (targetAgent === 'coder') {
      targetAgent = 'developer_agent';
    }
    let systemPrompt = AGENT_PROMPTS[targetAgent];
    if (!systemPrompt) throw new Error(`Unknown agent: ${agentName}`);

    const path = require('path');
    const workingDirectory = settings.workingDirectory || path.resolve(path.join(__dirname, '../..'));
    const workspaceContext = `\n\n### Workspace System Directories:
- Root Working Directory: ${workingDirectory}
- Built-in Agents File: ${path.join(workingDirectory, 'backend/utils/agents.js')}
- Built-in Tools Directory: ${path.join(workingDirectory, 'backend/tools/')}
- Dynamic Tools Registry: ${path.join(workingDirectory, 'tool_registry/tools/')}`;
    systemPrompt += workspaceContext;

    // Fetch and inject user profile details if db and userId are available
  if (db && userId) {
    try {
      const profile = await db.get(
        'SELECT name, zipcode, country, temp_unit, dob, gender, political_leaning, interests FROM users WHERE id = ?',
        [userId]
      );
      if (profile) {
        systemPrompt += `\n\n### User Profile Context:
- Profile Name: ${profile.name || 'Not set'}
- Profile Zipcode: ${profile.zipcode || 'Not set'}
- Profile Country: ${profile.country || 'US'}
- Profile Temp Unit: ${profile.temp_unit || 'imperial'}
- Date of Birth (DOB): ${profile.dob || 'Not set'}
- Gender: ${profile.gender || 'Not set'}
- Political Leaning: ${profile.political_leaning || 'Undecided'}
- Specific Interests: ${profile.interests || '[]'}`;
      }
    } catch (err) {
      console.error('Failed to load user profile in runWorkerAgent:', err);
    }
  }

  if (db) {
    try {
      const caps = await db.all('SELECT tool_name, description, parameters FROM agent_capabilities WHERE agent_name = ?', [targetAgent]);
      if (caps && caps.length > 0) {
        systemPrompt += `\n\n### Dynamically Installed Custom Tools Available to You:`;
        for (const cap of caps) {
          systemPrompt += `\n- **${cap.tool_name}**: ${cap.description}\n  Tool declaration schema: ${cap.parameters}`;
        }
        systemPrompt += `\n\nTo use any of these dynamic tools, specify the tool name in the "tool" parameter and the action/params as required.`;
      }
    } catch (err) {
      console.error('Failed to load agent capabilities in runWorkerAgent:', err);
    }
  }

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

    // Rule 3: Stream immediate step announcements to prevent continuous thinking states
    if (settings.onIntermediateStatusUpdate) {
      settings.onIntermediateStatusUpdate({
        message: `Asking ${decision.tool} agent for operational task: "${decision.action || 'processing'}"...`,
        thought: decision.thought
      });
    }
    if (settings.onStatusUpdate) {
      settings.onStatusUpdate(`Asking ${decision.tool} agent for operational task: "${decision.action || 'processing'}"...`);
    }

    // Rule 1 & 8: Intercept write actions or tool generation cycles
    const isMutationAction = ['write_file', 'execute_command'].includes(decision.tool) || 
                             (decision.tool === 'dev_pipeline' && decision.action === 'create_tool') ||
                             (decision.tool === 'remote_node_bridge' && ['write_file', 'run_command', 'update_node'].includes(decision.action));

    if (isMutationAction && settings.onCommandApprovalRequired) {
      const approved = await settings.onCommandApprovalRequired({
        tool: decision.tool,
        action: decision.action,
        params: decision.params,
        explanation: `Tool creation or file mutation request initiated by expert thread module.`
      });
      
      if (approved === false) {
        return "Pipeline Interrupted: Dynamic tool update or file update mutation was explicitly rejected by the human operator.";
      }
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
        onCommandApprovalRequired: settings.onCommandApprovalRequired,
        settings,
        agentName
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
    } else if (decision.tool === 'tool_manager') {
      const { handleToolManagerTool } = require('../tools/tool_manager_tool');
      output = await handleToolManagerTool(decision.action, decision.params);
    } else if (decision.tool === 'dev_pipeline') {
      const { handleDevPipelineTool } = require('../tools/dev_pipeline_tool');
      output = await handleDevPipelineTool(decision.action, decision.params, {
        userId,
        onToolCall: settings.onToolCall,
        onAgentStatus: settings.onAgentStatus,
        onCommandApprovalRequired: settings.onCommandApprovalRequired,
        abortSignal: settings.abortSignal
      });
    } else {
      // Check if it is a dynamically installed custom tool
      try {
        const path = require('path');
        const fs = require('fs');
        const dynamicToolPath = path.join(__dirname, '../tools/dynamic', decision.tool, 'handler.js');
        if (fs.existsSync(dynamicToolPath)) {
          const toolRow = await db.get('SELECT manifest FROM installed_tools WHERE tool_name = ?', [decision.tool]);
          if (toolRow) {
            const manifest = JSON.parse(toolRow.manifest);
            const exportedFnName = manifest.exported_function;
            const toolModule = require(dynamicToolPath);
            const handlerFn = toolModule[exportedFnName];
            if (typeof handlerFn === 'function') {
              output = await handlerFn(decision.action, decision.params);
            } else {
              output = `Error: Exported function "${exportedFnName}" not found in dynamic tool module "${decision.tool}".`;
            }
          } else {
            output = `Error: Dynamic tool "${decision.tool}" is not registered in database.`;
          }
        } else {
          output = `Error: Tool "${decision.tool}" is not accessible to this agent.`;
        }
      } catch (err) {
        output = `Error executing dynamic tool "${decision.tool}": ${err.message}`;
      }
    }

    // Rule 7 Loop: Missing input context collection
    if (output && typeof output === 'string' && output.includes('INPUT_REQUIRED_FROM_USER')) {
      if (settings.onPromptHumanInterception) {
        const userPayloadResponse = await settings.onPromptHumanInterception({ message: output });
        decision.params.userInputContext = userPayloadResponse;
        continue; // Seamlessly loop back and re-run with parameters active
      }
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
  } finally {
    global.activeAgentOps = Math.max(0, global.activeAgentOps - 1);
  }
}

module.exports = {
  AGENT_PROMPTS,
  runAgentTurn,
  runWorkerAgent
};
