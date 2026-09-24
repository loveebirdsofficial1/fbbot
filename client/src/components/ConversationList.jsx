import React from 'react';
import { CHANNELS } from '../App';
import Avatar from './Avatar';

function ChannelBadge({ channel }) {
  const c = CHANNELS[channel] || { label: channel, short: '?', color: '#888' };
  return (
    <span className="ch-badge" style={{ background: c.color }} title={c.label}>
      {c.short}
    </span>
  );
}

export default function ConversationList({ conversations, selectedId, onSelect, formatTime }) {
  return (
    <section className="conversation-list">
      <div className="list-head">
        <h2>Inbox</h2>
        <span className="list-count">{conversations.length}</span>
      </div>

      <div className="list-scroll">
        {conversations.length === 0 ? (
          <div className="empty">
            <p>Koi conversation nahi.</p>
            <p className="empty-sub">Jab koi customer Facebook, Instagram ya WhatsApp par message karega, to yahan aa jayega.</p>
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${selectedId === c.id ? 'active' : ''} ${c.unread ? 'unread' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <Avatar name={c.contact_name} photo={c.photo} size={36} />

              <div className="conv-body">
                <div className="conv-top">
                  <strong className="conv-name">{c.contact_name}</strong>
                  <span className="conv-time">{formatTime(c.last_message_at)}</span>
                </div>
                <div className="conv-bottom">
                  <span className="conv-preview">{c.last_message || '—'}</span>
                  <div className="conv-meta">
                    <ChannelBadge channel={c.channel} />
                    {c.unread > 0 && <span className="unread-badge">{c.unread}</span>}
                    {c.status !== 'open' && (
                      <span className={`status-chip ${c.status}`}>{c.status}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}