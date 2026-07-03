const { encrypt, decrypt } = require('../utils/crypto');

describe('Crypto Utility Tests', () => {
  test('encrypt and decrypt should restore original text', () => {
    const originalText = 'my-secret-key-123';
    const encrypted = encrypt(originalText);
    expect(encrypted).not.toBe(originalText);
    expect(encrypted.split(':').length).toBe(3);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(originalText);
  });

  test('decrypt should return original text if not encrypted (split length !== 3)', () => {
    const rawText = 'unencrypted_string';
    const decrypted = decrypt(rawText);
    expect(decrypted).toBe(rawText);
  });

  test('decrypt should return original text on empty value', () => {
    expect(decrypt('')).toBe('');
    expect(decrypt(null)).toBe(null);
    expect(decrypt(undefined)).toBe(undefined);
  });

  test('encrypt should return original on empty value', () => {
    expect(encrypt('')).toBe('');
    expect(encrypt(null)).toBe(null);
    expect(encrypt(undefined)).toBe(undefined);
  });

  test('decrypt should catch errors and return original text', () => {
    // Malformed hex that would fail to parse/decrypt
    const invalidCipher = '1234:5678:90ab';
    const decrypted = decrypt(invalidCipher);
    expect(decrypted).toBe(invalidCipher);
  });
});
