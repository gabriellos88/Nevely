const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  }
  return output;
}

function decodeBase32(value) {
  const normalized = String(value || '').toUpperCase().replace(/=+$/g, '');
  let bits = '';
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 value');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function createTotpSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

function totp(secret, timestamp = Date.now()) {
  const counter = BigInt(Math.floor(timestamp / 30_000));
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(counter);
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

function verifyTotp(secret, code, timestamp = Date.now()) {
  const supplied = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(supplied)) return false;
  return [-1, 0, 1].some((window) => {
    const expected = totp(secret, timestamp + window * 30_000);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
  });
}

function encryptionKey(secret) {
  return crypto.createHash('sha256').update(String(secret || '')).digest();
}

function encryptSecret(secret, keyMaterial) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(keyMaterial), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((value) => value.toString('base64url')).join('.');
}

function decryptSecret(payload, keyMaterial) {
  const [ivValue, tagValue, encryptedValue] = String(payload || '').split('.');
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('Invalid encrypted TOTP secret');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(keyMaterial),
    Buffer.from(ivValue, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

module.exports = {
  createTotpSecret,
  decryptSecret,
  encryptSecret,
  totp,
  verifyTotp
};
