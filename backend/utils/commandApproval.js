const pendingCommands = new Map();

/**
 * Registers a pending command and returns a promise that resolves
 * when the command is approved or rejected by the user.
 * 
 * @param {string} commandId Unique command ID
 * @param {string} command The command proposed to run
 * @param {number} userId The user's database ID
 * @returns {Promise<{ approved: boolean, command: string }>} Result
 */
function registerPendingCommand(commandId, command, userId) {
  return new Promise((resolve) => {
    pendingCommands.set(commandId, {
      resolve,
      command,
      userId,
      timestamp: Date.now()
    });
  });
}

/**
 * Resolves a pending command with the user's decision (approved/rejected).
 * 
 * @param {string} commandId Unique command ID
 * @param {boolean} approved True if approved, false if rejected
 * @param {string} [editedCommand] Custom/modified command edited by user
 * @returns {boolean} True if successfully resolved, false if not found
 */
function resolveCommand(commandId, approved, editedCommand) {
  const pending = pendingCommands.get(commandId);
  if (!pending) return false;
  pendingCommands.delete(commandId);
  pending.resolve({ approved, command: editedCommand || pending.command });
  return true;
}

module.exports = {
  registerPendingCommand,
  resolveCommand,
  pendingCommands
};
