const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { db } = require('../db');

const FILE_PATTERN = /^omnichannel-\d{8}-\d{6}\.db$/;

function ensureBackupDir() {
  fs.mkdirSync(config.backupDir, { recursive: true });
}

// Timestamped name, e.g. omnichannel-20261003-105512.db
function backupFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `omnichannel-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(
    date.getHours()
  )}${p(date.getMinutes())}${p(date.getSeconds())}.db`;
}

// SQLite ka VACUUM INTO WAL-mode mein bhi ek consistent snapshot deta hai —
// main .db file ko raw copy karne se nahi (watch-out: raw copy aakhri writes
// khoye deti kyunki wo WAL mein hoti hain).
function createBackup() {
  ensureBackupDir();
  const dest = path.join(config.backupDir, backupFileName());
  // Path mein single quote ho to escape karo (SQL string literal)
  const escaped = dest.replace(/'/g, "''");
  db.prepare(`VACUUM INTO '${escaped}'`).run();
  pruneBackups();
  return dest;
}

// Backups ki list, naye se puraane order mein
function listBackups() {
  ensureBackupDir();
  return fs
    .readdirSync(config.backupDir)
    .filter((f) => FILE_PATTERN.test(f))
    .map((f) => {
      const full = path.join(config.backupDir, f);
      return { file: f, path: full, size: fs.statSync(full).size };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

// Sirf aakhri N backups rakhna (default 10)
function pruneBackups() {
  const keep = Math.max(1, parseInt(config.backupKeep, 10) || 10);
  const backups = listBackups();
  const toDelete = backups.slice(keep);
  for (const b of toDelete) {
    try {
      fs.unlinkSync(b.path);
      console.log(`[backup] purana backup delete: ${b.file}`);
    } catch (e) {
      console.warn(`[backup] delete fail: ${b.file} (${e.message})`);
    }
  }
  return toDelete.length;
}

module.exports = { createBackup, listBackups, pruneBackups, backupFileName };