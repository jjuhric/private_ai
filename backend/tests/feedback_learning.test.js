const { handleUserFeedback, getInjectedContext } = require('../services/feedback_learning');
const { storeLearnedBehavior, searchLearnedBehaviors } = require('../utils/embeddings');

jest.mock('../utils/embeddings', () => {
  const actual = jest.requireActual('../utils/embeddings');
  return {
    ...actual,
    storeLearnedBehavior: jest.fn().mockResolvedValue(),
    searchLearnedBehaviors: jest.fn().mockResolvedValue([
      {
        text: 'original prompt text',
        metadata: { type: 'correction', correctAgent: 'weather_expert', userPrompt: 'original prompt text' },
        score: 0.9
      },
      {
        text: 'another prompt text',
        metadata: { type: 'success', userPrompt: 'another prompt text' },
        score: 0.9
      }
    ])
  };
});

describe('Continuous Learning & Feedback System Tests', () => {
  let mockDb;

  beforeAll(() => {
    mockDb = {
      all: jest.fn().mockResolvedValue([
        { id: 2, role: 'assistant', content: 'Here is some code.' },
        { id: 1, role: 'user', content: 'What is the weather like?' }
      ])
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('handleUserFeedback: detects corrections and saves them', async () => {
    await handleUserFeedback(mockDb, 1, 101, 'No, you should ask weather_expert');
    expect(storeLearnedBehavior).toHaveBeenCalledWith(
      'What is the weather like?',
      expect.objectContaining({
        type: 'correction',
        correctAgent: 'weather_expert',
        feedback: 'No, you should ask weather_expert'
      })
    );
  });

  test('handleUserFeedback: detects positive reinforcement and saves it', async () => {
    await handleUserFeedback(mockDb, 1, 101, 'This is perfect, thank you!');
    expect(storeLearnedBehavior).toHaveBeenCalledWith(
      'What is the weather like?',
      expect.objectContaining({
        type: 'success',
        feedback: 'This is perfect, thank you!'
      })
    );
  });

  test('getInjectedContext: returns prompt context for similar past queries', async () => {
    const context = await getInjectedContext('What is the weather?');
    expect(context).toContain('### CRITICAL: LEARNED ROUTING DIRECTIVES');
    expect(context).toContain('weather_expert');
  });
});
