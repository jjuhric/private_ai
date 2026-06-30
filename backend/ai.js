const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleCalendarTool } = require('./tools/calendar_tool');
const { handleGitHubTool } = require('./tools/github_tool');
const { handleWebSearchTool } = require('./tools/web_search_tool');
const { handleGoogleNewsTool } = require('./tools/google_news_tool');

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
You have access to the following tools:
1. "calendar": Manage meetings/tasks. Action values: 'list' (params: {date: "YYYY-MM-DD"}), 'add' (params: {title, start_time: "YYYY-MM-DD HH:MM", end_time: "YYYY-MM-DD HH:MM", description}), 'delete' (params: {eventId}).
2. "github": Access GitHub details. Action values: 'list_repos', 'get_repo' (params: {owner, repo}), 'list_issues' (params: {owner, repo}).
3. "search_web": Search current info/Google (params: {query}).
4. "google_news": Fetch news headlines and content from Google News (params: {query?: string}). Use this whenever the user asks for general news, topic-specific news, breaking news, or latest events. Pass the specific topic of interest as the query parameter if the user is asking about a particular subject.
5. "none": If no tool is needed.

You can invoke tools sequentially to gather necessary information. If the results of a tool call indicate you should search a different query, location, or source, you can issue another tool call. When you have gathered all required information, set tool to "none".

Determine if you need a tool. Your output MUST be in this JSON format:
{
  "thought": "your step-by-step reasoning here",
  "tool": "calendar" | "github" | "search_web" | "google_news" | "none",
  "action": "action_name_if_any",
  "params": {}
}

If no tool is needed, set tool to "none". Do NOT output anything else but valid JSON.`;

  let currentHistory = [...history];
  let accumulatedToolOutputs = [];
  let toolCallsCount = 0;
  const maxToolCalls = 3;

  while (toolCallsCount < maxToolCalls) {
    let decision = null;
    onThought(`Deciding strategy (turn ${toolCallsCount + 1}/${maxToolCalls})...\n`);

    try {
      const isGemini = provider === 'gemini' || (provider === 'online' && onlineProvider === 'gemini');

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
        const respText = result.response.text();
        decision = JSON.parse(respText);
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
        let text = '';
        if (targetStyle === 'anthropic') {
          text = data.content?.[0]?.text || '';
        } else {
          text = data.choices?.[0]?.message?.content || '';
        }

        text = text
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
          .trim();

        try {
          decision = JSON.parse(text);
        } catch (jsonErr) {
          const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch && codeBlockMatch[1]) {
            decision = JSON.parse(codeBlockMatch[1].trim());
          } else {
            throw jsonErr;
          }
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
