const db = require('../db');
const { graphUrl } = require('./send');

// Meta ki "conversations" edge se account ke PEHLI SE maujood chats import
// karta hai. Meta message content ki full history API se nahi deta, lekin
// conversation ki LIST + last message ka snippet zaroor deta hai:
//   Facebook  -> GET /{page_id}/conversations
//   Instagram -> GET /{ig_id}/conversations?platform=instagram
// (WhatsApp par history API hai hi nahi - sirf naye webhook messages aate hain.)
//
// Import sirf unmatch hua data add karta hai; dobara sync par koi duplicate
// nahi banta (meta_id se dedupe).

const FIELD_SETS = {
  facebook:
    'participants{name,id,email},snippet,updated_time,unread_count,message_count',
  instagram:
    'participants{name,id,username},snippet,updated_time,unread_count,message_count',
};

async function syncConnection(conn) {
  const result = {
    channel: conn.channel,
    total: 0,
    created: 0,
    with_snippet: 0,
    failed: 0,
    error: null,
  };

  const fields = FIELD_SETS[conn.channel];
  if (!fields) {
    result.error =
      "WhatsApp ki purani messages na koi history API hai na webhook ke alawa - sirf naye messages aate hain. (Facebook/Instagram par yeh kaam karta hai.)";
    return result;
  }
  if (!conn.token) {
    result.error = 'Access token missing';
    return result;
  }
  if (!conn.accountId) {
    result.error = 'Account ID/Page ID missing';
    return result;
  }

  const host = conn.apiHost === 'instagram' ? 'instagram' : 'facebook';
  const prefix =
    conn.channel === 'instagram'
      ? `${graphUrl(host, conn.accountId)}/conversations?platform=instagram`
      : `${graphUrl(host, conn.accountId)}/conversations`;

  let url =
    `${prefix}?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(conn.token)}`;
  let pages = 0;

  try {
    while (url && pages < 20) {
      pages += 1;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        result.error = data.error.message;
        if (data.error.code === 190) result.error += ' (token expire ho gaya hai?)';
        break;
      }

      for (const conv of data.data || []) {
        result.total += 1;
        importOne(conn, conv, result);
      }
      url = data.paging && data.paging.next ? data.paging.next : null;
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

function importOne(conn, apiConversation, result) {
  // "participant" = customer jo page/account par message karta hai.
  // Apna account khud exclude karo; group chats ke liye conversation id key.
  const participants = (apiConversation.participants && apiConversation.participants.data) || [];
  const others = participants.filter((p) => String(p.id) !== String(conn.accountId));

  let externalId;
  let contactName = null;
  let photo = null;

  if (others.length === 1) {
    externalId = String(others[0].id);
    contactName = others[0].name || null;
  } else if (others.length > 1) {
    // group/thread - conversation id hi identity hai
    externalId = String(apiConversation.id);
    contactName = others.map((p) => p.name || p.id).slice(0, 3).join(', ');
  } else {
    // koi participant info nahi mili - conversation id se hi chala lo
    externalId = String(apiConversation.id);
    contactName = null;
  }

  const updatedTime = apiConversation.updated_time
    ? Math.floor(new Date(apiConversation.updated_time).getTime() / 1000)
    : null;
  const snippet = (apiConversation.snippet || '').trim();

  let conversation;
  try {
    conversation = db.findOrCreateConversation({
      channel: conn.channel,
      externalId,
      contactName,
      photo,
      connectionId: conn.id,
    });
  } catch {
    result.failed += 1;
    return;
  }

  if (updatedTime) db.setConversationTimestamps(conversation.id, { lastMessageAt: updatedTime });

  // Purani thread me sirf snippet hi milta hai - poori history nahi. Snippet
  // tab import karo jab conversation khaali ho warna asal thread ko nahi
  // chheRte (aur dobara sync par duplicate bhi nahi banega).
  const hadMessages = db.hasMessages(conversation.id);
  if (snippet && !hadMessages) {
    const metaId = `snip:${conn.id}:${externalId}`;
    const existing = db.findMessageByMetaId(metaId, conversation.id);
    if (!existing) {
      try {
        db.addMessage({
          conversationId: conversation.id,
          direction: 'inbound',
          body: snippet,
          type: 'text',
          metaId,
          sender: 'customer',
          touchConversation: false,
          createdAt: updatedTime,
        });
        result.with_snippet += 1;
      } catch {
        result.failed += 1;
      }
    }
  }

  // Import ke bad unread nahi chahiye - ye purane chats hain jo abhi dekhe
  // ja rahe hain. (Naye webhook messages ab bhi normal unread rakhte hain.)
  db.db.prepare('UPDATE conversations SET unread = 0 WHERE id = ?').run(conversation.id);

  result.created += 1;
}

module.exports = { syncConnection };