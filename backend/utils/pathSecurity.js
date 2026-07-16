const path = require('path');
const os = require('os');

/**
 * Resolves a user-provided path safely, preventing directory traversal attacks.
 * Allows paths within the workspace root, the user's home directory, or absolute
 * paths that fall under either of those directories.
 *
 * @param {string} userPath The path provided by the user or agent.
 * @returns {string} The resolved absolute path.
 * @throws {Error} If the path is outside the allowed directories.
 */
function resolveSafePath(userPath) {
  const workspaceRoot = path.resolve(process.cwd());
  const homeRoot = path.resolve(os.homedir());

  let resolved;
  const isHomePrefix = userPath === '~' || userPath.startsWith('~/') || userPath.startsWith('~\\');

  if (isHomePrefix) {
    resolved = userPath === '~' ? homeRoot : path.resolve(homeRoot, userPath.slice(2));
    if (!resolved.startsWith(homeRoot)) {
      throw new Error('Access denied: path is outside the home directory.');
    }
    return resolved;
  }

  resolved = path.resolve(workspaceRoot, userPath);
  const isAbsolute = path.isAbsolute(userPath);

  if (isAbsolute) {
    if (resolved.startsWith(workspaceRoot) || resolved.startsWith(homeRoot)) {
      return resolved;
    }
    throw new Error('Access denied: absolute path is outside the allowed workspace or home directories.');
  }

  if (resolved.startsWith(workspaceRoot)) {
    return resolved;
  }

  throw new Error('Access denied: path is outside the workspace directory.');
}

module.exports = { resolveSafePath };
