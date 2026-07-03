const { handleCoderTool } = require('../tools/coder_tools');
const { resolveCommand } = require('../utils/commandApproval');

describe('Coder Tools Command Approval Integration Tests', () => {
  test('execute_command should block and resume when approved with original command', async () => {
    let firedEvent = null;
    const options = {
      userId: 1,
      onCommandApprovalRequired: (evt) => {
        firedEvent = evt;
        // Simulate background approval after event fired
        setTimeout(() => {
          resolveCommand(evt.commandId, true);
        }, 10);
      }
    };

    const result = await handleCoderTool('execute_command', { command: 'node -v' }, options);
    expect(firedEvent).not.toBeNull();
    expect(firedEvent.command).toBe('node -v');
    expect(result).toContain('Stdout');
  });

  test('execute_command should block and resume with edited command when approved with edits', async () => {
    let firedEvent = null;
    const options = {
      userId: 1,
      onCommandApprovalRequired: (evt) => {
        firedEvent = evt;
        setTimeout(() => {
          resolveCommand(evt.commandId, true, 'node -e "console.log(\'edited_output\')"');
        }, 10);
      }
    };

    const result = await handleCoderTool('execute_command', { command: 'node -v' }, options);
    expect(firedEvent).not.toBeNull();
    expect(result).toContain('edited_output');
  });

  test('execute_command should return rejection message when rejected by user', async () => {
    let firedEvent = null;
    const options = {
      userId: 1,
      onCommandApprovalRequired: (evt) => {
        firedEvent = evt;
        setTimeout(() => {
          resolveCommand(evt.commandId, false);
        }, 10);
      }
    };

    const result = await handleCoderTool('execute_command', { command: 'node -v' }, options);
    expect(firedEvent).not.toBeNull();
    expect(result).toContain('Command execution rejected by user');
  });
});
