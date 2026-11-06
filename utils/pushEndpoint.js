const TRUSTED_PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);

function isTrustedPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    const host = url.hostname.toLowerCase();
    const configured = String(process.env.WEB_PUSH_ALLOWED_HOSTS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase());
    return TRUSTED_PUSH_HOSTS.has(host) || host.endsWith('.notify.windows.com') || configured.includes(host);
  } catch {
    return false;
  }
}

module.exports = { isTrustedPushEndpoint };
