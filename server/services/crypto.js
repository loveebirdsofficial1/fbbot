const crypto = require('node:crypto');
const config = require('../config');

// Access tokens ko DB me plain text me rakhna bura hota hai - SQLite file
// kisi ko bhi copy ho sakti hai. Is liye AES-256-GCM se encrypt karte hain,
// key JWT_SECRET se derive hoti hai (agar JWT_SECRET badla to purana data
// decrypt nahi hoga, is liye production me ise stable rakhna zaroori hai).
const KEY = crypto
  .createHash('sha256')
  .update(config.jwtSecret || 'omnichannel-inbox')
  .digest();

const VERSION = 'v1';

// Output layout: v1:<iv hex>:<authTag hex>:<ciphertext hex>
function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(parts[1], 'hex'));
    decipher.setAuthTag(Buffer.from(parts[2], 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString('utf8');
  } catch (err) {
    // JWT_SECRET badal gaya ya data corrupt hai
    console.warn('[crypto] decrypt failed:', err.message);
    return null;
  }
}

// UI me token kabhi poora nahi dikhana - sirf pehla/akhri characters.
function mask(value, { head = 8, tail = 4 } = {}) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= head + tail) return '••••';
  return `${s.slice(0, head)}••••${s.slice(-tail)}`;
}

module.exports = { encrypt, decrypt, mask };
