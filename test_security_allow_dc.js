// test_security_allow_dc.js
const axios = require('axios');
const ipIntelligenceMiddleware = require('./Middleware/ipIntelligenceMiddleware');

const mockRes = () => {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.body = data;
    return res;
  };
  return res;
};

const mockNext = () => {
  return () => {
    console.log('  -> Passed to next()');
  };
};

async function testIp(ip, description) {
  console.log(`Testing ${description} (IP: ${ip})...`);
  const req = {
    headers: { 'x-forwarded-for': ip },
    ip: ip,
    connection: { remoteAddress: ip }
  };
  const res = mockRes();
  const next = mockNext();

  await ipIntelligenceMiddleware(req, res, next);
  
  if (res.statusCode === 403) {
    console.log(`  -> BLOCKED: ${res.body.message} (${res.body.meta.provider})`);
  } else {
    console.log(`  -> ALLOWED`);
  }
}

process.env.BLOCK_DATACENTER = 'true';
process.env.NODE_ENV = 'production'; 

async function runTests() {
  await testIp('103.76.189.203', 'Indian Residential IP');
  await testIp('13.234.199.152', 'AWS Mumbai IP (Whitelisted)');
  await testIp('3.5.6.7', 'AWS US IP (Allowed but not Mumbai)');
  await testIp('8.8.8.8', 'Google Public DNS (Allowed)');
}

runTests();
