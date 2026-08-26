const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const testDb = path.resolve(__dirname, '..', 'data', 'test-attendance.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${testDb}${suffix}`, { force: true });
process.env.DB_PATH = './data/test-attendance.db';
process.env.SOLUTION_WEBHOOK_SECRET = 'test-webhook-secret';
const app = require('../src/server');
const { encrypt, decrypt } = require('../src/services/secrets');

test.after(() => {
  require('../src/db').close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${testDb}${suffix}`, { force: true });
});

test('unauthenticated dashboard redirects to login', async () => {
  const response = await request(app).get('/');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('authenticated dashboard renders the ADMS connection instructions', async () => {
  const agent = request.agent(app);
  const login = await agent.post('/login').type('form').send({ email: 'admin@attendance.local', password: 'admin123' });
  assert.equal(login.status, 302);
  const dashboard = await agent.get('/');
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /Pengaturan ADMS mesin/);
});

test('solution webhook rejects an invalid secret when configured', async () => {
  const response = await request(app).post('/api/webhooks/solution').send({});
  assert.equal(response.status, 401);
});

test('solution webhook is idempotent for duplicate scans', async () => {
  const payload = { employee_code: '2', device_serial: 'DEMO-SOLUTION-001', scanned_at: '2026-08-24T09:00:00+07:00' };
  const first = await request(app).post('/api/webhooks/solution').set('x-webhook-secret', 'test-webhook-secret').send(payload);
  const second = await request(app).post('/api/webhooks/solution').set('x-webhook-secret', 'test-webhook-secret').send(payload);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.inserted, 1);
  assert.equal(second.body.inserted, 0);
});

test('device API tokens are encrypted reversibly', () => {
  const encrypted = encrypt('vendor-token');
  assert.notEqual(encrypted, 'vendor-token');
  assert.equal(decrypt(encrypted), 'vendor-token');
});

test('ADMS handshake and attendance push are accepted', async () => {
  const options = await request(app).get('/iclock/cdata?SN=ADMS-TEST-001&options=all');
  assert.equal(options.status, 200);
  assert.match(options.text, /GET OPTION FROM: ADMS-TEST-001/);

  const push = await request(app)
    .post('/iclock/cdata?SN=ADMS-TEST-001&table=ATTLOG')
    .set('content-type', 'text/plain')
    .send('1\t2026-08-24 09:00:00\t0\t1\t0');
  assert.equal(push.status, 200);
  assert.equal(push.text, 'OK');
  const device = require('../src/db').prepare('SELECT status FROM devices WHERE serial_number = ?').get('ADMS-TEST-001');
  assert.equal(device.status, 'online');
  const log = require('../src/db').prepare('SELECT scanned_at FROM attendance_logs WHERE device_serial = ?').get('ADMS-TEST-001');
  assert.equal(log.scanned_at, '2026-08-24T09:00:00+07:00');
});
