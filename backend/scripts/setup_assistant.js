const GoogleAssistant = require('google-assistant');
const path = require('path');
const fs = require('fs');

const credentialsPath = path.resolve(__dirname, '../credentials.json');
const tokensPath = path.resolve(__dirname, '../tokens.json');

if (!fs.existsSync(credentialsPath)) {
  console.error('ERROR: credentials.json not found in the backend directory.');
  console.error('Please ensure the client_secret file is renamed to credentials.json and placed in the backend folder.');
  process.exit(1);
}

const config = {
  auth: {
    keyFilePath: credentialsPath,
    savedTokensPath: tokensPath, 
  },
  conversation: {
    lang: 'en-US',
  },
};

console.log('Initializing Google Assistant Auth Flow...');
console.log('If this is your first time running this, you will be prompted with a URL.');
console.log('Open the URL in your browser, sign in to your Google Account, allow permissions, and paste the code back here.');
console.log('-------------------------------------------------------------------------');

try {
  const assistant = new GoogleAssistant(config.auth);

  assistant.on('ready', () => {
    console.log('\n✅ Successfully authenticated with Google Assistant!');
    console.log(`Saving tokens to: ${tokensPath}...`);
    setTimeout(() => {
      console.log('You can now use the Google Assistant SDK to execute commands.');
      process.exit(0);
    }, 1500);
  });

  assistant.on('error', (err) => {
    console.error('❌ Authentication Error:', err);
    process.exit(1);
  });
} catch (error) {
  console.error('Failed to initialize Google Assistant:', error);
}
