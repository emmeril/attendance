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
