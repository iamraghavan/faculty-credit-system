// middleware.js
// Vercel Edge Middleware - works in the Edge Runtime

// AWS Mumbai (ap-south-1) IP Ranges provided by user
const WHITELISTED_RANGES = [
  { ip: '52.66.193.64', mask: 27 },
  { ip: '13.126.0.0', mask: 15 },
  { ip: '13.234.0.0', mask: 16 }
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
  const country = request.geo?.country || request.headers.get('x-vercel-ip-country');
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '0.0.0.0';

  // 2. Whitelist Check (AWS Mumbai ap-south-1)
  const isWhitelisted = WHITELISTED_RANGES.some(range => 
    ipInCIDR(ip, `${range.ip}/${range.mask}`)
  );

  if (isWhitelisted) {
    console.info(`Whitelisted request from AWS Mumbai IP: ${ip}`);
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
  }

  // 3. Geo-block logic: Allow ONLY India (IN)
  if (country && country !== 'IN') {
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
