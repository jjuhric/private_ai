const { storeLearnedBehavior, searchLearnedBehaviors } = require('../utils/embeddings');

// Known agents list for simple heuristic extraction from corrections
const AGENTS_LIST = [
  'weather_expert',
  'system_specialist',
  'node_agent',
  'memory_agent',
  'calendar_handler',
  'web_searcher',
  'document_vault',
  'github_agent',
  'developer_agent',
  'qa_engineer',
  'tool_creator_agent',
  'agent_creator_agent'
];

async function handleUserFeedback(db, userId, chatId, userMessage) {
  try {
    // 1. Fetch previous messages to understand context
    const history = await db.all(
      'SELECT id, role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 5',
      [chatId]
    );
    if (!history || history.length < 2) return; // Need at least some history

    const lastAssistantMsg = history.find(m => m.role === 'assistant');
    // Find the original user prompt before the assistant's turn
    const previousUserMsg = history.find(m => m.role === 'user' && m.id < (lastAssistantMsg ? lastAssistantMsg.id : Infinity));

    if (!previousUserMsg) return;

    const lowerMessage = userMessage.toLowerCase();

    // 2. Positive Reinforcement Detection
    const positiveKeywords = /\b(good|perfect|great|awesome|excellent|amazing|works)\b/i;
    if (positiveKeywords.test(userMessage)) {
      // Find what agent or tool sequence was recently used.
      // We can check assistant response or tool logs.
      // For now, let's extract a generic success log for the user's previous query
      console.log(`[Feedback System] Positive reinforcement detected: "${userMessage}"`);
      await storeLearnedBehavior(previousUserMsg.content, {
        type: 'success',
        userPrompt: previousUserMsg.content,
        feedback: userMessage,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // 3. Correction Detection
    const correctionKeywords = /\b(no|wrong|incorrect|should have|instead|use|ask|route to)\b/i;
    if (correctionKeywords.test(userMessage)) {
      // Check if user named any specific agent to route to
      let matchedAgent = null;
      for (const agent of AGENTS_LIST) {
        // Handle variations (e.g. "weather expert" -> "weather_expert")
        const normalizedAgent = agent.replace('_', ' ');
        if (lowerMessage.includes(agent) || lowerMessage.includes(normalizedAgent)) {
          matchedAgent = agent;
          break;
        }
      }

      if (matchedAgent) {
        console.log(`[Feedback System] Correction detected. Directing "${previousUserMsg.content}" -> "${matchedAgent}"`);
        await storeLearnedBehavior(previousUserMsg.content, {
          type: 'correction',
          correctAgent: matchedAgent,
          userPrompt: previousUserMsg.content,
          feedback: userMessage,
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch (err) {
    console.error('[Feedback System] Error handling user feedback:', err);
  }
}

async function getInjectedContext(queryText) {
  try {
    const matches = await searchLearnedBehaviors(queryText, 3);
    const relevantRules = matches.filter(m => m.score > 0.75);
    
    if (relevantRules.length === 0) return '';

    let context = `\n### CRITICAL: LEARNED ROUTING DIRECTIVES (PRIORITY RULES):\n`;
    context += `You have previously received explicit corrections or success workflows for similar queries. You MUST prioritize these directives:\n`;

    relevantRules.forEach(rule => {
      const meta = rule.metadata;
      if (meta.type === 'correction' && meta.correctAgent) {
        context += `- For queries similar to "${meta.userPrompt}", you MUST delegate directly to the **${meta.correctAgent}** sub-agent.\n`;
      } else if (meta.type === 'success') {
        context += `- Successful past workflow for similar query "${meta.userPrompt}": Repeat the successful sequence of actions.\n`;
      }
    });

    return context;
  } catch (err) {
    console.error('[Feedback System] Error generating injected context:', err);
    return '';
  }
}

module.exports = {
  handleUserFeedback,
  getInjectedContext
};
