// Middleware/ipIntelligenceMiddleware.js
const axios = require('axios');

// In-memory cache to reduce external API calls
// Note: In serverless (Vercel), this cache is per-instance.
const ipCache = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Keywords in 'org' field that indicate datacenter/hosting (likely VPN/Proxy)
const DATACENTER_KEYWORDS = [
  'amazon', 'aws', 'microsoft', 'azure', 'google', 'digitalocean', 
  'hetzner', 'ovh', 'linode', 'vultr', 'm247', 'datacenter', 
  'hosting', 'cloud', 'server', 'akamai', 'fastly'
];

/**
 * Middleware to check if an IP belongs to a datacenter/proxy
 */
const ipIntelligenceMiddleware = async (req, res, next) => {
  // Skip if not in production or if flag is disabled
  if (process.env.NODE_ENV === 'development' || process.env.BLOCK_DATACENTER === 'false') {
    return next();
  }

  // Get real IP from x-forwarded-for (standard on Vercel/Proxy)
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.connection.remoteAddress;

  // 1. Check Cache
  const cached = ipCache.get(ip);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return next();
  }

  try {
    // 2. Fetch IP Info (Public Endpoint - No Token)
    // Using a timeout to ensure backend isn't held up
    const response = await axios.get(`https://ipinfo.io/${ip}/json`, { timeout: 3000 });
    const data = response.data;

    const org = (data.org || '').toLowerCase();
    const isDatacenter = DATACENTER_KEYWORDS.some(keyword => org.includes(keyword));

    // 3. Cache Result (Just for logging/info now)
    ipCache.set(ip, {
      timestamp: Date.now(),
      blocked: false, // We are allowing datacenters now
      org: data.org
    });

    // Logging for monitoring
    if (isDatacenter) {
      console.info(`Allowed Datacenter IP: ${ip} (${data.org})`);
    }

    next();
  } catch (error) {
    // Fail open on external API error to ensure service availability
    console.error(`IP Intelligence Error for ${ip}:`, error.message);
    next();
  }
};

module.exports = ipIntelligenceMiddleware;
