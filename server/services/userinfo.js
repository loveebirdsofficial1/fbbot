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
    }
    if (channel === 'instagram' && config.igAccessToken) {
      const res = await fetch(
        `https://graph.instagram.com/${config.graphVersion}/${externalId}?fields=username,name,profile_picture_url&access_token=${encodeURIComponent(config.igAccessToken)}`
      );
      const data = await res.json();
      if (data && (data.username || data.name)) {
        return {
          name: data.username || data.name || externalId,
          photo: data.profile_picture_url || null,
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

// Keep resolveContactName for compatibility (used by callers needing only a name).
async function resolveContactName(channel, externalId) {
  const info = await resolveContact(channel, externalId);
  return info.name;
}

module.exports = { resolveContactName, resolveContact };