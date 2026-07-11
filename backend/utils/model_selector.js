const { GoogleGenerativeAI } = require('@google/generative-ai');

const BLOCKED_MODEL_PATTERNS = ['embed', 'embedding', 'nomic-embed'];

function checkAndFallbackModel(candidate, preferredModel) {
  return 'google/gemma-4-e4b';
}

/**
 * Runs the routing agent to select the best model.
 * Unconditionally returns 'google/gemma-4-e4b' as it is the only supported model type.
 */
async function selectBestModel(settings, userMessage, history) {
  return 'google/gemma-4-e4b';
}

module.exports = {
  selectBestModel
};
