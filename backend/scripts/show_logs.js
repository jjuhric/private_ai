const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '../../app.log');

if (fs.existsSync(logPath)) {
  console.log(fs.readFileSync(logPath, 'utf8'));
} else {
  console.log('No logs found at ' + logPath);
}
