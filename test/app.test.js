const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const testDb = path.resolve(__dirname, '..', 'data', 'test-attendance.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${testDb}${suffix}`, { force: true });
process.env.NODE_ENV = 'test';
process.env.DB_PATH = './data/test-attendance.db';
process.env.SOLUTION_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.ADMIN_EMAIL = 'admin@attendance.local';
process.env.ADMIN_PASSWORD = 'admin123';
process.env.SESSION_COOKIE_SECURE = 'false';
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

test('payroll settings preview payday and holiday adjustment', async () => {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'admin@attendance.local', password: 'admin123' });

  const settings = await agent.put('/api/payroll/settings/2026').send({
    payday_day: 10,
    period_mode: 'previous_month',
    cutoff_day: 25,
    holiday_adjustment: 'previous_workday',
  });
  assert.equal(settings.status, 200);

  const holiday = await agent.post('/api/holidays').send({ holiday_date: '2026-09-10', name: 'Libur uji payroll' });
  assert.equal(holiday.status, 201);
  const preview = await agent.get('/api/payroll/preview?payment_date=2026-09-10&period_mode=previous_month');
  assert.equal(preview.status, 200);
  assert.equal(preview.body.start_date, '2026-08-01');
  assert.equal(preview.body.end_date, '2026-08-31');
  assert.equal(preview.body.adjusted_payment_date, '2026-09-09');

  const secondHoliday = await agent.post('/api/holidays').send({ holiday_date: '2026-09-09', name: 'Libur uji payroll 2' });
  assert.equal(secondHoliday.status, 201);
  const adjustedAgain = await agent.get('/api/payroll/preview?payment_date=2026-09-10');
  assert.equal(adjustedAgain.body.adjusted_payment_date, '2026-09-08');

  const holidays = await agent.get('/api/holidays?year=2026');
  assert.ok(holidays.body.some(row => row.id === holiday.body.id));
  const edited = await agent.put(`/api/holidays/${holiday.body.id}`).send({ holiday_date: '2026-09-10', name: 'Libur payroll diperbarui', is_working_day: true });
  assert.equal(edited.status, 200);
  const removed = await agent.delete(`/api/holidays/${secondHoliday.body.id}`);
  assert.equal(removed.status, 200);
  await agent.delete(`/api/holidays/${holiday.body.id}`);
});

test('holiday is excluded from scheduled payroll days and locked payroll cannot recalculate', async () => {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ email: 'admin@attendance.local', password: 'admin123' });
  const employee = require('../src/db').prepare('SELECT id FROM employees LIMIT 1').get();
  const holiday = await agent.post('/api/holidays').send({ holiday_date: '2026-09-17', name: 'Hari Libur uji' });
  assert.equal(holiday.status, 201);
  const period = await agent.post('/api/payroll/periods').send({ name: 'Payroll Libur Uji', payment_date: '2026-10-10', period_mode: 'previous_month' });
  assert.equal(period.status, 201);
  const calculated = await agent.post(`/api/payroll/periods/${period.body.id}/calculate`).send({});
  assert.equal(calculated.status, 200);
  const records = await agent.get(`/api/payroll/periods/${period.body.id}/records`);
  const row = records.body.find(item => item.employee_id === employee.id);
  assert.ok(row);
  assert.equal(row.scheduled_days, 21);
  const locked = await agent.put(`/api/payroll/periods/${period.body.id}/status`).send({ status: 'locked' });
  assert.equal(locked.status, 200);
  const cannotReturnToDraft = await agent.put(`/api/payroll/periods/${period.body.id}/status`).send({ status: 'draft' });
  assert.equal(cannotReturnToDraft.status, 409);
  const recalculated = await agent.post(`/api/payroll/periods/${period.body.id}/calculate`).send({});
  assert.equal(recalculated.status, 409);
  await agent.delete(`/api/holidays/${holiday.body.id}`);
});
