const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');

const UPLOADS_DIR = config.uploadDir;

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/3gpp',
  'video/3gpp2',
  'video/x-msvideo',
  'video/x-ms-wmv',
  'video/mpeg',
];

function isAllowedMime(mime) {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  if (ALLOWED_MIME_TYPES.includes(lower)) return true;
  return lower.startsWith('image/') || lower.startsWith('video/') || lower.startsWith('audio/');
}

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'video/3gpp': '.3gp',
  'video/3gpp2': '.3g2',
  'video/x-msvideo': '.avi',
  'video/x-ms-wmv': '.wmv',
  'video/mpeg': '.mpg',
};

function extForMime(mime) {
  const known = EXT_BY_MIME[mime?.toLowerCase()];
  if (known) return known;
  const type = mime?.split('/')[0] || '';
  return type === 'image' ? '.jpg' : type === 'video' ? '.mp4' : '.bin';
}

function mediaTypeFor(mime) {
  const type = mime?.toLowerCase().split('/')[0] || '';
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  return 'document';
}

function generateKey(originalName, ext) {
  const base = originalName
    ? path.parse(originalName).name.replace(/[^a-z0-9]/gi, '-').slice(0, 30)
    : 'file';
  const rand = crypto.randomBytes(8).toString('hex');
  return `${Date.now()}-${base || 'file'}-${rand}${ext}`;
}

function saveUpload(buffer, originalName, mimeType) {
  if (!isAllowedMime(mimeType)) {
    throw new Error(`File type not allowed: ${mimeType}`);
  }
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const key = generateKey(originalName, extForMime(mimeType));
  fs.writeFileSync(path.join(UPLOADS_DIR, key), buffer);
  return { key, url: `/uploads/${key}`, media_type: mediaTypeFor(mimeType) };
}

function deleteUpload(url) {
  if (!url || !url.startsWith('/uploads/')) return false;
  const name = path.basename(url);
  try {
    fs.unlinkSync(path.join(UPLOADS_DIR, name));
    return true;
  } catch {
    return false;
  }
}

module.exports = { UPLOADS_DIR, isAllowedMime, extForMime, mediaTypeFor, saveUpload, deleteUpload };