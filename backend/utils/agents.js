const { GoogleGenerativeAI } = require('@google/generative-ai');

const AGENT_PROMPTS = {
  supervisor: `You are the Supervisor Agent of the Private AI system.
Your job is to coordinate, delegate tasks to specialized sub-agents, retrieve their findings, and compile the final response.

### Available Sub-Agents & Tools:
1. delegate_to_web_searcher (params: { query }): Search current web info/Google News.
2. delegate_to_calendar_handler (params: { action, params }): Manage meetings/tasks. Action values: 'list', 'add', 'delete'.
3. delegate_to_coder (params: { task }): Writes, refactors, reads local workspace files or runs local commands.
4. delegate_to_qa_engineer (params: { task }): Reviews code, finds vulnerabilities, and audits code quality.
5. delegate_to_weather_expert (params: { action, zipcode, country }): Fetches weather (One Call API). Action: 'current', 'hourly', 'daily', 'onecall'.
6. delegate_to_host_specialist (params: { query }): Inspects local machine CPU, RAM, disk space, and OS properties.
7. memory (action: 'recall' or 'remember'): Recall past facts or remember new ones.
8. time (action: 'current_time' or 'lookup_timezone'): Find current date/time.

### CRITICAL RULES:
1. Memory/Time first: If timezone offset or date is missing for weather/calendar, query time/memory first.
2. Delegation first: Do not answer questions yourself if they require weather, searching, coding, calendar, or host details. Delegate to the correct sub-agent.
3. Summarization: When sub-agents finish and return their reports, combine their outputs into a final clear response.`,

  web_searcher: `You are the Web Searching Agent.
Your job is to search the web or Google News to gather info, and summarize the findings.
Available Tools:
- search_web (params: { query })
- google_news (params: { query })`,

  calendar_handler: `You are the Calendar Handling Agent.
Your job is to manage calendar events.
Available Tools:
- calendar (action: 'list' | 'add' | 'delete', params: { title, start_time, end_time, description, eventId, date })`,

  coder: `You are the Coding Agent (Superior Developer).
Your job is to read/write files and execute shell commands inside the workspace directory.
Available Tools:
- read_file (params: { filePath })
- write_file (params: { filePath, content })
- list_dir (params: { dirPath })
- execute_command (params: { command })
- github (action: 'list_repos' | 'get_repo' | 'list_issues', params: { owner, repo })`,

  qa_engineer: `You are the Quality Assurance Agent.
Your job is to find vulnerabilities, bugs, and enforce code quality standards.
Available Tools:
- read_file (params: { filePath })
- list_dir (params: { dirPath })
- execute_command (params: { command })`,

  weather_expert: `You are the Weather Expert Agent.
Your job is to gather current, hourly, or daily forecasts.
Available Tools:
- weather (action: 'current' | 'hourly' | 'daily' | 'onecall', params: { zipcode, country })`,

  host_specialist: `You are the Host Specialist Agent.
Your job is to query the local computer's specifications (CPU, RAM, OS, disk volume info).
Available Tools:
- host_machine (action: 'get_specifications')`
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
      model: modelName || 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });
    const result = await model.generateContent(fullPrompt);
    respText = result.response.text();
  } else {
    let targetUrl = provider === 'local' 
      ? (localBaseUrl || 'http://localhost:1234/v1') 
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
        endpoint = `${origin}/api/v1/chat`;
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
        system: systemPrompt,
        messages: [{ role: 'user', content: fullPrompt }],
        max_tokens: 1024
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
      body: JSON.stringify(body)
    });

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
    throw new Error(`Failed to parse agent JSON: ${respText}`);
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
      ? (localBaseUrl || 'http://localhost:1234/v1') 
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
        endpoint = `${origin}/api/v1/chat`;
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
        messages: [{ role: 'user', content: responderInstruction }],
        temperature: 0.2,
        max_tokens: 2048
      };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
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
    const decision = await runAgentTurn(agentName, systemPrompt, settings, task, history);
    
    if (!decision.tool || decision.tool === 'none') {
      break;
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
      output = await handleCoderTool(decision.tool, decision.params);
    } else if (decision.tool === 'github') {
      const { handleGitHubTool } = require('../tools/github_tool');
      output = await handleGitHubTool(githubToken, decision.action, decision.params);
    } else if (decision.tool === 'calendar') {
      const { handleCalendarTool } = require('../tools/calendar_tool');
      output = await handleCalendarTool(db, userId, decision.action, decision.params);
    } else if (decision.tool === 'search_web') {
      const { handleWebSearchTool } = require('../tools/web_search_tool');
      const q = decision.params?.query || task;
      output = await handleWebSearchTool(db, userId, q);
    } else if (decision.tool === 'google_news') {
      const { handleGoogleNewsTool } = require('../tools/google_news_tool');
      output = await handleGoogleNewsTool(decision.params?.query);
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
