const { registerPendingCommand, resolveCommand, pendingCommands } = require('../utils/commandApproval');

describe('Command Approval Utility Tests', () => {
  beforeEach(() => {
    pendingCommands.clear();
  });

  test('registerPendingCommand should add command to pending list and resolve when resolved', async () => {
    const commandId = 'cmd_test';
    const command = 'npm run test';
    const userId = 1;

    const promise = registerPendingCommand(commandId, command, userId);

    expect(pendingCommands.has(commandId)).toBe(true);
    const pendingObj = pendingCommands.get(commandId);
    expect(pendingObj.command).toBe(command);
    expect(pendingObj.userId).toBe(userId);

    // Resolve command
    const resolved = resolveCommand(commandId, true, 'npm run test --edited');
    expect(resolved).toBe(true);

    const result = await promise;
    expect(result.approved).toBe(true);
    expect(result.command).toBe('npm run test --edited');
    expect(pendingCommands.has(commandId)).toBe(false);
  });

  test('resolveCommand should return false if commandId does not exist', () => {
    const resolved = resolveCommand('non_existent', true);
    expect(resolved).toBe(false);
  });

  test('resolveCommand should use original command if editedCommand is not provided', async () => {
    const commandId = 'cmd_test_original';
    const command = 'ls -la';
    const userId = 1;

    const promise = registerPendingCommand(commandId, command, userId);
    resolveCommand(commandId, true);

    const result = await promise;
    expect(result.approved).toBe(true);
    expect(result.command).toBe(command);
  });
});
