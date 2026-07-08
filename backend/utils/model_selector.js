const { GoogleGenerativeAI } = require('@google/generative-ai');

const BLOCKED_MODEL_PATTERNS = ['embed', 'embedding', 'nomic-embed'];

function checkAndFallbackModel(candidate, preferredModel) {
  return 'qwen2.5-coder-3b-instruct';
}

/**
 * Runs the routing agent to select the best model.
 * Unconditionally returns 'qwen2.5-coder-3b-instruct' as it is the only supported model type.
 */
async function selectBestModel(settings, userMessage, history) {
  return 'qwen2.5-coder-3b-instruct';
}

module.exports = {
  selectBestModel
};
