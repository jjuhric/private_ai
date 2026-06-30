const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleDecoder } = require('google-news-url-decoder');

// Calendar tool operations (SQLite-backed)
async function handleCalendarTool(db, userId, action, params) {
  if (action === 'list') {
    const { date } = params; // YYYY-MM-DD
    const queryDate = date || new Date().toISOString().split('T')[0];
    const events = await db.all(
      `SELECT * FROM calendar_events 
       WHERE user_id = ? AND (start_time LIKE ? OR date(start_time) = date(?))
       ORDER BY start_time ASC`,
      [userId, `${queryDate}%`, queryDate]
    );
    return JSON.stringify(events);
  } else if (action === 'add') {
    const { title, start_time, end_time, description } = params;
    if (!title || !start_time) {
      return JSON.stringify({ error: 'Title and start_time are required' });
    }
    const result = await db.run(
      `INSERT INTO calendar_events (user_id, title, description, start_time, end_time) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, title, description || '', start_time, end_time || start_time]
    );
    return JSON.stringify({ success: true, eventId: result.lastID, message: 'Event added successfully' });
  } else if (action === 'delete') {
    const { eventId } = params;
    if (!eventId) {
      return JSON.stringify({ error: 'eventId is required' });
    }
    await db.run(`DELETE FROM calendar_events WHERE id = ? AND user_id = ?`, [eventId, userId]);
    return JSON.stringify({ success: true, message: 'Event deleted successfully' });
  }
  return JSON.stringify({ error: 'Unknown calendar action' });
}

// GitHub tool operations
async function handleGitHubTool(token, action, params) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Private-AI-Assistant'
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  try {
    if (action === 'list_repos') {
      const url = token 
        ? 'https://api.github.com/user/repos?sort=updated&per_page=5'
        : 'https://api.github.com/repositories?per_page=5'; // public fallback
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`GitHub error: ${res.statusText}`);
      const data = await res.json();
      return JSON.stringify(data.map(r => ({ name: r.full_name, url: r.html_url, description: r.description })));
    } else if (action === 'get_repo') {
      const { owner, repo } = params;
      if (!owner || !repo) return JSON.stringify({ error: 'Owner and repo are required' });
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!res.ok) throw new Error(`GitHub error: ${res.statusText}`);
      const data = await res.json();
      return JSON.stringify({ name: data.full_name, desc: data.description, stars: data.stargazers_count, forks: data.forks_count });
    } else if (action === 'list_issues') {
      const { owner, repo } = params;
      if (!owner || !repo) return JSON.stringify({ error: 'Owner and repo are required' });
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=5`, { headers });
      if (!res.ok) throw new Error(`GitHub error: ${res.statusText}`);
      const data = await res.json();
      return JSON.stringify(data.map(i => ({ number: i.number, title: i.title, state: i.state, url: i.html_url })));
    }
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
  return JSON.stringify({ error: 'Unknown GitHub action' });
}

// Web search tool operations
async function handleWebSearchTool(query) {
  if (!query) return JSON.stringify({ error: 'Query is required' });
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    if (!response.ok) {
      throw new Error(`Google request failed: ${response.statusText}`);
    }

    const html = await response.text();
    const results = [];
    
    // Split page into standard Google result container blocks
    const blocks = html.split(/<div class="g"|<div class="MjjYud"/);
    for (let i = 1; i < blocks.length && results.length < 5; i++) {
      const block = blocks[i];
      const linkMatch = block.match(/<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (linkMatch) {
        let link = linkMatch[1];
        let title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
        
        if (link.includes('google.com')) continue;
        
        const snippetMatch = block.match(/<div class="VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
                             block.match(/<div class="BNeawe s3v9rd AP7Wnd"[^>]*>([\s\S]*?)<\/div>/) ||
                             block.match(/<span class="aCOpRe"[^>]*>([\s\S]*?)<\/span>/);
                             
        let snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';
        
        results.push({
          title,
          link,
          snippet
        });
      }
    }

    // Fallback: Try global page matching if structured blocks were not found
    if (results.length === 0) {
      const globalReg = /<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g;
      let globalMatch;
      while ((globalMatch = globalReg.exec(html)) !== null && results.length < 5) {
        const link = globalMatch[1];
        const title = globalMatch[2].replace(/<[^>]*>/g, '').trim();
        if (!link.includes('google.com')) {
          results.push({ title, link, snippet: 'Click link to view details.' });
        }
      }
    }
    
    if (results.length === 0) {
      // Wikipedia fallback
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
      const res = await fetch(wikiUrl);
      if (res.ok) {
        const data = await res.json();
        const wikiResults = data.query.search.slice(0, 3).map(r => ({
          title: r.title,
          snippet: r.snippet.replace(/<span class="searchmatch">|<\/span>/g, ''),
          link: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title)}`
        }));
        return JSON.stringify({ source: 'Wikipedia', results: wikiResults });
      }
      return JSON.stringify({ error: 'Search failed' });
    }
    
    // Deep scrape the top Google search result pages
    const scrapedResults = [];
    for (const res of results.slice(0, 3)) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const pageRes = await fetch(res.link, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const pageHtml = await pageRes.text();
        const fullContent = extractFirst100Words(pageHtml);
        
        scrapedResults.push({
          title: res.title,
          link: res.link,
          snippet: res.snippet,
          scraped_content: fullContent
        });
      } catch (err) {
        console.error(`Deep search scrape failed for ${res.link}:`, err.message);
        scrapedResults.push({
          title: res.title,
          link: res.link,
          snippet: res.snippet,
          scraped_content: 'Could not scrape live contents. Falling back to search snippet.'
        });
      }
    }
    
    return JSON.stringify({ source: 'Google Live Search with Scraped Snippets', results: scrapedResults });
  } catch (err) {
    console.error('Google search failed, trying Wikipedia fallback:', err.message);
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
      const res = await fetch(wikiUrl);
      if (res.ok) {
        const data = await res.json();
        const wikiResults = data.query.search.slice(0, 3).map(r => ({
          title: r.title,
          snippet: r.snippet.replace(/<span class="searchmatch">|<\/span>/g, ''),
          link: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title)}`
        }));
        return JSON.stringify({ source: 'Wikipedia Fallback', results: wikiResults });
      }
    } catch (wikiErr) {
      return JSON.stringify({ error: `Search failed: ${err.message} / ${wikiErr.message}` });
    }
    return JSON.stringify({ error: `Search failed: ${err.message}` });
  }
}

// Google News tool operations
async function handleGoogleNewsTool(query) {
  try {
    const rssUrl = query
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
      : 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';
      
    const response = await fetch(rssUrl);
    if (!response.ok) throw new Error('Failed to fetch news RSS feed');
    const xml = await response.text();

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    const articles = [];

    while ((match = itemRegex.exec(xml)) !== null && articles.length < 30) {
      const block = match[1];
      const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1];
      const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1];
      if (title && link) {
        articles.push({
          headline: title.replace(/<[^>]*>/g, '').trim(),
          link: link.trim()
        });
      }
    }

    const decoder = new GoogleDecoder();
    const scrapedArticles = await Promise.all(
      articles.map(async (art, index) => {
        try {
          let destinationLink = art.link;
          try {
            const decoded = await decoder.decode(art.link);
            if (decoded && decoded.status) {
              destinationLink = decoded.decoded_url;
            }
          } catch (decodeErr) {
            console.warn(`Failed to decode URL for "${art.headline}":`, decodeErr.message);
          }

          // Limit intensive web scraping to the top 10 articles to protect performance and bandwidth
          if (index >= 10) {
            return {
              headline: art.headline,
              link: destinationLink,
              content: 'Headline and link only (content not scraped to save bandwidth/time).'
            };
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          
          const destRes = await fetch(destinationLink, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          const destHtml = await destRes.text();
          const snippet = extractFirst100Words(destHtml);
          return {
            headline: art.headline,
            link: destinationLink,
            content: snippet
          };
        } catch (err) {
          console.error(`Failed to scrape article "${art.headline}":`, err.message);
          return {
            headline: art.headline,
            link: art.link,
            content: 'Failed to scrape full text from destination server.'
          };
        }
      })
    );

    return JSON.stringify({
      source: query ? `Google News (Search: "${query}")` : 'Google News (Top Stories)',
      articles: scrapedArticles
    });
  } catch (err) {
    return JSON.stringify({ error: `News fetch failed: ${err.message}` });
  }
}

function extractFirst100Words(html) {
  let text = html
    .replace(/<head>[\s\S]*?<\/head>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    
  const words = text.split(/\s+/).slice(0, 100);
  return words.join(' ') + '...';
}

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
    model: modelName || 'gemini-1.5-flash',
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

Determine if you need a tool. Your output MUST be in this JSON format:
{
  "thought": "your step-by-step reasoning here",
  "tool": "calendar" | "github" | "search_web" | "google_news" | "none",
  "action": "action_name_if_any",
  "params": {}
}

If no tool is needed, set tool to "none". Do NOT output anything else but valid JSON.`;

  let decision = null;
  onThought('Deciding strategy and routing request...\n');

  try {
    const isGemini = provider === 'gemini' || (provider === 'online' && onlineProvider === 'gemini');
    
    if (isGemini) {
      const activeKey = provider === 'gemini' ? (geminiKey || onlineKey) : onlineKey;
      if (!activeKey) throw new Error('Gemini API key is not configured in settings.');
      const genAI = new GoogleGenerativeAI(activeKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });
      const prompt = `${systemPrompt}\n\nUser Message: ${userMessage}\nChat History: ${JSON.stringify(history.slice(-3))}`;
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
        { role: 'user', content: `User Message: ${userMessage}\nChat History: ${JSON.stringify(history.slice(-3))}` }
      ];
      
      if (targetStyle === 'anthropic') {
        body = {
          model: modelName,
          system: systemPrompt,
          messages: [{ role: 'user', content: `User Message: ${userMessage}\nChat History: ${JSON.stringify(history.slice(-3))}` }],
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
      
      // If output is not valid JSON (some models don't follow format strictly without response_format parameter)
      // try to parse out the JSON block if it is wrapped in markdown code fence.
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

  let toolOutput = '';
  if (decision.tool && decision.tool !== 'none') {
    onThought(`Executing tool "${decision.tool}" with action "${decision.action}"...\n`);
    onToolCall({ tool: decision.tool, action: decision.action, params: decision.params });

    if (decision.tool === 'calendar') {
      toolOutput = await handleCalendarTool(db, userId, decision.action, decision.params);
    } else if (decision.tool === 'github') {
      toolOutput = await handleGitHubTool(githubToken, decision.action, decision.params);
    } else if (decision.tool === 'search_web') {
      const q = decision.params?.query || userMessage;
      toolOutput = await handleWebSearchTool(q);
    } else if (decision.tool === 'google_news') {
      toolOutput = await handleGoogleNewsTool(decision.params?.query);
    }

    onThought(`Tool Response received: ${toolOutput.substring(0, 300)}...\n`);
  }

  // Now, call the Responder Agent to output the streamed response
  onThought('Generating final response...\n');

  const responderInstruction = `You are a helpful, smart AI Personal Assistant.
If you output a thinking process, planning, or reasoning before your response, you MUST wrap it inside <think> and </think> tags. For example: <think>your thoughts here</think>your final response here.
Here is the user request: "${userMessage}".
${toolOutput ? `We queried a tool for additional context. Here is the tool output: ${toolOutput}` : ''}
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
