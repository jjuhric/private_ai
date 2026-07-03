const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';

// Obtain encryption key from secret env or fallback for local dev
const ENCRYPTION_KEY = process.env.DB_ENCRYPTION_SECRET 
  ? crypto.scryptSync(process.env.DB_ENCRYPTION_SECRET, 'salt', 32)
  : crypto.scryptSync('dev_encryption_secret_key_2026', 'salt', 32);

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
    return encryptedText;
  }
}

module.exports = { encrypt, decrypt };
