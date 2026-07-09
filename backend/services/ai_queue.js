const { broadcastAlert } = require('../routes/alerts');

class AiQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.activeTask = null;
    this.taskIdCounter = 0;
  }

  enqueue(taskFn, metadata = {}) {
    if (process.env.NODE_ENV === 'test') {
      return taskFn(() => {});
    }

    return new Promise((resolve, reject) => {
      const taskId = ++this.taskIdCounter;
      const task = {
        id: taskId,
        metadata: {
          nodeId: metadata.nodeId || 'unknown-node',
          name: metadata.name || 'AI Task',
          requestedAt: new Date().toISOString(),
          ...metadata
        },
        taskFn,
        resolve,
        reject
      };

      this.queue.push(task);
      this.broadcastState();

      // Process next in queue
      this.processNext();
    });
  }

  getState() {
    return {
      isBusy: this.isProcessing,
      activeTask: this.activeTask ? {
        id: this.activeTask.id,
        metadata: this.activeTask.metadata,
        startedAt: this.activeTask.startedAt
      } : null,
      queueLength: this.queue.length,
      waitingQueue: this.queue.map(t => ({
        id: t.id,
        metadata: t.metadata
      }))
    };
  }

  broadcastState(thoughtText = null, activeNode = null) {
    const state = this.getState();
    broadcastAlert({
      type: 'ai_state',
      isBusy: state.isBusy,
      activeTask: state.activeTask,
      queueLength: state.queueLength,
      waitingQueue: state.waitingQueue,
      thought: thoughtText || (this.activeTask ? `Executing task: ${this.activeTask.metadata.name}` : 'Idle'),
      activeNode: activeNode || (this.activeTask ? this.activeTask.metadata.nodeId : null),
      timestamp: new Date().toISOString()
    });
  }

  async processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    this.activeTask = this.queue.shift();
    this.activeTask.startedAt = new Date().toISOString();
    
    this.broadcastState(`Starting task: ${this.activeTask.metadata.name}`);

    try {
      const result = await this.activeTask.taskFn((thought) => {
        this.broadcastState(thought);
      });
      this.activeTask.resolve(result);
    } catch (err) {
      this.activeTask.reject(err);
    } finally {
      this.activeTask = null;
      this.isProcessing = false;
      this.broadcastState('Idle');
      
      this.processNext();
    }
  }
}

module.exports = new AiQueue();
