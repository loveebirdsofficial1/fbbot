const config = require('../config');

const FB_GRAPH = (path) =>
  `https://graph.facebook.com/${config.graphVersion}/${path}`;

async function graphPost(path, accessToken, body) {
  const url = `${FB_GRAPH(path)}?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    return { ok: false, error: (data.error && data.error.message) || `HTTP ${res.status}` };
  }
  return { ok: true, data };
}

// Messenger and Instagram use the exact same "me/messages" send endpoint -
// only the token differs (page token for Messenger, IG-scoped token for Instagram).
function buildAttachmentMessage(attachment) {
  if (!attachment || !attachment.url) return null;
  const typeMap = {
    audio: 'audio',
    video: 'video',
    image: 'image',
    document: 'file',
  };
  const type = typeMap[attachment.type] || 'file';
  return { attachment: { type, payload: { url: attachment.url } } };
}

async function sendMetaMessage(token, recipientId, text, attachment) {
  const msg = buildAttachmentMessage(attachment) || { text };
  return graphPost('me/messages', token, {
    recipient: { id: recipientId },
    message: msg,
  });
}

// Messenger uses the "me/messages" endpoint with a Page token.
function sendFacebook(psid, text, attachment) {
  return sendMetaMessage(config.pageAccessToken, psid, text, attachment);
}

// Instagram (Instagram API with Instagram Login) uses graph.instagram.com
// with the IGAA token and the IG account id as the sending node.
async function sendInstagram(igsid, text, attachment) {
  if (!config.igAccessToken || !config.igAccountId) {
    return { ok: false, error: 'Instagram not configured (IG_ACCESS_TOKEN / IG_ACCOUNT_ID)' };
  }
  const url = `https://graph.instagram.com/${config.graphVersion}/${config.igAccountId}/messages?access_token=${encodeURIComponent(config.igAccessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: igsid },
      message: buildAttachmentMessage(attachment) || { text },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    return { ok: false, error: (data.error && data.error.message) || `HTTP ${res.status}` };
  }
  return { ok: true, data };
}

async function sendWhatsApp(to, text) {
  const url = FB_GRAPH(`${config.waPhoneNumberId}/messages`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.waAccessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    return { ok: false, error: (data.error && data.error.message) || `HTTP ${res.status}` };
  }
  return { ok: true, data };
}

function dispatchSend(channel, externalId, text, attachment) {
  switch (channel) {
    case 'facebook':
      return sendFacebook(externalId, text, attachment);
    case 'instagram':
      return sendInstagram(externalId, text, attachment);
    case 'whatsapp':
      return sendWhatsApp(externalId, text);
    default:
      return Promise.resolve({ ok: false, error: `Unknown channel: ${channel}` });
  }
}

module.exports = { dispatchSend, sendFacebook, sendInstagram, sendWhatsApp };