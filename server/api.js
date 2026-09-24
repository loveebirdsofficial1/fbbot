const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const { dispatchSend } = require('./services/send');
const { saveUpload, isAllowedMime, mediaTypeFor } = require('./services/uploads');
const { broadcast } = require('./realtime');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

// ------------------------------------------------------------------ auth
function sign(agent) {
  return jwt.sign({ sub: agent.id, email: agent.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const agent = db.findAgentById(decoded.sub);
    if (!agent) return res.status(401).json({ error: 'Agent not found' });
    req.agent = agent;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.agent.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Admin koi bhi note likh sakta hai; assigned agent sirf apne thread par.
function requireNoteAccess(req, res, next) {
  if (req.agent.role === 'admin') return next();
  const conversation = db.getConversation(req.params.id);
  if (conversation && conversation.assigned_agent_id === req.agent.id) return next();
  return res.status(403).json({ error: 'Only admin or the assigned agent can add notes' });
}

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const agent = db.findAgentByEmail(String(email).toLowerCase().trim());
  if (!agent || !bcrypt.compareSync(password, agent.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: sign(agent), agent: db.findAgentById(agent.id) });
});

router.get('/auth/me', requireAuth, (req, res) => res.json({ agent: req.agent }));

router.get('/auth/agents', requireAuth, (req, res) => res.json({ agents: db.listAgents() }));

// ------------------------------------------------------------ conversations
router.get('/conversations', requireAuth, (req, res) => {
  const conversations = db.listConversations({
    status: req.query.status || 'all',
    channel: req.query.channel || 'all',
    limit: req.query.limit,
  });
  res.json({ conversations });
});

router.get('/conversations/:id', requireAuth, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const messages = db.listMessages(conversation.id);
  res.json({ conversation, messages });
});

router.post('/conversations/:id/reply', requireAuth, async (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  const body = (req.body && req.body.body || '').trim();
  const mediaType = (req.body && req.body.media_type || '').trim();
  const mediaUrl = (req.body && req.body.media_url || '').trim();

  if (mediaUrl && !mediaType) {
    return res.status(400).json({ error: 'media_type is required when sending media' });
  }
  if (!mediaUrl && !body) {
    return res.status(400).json({ error: 'Reply body is required' });
  }

  const attachment = mediaUrl ? { type: mediaType, url: mediaUrl } : null;
  const result = await dispatchSend(conversation.channel, conversation.external_id, body, attachment);

  if (!result.ok) {
    return res.status(502).json({ error: result.error || 'Failed to send message' });
  }

  const record = db.addMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    body,
    type: mediaType || 'text',
    metaId: (result.data && result.data.message_id) || null,
    agentId: req.agent.id,
    mediaType: mediaType || null,
    mediaUrl: mediaUrl || null,
  });

  const full = db.getConversation(conversation.id);
  broadcast('message', { conversation: full, message: record });
  res.json({ ok: true, message: record });
});

// Upload media for later use in a reply. Returns a URL that is sendable to FB/IG.
router.post('/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: `Upload failed: ${err.message}` });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided (field "file")' });
    }
    if (!isAllowedMime(req.file.mimetype)) {
      return res.status(400).json({ error: `File type not allowed: ${req.file.mimetype}` });
    }
    const saved = saveUpload(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ ok: true, url: saved.url, media_type: mediaTypeFor(req.file.mimetype) });
  });
});

router.post('/conversations/:id/assign', requireAuth, requireAdmin, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const agentId = req.body && req.body.agent_id ? Number(req.body.agent_id) : null;
  const updated = db.setConversationAgent(conversation.id, agentId);

  const noteText = String((req.body && (req.body.note ?? req.body.body)) || '').trim();
  const mediaType = ((req.body && req.body.media_type) || '').trim();
  const mediaUrl = ((req.body && req.body.media_url) || '').trim();
  let note = null;
  if (noteText || mediaUrl) {
    note = db.addNoteMessage({
      conversationId: conversation.id,
      body: noteText,
      type: mediaUrl ? (mediaType || 'document') : 'text',
      mediaType: mediaUrl ? mediaType : null,
      mediaUrl: mediaUrl || null,
      agentId: req.agent.id,
    });
    broadcast('message', { conversation: updated, message: note });
  }

  broadcast('conversation', { conversation: updated });
  res.json({ conversation: updated, note });
});

router.post('/conversations/:id/note', requireAuth, requireNoteAccess, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const noteText = String((req.body && (req.body.body ?? req.body.note)) || '').trim();
  const mediaType = ((req.body && req.body.media_type) || '').trim();
  const mediaUrl = ((req.body && req.body.media_url) || '').trim();
  if (!noteText && !mediaUrl) return res.status(400).json({ error: 'Note body or media required' });

  const note = db.addNoteMessage({
    conversationId: conversation.id,
    body: noteText,
    type: mediaUrl ? (mediaType || 'document') : 'text',
    mediaType: mediaUrl ? mediaType : null,
    mediaUrl: mediaUrl || null,
    agentId: req.agent.id,
  });

  broadcast('message', { conversation, message: note });
  res.json({ ok: true, note });
});

router.delete('/conversations/:id/notes/:messageId', requireAuth, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const note = db.getNoteMessage(req.params.messageId);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (req.agent.role !== 'admin' && note.agent_id !== req.agent.id) {
    return res.status(403).json({ error: 'Only the author or an admin can delete this note' });
  }
  db.deleteNoteMessage(note.id);
  broadcast('message-deleted', { conversation_id: conversation.id, message_id: note.id });
  res.json({ ok: true });
});

router.post('/conversations/:id/status', requireAuth, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const status = (req.body && req.body.status) || 'open';
  if (!['open', 'pending', 'resolved'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const updated = db.setConversationStatus(conversation.id, status);
  broadcast('conversation', { conversation: updated });
  res.json({ conversation: updated });
});

router.post('/conversations/:id/read', requireAuth, (req, res) => {
  const conversation = db.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  db.markConversationRead(conversation.id);
  res.json({ ok: true });
});

// -------------------------------------------------------------- admin: agents
router.post('/auth/agents', requireAuth, requireAdmin, (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  if (db.findAgentByEmail(String(email).toLowerCase().trim())) {
    return res.status(409).json({ error: 'Email already exists' });
  }
  res.json({ agent: db.createAgent(name, String(email).toLowerCase().trim(), password) });
});

router.delete('/auth/agents/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.agent.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const result = db.deleteAgent(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Agent not found' });
  broadcast('agents', {});
  res.json({ ok: true });
});

router.patch('/auth/agents/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const agent = db.findAgentById(id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const photo = (req.body && req.body.photo) || '';
  const updated = db.setAgentPhoto(id, photo);
  broadcast('agents', {});
  res.json({ agent: updated });
});

module.exports = { router, requireAuth };