const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleCalendarTool } = require('./tools/calendar_tool');
const { handleGitHubTool } = require('./tools/github_tool');
const { handleWebSearchTool } = require('./tools/web_search_tool');
const { handleGoogleNewsTool } = require('./tools/google_news_tool');
const { handleWeatherTool } = require('./tools/weather_tool');
const { handleMemoryTool } = require('./tools/memory_tool');
const { handleTimeTool } = require('./tools/time_tool');

// Helper to call Local LLM (supporting openai, lm-studio, and anthropic API styles)
async function callLocalLLMStream(baseUrl, apiKey, modelName, messages, apiStyle, onChunk, abortSignal) {
  const localStyle = apiStyle || 'openai';
  let endpoint = '';
  let headers = {
    'Content-Type': 'application/json'
  };

  if (apiKey && apiKey !== 'lm-studio') {
    if (localStyle === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  let body = {};

  try {
    const urlObj = new URL(baseUrl);
    const origin = urlObj.origin;

    if (localStyle === 'lm-studio') {
      endpoint = `${origin}/v1/chat/completions`;
    } else if (localStyle === 'anthropic') {
      endpoint = `${origin}/v1/messages`;
    } else {
      endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    }
  } catch (e) {
    endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  }

  if (localStyle === 'anthropic') {
    // Anthropic style formatting
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const anthropicMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

    body = {
      model: modelName,
      messages: anthropicMessages,
      max_tokens: 4096,
      stream: true
    };
    if (systemMessage) {
      body.system = systemMessage;
    }
  } else {
    // OpenAI and LM Studio style formatting
    body = {
      model: modelName,
      messages: messages,
      temperature: 0.7,
      frequency_penalty: 0.3,
      presence_penalty: 0.1,
      max_tokens: 4096,
      stream: true
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: abortSignal
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${errText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.content?.[0]?.text;
    if (content) {
      onChunk(content);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    if (abortSignal?.aborted) {
      await reader.cancel();
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const cleaned = line.trim();
      if (!cleaned || cleaned === 'data: [DONE]') continue;
      if (cleaned.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(cleaned.substring(6));
          // Support both OpenAI format and Anthropic format chunk parsing
          const text = parsed.choices?.[0]?.delta?.content || parsed.delta?.text;
          if (text) onChunk(text);
        } catch (e) {
          // ignore malformed lines
        }
      }
    }
  }
}

// Helper to call Gemini Client Stream
async function callGeminiStream(apiKey, modelName, systemInstruction, history, userMessage, onChunk, abortSignal) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName || 'gemini-2.0-flash',
    systemInstruction: systemInstruction
  });

  const contents = [];
  for (const msg of history) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    });
  }
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  const result = await model.generateContentStream({ contents });
  for await (const chunk of result.stream) {
    if (abortSignal?.aborted) break;
    const text = chunk.text();
    if (text) onChunk(text);
  }
}

// Run the agent loop
// Run the agent loop (Multi-Agent Coordinator)
async function runAgentLoop({
  db,
  userId,
  provider,
  modelName,
  supervisorModel,
  userMessage,
  history,
  githubToken,
  geminiKey, // legacy, fallback to onlineKey
  localBaseUrl,
  localApiKey,
  localApiStyle,
  onlineUrl,
  onlineKey,
  onlineProvider,
  onThought,
  onContent,
  onToolCall,
  onAgentStatus,
  isAborted,
  abortSignal,
  onCommandApprovalRequired,
  forceMemoryAgent = false
}) {
  const { AGENT_PROMPTS, runAgentTurn, runWorkerAgent } = require('./utils/agents');

  // Filter history to ensure it starts with a user message
  const firstUserIdx = (history || []).findIndex(msg => msg.role === 'user');
  const cleanedHistory = firstUserIdx !== -1 ? history.slice(firstUserIdx) : [];

  const settings = {
    provider,
    modelName,
    onlineProvider,
    onlineKey,
    geminiKey,
    localBaseUrl,
    localApiKey,
    localApiStyle,
    onlineUrl,
    forceMemoryAgent,
    onToolCall,
    onAgentStatus,
    onCommandApprovalRequired,
    abortSignal
  };

  // Core/Location memories will be fetched programmatically below.
  // Other memories should be requested by the Supervisor dynamically using delegate_to_memory_agent.
  let memoriesResult = 'No relevant memories retrieved yet. Delegate to the memory agent if you need other past user facts.';

  // Programmatic fetch of core identity and location memories to guarantee availability
  try {
    const coreRows = await db.all(
      `SELECT id, content, level FROM memories 
       WHERE user_id = ? 
         AND (expires_at IS NULL OR expires_at > datetime('now'))
         AND (
           content LIKE '%zipcode%' OR 
           content LIKE '%location%' OR 
           content LIKE '%latitude%' OR 
           content LIKE '%longitude%' OR 
           content LIKE '%address%' OR 
           content LIKE '%first name%' OR 
           content LIKE '%last name%' OR
           content LIKE '%country%'
         )`,
      [userId]
    );
    if (coreRows && coreRows.length > 0) {
      const coreMemStrings = coreRows.map(r => `- [ID ${r.id}] ${r.content} (${r.level})`);
      memoriesResult = `${memoriesResult}\n\n### Core Identity & Location Memories:\n${coreMemStrings.join('\n')}`;
    }
  } catch (err) {
    console.error('Failed to programmatically query core memories:', err);
  }

  // Fetch user profile details
  let profileContext = '';
  try {
    const profile = await db.get('SELECT name, zipcode, country, temp_unit FROM users WHERE id = ?', [userId]);
    if (profile) {
      profileContext = `### User Profile Details:
- Profile Name: ${profile.name || 'Not set'}
- Profile Zipcode: ${profile.zipcode || 'Not set'}
- Profile Country: ${profile.country || 'US'}
- Profile Temp Unit: ${profile.temp_unit || 'imperial'}`;
    }
  } catch (err) {
    console.error('Failed to load user profile in agent loop:', err);
  }

  const systemPrompt = AGENT_PROMPTS.supervisor + `\n\n${profileContext}\n\n### User Memories Context:\n${memoriesResult}`;
  let currentHistory = [...cleanedHistory];
  let accumulatedToolOutputs = [];
  let toolCallsCount = 0;
  const maxToolCalls = 10;

  while (toolCallsCount < maxToolCalls) {
    if (abortSignal?.aborted || (isAborted && isAborted())) {
      onThought("Stream aborted by user.\n");
      break;
    }
    let decision = null;
    if (onAgentStatus) onAgentStatus({ agent: 'supervisor', status: 'active' });
    onThought(`Supervisor deciding strategy (turn ${toolCallsCount + 1}/${maxToolCalls})...\n`);

    try {
      const supervisorSettings = {
        ...settings,
        modelName: supervisorModel || settings.modelName
      };
      decision = await runAgentTurn('supervisor', systemPrompt, supervisorSettings, userMessage, currentHistory);
    } catch (err) {
      console.error('Supervisor turn failed, using fallback "none":', err);
      decision = {
        thought: `Supervisor error: ${err.message}. Proceeding directly with default responder.`,
        tool: 'none',
        params: {}
      };
    }

    onThought(`Supervisor Thought: ${decision.thought}\n`);

    if (!decision.tool || decision.tool === 'none') {
      break;
    }

    onThought(`Supervisor invoking tool/delegate: "${decision.tool}" with action "${decision.action}"...\n`);
    onToolCall({ tool: decision.tool, action: decision.action || 'delegate', params: decision.params });

    let toolOutput = '';
    
    // Check for delegation
    if (decision.tool.startsWith('delegate_to_') && decision.tool !== 'delegate_to_remote_node') {
      const agentName = decision.tool.replace('delegate_to_', '');
      let subTask = '';
      if (agentName === 'web_searcher') {
        subTask = decision.params?.query || userMessage;
      } else if (agentName === 'calendar_handler') {
        subTask = decision.params?.task || JSON.stringify(decision.params);
      } else if (agentName === 'coder') {
        subTask = decision.params?.task || userMessage;
      } else if (agentName === 'qa_engineer') {
        subTask = decision.params?.task || userMessage;
      } else if (agentName === 'weather_expert') {
        subTask = decision.params?.task || JSON.stringify(decision.params);
      } else if (agentName === 'host_specialist') {
        subTask = decision.params?.query || decision.params?.task || userMessage;
      } else if (agentName === 'memory_agent') {
        subTask = decision.params?.task || userMessage;
      } else if (agentName === 'document_vault') {
        subTask = decision.params?.query || decision.params?.task || userMessage;
      } else {
        subTask = userMessage;
      }

      onThought(`Delegating sub-task to Agent "${agentName}": "${subTask}"...\n`);
      if (onAgentStatus) onAgentStatus({ agent: agentName, status: 'active' });
      try {
        toolOutput = await runWorkerAgent(agentName, settings, subTask, db, userId, githubToken);
      } catch (err) {
        toolOutput = `Agent "${agentName}" delegation failed: ${err.message}`;
      }
      if (onAgentStatus) onAgentStatus({ agent: 'supervisor', status: 'active' });
    } else {
      // Execute direct fallback tools of supervisor
      if (decision.tool === 'calendar') {
        toolOutput = await handleCalendarTool(db, userId, decision.action, decision.params);
      } else if (decision.tool === 'github') {
        toolOutput = await handleGitHubTool(githubToken, decision.action, decision.params);
      } else if (decision.tool === 'search_web') {
        const q = decision.params?.query || userMessage;
        toolOutput = await handleWebSearchTool(db, userId, q);
      } else if (decision.tool === 'google_news') {
        toolOutput = await handleGoogleNewsTool(decision.params?.query);
      } else if (decision.tool === 'weather') {
        toolOutput = await handleWeatherTool(db, userId, decision.action, decision.params);
      } else if (decision.tool === 'host_machine') {
        const { handleHostMachineTool } = require('./tools/host_machine_tool');
        toolOutput = await handleHostMachineTool(decision.action, decision.params);
      } else if (decision.tool === 'time') {
        const { handleTimeTool } = require('./tools/time_tool');
        toolOutput = await handleTimeTool(db, userId, decision.action, decision.params);
      } else if (decision.tool === 'delegate_to_remote_node') {
        try {
          const { nodeId, command } = decision.params;
          const fetch = require('node-fetch'); // Ensure fetch is available
          const bridgeRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/bridge/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.token}` },
            body: JSON.stringify({ nodeId, command })
          });
          const data = await bridgeRes.json();
          toolOutput = JSON.stringify(data);
        } catch (err) {
          toolOutput = `Remote node execution error: ${err.message}`;
        }
      } else {
        toolOutput = `Error: Tool "${decision.tool}" is unrecognized by Supervisor.`;
      }
    }

    onThought(`Response received from tool/agent (length: ${toolOutput.length})\n`);

    accumulatedToolOutputs.push({
      tool: decision.tool,
      output: toolOutput
    });

    currentHistory.push({
      role: 'assistant',
      content: `Thought: ${decision.thought}\nCalling tool: ${decision.tool} with parameters: ${JSON.stringify(decision.params)}`
    });
    currentHistory.push({
      role: 'user',
      content: `[Output for ${decision.tool}]:\n${toolOutput}`
    });

    toolCallsCount++;
  }

  // Now, call the Responder Agent to output the streamed response
  if (abortSignal?.aborted || (isAborted && isAborted())) {
    onThought("Stream aborted by user.\n");
    return;
  }
  if (onAgentStatus) onAgentStatus({ agent: 'supervisor', status: 'active' });
  onThought('Supervisor generating final response...\n');

  const responderInstruction = `You are a helpful, smart AI Personal Assistant Supervisor.
If you output a thinking process, planning, or reasoning before your response, you MUST wrap it inside <think> and </think> tags. For example: <think>your thoughts here</think>your final response here.
CRITICAL: Avoid going in loops or repeating analysis. Keep any thinking process concise and make a clear decision quickly, then close the </think> tag and output your final response immediately.
Here is the user request: "${userMessage}".
${accumulatedToolOutputs.length > 0 ? `We delegated tasks/queried tools to gather context. Here are the report/action results:\n${accumulatedToolOutputs.map(t => `--- [Source: ${t.tool}] ---\n${t.output}`).join('\n\n')}` : ''}
Formulate a rich, helpful final response. Format in beautiful markdown. Fully support emojis.
Make sure to answer the user query directly and clearly.`;

  const isGemini = provider === 'gemini' || (provider === 'online' && onlineProvider === 'gemini');

  if (isGemini) {
    const activeKey = provider === 'gemini' ? (geminiKey || onlineKey) : onlineKey;
    await callGeminiStream(
      activeKey,
      modelName,
      responderInstruction,
      cleanedHistory,
      userMessage,
      onContent,
      abortSignal
    );
  } else {
    let targetUrl = '';
    let targetKey = '';
    let targetStyle = '';

    if (provider === 'local') {
      targetUrl = localBaseUrl || (process.platform === 'win32' ? 'http://localhost:1234/v1' : 'http://192.168.1.42:1234/v1');
      targetKey = localApiKey;
      targetStyle = localApiStyle || 'openai';
    } else {
      targetUrl = onlineUrl || 'https://api.openai.com/v1';
      targetKey = onlineKey;
      targetStyle = onlineProvider || 'openai';
    }

    const messages = [
      { role: 'system', content: responderInstruction }
    ];
    for (const msg of cleanedHistory) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    }
    messages.push({ role: 'user', content: userMessage });

    await callLocalLLMStream(
      targetUrl,
      targetKey,
      modelName,
      messages,
      targetStyle,
      onContent,
      abortSignal
    );
  }
}

async function generateGreetingAndSave(db, userId, chatId) {
  let userName = '';
  try {
    const user = await db.get('SELECT name FROM users WHERE id = ?', [userId]);
    userName = user?.name || '';
  } catch (err) {
    console.error('Failed to fetch user name for greeting:', err);
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const greeting = `Hello${userName ? ' ' + userName : ''}! Today is ${dateStr} ${timeStr}. What can I do for you next?`;

  try {
    await db.run(
      'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
      [chatId, 'assistant', greeting]
    );
  } catch (dbErr) {
    console.error('Failed to save generated greeting to database:', dbErr);
  }
}

module.exports = { runAgentLoop, handleGoogleNewsTool, generateGreetingAndSave };
