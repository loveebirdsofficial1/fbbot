import React, { useEffect, useRef, useState } from 'react';
import { CHANNELS } from '../App';
import { api } from '../api';
import Avatar from './Avatar';

function formatClock(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MediumImage({ src, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="broken-media">🖼 Media load nahi hui</div>;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className={className} />;
}

function MediumVideo({ src, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="broken-media">🎬 Media load nahi hua</div>;
  return <video src={src} controls preload="metadata" onError={() => setFailed(true)} className={className} />;
}

function Medium({ m, className = '' }) {
  if (!m.media_url) return null;
  if (m.media_type === 'video') return <MediumVideo src={m.media_url} className={className} />;
  if (m.media_type === 'image') return <MediumImage src={m.media_url} className={className} />;
  return (
    <a href={m.media_url} target="_blank" rel="noreferrer" className="file-link">
      📄 {decodeURIComponent(m.media_url.split('/').pop() || 'file')}
    </a>
  );
}

function Bubble({ m, channel, customerName, customerPhoto, agent, agentPhoto }) {
  const outbound = m.direction === 'outbound';
  const who = outbound ? (m.agent_name || agent?.name || 'Agent') : customerName;
  const whoSub = outbound ? 'Agent' : channel === 'whatsapp' ? 'Customer' : 'Customer';
  return (
    <div className={`bubble ${outbound ? 'out' : 'in'}`}>
      <div className="bubble-who-line">
        {!outbound && <Avatar name={customerName} photo={customerPhoto} size={22} />}
        <span className="bubble-who-name">{who}</span>
        <span className="bubble-who-sub">{whoSub}</span>
        {outbound && <Avatar name={who} photo={agentPhoto} size={22} />}
      </div>
      <div className="bubble-row">
        <div className="bubble-main">
          <Medium m={m} className="bubble-media" />
          {m.body ? <div className="bubble-body">{m.body}</div> : null}
        </div>
        <span className="bubble-time">{formatClock(m.created_at)}</span>
      </div>
    </div>
  );
}

function kindOf(file) {
  const t = (file.type || '').split('/')[0];
  return t === 'image' || t === 'video' ? t : 'document';
}

function Preview({ p, onRemove }) {
  return (
    <div className="preview">
      {p.kind === 'video' ? (
        <video src={p.preview} muted className="preview-media" />
      ) : p.kind === 'image' ? (
        <img src={p.preview} alt="" className="preview-media" />
      ) : (
        <div className="preview-doc">📄 {p.file.name}</div>
      )}
      <button type="button" className="preview-x" onClick={onRemove}>×</button>
    </div>
  );
}

export default function ChatPane({
  thread,
  messages,
  agents,
  agent,
  isAdmin,
  canNote,
  onSend,
  onSendMedia,
  onChangeStatus,
  onChangeAssignee,
  onAddNote,
  onDeleteNote,
  onError,
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState([]);
  const [sending, setSending] = useState(false);

  const [notesWidth, setNotesWidth] = useState(320);
  const [showNotesMobile, setShowNotesMobile] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const [forwardAgent, setForwardAgent] = useState('');
  const [forwardNote, setForwardNote] = useState('');
  const [forwardFile, setForwardFile] = useState(null);
  const [forwardBusy, setForwardBusy] = useState(false);

  const [quickNote, setQuickNote] = useState('');
  const [quickFile, setQuickFile] = useState(null);
  const [quickBusy, setQuickBusy] = useState(false);

  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const forwardFileRef = useRef(null);
  const quickFileRef = useRef(null);
  const forwardFormRef = useRef(null);

  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const forwardFileRefLens = useRef(forwardFile);
  forwardFileRefLens.current = forwardFile;
  const quickFileRefLens = useRef(quickFile);
  quickFileRefLens.current = quickFile;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thread?.id]);

  useEffect(() => {
    setText('');
    setPending([]);
    setForwardAgent('');
    setForwardNote('');
    setForwardFile(null);
    setQuickNote('');
    setQuickFile(null);
    setShowInfo(false);
  }, [thread?.id]);

  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
      if (forwardFileRefLens.current?.preview) URL.revokeObjectURL(forwardFileRefLens.current.preview);
      if (quickFileRefLens.current?.preview) URL.revokeObjectURL(quickFileRefLens.current.preview);
    };
  }, []);

  if (!thread) {
    return (
      <section className="chat-pane">
        <div className="chat-empty">
          <span className="chat-empty-icon">✉</span>
          <p>Conversation select karo</p>
          <p className="empty-sub">Social inbox se reply karna shuru karein.</p>
        </div>
      </section>
    );
  }

  const channel = CHANNELS[thread.channel] || { label: thread.channel, color: '#888' };
  const notes = messages.filter((m) => m.sender === 'note');
  const threadMessages = messages.filter((m) => m.sender !== 'note');
  const agentById = Object.fromEntries(agents.map((a) => [a.id, a]));

  function addFiles(files, list, setList) {
    const arr = [...files];
    setList((prev) => [...prev, ...arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      kind: kindOf(file),
      preview: kindOf(file) === 'document' ? null : URL.createObjectURL(file),
    }))]);
  }

  function removePending(id) {
    setPending((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found?.preview) URL.revokeObjectURL(found.preview);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function uploadQueue(files) {
    const out = [];
    for (const p of files) {
      const up = await api.uploadFile(p.file);
      out.push({ media_type: up.media_type, media_url: up.url });
      if (p.preview) URL.revokeObjectURL(p.preview);
    }
    return out;
  }

  async function submit(e) {
    e.preventDefault();
    if (sending) return;
    if (!pending.length && !text.trim()) return;
    setSending(true);
    try {
      if (pending.length) {
        const caption = text.trim();
        const uploaded = await uploadQueue(pending);
        let ok = true;
        for (let i = 0; i < uploaded.length && ok; i++) {
          ok = await onSendMedia({
            body: i === 0 && caption ? caption : '',
            ...uploaded[i],
          });
        }
        if (ok) {
          setPending([]);
          setText('');
        }
      } else {
        const ok = await onSend(text.trim());
        if (ok) setText('');
      }
    } catch (err) {
      onError(err.message);
    } finally {
      setSending(false);
    }
  }

  function onPaste(e) {
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const it of items) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files, pending, setPending);
    }
  }

  function startNotesResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = notesWidth;
    const move = (ev) => {
      const w = Math.min(620, Math.max(220, startW - (ev.clientX - startX)));
      setNotesWidth(w);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function canDelete(note) {
    return isAdmin || note.agent_id === agent?.id;
  }

  async function submitForward(e) {
    e.preventDefault();
    if (!forwardAgent || forwardBusy) return;
    setForwardBusy(true);
    try {
      let media;
      if (forwardFile) {
        const up = await api.uploadFile(forwardFile.file);
        media = { media_type: up.media_type, media_url: up.url };
        if (forwardFile.preview) URL.revokeObjectURL(forwardFile.preview);
      }
      await onChangeAssignee(Number(forwardAgent), forwardNote, media);
      setForwardAgent('');
      setForwardNote('');
      setForwardFile(null);
    } catch (err) {
      onError(err.message);
    } finally {
      setForwardBusy(false);
    }
  }

  async function submitQuickNote(e) {
    e.preventDefault();
    if (quickBusy) return;
    if (!quickNote.trim() && !quickFile) return;
    setQuickBusy(true);
    try {
      let media;
      if (quickFile) {
        const up = await api.uploadFile(quickFile.file);
        media = { media_type: up.media_type, media_url: up.url };
        if (quickFile.preview) URL.revokeObjectURL(quickFile.preview);
      }
      await onAddNote(thread.id, { body: quickNote.trim(), ...(media || {}) });
      setQuickNote('');
      setQuickFile(null);
    } catch (err) {
      onError(err.message);
    } finally {
      setQuickBusy(false);
    }
  }

  function scrollToForward() {
    setShowNotesMobile(true);
    setTimeout(() => forwardFormRef.current?.scrollIntoView({ block: 'center' }), 50);
  }

  return (
    <section className="chat-pane">
      <header className="chat-head">
        <div className="chat-who">
          <Avatar name={thread.contact_name} photo={thread.photo} size={40} />
          <div>
            <strong>{thread.contact_name}</strong>
            <span className="chat-channel" style={{ color: channel.color }}>
              {channel.label}
              {thread.assigned_agent_name ? ` · Agent: ${thread.assigned_agent_name}` : ''}
            </span>
          </div>
        </div>

        <div className="chat-actions">
          <button className="btn-ghost" onClick={() => setShowInfo(true)} title="Customer details">ℹ️</button>
          <button className="btn-ghost notes-toggle" onClick={() => { setShowNotesMobile(true); }} title="Notes panel">📝</button>
          {isAdmin && (
            <button className="btn-ghost" onClick={scrollToForward} title="Forward to agent with note">
              ⇢ Forward
            </button>
          )}
          <select className="select" value={thread.status} onChange={(e) => onChangeStatus(e.target.value)} title="Status">
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
          </select>
          <select className="select" value={thread.assigned_agent_id || ''} onChange={(e) => onChangeAssignee(e.target.value === '' ? null : Number(e.target.value))} title="Assign to agent">
            <option value="">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="chat-body">
        <div className={`chat-main ${showNotesMobile ? 'notes-hidden-mobile' : ''}`}>
          <div className="chat-scroll" ref={scrollRef}>
            {threadMessages.map((m) => (
              <Bubble
                key={m.id}
                m={m}
                channel={thread.channel}
                customerName={thread.contact_name}
                customerPhoto={thread.photo}
                agent={agent}
                agentPhoto={agentById[m.agent_id]?.photo}
              />
            ))}
            {threadMessages.length === 0 && (
              <div className="empty chat-scroll-empty">
                <p>Is conversation ka koi message nahi. Pehla reply bhejein.</p>
              </div>
            )}
          </div>

          <form className="composer" onSubmit={submit} onPaste={onPaste}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files, pending, setPending); }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*,.pdf,.txt"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files || [], pending, setPending); if (fileRef.current) fileRef.current.value = ''; }}
            />
            {pending.length > 0 && (
              <div className="preview-row">
                {pending.map((p) => <Preview key={p.id} p={p} onRemove={() => removePending(p.id)} />)}
              </div>
            )}
            <button type="button" className="attach-btn" onClick={() => fileRef.current?.click()} title="Attach image/video/file (Ctrl+V bhi)">
              🖼
            </button>
            <input
              className="composer-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={pending.length ? 'Images ka caption (optional)…' : `${channel.label} par reply likhein…`}
              autoFocus
            />
            <button className="btn-primary" type="submit" disabled={sending || (!text.trim() && !pending.length)}>
              {sending ? 'Sending…' : pending.length ? `Send ${pending.length}` : 'Send ⇧'}
            </button>
          </form>
        </div>

        <div className="notes-divider" onMouseDown={startNotesResize} title="Chota/bara karein" />
        <aside
          className={`notes-panel ${showNotesMobile ? 'notes-open' : ''}`}
          style={{ width: notesWidth }}
        >
          <div className="notes-head">
            <div>
              <h3>📝 Agent Notes</h3>
              <p>Sirf team ko dikhte hain — customer ko nahi</p>
            </div>
            <button className="icon-btn notes-close" onClick={() => setShowNotesMobile(false)}>✕</button>
          </div>

          <div className="notes-scroll">
            {notes.map((n) => (
              <div className="note-card" key={n.id}>
                <div className="note-card-top">
                  <span className="note-author">{n.agent_name || agent?.name || 'Agent'}</span>
                  {canDelete(n) && (
                    <button className="icon-btn danger note-del" onClick={() => onDeleteNote(thread.id, n.id)} title="Delete note">🗑</button>
                  )}
                </div>
                <Medium m={n} className="note-media" />
                {n.body ? <p className="note-body">{n.body}</p> : null}
                <p className="note-time">{formatClock(n.created_at)}</p>
              </div>
            ))}
            {notes.length === 0 && <p className="notes-empty">Abhi koi note nahi.</p>}
          </div>

          {isAdmin && (
            <form className="forward-form" ref={forwardFormRef} onSubmit={submitForward}>
              <p className="form-label">⇢ Forward + Note</p>
              <select
                className="select forward-select"
                value={forwardAgent}
                onChange={(e) => setForwardAgent(e.target.value)}
              >
                <option value="">Agent assign karo…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {forwardFile && (
                <div className="forward-file">
                  <Preview p={forwardFile} onRemove={() => { if (forwardFile.preview) URL.revokeObjectURL(forwardFile.preview); setForwardFile(null); }} />
                </div>
              )}
              <div className="note-compose-row">
                <input
                  ref={forwardFileRef}
                  type="file"
                  accept="image/*,video/*,.pdf,.txt"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setForwardFile({ id: crypto.randomUUID(), file: f, kind: kindOf(f), preview: kindOf(f) === 'document' ? null : URL.createObjectURL(f) });
                    if (forwardFileRef.current) forwardFileRef.current.value = '';
                  }}
                />
                <button type="button" className="attach-btn small" onClick={() => forwardFileRef.current?.click()} title="Image/video/document">🖼</button>
                <textarea
                  className="composer-input note-input"
                  value={forwardNote}
                  onChange={(e) => setForwardNote(e.target.value)}
                  rows={2}
                  placeholder="Note (optional)…"
                />
              </div>
              <button className="btn-primary forward-btn" disabled={forwardBusy || !forwardAgent}>
                {forwardBusy ? 'Forwarding…' : 'Forward Karein'}
              </button>
            </form>
          )}

          {canNote && (
            <div className="quick-note">
              <p className="form-label">📝 Quick note</p>
              {quickFile && (
                <div className="forward-file">
                  <Preview p={quickFile} onRemove={() => { if (quickFile.preview) URL.revokeObjectURL(quickFile.preview); setQuickFile(null); }} />
                </div>
              )}
              <div className="note-compose-row">
                <input
                  ref={quickFileRef}
                  type="file"
                  accept="image/*,video/*,.pdf,.txt"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setQuickFile({ id: crypto.randomUUID(), file: f, kind: kindOf(f), preview: kindOf(f) === 'document' ? null : URL.createObjectURL(f) });
                    if (quickFileRef.current) quickFileRef.current.value = '';
                  }}
                />
                <button type="button" className="attach-btn small" onClick={() => quickFileRef.current?.click()}>🖼</button>
                <textarea
                  className="composer-input note-input"
                  value={quickNote}
                  onChange={(e) => setQuickNote(e.target.value)}
                  rows={2}
                  placeholder="Internal note…"
                />
              </div>
              <button className="btn-ghost quick-note-btn" disabled={quickBusy || (!quickNote.trim() && !quickFile)} onClick={submitQuickNote}>
                {quickBusy ? 'Adding…' : 'Add Note'}
              </button>
            </div>
          )}
        </aside>
      </div>

      {showInfo && (
        <div className="modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>📋 Customer Details</h3>
              <button type="button" className="icon-btn" onClick={() => setShowInfo(false)}>✕</button>
            </div>
            <div className="info-hero">
              <Avatar name={thread.contact_name} photo={thread.photo} size={56} />
              <div className="info-hero-meta">
                <p className="info-name">{thread.contact_name}</p>
                <p className="info-id">{thread.external_id}</p>
              </div>
            </div>
            <dl className="info-list">
              <div><dt>Channel</dt><dd>{channel.label}</dd></div>
              <div><dt>Status</dt><dd>{thread.status}</dd></div>
              <div><dt>Assigned to</dt><dd>{thread.assigned_agent_name || 'Unassigned'}</dd></div>
              <div><dt>Unread</dt><dd>{thread.unread || 0}</dd></div>
              <div><dt>Last message</dt><dd>{thread.last_message_at ? new Date(thread.last_message_at * 1000).toLocaleString() : '—'}</dd></div>
              <div><dt>Created</dt><dd>{thread.created_at ? new Date(thread.created_at * 1000).toLocaleString() : '—'}</dd></div>
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}