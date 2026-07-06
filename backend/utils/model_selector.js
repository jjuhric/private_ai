const { GoogleGenerativeAI } = require('@google/generative-ai');

const BLOCKED_MODEL_PATTERNS = ['embed', 'embedding', 'nomic-embed'];

function checkAndFallbackModel(candidate, preferredModel) {
  const preferredLower = (preferredModel || '').toLowerCase();
  const isQwenPreferred = preferredLower.includes('qwen');

  let fallback = preferredModel || 'google/gemma-4-e4b';
  if (BLOCKED_MODEL_PATTERNS.some(p => fallback.toLowerCase().includes(p))) {
    fallback = 'google/gemma-4-e4b';
  }

  // If preferred is not qwen, fallback should not be qwen
  if (!isQwenPreferred && fallback.toLowerCase().includes('qwen')) {
    fallback = 'google/gemma-4-e4b';
  }

  let selected = candidate || fallback;
  if (selected && BLOCKED_MODEL_PATTERNS.some(p => selected.toLowerCase().includes(p))) {
    console.warn(`[Model Selector] Warning: selected model "${selected}" is an embedding-only model. Silently falling back to default model: "${fallback}"`);
    selected = fallback;
  }

  // Force non-qwen if not preferred
  if (!isQwenPreferred && selected.toLowerCase().includes('qwen')) {
    console.log(`[Model Selector] Overriding selected model "${selected}" to "google/gemma-4-e4b" because Qwen is not preferred in settings.`);
    selected = 'google/gemma-4-e4b';
  }

  return selected;
}

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
    
    const preferredLower = (modelName || '').toLowerCase();
    const isQwenPreferred = preferredLower.includes('qwen');

    let loadedModelObj = availableModels.find(m => m.isLoaded);
    let loadedModel = loadedModelObj ? loadedModelObj.id : null;

    // If loaded model is Qwen but Qwen is not preferred, ignore it
    if (loadedModel && loadedModel.toLowerCase().includes('qwen') && !isQwenPreferred) {
      console.log(`[Model Selector] Ignoring loaded model "${loadedModel}" because Qwen is not preferred in settings.`);
      loadedModel = null;
    }

    // If no model is currently loaded, bypass routing and return configured default model to avoid cold-start load
    if (!loadedModel) {
      console.log(`[Model Selector] No local model loaded. Defaulting to preferred local model: ${modelName}`);
      return checkAndFallbackModel(modelName, modelName);
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
2. IMPORTANT: Loading/switching models in LM Studio takes ~10-30 seconds. If the currently loaded model ("${loadedModel}") is adequate to perform the task, KEEP it.
   EXCEPTION: If the currently loaded model is the large/heavy model (e.g., "qwen" or "qwen3.5-9b"), you MUST switch back to the workhorse/middle model ("e4b" or "gemma-4-e4b") or the weakest model ("e2b" or "gemma-4-e2b") if the task does not strictly require the heavy model's capabilities, in order to free up system RAM.
3. MODEL CAPACITY PREFERENCE:
   - Bias selection HEAVILY toward the "middle" capabilities model (e.g., 4B/7B models like "e4b" or "gemma-4-e4b") as the default workhorse for most standard tasks, tools, and general orchestration.
   - Use the weakest model (e.g., 2B models like "e2b" or "gemma-4-e2b") ONLY for very simple, casual, or trivial tasks (e.g., short greetings, date/time queries, simple questions).
   - Use the best/heavy model (e.g., "qwen" or "qwen3.5-9b") ONLY for complex coding, advanced software pipeline engineering, deep reasoning, or logic-heavy requirements.

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
            return checkAndFallbackModel(parsed.selected_model, modelName);
          }
        } catch (parseErr) {
          // Fallback if JSON parsing fails but text matches one of the IDs
          for (const id of availableModelIds) {
            if (text.includes(id)) return checkAndFallbackModel(id, modelName);
          }
        }
      }
    } catch (err) {
      console.warn(`[Model Selector] Local routing query failed: ${err.message}. Using currently loaded model.`);
    }

    return checkAndFallbackModel(loadedModel, modelName);
  }

  // 2. ONLINE PROVIDER PATH
  const isOnlineGemini = provider === 'gemini' || (provider === 'online' && onlineProvider === 'gemini');
  if (isOnlineGemini) {
    const activeKey = geminiKey || onlineKey;
    if (!activeKey) {
      console.log(`[Model Selector] No online API key available. Defaulting to: ${modelName || 'gemini-2.5-flash'}`);
      return checkAndFallbackModel(modelName || 'gemini-2.5-flash', modelName);
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
        return checkAndFallbackModel(parsed.selected_model, modelName);
      }
    } catch (err) {
      console.warn(`[Model Selector] Online routing query failed: ${err.message}. Using default: ${modelName || 'gemini-2.5-flash'}`);
    }
  }

  // Fallback to configured model name if provider is custom or routing failed
  return checkAndFallbackModel(modelName, modelName);
}

module.exports = {
  selectBestModel
};
