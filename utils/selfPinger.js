// utils/selfPinger.js
const axios = require('axios');

/**
 * startSelfPinger(app, options)
 *  - app: express app (so we can build base url)
 *  - opts:
 *      intervalMs: number (default 4 minutes)
 *      endpoints: array of endpoint paths to pick from (default ['/','/api/health'])
 *      jitter: boolean (randomize interval)
 */
function startSelfPinger(app, opts = {}) {
  const intervalMs = opts.intervalMs || (4 * 60 * 1000); // 4 minutes default
  const endpoints = opts.endpoints || ['/api/health', '/'];
  const jitter = opts.jitter !== undefined ? !!opts.jitter : true;
  const port = process.env.PORT || app.get('port') || 3000;
  // choose host; prefer explicit env var (useful on some hosts)
  const hostEnv = process.env.SELF_PINGER_HOST; // optional: e.g. 'https://my-app.example.com'
const baseUrl = hostEnv || `http://172.16.20.129:${port}`;

  let stopped = false;
  async function pingOnce() {
    try {
      const path = endpoints[Math.floor(Math.random() * endpoints.length)];
      const url = `${baseUrl.replace(/\/$/, '')}${path}`;
      const res = await axios.get(url, { timeout: 5000 });
      console.log(`[self-pinger] pinged ${url} -> ${res.status}`);
    } catch (err) {
      console.warn('[self-pinger] ping failed:', err.message);
    }
  }

  let timer = null;
  function scheduleNext() {
    if (stopped) return;
    const extra = jitter ? Math.floor(Math.random() * intervalMs * 0.5) : 0;
    const next = intervalMs + extra;
    timer = setTimeout(async () => {
      await pingOnce();
      scheduleNext();
    }, next);
  }

  // start immediately once
  pingOnce().catch(()=>{});
  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

module.exports = { startSelfPinger };
