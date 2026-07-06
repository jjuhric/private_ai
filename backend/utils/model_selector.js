const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Runs the routing agent to select the best model.
 * - If provider is local, it queries the currently loaded local model (if any).
 *   If no local model is loaded, it immediately returns the configured model to avoid a cold-start load.
 * - If provider is online, it queries gemini-2.5-flash to route between flash and pro.
 */
async function selectBestModel(settings, userMessage, history) {
  const {
    provider,
    modelName,
    onlineProvider,
    onlineKey,
    geminiKey,
    localBaseUrl,
    localApiKey,
    localApiStyle
  } = settings;

  // 1. OFFLINE (LOCAL) PROVIDER PATH
  if (provider === 'local') {
    const { listLocalModels } = require('./lmstudio');
    const availableModels = await listLocalModels(localBaseUrl, localApiKey);
    const loadedModelObj = availableModels.find(m => m.isLoaded);
    const loadedModel = loadedModelObj ? loadedModelObj.id : null;

    // If no model is currently loaded, bypass routing and return configured default model to avoid cold-start load
    if (!loadedModel) {
      console.log(`[Model Selector] No local model loaded. Defaulting to preferred local model: ${modelName}`);
      return modelName;
    }

    const availableModelIds = availableModels.map(m => m.id);

    const systemPrompt = `You are a Model Selection Router Agent.
Your job is to analyze the user's task request and the chat history, and select the optimal local model to complete the task.

AVAILABLE MODELS:
${JSON.stringify(availableModelIds)}

CURRENTLY LOADED LOCAL MODEL:
"${loadedModel}"

SELECTION RULES:
1. Select the most appropriate model ID from the AVAILABLE MODELS list.
2. IMPORTANT: Loading/switching models in LM Studio takes ~10-30 seconds. If the currently loaded model ("${loadedModel}") is adequate to perform the task, KEEP it (return the loaded model ID). Only switch to a different model if the task capability requirement strictly justifies the load time (e.g. switching from a tiny 3B model to a 70B model for complex coding/reasoning, or switching to a specialized code model).

You MUST respond in this exact JSON format:
{
  "reasoning": "Brief explanation of the choice and trade-offs considered",
  "selected_model": "selected_model_id_here"
}
`;

    try {
      console.log(`[Model Selector] Running local model routing query on loaded model: ${loadedModel}`);
      const cleanUrl = (localBaseUrl || 'http://localhost:1234/v1').trim().replace(/\/$/, '') + '/chat/completions';
      const body = {
        model: loadedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Task: "${userMessage}"\nHistory: ${JSON.stringify((history || []).slice(-5))}` }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      };

      const res = await fetch(cleanUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localApiKey ? { 'Authorization': `Bearer ${localApiKey}` } : {})
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        try {
          const parsed = JSON.parse(text);
          if (parsed.selected_model && availableModelIds.includes(parsed.selected_model)) {
            console.log(`[Model Selector] Local router selected: ${parsed.selected_model} (Reason: ${parsed.reasoning})`);
            return parsed.selected_model;
          }
        } catch (parseErr) {
          // Fallback if JSON parsing fails but text matches one of the IDs
          for (const id of availableModelIds) {
            if (text.includes(id)) return id;
          }
        }
      }
    } catch (err) {
      console.warn(`[Model Selector] Local routing query failed: ${err.message}. Using currently loaded model.`);
    }

    return loadedModel;
  }

  // 2. ONLINE PROVIDER PATH
  const isOnlineGemini = provider === 'gemini' || (provider === 'online' && onlineProvider === 'gemini');
  if (isOnlineGemini) {
    const activeKey = geminiKey || onlineKey;
    if (!activeKey) {
      console.log(`[Model Selector] No online API key available. Defaulting to: ${modelName || 'gemini-2.5-flash'}`);
      return modelName || 'gemini-2.5-flash';
    }

    const systemPrompt = `You are a Model Selection Router Agent.
Your job is to analyze the user's task request and the chat history, and select the optimal Gemini model to complete the task.

SELECTION RULES:
1. Choose between 'gemini-2.5-flash' and 'gemini-2.5-pro'.
2. IMPORTANT: 'gemini-2.5-flash' is extremely fast and cheap, and should be the default for most tasks (Q&A, weather, system stats, simple requests).
3. Only select 'gemini-2.5-pro' for highly complex coding tasks, advanced refactoring, complex mathematical/logical reasoning, or when processing massive amounts of documents/vault text. Be considerate of API costs.

You MUST respond in this exact JSON format:
{
  "reasoning": "Brief explanation of the choice and trade-offs considered",
  "selected_model": "selected_model_id_here"
}
`;

    try {
      console.log(`[Model Selector] Running online model routing query using gemini-2.5-flash`);
      const genAI = new GoogleGenerativeAI(activeKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

      const prompt = `System Instructions:
${systemPrompt}

User Message: "${userMessage}"
History: ${JSON.stringify((history || []).slice(-5))}`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);
      if (parsed.selected_model === 'gemini-2.5-flash' || parsed.selected_model === 'gemini-2.5-pro') {
        console.log(`[Model Selector] Online router selected: ${parsed.selected_model} (Reason: ${parsed.reasoning})`);
        return parsed.selected_model;
      }
    } catch (err) {
      console.warn(`[Model Selector] Online routing query failed: ${err.message}. Using default: ${modelName || 'gemini-2.5-flash'}`);
    }
  }

  // Fallback to configured model name if provider is custom or routing failed
  return modelName;
}

module.exports = {
  selectBestModel
};
