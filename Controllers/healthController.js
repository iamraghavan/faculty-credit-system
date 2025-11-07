// controllers/healthController.js
const axios = require('axios');
const os = require('os');
const dns = require('dns').promises;


/**
 * Helper: walk express app router to collect routes
 * Accepts the `app` instance (req.app in a request).
 * Returns array of { path, methods } (methods is array of upper-case strings).
 */
function collectRoutes(app) {
  const routes = [];
  if (!app || !app._router) return routes;

  const stack = app._router.stack || [];
  function processStack(stack, basePath = '') {
    stack.forEach(layer => {
      if (layer.route && layer.route.path) {
        // Direct route
        const path = basePath + layer.route.path;
        const methods = Object.keys(layer.route.methods || {}).map(m => m.toUpperCase());
        routes.push({ path, methods });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        // Nested router — if layer has a "regexp" we attempt to get prefix
        const prefix = layer.regexp && layer.regexp.fast_slash ? '' :
          (layer.regexp && layer.regexp.source ? extractPrefixFromRegexp(layer.regexp.source) : '');
        processStack(layer.handle.stack, basePath + prefix);
      }
      // other layers (middleware) ignored
    });
  }

  processStack(stack, '');
  return routes;
}

// crude attempt to turn layer.regexp source into a prefix if possible
function extractPrefixFromRegexp(source) {
  // e.g. '^\\/api(?:\\/(.+?))?\\/?$' -> '/api'
  try {
    const m = source.match(/\\\/([^^\\\(\)\?]+)/);
    if (m) return '/' + m[1];
  } catch (e) {}
  return '';
}

/**
 * Choose a method to use for checking a route.
 * Prefer GET if present; otherwise try OPTIONS; otherwise pick the first available method.
 */
function chooseMethod(methods) {
  if (!methods || methods.length === 0) return 'GET';
  const up = methods.map(m => m.toUpperCase());
  if (up.includes('GET')) return 'GET';
  if (up.includes('HEAD')) return 'HEAD';
  if (up.includes('OPTIONS')) return 'OPTIONS';
  // otherwise return first
  return up[0];
}

/**
 * Perform the request to 'baseUrl + path' with chosen method and timeout.
 * Returns { ok: boolean, status: number|null, error: string|null, time: ms }
 */
async function pingUrl(baseUrl, path, method, timeout = 3000) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`; // ensure no double slash
  const start = Date.now();
  try {
    const config = {
      url,
      method: method.toLowerCase(),
      timeout,
      validateStatus: () => true // we'll interpret status codes ourselves
    };

    // For POST/PUT/PATCH we send no body — many endpoints will 4xx. We prefer OPTIONS if available,
    // but if server doesn't support it, fallback to GET and consider non-GET as "not fully testable".
    const res = await axios.request(config);
    const time = Date.now() - start;
    const ok = res.status >= 200 && res.status < 400;
    return { ok, status: res.status, error: null, time };
  } catch (err) {
    const time = Date.now() - start;
    return { ok: false, status: null, error: err.message, time };
  }
}

/**
 * Controller: /api/health
 *
 * - Finds routes from req.app
 * - For each route chooses a suitable method and pings the route
 * - Returns JSON: { timestamp, baseUrl, totalEndpoints, workingCount, results: [...] }
 */
exports.apiHealth = async function (req, res) {
  const app = req.app;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const discovered = collectRoutes(app);

  // Deduplicate routes
  const map = new Map();
  discovered.forEach(r => {
    const key = `${r.path}|${(r.methods || []).join(',')}`;
    if (!map.has(key)) map.set(key, r);
  });
  const routes = Array.from(map.values());

  // Ping routes
  const checks = await Promise.all(routes.map(async r => {
    const method = chooseMethod(r.methods);
    const result = await pingUrl(baseUrl, r.path, method);
    return {
      path: r.path,
      declaredMethods: r.methods,
      testedWith: method,
      ok: result.ok,
      status: result.status,
      error: result.error,
      responseTimeMs: result.time
    };
  }));

  const total = checks.length;
  const working = checks.filter(c => c.ok).length;

  // Server details
  const hostname = os.hostname();
  const interfaces = os.networkInterfaces();
  const localIPs = Object.values(interfaces)
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);

  let publicIP = null;
  try {
    const resIP = await axios.get('https://api.ipify.org?format=json', { timeout: 2000 });
    publicIP = resIP.data.ip;
  } catch (e) {
    publicIP = 'unavailable';
  }

  // App details
  const pkg = require('../package.json');
  const appInfo = {
    name: pkg.name || 'Unknown',
    version: pkg.version || 'N/A',
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    uptime: process.uptime(),
    memoryUsageMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
    platform: os.platform(),
    arch: os.arch(),
    cpuCores: os.cpus().length,
    loadAvg: os.loadavg(),
  };

  // Tech stack info (adjust to your stack)
  const stackInfo = {
    backend: 'Node.js + Express',
    database: process.env.DB_TYPE || 'MongoDB',
    security: ['helmet', 'cors', 'express-mongo-sanitize', 'rate-limit'],
    logging: process.env.NODE_ENV === 'production' ? 'minimal' : 'morgan(dev)',
    hostedOn: process.env.VERCEL ? 'Vercel' : 'Self-hosted / Server',
  };

  res.json({
    timestamp: new Date().toISOString(),
    baseUrl,
    totalEndpoints: total,
    workingEndpoints: working,
    server: {
      hostname,
      localIPs,
      publicIP,
      uptimeSeconds: os.uptime(),
      memory: {
        totalMB: (os.totalmem() / 1024 / 1024).toFixed(2),
        freeMB: (os.freemem() / 1024 / 1024).toFixed(2),
      },
    },
    app: appInfo,
    techStack: stackInfo,
    results: checks,
  });
};
