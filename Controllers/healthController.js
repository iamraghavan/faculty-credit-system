// controllers/healthController.js
const axios = require('axios');

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
  const baseUrl = `${req.protocol}://${req.get('host')}`; // base URL to contact the server
  const discovered = collectRoutes(app);

  // dedupe routes by path + methods string
  const map = new Map();
  discovered.forEach(r => {
    const key = `${r.path}|${(r.methods || []).join(',')}`;
    if (!map.has(key)) map.set(key, r);
  });
  const routes = Array.from(map.values());

  // Ping each route (in parallel, but bounded concurrency might be better for large apps).
  const checks = await Promise.all(routes.map(async r => {
    const method = chooseMethod(r.methods);
    // If method is non-safe (POST/PUT/PATCH/DELETE), prefer to use OPTIONS first if not in methods
    let methodToUse = method;
    if (!['GET','HEAD','OPTIONS'].includes(methodToUse)) {
      // attempt OPTIONS first (safer) if OPTIONS is not listed
      methodToUse = r.methods && r.methods.includes('OPTIONS') ? 'OPTIONS' : 'GET';
    }
    const result = await pingUrl(baseUrl, r.path, methodToUse);
    return {
      path: r.path,
      declaredMethods: r.methods,
      testedWith: methodToUse,
      ok: result.ok,
      status: result.status,
      error: result.error,
      responseTimeMs: result.time
    };
  }));

  const total = checks.length;
  const working = checks.filter(c => c.ok).length;

  res.json({
    timestamp: new Date().toISOString(),
    baseUrl,
    totalEndpoints: total,
    workingEndpoints: working,
    uptime: process.uptime(), // seconds
    results: checks
  });
};
