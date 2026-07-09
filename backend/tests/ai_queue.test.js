const aiQueue = require('../services/ai_queue');
const { broadcastAlert } = require('../routes/alerts');

jest.mock('../routes/alerts', () => ({
  broadcastAlert: jest.fn()
}));

describe('AI Concurrency FIFO Queue Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    aiQueue.queue = [];
    aiQueue.isProcessing = false;
    aiQueue.activeTask = null;
  });

  test('enqueues a task and executes it sequentially', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const taskLog = [];
    const task1 = aiQueue.enqueue(async (onThought) => {
      onThought('Executing task 1');
      await new Promise(resolve => setTimeout(resolve, 50));
      taskLog.push(1);
      return 'result1';
    }, { nodeId: 'node1', name: 'Task 1' });

    const task2 = aiQueue.enqueue(async (onThought) => {
      onThought('Executing task 2');
      await new Promise(resolve => setTimeout(resolve, 10));
      taskLog.push(2);
      return 'result2';
    }, { nodeId: 'node2', name: 'Task 2' });

    const state = aiQueue.getState();
    expect(state.isBusy).toBe(true);
    expect(state.queueLength).toBe(1);

    const r1 = await task1;
    const r2 = await task2;

    expect(r1).toBe('result1');
    expect(r2).toBe('result2');
    expect(taskLog).toEqual([1, 2]);
    expect(broadcastAlert).toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });
});
