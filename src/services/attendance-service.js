const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const db = require('../db');
const config = require('../config');

dayjs.extend(utc);
dayjs.extend(timezone);

function localTime(value) {
  const parsed = dayjs(value);
  if (!parsed.isValid()) throw new Error(`Waktu scan tidak valid: ${value}`);
  return parsed.tz(config.timezone);
}

function resolveEmployee(payload) {
  const code = String(payload.employee_code || payload.employeeCode || payload.pin || payload.user_id || payload.userId || '').trim();
  if (!code) throw new Error('employee_code/pin/user_id wajib tersedia');

  const employee = db.prepare(`
    SELECT e.*, s.start_time, s.end_time, s.late_tolerance_minutes
    FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
    WHERE e.employee_code = ? OR e.device_user_id = ?
    LIMIT 1
  `).get(code, code);

  return { code: employee?.employee_code || code, employee };
}

function resolveDevice(payload) {
  const serial = String(payload.device_serial || payload.deviceSerial || payload.sn || payload.serial_number || '').trim();
  if (!serial) return { serial: null, device: null };

  const device = db.prepare('SELECT * FROM devices WHERE serial_number = ? OR external_id = ? LIMIT 1').get(serial, serial);
  if (device) {
    db.prepare(`UPDATE devices SET status = 'online', last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(device.id);
  }
  return { serial, device };
}

function rebuildDaily(employeeId, date) {
  const employee = db.prepare(`
    SELECT e.id, s.start_time, s.end_time, s.late_tolerance_minutes
    FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = ?
  `).get(employeeId);
  if (!employee) return;

  const logs = db.prepare(`
    SELECT scanned_at FROM attendance_logs
    WHERE employee_id = ? AND substr(scanned_at, 1, 10) = ?
    ORDER BY scanned_at ASC
  `).all(employeeId, date);
  if (!logs.length) return;

  const first = dayjs(logs[0].scanned_at);
  const last = dayjs(logs[logs.length - 1].scanned_at);
  const tolerance = employee.late_tolerance_minutes || 0;
  let lateMinutes = 0;
  if (employee.start_time) {
    const scheduled = dayjs(`${date}T${employee.start_time}:00`);
    lateMinutes = Math.max(0, first.diff(scheduled, 'minute') - tolerance);
  }
  const workMinutes = logs.length > 1 ? Math.max(0, last.diff(first, 'minute')) : 0;

  db.prepare(`
    INSERT INTO daily_attendance
      (employee_id, attendance_date, check_in, check_out, status, late_minutes, work_minutes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(employee_id, attendance_date) DO UPDATE SET
      check_in = excluded.check_in,
      check_out = excluded.check_out,
      status = excluded.status,
      late_minutes = excluded.late_minutes,
      work_minutes = excluded.work_minutes,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    employeeId,
    date,
    logs[0].scanned_at,
    logs.length > 1 ? logs[logs.length - 1].scanned_at : null,
    lateMinutes > 0 ? 'terlambat' : 'hadir',
    lateMinutes,
    workMinutes
  );
}

function ingestOne(payload, source = 'device') {
  const scannedValue = payload.scanned_at || payload.scan_time || payload.timestamp || payload.datetime || payload.attendance_time;
  const scanned = localTime(scannedValue);
  const scannedAt = scanned.format('YYYY-MM-DDTHH:mm:ssZ');
  const { code, employee } = resolveEmployee(payload);
  const { serial, device } = resolveDevice(payload);

  const result = db.prepare(`
    INSERT OR IGNORE INTO attendance_logs
      (external_id, employee_id, employee_code, device_id, device_serial, scanned_at, verify_mode, event_type, source, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.id ? String(payload.id) : (payload.external_id ? String(payload.external_id) : null),
    employee?.id || null,
    code,
    device?.id || null,
    serial,
    scannedAt,
    payload.verify_mode || payload.verifyMode || payload.verification || 'fingerprint',
    payload.event_type || payload.eventType || payload.status || 'auto',
    source,
    JSON.stringify(payload)
  );

  if (result.changes && employee) rebuildDaily(employee.id, scanned.format('YYYY-MM-DD'));
  return { inserted: Boolean(result.changes), matched: Boolean(employee), employeeCode: code, scannedAt };
}

function ingestMany(records, source = 'device') {
  const transaction = db.transaction((items) => items.map((item) => ingestOne(item, source)));
  const results = transaction(records);
  return {
    received: records.length,
    inserted: results.filter((item) => item.inserted).length,
    unmatched: results.filter((item) => !item.matched).length,
    results
  };
}

module.exports = { ingestOne, ingestMany, rebuildDaily };

