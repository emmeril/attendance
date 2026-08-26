const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const db = require('../db');
const config = require('../config');

dayjs.extend(utc);
dayjs.extend(timezone);

function localTime(value) {
  const text = String(value || '');
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const parsed = hasTimezone ? dayjs(text) : dayjs.tz(text, config.timezone);
  if (!parsed.isValid()) throw new Error(`Waktu scan tidak valid: ${value}`);
  return parsed.tz(config.timezone);
}

function resolveEmployee(payload) {
  const code = String(payload.employee_code || payload.employeeCode || payload.pin || payload.user_id || payload.userId || '').trim();
  if (!code) throw new Error('employee_code/pin/user_id wajib tersedia');
  const deviceId = Number(payload.device_id || 0);

  if (deviceId) {
    const mappedEmployee = db.prepare(`
      SELECT e.*, s.start_time, s.end_time, s.late_tolerance_minutes
      FROM employee_device_ids x
      JOIN employees e ON e.id=x.employee_id
      LEFT JOIN shifts s ON s.id=e.shift_id
      WHERE x.device_id=? AND x.device_user_id=?
      LIMIT 1
    `).get(deviceId, code);
    if (mappedEmployee) return { code: mappedEmployee.employee_code, employee: mappedEmployee };
  }

  const employee = db.prepare(`
    SELECT e.*, s.start_time, s.end_time, s.late_tolerance_minutes
    FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
    WHERE ${deviceId ? 'e.device_user_id = ?' : 'e.employee_code = ? OR e.device_user_id = ?'}
    LIMIT 1
  `).get(...(deviceId ? [code] : [code, code]));

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
  const employee = db.prepare('SELECT id, shift_id FROM employees WHERE id = ?').get(employeeId);
  if (!employee) return;

  const dayLogs = db.prepare(`
    SELECT scanned_at FROM attendance_logs
    WHERE employee_id = ? AND substr(scanned_at, 1, 10) = ?
    ORDER BY scanned_at ASC
  `).all(employeeId, date);
  if (!dayLogs.length) return;

  const first = dayjs(dayLogs[0].scanned_at);
  const workDay = String(first.day());
  let shifts = db.prepare("SELECT * FROM shifts WHERE is_active = 1 ORDER BY start_time").all()
    .filter(shift => String(shift.work_days || '').split(',').includes(workDay));
  if (!shifts.length) shifts = db.prepare("SELECT * FROM shifts WHERE is_active = 1 ORDER BY start_time").all();
  const firstMinutes = first.hour() * 60 + first.minute();
  const toMinutes = value => { const [hour, minute] = String(value || '00:00').split(':').map(Number); return hour * 60 + minute; };
  const inRange = (value, start, end) => { const current = toMinutes(value); const from = toMinutes(start); const until = toMinutes(end); return from <= until ? current >= from && current <= until : current >= from || current <= until; };
  const minuteDistance = (time) => {
    const [hour, minute] = String(time).split(':').map(Number);
    const difference = Math.abs(firstMinutes - (hour * 60 + minute));
    return Math.min(difference, 1440 - difference);
  };
  shifts.sort((a, b) => {
    const aIn = inRange(first.format('HH:mm'), a.check_in_start || a.start_time, a.check_in_end || a.start_time);
    const bIn = inRange(first.format('HH:mm'), b.check_in_start || b.start_time, b.check_in_end || b.start_time);
    return Number(bIn) - Number(aIn) || minuteDistance(a.start_time) - minuteDistance(b.start_time);
  });
  const shift = shifts[0] || null;
  const overnight = shift && shift.end_time <= shift.start_time;
  let availableLogs = dayLogs;
  if (overnight) {
    const nextDate = dayjs(`${date}T00:00:00`).add(1, 'day').format('YYYY-MM-DD');
    const nextLogs = db.prepare(`SELECT scanned_at FROM attendance_logs WHERE employee_id = ? AND substr(scanned_at,1,10) = ? ORDER BY scanned_at`).all(employeeId, nextDate);
    const scheduledEnd = dayjs(`${nextDate}T${shift.end_time}:00`).add(4, 'hour');
    availableLogs = [...dayLogs, ...nextLogs.filter(log => dayjs(log.scanned_at).isBefore(scheduledEnd) || dayjs(log.scanned_at).isSame(scheduledEnd))];
  }

  const checkOutCandidates = shift ? availableLogs.slice(1).filter(log => {
    const scannedLog = dayjs(log.scanned_at);
    if (overnight && scannedLog.format('YYYY-MM-DD') === date) return false;
    return inRange(scannedLog.format('HH:mm'), shift.check_out_start || shift.end_time, shift.check_out_end || shift.end_time);
  }) : availableLogs.slice(1);
  const logs = checkOutCandidates.length ? [dayLogs[0], checkOutCandidates[checkOutCandidates.length - 1]] : [dayLogs[0]];

  const last = dayjs(logs[logs.length - 1].scanned_at);
  const tolerance = shift?.late_tolerance_minutes || 0;
  let lateMinutes = 0;
  if (shift?.start_time) {
    const scheduled = dayjs(`${date}T${shift.start_time}:00`);
    lateMinutes = Math.max(0, first.diff(scheduled, 'minute') - tolerance);
  }
  const workMinutes = logs.length > 1 ? Math.max(0, last.diff(first, 'minute')) : 0;

  db.prepare(`
    INSERT INTO daily_attendance
      (employee_id, attendance_date, shift_id, check_in, check_out, status, late_minutes, work_minutes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(employee_id, attendance_date) DO UPDATE SET
      shift_id = excluded.shift_id,
      check_in = excluded.check_in,
      check_out = excluded.check_out,
      status = excluded.status,
      late_minutes = excluded.late_minutes,
      work_minutes = excluded.work_minutes,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    employeeId,
    date,
    shift?.id || employee.shift_id || null,
    logs[0].scanned_at,
    logs.length > 1 ? logs[logs.length - 1].scanned_at : null,
    lateMinutes > 0 ? 'terlambat' : 'hadir',
    lateMinutes,
    workMinutes
  );
}

function rebuildForScan(employeeId, scanned) {
  const date = scanned.format('YYYY-MM-DD');
  const previousDate = scanned.subtract(1, 'day').format('YYYY-MM-DD');
  rebuildDaily(employeeId, previousDate);
  const consumedByPreviousShift = db.prepare(`
    SELECT 1 FROM daily_attendance da JOIN shifts s ON s.id=da.shift_id
    WHERE da.employee_id=? AND da.attendance_date=? AND s.end_time<=s.start_time AND da.check_out=?
  `).get(employeeId, previousDate, scanned.format('YYYY-MM-DDTHH:mm:ssZ'));
  if (!consumedByPreviousShift) rebuildDaily(employeeId, date);
}

function ingestOne(payload, source = 'device') {
  const scannedValue = payload.scanned_at || payload.scan_time || payload.timestamp || payload.datetime || payload.attendance_time;
  const scanned = localTime(scannedValue);
  const scannedAt = scanned.format('YYYY-MM-DDTHH:mm:ssZ');
  const { serial, device } = resolveDevice(payload);
  const { code, employee } = resolveEmployee({ ...payload, device_id: device?.id || payload.device_id });

  const existingLog = employee ? db.prepare(`
    SELECT id FROM attendance_logs
    WHERE scanned_at = ? AND employee_id = ?
      AND ((device_id IS NOT NULL AND device_id = ?) OR (device_serial IS NOT NULL AND device_serial = ?))
    LIMIT 1
  `).get(scannedAt, employee.id, device?.id || null, serial) : null;
  if (existingLog) {
    db.prepare(`UPDATE attendance_logs SET employee_code = ?, employee_id = ?, device_id = COALESCE(device_id, ?) WHERE id = ?`)
      .run(employee.employee_code, employee.id, device?.id || null, existingLog.id);
    rebuildForScan(employee.id, scanned);
    return { inserted: false, matched: true, employeeCode: employee.employee_code, scannedAt };
  }

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

  if (!result.changes && (employee || device)) {
    db.prepare(`
      UPDATE attendance_logs
      SET employee_id = COALESCE(employee_id, ?), device_id = COALESCE(device_id, ?)
      WHERE device_serial = ? AND employee_code = ? AND scanned_at = ?
    `).run(employee?.id || null, device?.id || null, serial, code, scannedAt);
  }
  if (employee) rebuildForScan(employee.id, scanned);
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
