const { GoogleGenerativeAI } = require('@google/generative-ai');
const { handleCalendarTool } = require('./tools/calendar_tool');
const { handleGitHubTool } = require('./tools/github_tool');
const { handleWebSearchTool } = require('./tools/web_search_tool');
const { handleGoogleNewsTool } = require('./tools/google_news_tool');
const { handleWeatherTool } = require('./tools/weather_tool');
const { handleMemoryTool } = require('./tools/memory_tool');
const { handleTimeTool } = require('./tools/time_tool');

// Helper to call Local LLM (supporting openai, lm-studio, and anthropic API styles)
async function callLocalLLMStream(baseUrl, apiKey, modelName, messages, apiStyle, onChunk, abortSignal, db, userId, provider) {
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
    } else if (localStyle === 'local-gemini') {
      endpoint = `${origin}/api/v1/chat`;
    } else {
      endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    }
  } catch (e) {
    if (localStyle === 'local-gemini') {
      endpoint = `${baseUrl.replace(/\/$/, '')}/api/v1/chat`;
    } else {
      endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    }
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
  } else if (localStyle === 'local-gemini') {
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const conversation = messages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    body = {
      model: modelName,
      system_prompt: systemMessage,
      input: conversation
    };
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

  let fullResponseText = '';

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.content?.[0]?.text || data.response || data.content;
    if (content) {
      onChunk(content);
      fullResponseText += content;
    }

    // Save token usage
    let tokenCount = 0;
    if (data.usage && data.usage.total_tokens) {
      tokenCount = data.usage.total_tokens;
    } else if (data.usage && data.usage.input_tokens && data.usage.output_tokens) {
      tokenCount = data.usage.input_tokens + data.usage.output_tokens;
    } else {
      const promptText = JSON.stringify(messages);
      tokenCount = Math.ceil((promptText.length + fullResponseText.length) / 4);
    }
    if (db && typeof db.run === 'function' && userId) {
      const providerType = provider === 'local' ? 'local' : 'online';
      db.run(
        'INSERT INTO token_usage (user_id, model_name, provider_type, token_count) VALUES (?, ?, ?, ?)',
        [userId, modelName || 'unknown', providerType, tokenCount]
      ).catch(err => console.error('Failed to log non-stream local LLM tokens:', err));
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
          const text = parsed.choices?.[0]?.delta?.content || parsed.delta?.text || parsed.response || parsed.content;
          if (text) {
            onChunk(text);
            fullResponseText += text;
          }
        } catch (e) {
          // ignore malformed lines
        }
      }
    }
  }

  // Estimate and log streaming tokens
  const promptText = JSON.stringify(messages);
  const tokenCount = Math.ceil((promptText.length + fullResponseText.length) / 4);
  if (db && typeof db.run === 'function' && userId) {
    const providerType = provider === 'local' ? 'local' : 'online';
    db.run(
      'INSERT INTO token_usage (user_id, model_name, provider_type, token_count) VALUES (?, ?, ?, ?)',
      [userId, modelName || 'unknown', providerType, tokenCount]
    ).catch(err => console.error('Failed to log streaming local LLM tokens:', err));
  }
}

// Helper to call Gemini Client Stream
async function callGeminiStream(apiKey, modelName, systemInstruction, history, userMessage, onChunk, abortSignal, db, userId, provider) {
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

  const result = await model.generateContentStream({ contents }, { signal: abortSignal });
  let fullResponseText = '';
  for await (const chunk of result.stream) {
    if (abortSignal?.aborted) break;
    const text = chunk.text();
    if (text) {
      onChunk(text);
      fullResponseText += text;
    }
  }

  // Record token usage
  let tokenCount = 0;
  try {
    const response = await result.response;
    if (response.usageMetadata && response.usageMetadata.totalTokenCount) {
      tokenCount = response.usageMetadata.totalTokenCount;
    }
  } catch (err) {
    console.error('Failed to get Gemini stream usage metadata:', err);
  }

  if (tokenCount === 0) {
    // Estimate fallback
    const promptText = systemInstruction + JSON.stringify(contents);
    tokenCount = Math.ceil((promptText.length + fullResponseText.length) / 4);
  }

  if (db && typeof db.run === 'function' && userId) {
    const providerType = provider === 'local' ? 'local' : 'online';
    db.run(
      'INSERT INTO token_usage (user_id, model_name, provider_type, token_count) VALUES (?, ?, ?, ?)',
      [userId, modelName || 'gemini-2.0-flash', providerType, tokenCount]
    ).catch(err => console.error('Failed to log Gemini stream tokens:', err));
  }
}

// Run the agent loop
// Run the agent loop (Multi-Agent Coordinator)
async function runAgentLoop({
  db,
  userId,
  chatId,
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
    db,
    userId,
    chatId,
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
    abortSignal,
    workingDirectory: null // will be set dynamically below
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
    const profile = await db.get('SELECT name, zipcode, country, temp_unit, dob, gender, political_leaning, interests FROM users WHERE id = ?', [userId]);
    if (profile) {
      profileContext = `### User Profile Details:
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
    console.error('Failed to load user profile in agent loop:', err);
  }

  let dynamicCapabilitiesContext = '';
  try {
    const caps = await db.all('SELECT agent_name, tool_name, description, parameters FROM agent_capabilities');
    if (caps && caps.length > 0) {
      dynamicCapabilitiesContext = `\n\n### Dynamically Installed Custom Tools in the Mesh:`;
      for (const cap of caps) {
        dynamicCapabilitiesContext += `\n- Agent "**${cap.agent_name}**" has tool "**${cap.tool_name}**": ${cap.description}\n  Tool parameters: ${cap.parameters}`;
      }
      dynamicCapabilitiesContext += `\n\nWhen delegating tasks to these agents, you can expect them to be able to execute these custom tools.`;
    }
  } catch (err) {
    console.error('Failed to query agent capabilities in runAgentLoop:', err);
  }

  let workingDirectory = '';
  try {
    const settingsRow = await db.get('SELECT working_directory FROM user_settings WHERE user_id = ?', [userId]);
    workingDirectory = settingsRow?.working_directory;
  } catch (err) {
    console.error('Failed to query working_directory in runAgentLoop:', err);
  }
  const path = require('path');
  const defaultWorkingDir = path.resolve(path.join(__dirname, '..'));
  if (!workingDirectory) {
    workingDirectory = defaultWorkingDir;
  }
  settings.workingDirectory = workingDirectory;

  const workspaceContext = `\n\n### Workspace System Directories:
- Root Working Directory: ${workingDirectory}
- Built-in Agents File: ${path.join(workingDirectory, 'backend/utils/agents.js')}
- Built-in Tools Directory: ${path.join(workingDirectory, 'backend/tools/')}
- Dynamic Tools Registry: ${path.join(workingDirectory, 'tool_registry/tools/')}`;

  let systemPrompt = AGENT_PROMPTS.supervisor + `\n\n${profileContext}\n\n### User Memories Context:\n${memoriesResult}${dynamicCapabilitiesContext}${workspaceContext}`;
  let currentHistory = [...cleanedHistory];
  let accumulatedToolOutputs = [];
  let toolCallsCount = 0;
  const maxToolCalls = 10;

  // Intercept chat-based approvals for code execution
  const lastAssistantMsg = [...cleanedHistory].reverse().find(msg => msg.role === 'assistant');
  let customSystemPromptContext = '';

  if (lastAssistantMsg) {
    if (lastAssistantMsg.content.includes('[Supervisor Approval Required]')) {
      // Parse agent, command, file and content
      let parsedAgent = null;
      let parsedCommand = null;
      let parsedFile = null;
      let parsedContent = null;
      
      const agentIndex = lastAssistantMsg.content.indexOf('Agent:');
      const commandIndex = lastAssistantMsg.content.indexOf('Command:');
      const fileIndex = lastAssistantMsg.content.indexOf('File:');
      const contentIndex = lastAssistantMsg.content.indexOf('Content:');
      const qaIndex = lastAssistantMsg.content.indexOf('QA Analysis:');
      const errorIndex = lastAssistantMsg.content.indexOf('Error:');

      if (agentIndex !== -1) {
        if (commandIndex !== -1) {
          const endCommandIndex = qaIndex !== -1 ? qaIndex : (errorIndex !== -1 ? errorIndex : lastAssistantMsg.content.indexOf('This command could cause'));
          if (endCommandIndex !== -1 && endCommandIndex > commandIndex) {
            parsedAgent = lastAssistantMsg.content.substring(agentIndex + 6, commandIndex).trim();
            parsedCommand = lastAssistantMsg.content.substring(commandIndex + 8, endCommandIndex).trim();
          }
        } else if (fileIndex !== -1) {
          const endFileIndex = contentIndex !== -1 ? contentIndex : (qaIndex !== -1 ? qaIndex : lastAssistantMsg.content.indexOf('This file write could cause'));
          if (endFileIndex !== -1 && endFileIndex > fileIndex) {
            parsedAgent = lastAssistantMsg.content.substring(agentIndex + 6, fileIndex).trim();
            parsedFile = lastAssistantMsg.content.substring(fileIndex + 5, endFileIndex).trim();
            if (contentIndex !== -1) {
              const endContentIndex = qaIndex !== -1 ? qaIndex : (errorIndex !== -1 ? errorIndex : lastAssistantMsg.content.indexOf('This file write could cause'));
              parsedContent = lastAssistantMsg.content.substring(contentIndex + 8, endContentIndex).trim();
            }
          }
        }
      }

      if (parsedAgent && (parsedCommand || parsedFile)) {
        const reply = userMessage.trim().toLowerCase();
        if (reply.startsWith('1') || reply === 'yes' || reply.includes('approve') || reply.includes('go ahead') || reply.includes('ok')) {
          const { handleCoderTool } = require('./tools/coder_tools');
          let toolOutput = '';
          
          if (parsedCommand) {
            onThought(`User approved the command: "${parsedCommand}". Executing...\n`);
            try {
              toolOutput = await handleCoderTool('execute_command', { command: parsedCommand }, {
                userId,
                settings,
                skipVerification: true,
                agentName: parsedAgent
              });
            } catch (err) {
              toolOutput = `Error running command: ${err.message}`;
            }
          } else if (parsedFile) {
            onThought(`User approved writing to file: "${parsedFile}". Executing...\n`);
            try {
              toolOutput = await handleCoderTool('write_file', { filePath: parsedFile, content: parsedContent }, {
                userId,
                settings,
                skipVerification: true,
                agentName: parsedAgent
              });
            } catch (err) {
              toolOutput = `Error writing file: ${err.message}`;
            }
          }
          
          accumulatedToolOutputs.push({
            tool: `delegate_to_${parsedAgent}`,
            output: toolOutput
          });
          
          currentHistory.push({
            role: 'assistant',
            content: lastAssistantMsg.content
          });
          currentHistory.push({
            role: 'user',
            content: userMessage
          });
          currentHistory.push({
            role: 'user',
            content: parsedCommand ? `[Output for execute_command]:\n${toolOutput}` : `[Output for write_file]:\n${toolOutput}`
          });
          
          toolCallsCount = 1; // Mark that we did 1 tool call turn already
        } else if (reply.startsWith('2') || reply === 'no' || reply.includes('reject') || reply.includes('refuse')) {
          onThought("User rejected running the command/file write. Asking why...\n");
          const promptMsg = "Why did you choose not to go forward with this code?";
          onContent(promptMsg);
          
          if (db && typeof db.run === 'function' && chatId) {
            await db.run(
              'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
              [chatId, 'assistant', promptMsg]
            ).catch(err => console.error('Failed to save rejection prompt to database:', err));
          }
          return;
        }
      }
    } else if (lastAssistantMsg.content.includes('Why did you choose not to go forward with this code?')) {
      // The user is responding with their reason for rejection.
      // Find the original proposal in history.
      const originalProposal = [...cleanedHistory].reverse().find(msg => msg.role === 'assistant' && msg.content.includes('[Supervisor Approval Required]'));
      let rejectedCommandInfo = '';
      if (originalProposal) {
        let parsedCommand = null;
        let parsedFile = null;
        const commandIndex = originalProposal.content.indexOf('Command:');
        const fileIndex = originalProposal.content.indexOf('File:');
        const qaIndex = originalProposal.content.indexOf('QA Analysis:');
        const errorIndex = originalProposal.content.indexOf('Error:');
        
        if (commandIndex !== -1) {
          const endCommandIndex = qaIndex !== -1 ? qaIndex : (errorIndex !== -1 ? errorIndex : originalProposal.content.indexOf('This command could cause'));
          if (endCommandIndex !== -1 && endCommandIndex > commandIndex) {
            parsedCommand = originalProposal.content.substring(commandIndex + 8, endCommandIndex).trim();
            rejectedCommandInfo = `The user rejected running this command: "${parsedCommand}".\n`;
          }
        } else if (fileIndex !== -1) {
          const contentIndex = originalProposal.content.indexOf('Content:');
          const endFileIndex = contentIndex !== -1 ? contentIndex : (qaIndex !== -1 ? qaIndex : originalProposal.content.indexOf('This file write could cause'));
          if (endFileIndex !== -1 && endFileIndex > fileIndex) {
            parsedFile = originalProposal.content.substring(fileIndex + 5, endFileIndex).trim();
            rejectedCommandInfo = `The user rejected writing to this file: "${parsedFile}".\n`;
          }
        }
      }
      
      customSystemPromptContext = `\n\n### User Code Rejection Context:
${rejectedCommandInfo}The user chose not to run the code/command and provided this reason: "${userMessage}".
Please evaluate their reason. If changes to the code or command are required based on their feedback, make those changes (e.g. call the coder/developer agent to edit the files, or adjust the command) and ask for approval again (which will undergo QA and Supervisor review again).
If no changes are required and you can proceed without executing the code, then continue.`;
    }
  }

  if (customSystemPromptContext) {
    systemPrompt += customSystemPromptContext;
  }

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

    // Normalize direct agent calls to delegation format
    let toolName = decision.tool;
    const agentNames = [
      'web_searcher',
      'calendar_handler',
      'coder',
      'qa_engineer',
      'weather_expert',
      'system_specialist',
      'memory_agent',
      'document_vault',
      'developer_agent',
      'node_agent',
      'github_agent',
      'tool_creator_agent',
      'agent_creator_agent'
    ];

    if (agentNames.includes(toolName)) {
      toolName = `delegate_to_${toolName}`;
    } else if (toolName === 'system_info' || toolName === 'system' || toolName === 'system_specialist') {
      toolName = 'delegate_to_system_specialist';
    } else if (toolName === 'developer' || toolName === 'delegate_to_developer') {
      toolName = 'delegate_to_developer_agent';
    } else if (toolName === 'github' || toolName === 'delegate_to_github') {
      toolName = 'delegate_to_github_agent';
    } else if (toolName === 'tool_creator' || toolName === 'delegate_to_tool_creator') {
      toolName = 'delegate_to_tool_creator_agent';
    } else if (toolName === 'agent_creator' || toolName === 'delegate_to_agent_creator') {
      toolName = 'delegate_to_agent_creator_agent';
    }
    decision.tool = toolName;

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
      } else if (agentName === 'system_specialist') {
        subTask = decision.params?.query || decision.params?.task || userMessage;
      } else if (agentName === 'memory_agent') {
        subTask = decision.params?.task || userMessage;
      } else if (agentName === 'document_vault') {
        subTask = decision.params?.query || decision.params?.task || userMessage;
      } else if (agentName === 'developer' || agentName === 'developer_agent') {
        subTask = decision.params?.task || userMessage;
      } else if (agentName === 'node_agent') {
        subTask = decision.params?.query || decision.params?.task || userMessage;
      } else if (agentName === 'github_agent') {
        subTask = decision.params?.query || decision.params?.task || userMessage;
      } else if (agentName === 'tool_creator_agent') {
        subTask = decision.params?.query || decision.params?.task || userMessage;
      } else if (agentName === 'agent_creator_agent') {
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

      // Check if sub-agent output requires user input/permission
      if (toolOutput && typeof toolOutput === 'string' && toolOutput.includes('INPUT_REQUIRED_FROM_USER')) {
        const cleanedOutput = toolOutput.replace('INPUT_REQUIRED_FROM_USER:', '').trim();
        onContent(cleanedOutput);
        return; // Return immediately to pause the coordinator loop
      }
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
      abortSignal,
      db,
      userId,
      provider
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
      abortSignal,
      db,
      userId,
      provider
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
