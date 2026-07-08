const { GoogleGenerativeAI } = require('@google/generative-ai');

const BLOCKED_MODEL_PATTERNS = ['embed', 'embedding', 'nomic-embed'];

function checkAndFallbackModel(candidate, preferredModel) {
  return 'qwen3-8b';
}

/**
 * Runs the routing agent to select the best model.
 * Unconditionally returns 'qwen3-8b' as it is the only supported model type.
 */
async function selectBestModel(settings, userMessage, history) {
  return 'qwen3-8b';
}

module.exports = {
  selectBestModel
};
