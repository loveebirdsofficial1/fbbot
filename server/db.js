const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT 'Unknown',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_agent_id INTEGER REFERENCES agents(id),
  unread INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_channel ON conversations(channel);
CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  meta_id TEXT,
  agent_id INTEGER REFERENCES agents(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
`);

// -------------------------------------------------- additive migrations
const agentCols = db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
if (!agentCols.includes('role')) {
  db.exec(`ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'`);
}
if (!agentCols.includes('photo')) {
  db.exec(`ALTER TABLE agents ADD COLUMN photo TEXT`);
}
const convCols = db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name);
if (!convCols.includes('note')) {
  db.exec(`ALTER TABLE conversations ADD COLUMN note TEXT`);
}
if (!convCols.includes('photo')) {
  db.exec(`ALTER TABLE conversations ADD COLUMN photo TEXT`);
}
const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
if (!msgCols.includes('media_type')) {
  db.exec(`ALTER TABLE messages ADD COLUMN media_type TEXT`);
}
if (!msgCols.includes('media_url')) {
  db.exec(`ALTER TABLE messages ADD COLUMN media_url TEXT`);
}
if (!msgCols.includes('sender')) {
  db.exec(`ALTER TABLE messages ADD COLUMN sender TEXT DEFAULT 'customer'`);
}
if (!msgCols.includes('reply_to_id')) {
  db.exec(`ALTER TABLE messages ADD COLUMN reply_to_id INTEGER`);
}
db.prepare(`UPDATE agents SET role = 'admin' WHERE email = ?`).run(config.adminEmail);

const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- agents
function seedAdmin() {
  const existing = db.prepare('SELECT id FROM agents LIMIT 1').get();
  if (existing) return;
  const hash = bcrypt.hashSync(config.adminPassword, 10);
  db.prepare("INSERT INTO agents (email, name, role, password_hash) VALUES (?, ?, 'admin', ?)")
    .run(config.adminEmail, config.adminName, hash);
  console.log(`[db] Seeded admin agent: ${config.adminEmail} (password: ${config.adminPassword})`);
}

function findAgentByEmail(email) {
  return db.prepare('SELECT * FROM agents WHERE email = ?').get(email);
}

function findAgentById(id) {
  return db.prepare('SELECT id, email, name, role, photo, created_at FROM agents WHERE id = ?').get(id);
}

function listAgents() {
  return db.prepare('SELECT id, email, name, role, photo, created_at FROM agents ORDER BY name').all();
}

function setAgentPhoto(id, photo) {
  db.prepare('UPDATE agents SET photo = ? WHERE id = ?').run(photo && photo.trim() ? photo.trim() : null, id);
  return findAgentById(id);
}

function createAgent(name, email, password) {
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare("INSERT INTO agents (email, name, role, password_hash) VALUES (?, ?, 'agent', ?)")
    .run(email, name, hash);
  return findAgentById(Number(r.lastInsertRowid));
}

function deleteAgent(id) {
  db.prepare('UPDATE conversations SET assigned_agent_id = NULL WHERE assigned_agent_id = ?').run(id);
  db.prepare('UPDATE messages SET agent_id = NULL WHERE agent_id = ?').run(id);
  return db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

// ------------------------------------------------------- conversations
function findOrCreateConversation({ channel, externalId, contactName, photo }) {
  const existing = db.prepare(
    'SELECT * FROM conversations WHERE channel = ? AND external_id = ?'
  ).get(channel, externalId);

  if (existing) {
    if (contactName && contactName !== existing.contact_name) {
      db.prepare('UPDATE conversations SET contact_name = ? WHERE id = ?')
        .run(contactName, existing.id);
    }
    if (photo && photo !== existing.photo) {
      db.prepare('UPDATE conversations SET photo = ? WHERE id = ?')
        .run(photo, existing.id);
    }
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(existing.id);
  }

  const t = now();
  db.prepare(
    `INSERT INTO conversations (channel, external_id, contact_name, photo, created_at, last_message_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(channel, externalId, contactName || 'Unknown', photo || null, t, t);

  return db.prepare('SELECT * FROM conversations WHERE channel = ? AND external_id = ?')
    .get(channel, externalId);
}

const CONVERSATION_FIELDS = `c.id, c.channel, c.external_id, c.contact_name, c.status, c.note, c.photo,
  c.unread, c.last_message_at, c.created_at,
  a.id AS assigned_agent_id, a.name AS assigned_agent_name,
  (SELECT body FROM messages m WHERE m.conversation_id = c.id AND m.sender != 'note' ORDER BY m.id DESC LIMIT 1) AS last_message`;

function listConversations({ status, channel, limit = 200 } = {}) {
  const conditions = [];
  const params = [];
  if (status && status !== 'all') {
    conditions.push('c.status = ?');
    params.push(status);
  }
  if (channel && channel !== 'all') {
    conditions.push('c.channel = ?');
    params.push(channel);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 200, 500));

  return db.prepare(
    `SELECT ${CONVERSATION_FIELDS}
     FROM conversations c
     LEFT JOIN agents a ON a.id = c.assigned_agent_id
     ${where}
     ORDER BY c.last_message_at DESC
     LIMIT ?`
  ).all(...params);
}

function getConversation(id) {
  return db.prepare(
    `SELECT ${CONVERSATION_FIELDS}
     FROM conversations c
     LEFT JOIN agents a ON a.id = c.assigned_agent_id
     WHERE c.id = ?`
  ).get(id);
}

function setConversationStatus(id, status) {
  db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, id);
  return getConversation(id);
}

function setConversationAgent(id, agentId) {
  db.prepare('UPDATE conversations SET assigned_agent_id = ? WHERE id = ?').run(agentId, id);
  return getConversation(id);
}

function setConversationNote(id, note) {
  db.prepare('UPDATE conversations SET note = ? WHERE id = ?').run(note && note.trim() ? note.trim() : null, id);
  return getConversation(id);
}

function markConversationRead(id) {
  db.prepare('UPDATE conversations SET unread = 0 WHERE id = ?').run(id);
}

function reopenIfResolved(id) {
  db.prepare(
    "UPDATE conversations SET status = 'open' WHERE id = ? AND status IN ('resolved','pending')"
  ).run(id);
}

function incrementUnread(id, skip) {
  if (skip) return;
  db.prepare('UPDATE conversations SET unread = unread + 1 WHERE id = ?').run(id);
}

// ------------------------------------------------------------ messages
function addMessage({ conversationId, direction, body, type = 'text', metaId = null, agentId = null, mediaType = null, mediaUrl = null, sender = null, replyToId = null, touchConversation = true }) {
  const t = now();
  const r = db.prepare(
    `INSERT INTO messages (conversation_id, direction, body, type, meta_id, agent_id, media_type, media_url, sender, reply_to_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(conversationId, direction, body, type, metaId, agentId, mediaType, mediaUrl, sender || (direction === 'outbound' ? 'agent' : 'customer'), replyToId, t);

  if (touchConversation) {
    db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(t, conversationId);
  }
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid));
  if (row.reply_to_id) {
    const quoted = db.prepare('SELECT id, body, sender, media_type, media_url FROM messages WHERE id = ?').get(row.reply_to_id);
    row.reply_to = quoted
      ? { id: quoted.id, sender: quoted.sender, body: quoted.body || '', media_type: quoted.media_type || null, media_url: quoted.media_url || null }
      : { id: row.reply_to_id, sender: null, body: '', media_type: null, media_url: null };
  }
  return row;
}

// Private note: lives inside the conversation's message thread but is never
// rendered to the customer (sender = 'note'). Notes must NOT bump last_message_at.
function addNoteMessage({ conversationId, body = '', type = 'text', mediaType = null, mediaUrl = null, agentId = null }) {
  const t = now();
  const r = db.prepare(
    `INSERT INTO messages (conversation_id, direction, body, type, media_type, media_url, sender, agent_id, created_at)
     VALUES (?, 'note', ?, ?, ?, ?, 'note', ?, ?)`
  ).run(conversationId, body, type, mediaType, mediaUrl, agentId, t);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid));
}

function getNoteMessage(messageId) {
  return db.prepare(`SELECT * FROM messages WHERE id = ? AND sender = 'note'`).get(messageId);
}

function deleteNoteMessage(messageId) {
  return db.prepare(`DELETE FROM messages WHERE id = ? AND sender = 'note'`).run(messageId);
}

function listMessages(conversationId) {
  const rows = db.prepare(
    `SELECT m.*, a.name AS agent_name,
            r.id AS r_id, r.body AS r_body, r.sender AS r_sender,
            r.media_type AS r_media_type, r.media_url AS r_media_url
     FROM messages m
     LEFT JOIN agents a ON a.id = m.agent_id
     LEFT JOIN messages r ON r.id = m.reply_to_id
     WHERE m.conversation_id = ?
     ORDER BY m.id ASC`
  ).all(conversationId);

  return rows.map((row) => {
    const message = { ...row };
    delete message.r_id;
    delete message.r_body;
    delete message.r_sender;
    delete message.r_media_type;
    delete message.r_media_url;
    if (row.reply_to_id) {
      if (row.r_id) {
        message.reply_to = {
          id: row.r_id,
          sender: row.r_sender,
          body: row.r_body || '',
          media_type: row.r_media_type || null,
          media_url: row.r_media_url || null,
        };
      } else {
        message.reply_to = { id: row.reply_to_id, sender: null, body: '', media_type: null, media_url: null };
      }
    }
    return message;
  });
}

function getMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

module.exports = {
  db,
  seedAdmin,
  findAgentByEmail,
  findAgentById,
  listAgents,
  createAgent,
  deleteAgent,
  setAgentPhoto,
  findOrCreateConversation,
  listConversations,
  getConversation,
  setConversationStatus,
  setConversationAgent,
  setConversationNote,
  markConversationRead,
  reopenIfResolved,
  incrementUnread,
  addMessage,
  addNoteMessage,
  getNoteMessage,
  deleteNoteMessage,
  listMessages,
  getMessage,
  now,
};