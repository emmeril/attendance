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
  assert.match(dashboard.text, /Koneksi mesin/);
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

test('direct machine host is normalized', () => {
  const { hostFromDevice } = require('../src/services/direct-machine');
  assert.equal(hostFromDevice({ api_url: '192.168.2.201' }), '192.168.2.201');
  assert.equal(hostFromDevice({ api_url: 'http://192.168.2.201' }), '192.168.2.201');
});

test('machine users map to employee records', () => {
  const { syncUsers } = require('../src/services/direct-machine');
  const result = syncUsers([{ userId: 'TEST-USER-1', name: 'Mesin Test' }]);
  assert.equal(result.inserted, 1);
  const employee = require('../src/db').prepare('SELECT name, device_user_id FROM employees WHERE device_user_id = ?').get('TEST-USER-1');
  assert.deepEqual(employee, { name: 'Mesin Test', device_user_id: 'TEST-USER-1' });
});

test('overnight attendance is assigned to one automatic work schedule', () => {
  const db = require('../src/db');
  const { ingestOne } = require('../src/services/attendance-service');
  const shift = db.prepare("SELECT id FROM shifts WHERE name = 'Shift 3'").get();
  const employee = db.prepare(`INSERT INTO employees (employee_code,nik,name) VALUES ('SHIFT-TEST','NIK-SHIFT-TEST','Karyawan Shift Test')`).run();
  ingestOne({ employee_code: 'SHIFT-TEST', device_serial: 'SHIFT-DEVICE', scanned_at: '2026-08-24T21:00:00+07:00' });
  ingestOne({ employee_code: 'SHIFT-TEST', device_serial: 'SHIFT-DEVICE', scanned_at: '2026-08-25T07:00:00+07:00' });
  const rows = db.prepare('SELECT attendance_date,shift_id,check_in,check_out FROM daily_attendance WHERE employee_id=? ORDER BY attendance_date').all(employee.lastInsertRowid);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attendance_date, '2026-08-24');
  assert.equal(rows[0].shift_id, shift.id);
  assert.match(rows[0].check_out, /2026-08-25T07:00:00/);
});

test('leave and payroll draft endpoints are available', async () => {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'admin@attendance.local', password: 'admin123' });
  const employee = require('../src/db').prepare('SELECT id,nik FROM employees LIMIT 1').get();
  const leaveType = (await agent.get('/api/leave-types')).body[0];
  const leave = await agent.post('/api/leaves').send({ employee_id: employee.id, leave_type_id: leaveType.id, start_date: '2026-08-10', end_date: '2026-08-11', reason: 'Keperluan keluarga' });
  assert.equal(leave.status, 201);
  const period = await agent.post('/api/payroll/periods').send({ name: 'Payroll Agustus 2026', start_date: '2026-08-01', end_date: '2026-08-31' });
  assert.equal(period.status, 201);
  const calculated = await agent.post(`/api/payroll/periods/${period.body.id}/calculate`).send({});
  assert.equal(calculated.status, 200);
  assert.ok(calculated.body.employees >= 1);
  const records = await agent.get(`/api/payroll/periods/${period.body.id}/records`);
  assert.equal(records.status, 200);
  assert.ok(records.body.every(row => Number.isInteger(row.scheduled_days) && Number.isInteger(row.attendance_days) && Number.isInteger(row.absence_days)));
});
