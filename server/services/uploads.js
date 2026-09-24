const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { isR2Configured, uploadToR2, deleteFromR2 } = require('../lib/r2');

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
  const key = generateKey(originalName, extForMime(mimeType));

  if (isR2Configured) {
    return uploadToR2(key, buffer, mimeType).then(
      (publicUrl) => ({ key, url: publicUrl, media_type: mediaTypeFor(mimeType) })
    );
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, key), buffer);
  return Promise.resolve({ key, url: `/uploads/${key}`, media_type: mediaTypeFor(mimeType) });
}

function deleteUpload(url) {
  if (!url) return Promise.resolve(false);

  if (isR2Configured && !url.startsWith('/uploads/')) {
    const publicBase = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
    if (publicBase && url.startsWith(publicBase)) {
      return deleteFromR2(url.slice(publicBase.length + 1));
    }
    const ep = process.env.R2_ENDPOINT?.replace(/\/$/, '');
    const bucket = process.env.R2_BUCKET_NAME;
    const prefix = `${ep}/${bucket}/`;
    if (url.startsWith(prefix)) {
      return deleteFromR2(url.slice(prefix.length));
    }
    return Promise.resolve(false);
  }

  if (url.startsWith('/uploads/')) {
    const name = path.basename(url);
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, name));
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  return Promise.resolve(false);
}

module.exports = { UPLOADS_DIR, isAllowedMime, extForMime, mediaTypeFor, saveUpload, deleteUpload };