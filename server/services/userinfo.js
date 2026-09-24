const config = require('../config');

// Best-effort contact identity lookup. Falls back to the id on any failure.
async function resolveContact(channel, externalId) {
  try {
    if (channel === 'facebook' && config.pageAccessToken) {
      const res = await fetch(
        `https://graph.facebook.com/${config.graphVersion}/${externalId}?fields=name,profile_pic&access_token=${encodeURIComponent(config.pageAccessToken)}`
      );
      const data = await res.json();
      if (data && (data.name || data.profile_pic)) {
        return { name: data.name || externalId, photo: data.profile_pic || null };
      }
      // Direct PSID lookup can fail (dev-mode app / expired PSID). Messenger
      // still exposes the participant name through the page conversations edge.
      const viaConv = await facebookNameFromConversations(externalId);
      if (viaConv) return { name: viaConv, photo: null };
    }
    if (channel === 'instagram' && config.igAccessToken) {
      const res = await fetch(
        `https://graph.instagram.com/${config.graphVersion}/${externalId}?fields=username,name,profile_pic&access_token=${encodeURIComponent(config.igAccessToken)}`
      );
      const data = await res.json();
      if (data && (data.username || data.name)) {
        return {
          name: data.username || data.name || externalId,
          photo: data.profile_pic || null,
        };
      }
      if (data && data.error) {
        console.warn(`[userinfo] IG resolve fail for ${externalId}: ${data.error.message}`);
      }
    }
  } catch {
    // ignore - network errors are fine, we keep the fallback name
  }
  return { name: externalId, photo: null };
}

let fbParticipantsCache = { at: 0, byId: {}, byEmail: {} };

async function facebookNameFromConversations(externalId) {
  if (!config.pageId || !config.pageAccessToken) return null;
  if (Date.now() - fbParticipantsCache.at < 5 * 60 * 1000) {
    return fbParticipantsCache.byId[externalId] || fbParticipantsCache.byEmail[`${externalId}@facebook.com`] || null;
  }
  try {
    let next = `https://graph.facebook.com/${config.graphVersion}/${config.pageId}/conversations?fields=participants{name,id,email}&limit=100&access_token=${encodeURIComponent(config.pageAccessToken)}`;
    const map = { byId: {}, byEmail: {} };
    const seen = new Set();
    while (next && seen.size < 500) {
      const res = await fetch(next);
      const data = await res.json();
      if (data.error) break;
      for (const c of data.data || []) {
        for (const p of (c.participants && c.participants.data) || []) {
          if (!p || p.id === config.pageId) continue;
          map.byId[p.id] = p.name;
          if (p.email) map.byEmail[p.email] = p.name;
        }
      }
      next = data.paging && data.paging.next ? data.paging.next : null;
    }
    fbParticipantsCache = { at: Date.now(), ...map };
    return map.byId[externalId] || map.byEmail[`${externalId}@facebook.com`] || null;
  } catch {
    return null;
  }
}

// Keep resolveContactName for compatibility (used by callers needing only a name).
async function resolveContactName(channel, externalId) {
  const info = await resolveContact(channel, externalId);
  return info.name;
}

module.exports = { resolveContactName, resolveContact };