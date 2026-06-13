const request = require('supertest');
const app = require('../../server'); // Path to your Express app

describe('Health API', () => {
  it('should return 200 OK and status ok for GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('uptime');
  });

  it('should redirect / to auth portal', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(302);
    expect(res.headers.location).toContain('auth?faculty_login');
  });
});
