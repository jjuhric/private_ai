const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Helper to resolve paths safely relative to the workspace or home directory
function resolveSafePath(userPath) {
  const os = require('os');
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

async function handleWriteFile(params, options = {}) {
  const { filePath, content } = params;
  if (!filePath) return 'Error: "filePath" parameter is required.';
  if (content === undefined) return 'Error: "content" parameter is required.';

  // QA and Supervisor verification for agent loop executions
  if (options.settings && process.env.NODE_ENV !== 'test' && !options.skipVerification) {
    const { verifyWriteFileWithQAAndSupervisor } = require('../utils/codeVerifier');
    const agentName = options.agentName || 'unknown_agent';
    try {
      const { qaResult, supervisorResult } = await verifyWriteFileWithQAAndSupervisor(filePath, content, agentName, options.settings);
      
      if (supervisorResult.can_cause_disruptions || !qaResult.approved) {
        return `INPUT_REQUIRED_FROM_USER: [Supervisor Approval Required]
Agent: ${agentName}
File: ${filePath}
Content: ${content}
QA Analysis: ${qaResult.reason}
Supervisor Evaluation: ${supervisorResult.reason}
This file write could cause disruptions. Do you want to run this? Please reply with:
1 - Yes
2 - No`;
      }
    } catch (err) {
      console.error('File verification failed:', err);
      return `INPUT_REQUIRED_FROM_USER: [Supervisor Approval Required]
Agent: ${agentName}
File: ${filePath}
Content: ${content}
Error: QA/Supervisor verification failed: ${err.message}
This file write could cause disruptions. Do you want to run this? Please reply with:
1 - Yes
2 - No`;
    }
  }

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

async function executeInSandbox(command, cwd, sudoPassword) {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_SANDBOX === 'true') {
    let execCmd = command;
    if (sudoPassword && command.includes('sudo')) {
      const cleanCmd = command.replace(/sudo\s+/g, '');
      execCmd = `echo "${sudoPassword.replace(/"/g, '\\"')}" | sudo -S ${cleanCmd}`;
    }
    return await execPromise(execCmd, { cwd });
  }

  const cleanCmd = command.replace(/sudo\s+/g, '');
  const containerWorkspace = '/workspace';
  const hostPath = path.resolve(cwd).replace(/\\/g, '/');
  const dockerCmd = `docker run --rm -w ${containerWorkspace} -v "${hostPath}:${containerWorkspace}" node:20-alpine sh -c "${cleanCmd.replace(/"/g, '\\"')}"`;

  try {
    return await execPromise(dockerCmd);
  } catch (err) {
    console.warn(`[Sandbox] Docker container execution failed: ${err.message}. Falling back to host execution...`);
    let execCmd = command;
    if (sudoPassword && command.includes('sudo')) {
      const cleanCmd = command.replace(/sudo\s+/g, '');
      execCmd = `echo "${sudoPassword.replace(/"/g, '\\"')}" | sudo -S ${cleanCmd}`;
    }
    return await execPromise(execCmd, { cwd });
  }
}

async function handleExecuteCommand(params, options = {}) {
  let { command } = params;
  if (!command) return 'Error: "command" parameter is required.';
  let result = null;

  // QA and Supervisor verification for agent loop executions
  if (options.settings && process.env.NODE_ENV !== 'test' && !options.skipVerification) {
    const { verifyCommandWithQAAndSupervisor } = require('../utils/codeVerifier');
    const agentName = options.agentName || 'unknown_agent';
    try {
      const { qaResult, supervisorResult } = await verifyCommandWithQAAndSupervisor(command, agentName, options.settings);
      
      if (supervisorResult.can_cause_disruptions || !qaResult.approved) {
        return `INPUT_REQUIRED_FROM_USER: [Supervisor Approval Required]
Agent: ${agentName}
Command: ${command}
QA Analysis: ${qaResult.reason}
Supervisor Evaluation: ${supervisorResult.reason}
This command could cause disruptions. Do you want to run this? Please reply with:
1 - Yes
2 - No`;
      }
    } catch (err) {
      console.error('Verification failed:', err);
      return `INPUT_REQUIRED_FROM_USER: [Supervisor Approval Required]
Agent: ${agentName}
Command: ${command}
Error: QA/Supervisor verification failed: ${err.message}
This command could cause disruptions. Do you want to run this? Please reply with:
1 - Yes
2 - No`;
    }
  }

  // If command approval is enabled, wait for the user to approve (legacy)
  if (options.onCommandApprovalRequired && !options.settings) {
    const commandId = 'cmd_' + Math.random().toString(36).substring(2, 15);
    
    // Fire event to client via SSE callback
    options.onCommandApprovalRequired({ commandId, command, safety_analysis: params.safety_analysis });

    const { registerPendingCommand } = require('../utils/commandApproval');
    result = await registerPendingCommand(commandId, command, options.userId);

    if (!result.approved) {
      return `Command execution rejected by user. Command was: "${command}"`;
    }
    
    command = result.command; // Proceed with potentially edited command
  }

  const logger = require('../utils/logger');
  try {
    const workspaceRoot = path.resolve(process.cwd());
    const sudoPassword = params.sudo_password || (result && result.password);
    const { stdout, stderr } = await executeInSandbox(command, workspaceRoot, sudoPassword);
    logger.info(`[Command Execution] Success - Command: "${command}"`);
    let output = '';
    if (stdout) output += `### Stdout:\n${stdout}\n`;
    if (stderr) output += `### Stderr:\n${stderr}\n`;
    return output || 'Command executed successfully with no output.';
  } catch (err) {
    logger.error(`[Command Execution] Failure - Command: "${command}", Exit Code: ${err.code || 'unknown'}, Error: ${err.message}`);
    return `Command execution failed:\nExit Code: ${err.code}\nError: ${err.message}\n${err.stdout ? `Stdout:\n${err.stdout}\n` : ''}${err.stderr ? `Stderr:\n${err.stderr}\n` : ''}`;
  }
}

async function handleCoderTool(action, params = {}, options = {}) {
  switch (action) {
    case 'read_file':
      return handleReadFile(params);
    case 'write_file':
      return handleWriteFile(params, options);
    case 'list_dir':
      return handleListDir(params);
    case 'execute_command':
      return handleExecuteCommand(params, options);
    default:
      return `Error: Unknown coding/QA tool action "${action}".`;
  }
}

module.exports = { handleCoderTool };
