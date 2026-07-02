const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Helper to resolve paths safely relative to the workspace directory
function resolveSafePath(userPath) {
  const workspaceRoot = path.resolve(process.cwd());
  const resolved = path.resolve(workspaceRoot, userPath);
  if (!resolved.startsWith(workspaceRoot)) {
    throw new Error('Access denied: path is outside the workspace directory.');
  }
  return resolved;
}

async function handleReadFile(params) {
  const { filePath } = params;
  if (!filePath) return 'Error: "filePath" parameter is required.';
  
  try {
    const safePath = resolveSafePath(filePath);
    if (!fs.existsSync(safePath)) {
      return `Error: File not found at "${filePath}".`;
    }
    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      return `Error: Path "${filePath}" is a directory, not a file.`;
    }
    const content = fs.readFileSync(safePath, 'utf8');
    return `### Content of ${path.basename(filePath)}:\n\`\`\`\n${content}\n\`\`\``;
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
}

async function handleWriteFile(params) {
  const { filePath, content } = params;
  if (!filePath) return 'Error: "filePath" parameter is required.';
  if (content === undefined) return 'Error: "content" parameter is required.';

  try {
    const safePath = resolveSafePath(filePath);
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(safePath, content, 'utf8');
    return `Successfully wrote content to "${filePath}".`;
  } catch (err) {
    return `Error writing file: ${err.message}`;
  }
}

async function handleListDir(params) {
  const { dirPath } = params;
  const targetPath = dirPath || '.';

  try {
    const safePath = resolveSafePath(targetPath);
    if (!fs.existsSync(safePath)) {
      return `Error: Directory not found at "${targetPath}".`;
    }
    const stat = fs.statSync(safePath);
    if (!stat.isDirectory()) {
      return `Error: Path "${targetPath}" is a file, not a directory.`;
    }

    const files = fs.readdirSync(safePath);
    const details = files.map(file => {
      const fileStat = fs.statSync(path.join(safePath, file));
      const type = fileStat.isDirectory() ? 'DIR' : 'FILE';
      const size = fileStat.isFile() ? ` (${fileStat.size} bytes)` : '';
      return `- [${type}] ${file}${size}`;
    });

    return `### Directory Contents of "${targetPath}":\n${details.join('\n') || 'Empty directory'}`;
  } catch (err) {
    return `Error listing directory: ${err.message}`;
  }
}

async function handleExecuteCommand(params) {
  const { command } = params;
  if (!command) return 'Error: "command" parameter is required.';

  try {
    const workspaceRoot = path.resolve(process.cwd());
    const { stdout, stderr } = await execPromise(command, { cwd: workspaceRoot });
    let output = '';
    if (stdout) output += `### Stdout:\n${stdout}\n`;
    if (stderr) output += `### Stderr:\n${stderr}\n`;
    return output || 'Command executed successfully with no output.';
  } catch (err) {
    return `Command execution failed:\nExit Code: ${err.code}\nError: ${err.message}\n${err.stdout ? `Stdout:\n${err.stdout}\n` : ''}${err.stderr ? `Stderr:\n${err.stderr}\n` : ''}`;
  }
}

async function handleCoderTool(action, params = {}) {
  switch (action) {
    case 'read_file':
      return handleReadFile(params);
    case 'write_file':
      return handleWriteFile(params);
    case 'list_dir':
      return handleListDir(params);
    case 'execute_command':
      return handleExecuteCommand(params);
    default:
      return `Error: Unknown coding/QA tool action "${action}".`;
  }
}

module.exports = { handleCoderTool };
