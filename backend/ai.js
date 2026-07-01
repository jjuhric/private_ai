const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleCalendarTool } = require('./tools/calendar_tool');
const { handleGitHubTool } = require('./tools/github_tool');
const { handleWebSearchTool } = require('./tools/web_search_tool');
const { handleGoogleNewsTool } = require('./tools/google_news_tool');
const { handleWeatherTool } = require('./tools/weather_tool');
const { handleMemoryTool } = require('./tools/memory_tool');
const { handleTimeTool } = require('./tools/time_tool');

// Helper to call Local LLM (supporting openai, lm-studio, and anthropic API styles)
async function callLocalLLMStream(baseUrl, apiKey, modelName, messages, apiStyle, onChunk) {
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
      endpoint = `${origin}/api/v1/chat`;
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
      stream: true
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
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
async function callGeminiStream(apiKey, modelName, systemInstruction, history, userMessage, onChunk) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName || 'gemini-2.5-flash',
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
    const text = chunk.text();
    if (text) onChunk(text);
  }
}

// Run the agent loop
async function runAgentLoop({
  db,
  userId,
  provider,
  modelName,
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
  onToolCall
}) {
  const systemPrompt = `You are the main coordinator agent of the Private AI system.

### CRITICAL RUNTIME RULES (MUST OBEY):
1. ALWAYS recall memory FIRST (using the 'memory' tool with the 'recall' action) before selecting any other tool or giving up, if:
   - The user asks about personal details, name, address, or location (e.g., "where I live", "my address", "my name").
   - You need a parameter (like location, zipcode, or date) to perform an action (like checking weather or news) and it is not provided in the current user message. You MUST search memory first to see if the zipcode/location is stored.
2. TIMEZONES & DATES:
   - When scheduling calendar events or discussing times, ALWAYS convert all times from UTC to the user's local timezone.
   - If the user's timezone, latitude, or longitude is not in the current context/history, check memory FIRST.
   - If they are not in memory but you have the user's address/zipcode, call the 'time' tool with the 'lookup_timezone' action to find their timezone, latitude, and longitude.
   - Once you discover the user's timezone offset, latitude, or longitude, you MUST immediately call the 'memory' tool with the 'remember' action to save these details (timezone, latitude, longitude) permanently (long-term) in memory.
3. PERSONAL DATA BREAKDOWN & ENRICHMENT:
   - When the user shares a sentence containing their name and/or address (e.g., "My name is Jeffery Uhrick and I live at 18833 NE County Rd 274, Altha, FL"), you MUST:
     a) Parse and break it down into distinct parts: First Name, Last Name, and Home Address.
     b) Automatically use the search tools (like 'search_web') or time tools (like 'lookup_timezone') to look up valuable contextual details such as the County they live in, the zipcode, and the exact latitude/longitude coordinates.
     c) Save each parsed and retrieved fact as separate individual entries in long-term memory (using 'memory' with the 'remember' action and level 'long-term'). Save separate entries for First Name, Last Name, Address, County, Coordinates, and Timezone.
4. DO NOT default to 'none' or ask the user for details before querying the memory tool to see if you already know them.
5. AUTOMATICALLY store details: When the user shares personal details (name, address, preferences, plans), you MUST immediately call 'memory' with the 'remember' action.

You have access to the following tools:
1. "calendar": Manage meetings/tasks. Action values: 'list' (params: {date: "YYYY-MM-DD"}), 'add' (params: {title, start_time: "YYYY-MM-DD HH:MM", end_time: "YYYY-MM-DD HH:MM", description}), 'delete' (params: {eventId}).
2. "github": Access GitHub details. Action values: 'list_repos', 'get_repo' (params: {owner, repo}), 'list_issues' (params: {owner, repo}).
3. "search_web": Search current info/Google (params: {query}).
4. "google_news": Fetch news headlines and content from Google News (params: {query?: string}). Use this whenever the user asks for general news, topic-specific news, breaking news, or latest events. Pass the specific topic of interest as the query parameter if the user is asking about a particular subject.
5. "weather": Fetch weather forecast/conditions. Action values: 'current' (params: {zipcode?: string, country?: string}), 'hourly' (params: {zipcode?: string, country?: string}), 'daily' (params: {zipcode?: string, country?: string, cnt?: number}). Use this whenever the user asks for current conditions, hourly forecasts, or 7-16 day daily outlooks. If the query specifies a location, pass the zipcode and/or country.
6. "memory": Store or retrieve user details, facts, preferences, and conversations to persist information between sessions. Action values:
   - 'recall' (params: {query?: string}): Search for active memories matching query, or retrieve recent active memories. You MUST use this FIRST before other tools if:
     a) The user asks about previous conversations, preferences, name, or facts from past interactions.
     b) You need location, address, zipcode, or other missing personal details to perform a tool action (like weather or calendar). Query 'recall' first to see if those details are stored in memory before failing or asking the user.
   - 'remember' (params: {content: string, level: "short-term" | "long-term", expiresAt?: string, days?: number}): Store new facts, details, or context learned about the user. Whenever the user shares personal details (like name, address, location, preferences, or upcoming dates), you MUST automatically call 'remember' to save them. Set level to 'short-term' if only relevant short-term (like temporary plans, trip dates, current tasks, or temporary details from previous conversations), otherwise 'long-term'. Short-term memories default to 30 days retention. If the user mentions a specific upcoming event or date (e.g., "going on vacation July 15th"), calculate the day after the event (e.g., "2026-07-16T00:00:00.000Z") and pass it as "expiresAt" so it is remembered until the event has passed. Alternatively, pass "days" for a custom relative duration.
   - 'forget' (params: {memoryId: number}): Delete/forget a memory by its ID. Use this when the user corrects you or asks you to forget/remove a memory.
7. "time": Get current time and timezone details. Action values:
   - 'current_time': Returns the current year, month, day, weekday, and time in UTC.
   - 'lookup_timezone' (params: {zipcode: string, country?: string}): Uses geocoding/weather API to resolve a zipcode/country, returning its latitude, longitude, and timezone offset from UTC (in seconds and hours).
8. "none": If no tool is needed.

You can invoke tools sequentially to gather necessary information. If the results of a tool call indicate you should search a different query, location, or source, you can issue another tool call. When you have gathered all required information, set tool to "none".

Determine if you need a tool. Your output MUST be in this JSON format:
{
  "thought": "your step-by-step reasoning here",
  "tool": "calendar" | "github" | "search_web" | "google_news" | "weather" | "memory" | "time" | "none",
  "action": "action_name_if_any",
  "params": {}
}

If no tool is needed, set tool to "none". Do NOT output anything else but valid JSON.`;

  let currentHistory = [...history];
  let accumulatedToolOutputs = [];
  let toolCallsCount = 0;
  const maxToolCalls = 10;

  while (toolCallsCount < maxToolCalls) {
    let decision = null;
    onThought(`Deciding strategy (turn ${toolCallsCount + 1}/${maxToolCalls})...\n`);

    try {
      const isGemini = provider === 'gemini' || (provider === 'online' && onlineProvider === 'gemini');
      let respText = '';

      if (isGemini) {
        const activeKey = provider === 'gemini' ? (geminiKey || onlineKey) : onlineKey;
        if (!activeKey) throw new Error('Gemini API key is not configured in settings.');
        const genAI = new GoogleGenerativeAI(activeKey);
        const model = genAI.getGenerativeModel({
          model: modelName || 'gemini-2.5-flash',
          generationConfig: { responseMimeType: 'application/json' }
        });
        const prompt = `${systemPrompt}\n\nUser Message: ${userMessage}\nChat History: ${JSON.stringify(currentHistory.slice(-5))}`;
        const result = await model.generateContent(prompt);
        respText = result.response.text();
      } else {
        let targetUrl = '';
        let targetKey = '';
        let targetStyle = '';

        if (provider === 'local') {
          targetUrl = localBaseUrl || 'http://192.168.1.42:1234/v1';
          targetKey = localApiKey;
          targetStyle = localApiStyle || 'openai';
        } else {
          targetUrl = onlineUrl;
          targetKey = onlineKey;
          targetStyle = onlineProvider || 'openai';
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
        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `User Message: ${userMessage}\nChat History: ${JSON.stringify(currentHistory.slice(-5))}` }
        ];

        if (targetStyle === 'anthropic') {
          body = {
            model: modelName,
            system: systemPrompt,
            messages: [{ role: 'user', content: `User Message: ${userMessage}\nChat History: ${JSON.stringify(currentHistory.slice(-5))}` }],
            max_tokens: 1024
          };
        } else {
          body = {
            model: modelName,
            messages,
            temperature: 0.1
          };
          if (targetStyle === 'openai' || targetStyle === 'custom') {
            body.response_format = { type: "json_object" };
          }
        }

        let res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });

        if (!res.ok && (targetStyle === 'openai' || targetStyle === 'custom') && body.response_format) {
          console.warn("Local LLM failed with response_format, retrying without it...");
          delete body.response_format;
          res = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
          });
        }

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Router: LLM API error ${res.status}: ${errText || res.statusText}`);
        }

        const data = await res.json();
        if (targetStyle === 'anthropic') {
          respText = data.content?.[0]?.text || '';
        } else {
          respText = data.choices?.[0]?.message?.content || '';
        }
      }

      respText = respText
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
        .trim();

      let jsonParsed = false;
      try {
        decision = JSON.parse(respText);
        jsonParsed = true;
      } catch (jsonErr) {
        // Attempt to extract JSON substring from the first { to the last }
        const firstBrace = respText.indexOf('{');
        const lastBrace = respText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            const candidate = respText.substring(firstBrace, lastBrace + 1);
            decision = JSON.parse(candidate);
            jsonParsed = true;
          } catch (innerErr) {
            // Ignore
          }
        }
      }

      if (!jsonParsed) {
        try {
          const codeBlockMatch = respText.match(/```json\s*([\s\S]*?)\s*```/) || respText.match(/```\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch && codeBlockMatch[1]) {
            decision = JSON.parse(codeBlockMatch[1].trim());
          } else {
            throw new Error("Could not parse JSON from model output.");
          }
        } catch (codeBlockErr) {
          throw new Error(`Failed to parse response JSON. Original text: ${respText}`);
        }
      }
    } catch (err) {
      console.error('Routing failed, using fallback "none":', err);
      decision = {
        thought: `Routing failed: ${err.message}. Proceeding directly with default responder.`,
        tool: 'none',
        params: {}
      };
    }

    onThought(`Router Thought: ${decision.thought}\n`);

    if (!decision.tool || decision.tool === 'none') {
      break;
    }

    onThought(`Executing tool "${decision.tool}" with action "${decision.action}"...\n`);
    onToolCall({ tool: decision.tool, action: decision.action, params: decision.params });

    let toolOutput = '';
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
    } else if (decision.tool === 'memory') {
      toolOutput = await handleMemoryTool(db, userId, decision.action, decision.params);
    } else if (decision.tool === 'time') {
      toolOutput = await handleTimeTool(db, userId, decision.action, decision.params);
    }

    onThought(`Tool Response received (length: ${toolOutput.length})\n`);
    
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
      content: `[Tool Output for ${decision.tool}]:\n${toolOutput}`
    });

    toolCallsCount++;
  }

  // Now, call the Responder Agent to output the streamed response
  onThought('Generating final response...\n');

  const responderInstruction = `You are a helpful, smart AI Personal Assistant.
If you output a thinking process, planning, or reasoning before your response, you MUST wrap it inside <think> and </think> tags. For example: <think>your thoughts here</think>your final response here.
Here is the user request: "${userMessage}".
${accumulatedToolOutputs.length > 0 ? `We queried tools to gather context. Here are the search/action results:\n${accumulatedToolOutputs.map(t => `--- [Tool: ${t.tool}] ---\n${t.output}`).join('\n\n')}` : ''}
Formulate a rich, helpful final response. Format in beautiful markdown. Fully support emojis.
Make sure to answer the user query directly and clearly.`;

  const isGemini = provider === 'gemini' || (provider === 'online' && onlineProvider === 'gemini');

  if (isGemini) {
    const activeKey = provider === 'gemini' ? (geminiKey || onlineKey) : onlineKey;
    await callGeminiStream(
      activeKey,
      modelName,
      responderInstruction,
      history,
      userMessage,
      onContent
    );
  } else {
    let targetUrl = '';
    let targetKey = '';
    let targetStyle = '';

    if (provider === 'local') {
      targetUrl = localBaseUrl || 'http://192.168.1.42:1234/v1';
      targetKey = localApiKey;
      targetStyle = localApiStyle || 'openai';
    } else {
      targetUrl = onlineUrl;
      targetKey = onlineKey;
      targetStyle = onlineProvider || 'openai';
    }

    const messages = [
      { role: 'system', content: responderInstruction }
    ];
    for (const msg of history) {
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
      onContent
    );
  }
}

module.exports = { runAgentLoop, handleGoogleNewsTool };
