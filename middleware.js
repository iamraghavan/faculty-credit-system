// middleware.js
// Vercel Edge Middleware - works in the Edge Runtime

// AWS Mumbai (ap-south-1) IP Ranges provided by user
const WHITELISTED_RANGES = [
  { ip: '52.66.193.64', mask: 27 },
  { ip: '13.126.0.0', mask: 15 },
  { ip: '13.234.0.0', mask: 16 },
  { ip: '104.155.0.0', mask: 16 } // Google Cloud Workstations (Taiwan)
];

/**
 * Helper to check if an IP is within a CIDR range
 */
function ipInCIDR(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~(Math.pow(2, 32 - bits) - 1);
  
  const ipInt = ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
  const rangeInt = range.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
  
  return (ipInt & mask) === (rangeInt & mask);
}

export default function middleware(request) {
  // 1. Get Geo Information and IP
  const country = request.headers.get('x-vercel-ip-country') || request.geo?.country;
  const city = request.headers.get('x-vercel-ip-city');
  const state = request.headers.get('x-vercel-ip-country-region');
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '0.0.0.0';

  // Log visitor details for monitoring
  console.log(`Visitor: IP ${ip}, Country ${country}, State ${state}, City ${city}`);

  // 2. Whitelist Check (AWS Mumbai ap-south-1)
  const isWhitelisted = WHITELISTED_RANGES.some(range => 
    ipInCIDR(ip, `${range.ip}/${range.mask}`)
  );

  if (isWhitelisted) {
    console.info(`Whitelisted request from AWS Mumbai IP: ${ip} (${city}, ${state})`);
    return new Response(null, { 
      headers: { 
        'x-middleware-next': '1',
        'x-visitor-city': city || 'Unknown',
        'x-visitor-state': state || 'Unknown'
      } 
    });
  }

  // 3. Geo-block logic: Allow ONLY India (IN) and Taiwan (TW) for Development
  const ALLOWED_COUNTRIES = ['IN', 'TW'];
  if (country && !ALLOWED_COUNTRIES.includes(country)) {
    console.warn(`Blocked request from ${country}`);
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: 'Access restricted to India (IN).',
        meta: { country } 
      }),
      { 
        status: 403, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }

  // 4. Continue to the backend
  return new Response(null, {
    headers: {
      'x-middleware-next': '1',
      'x-visitor-city': city || 'Unknown',
      'x-visitor-state': state || 'Unknown'
    },
  });
}

// Config determines which paths this middleware runs on
export const config = {
  matcher: [
    '/api/:path*',
    '/s/:id',
    '/cdn/:path*',
    '/health'
  ],
};
