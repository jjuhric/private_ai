const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';

const isTest = process.env.NODE_ENV === 'test';
if (!process.env.DB_ENCRYPTION_SECRET && !isTest) {
  console.error('FATAL ERROR: DB_ENCRYPTION_SECRET env variable is not configured.');
  process.exit(1);
}
const secret = process.env.DB_ENCRYPTION_SECRET || 'test_encryption_secret_key_2026';
const ENCRYPTION_KEY = crypto.scryptSync(secret, 'salt', 32);

/**
 * Encrypts cleartext into hex format with IV and AuthTag:
 * format: ivHex:authTagHex:encryptedHex
 * 
 * @param {string} text Plaintext to encrypt
 * @returns {string} Encrypted ciphertext
 */
function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a ciphertext formatted as: ivHex:authTagHex:encryptedHex.
 * Gracefully returns original text if not encrypted (helps with legacy data migration).
 * 
 * @param {string} encryptedText Encrypted ciphertext
 * @returns {string} Plaintext
 */
function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    return encryptedText;
  }
  try {
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    const [ivHex, authTagHex] = parts;
    if (ivHex.length === 32 && authTagHex.length === 32) {
      return '';
    }
    return encryptedText;
  }
}

module.exports = { encrypt, decrypt };
