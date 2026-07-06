const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const isWin = process.platform === 'win32';
const envPath = path.resolve(path.join(__dirname, '../../.env'));
let hasGithubToken = false;

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const tokenMatch = envContent.match(/^GITHUB_TOKEN=\s*(\S+)/m);
  if (tokenMatch && tokenMatch[1]) {
    hasGithubToken = true;
  }
}

const args = [];
let command = '';

if (isWin) {
  command = 'powershell.exe';
  args.push('-ExecutionPolicy', 'Bypass', '-File', './setup.ps1');
  if (hasGithubToken) {
    args.push('-NonInteractive');
    console.log('[Updater] GITHUB_TOKEN detected. Running silent background update...');
  } else {
    console.log('[Updater] GITHUB_TOKEN not found. Running interactive setup to gather missing details...');
  }
} else {
  command = './setup.sh';
  if (hasGithubToken) {
    args.push('--non-interactive');
    console.log('[Updater] GITHUB_TOKEN detected. Running silent background update...');
  } else {
    console.log('[Updater] GITHUB_TOKEN not found. Running interactive setup to gather missing details...');
  }
}

const child = spawn(command, args, { stdio: 'inherit', shell: isWin });

child.on('close', (code) => {
  process.exit(code);
});
