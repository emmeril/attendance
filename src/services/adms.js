const db = require('../db');
const { ingestMany } = require('./attendance-service');

function ensureDevice(serial) {
  const normalized = String(serial || '').trim();
  if (!normalized) return null;

  let device = db.prepare('SELECT * FROM devices WHERE serial_number = ? LIMIT 1').get(normalized);
  if (!device) {
    const result = db.prepare(`
      INSERT INTO devices (serial_number, name, model, provider, status)
      VALUES (?, ?, 'Solution Finger', 'solution-adms', 'online')
    `).run(normalized, `Mesin ${normalized}`);
    device = db.prepare('SELECT * FROM devices WHERE id = ?').get(result.lastInsertRowid);
  } else {
    db.prepare(`UPDATE devices SET status = 'online', last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(device.id);
  }
  return device;
}

function parseAttendance(body, serial) {
  return String(body || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\t');
      return {
        employee_code: fields[0],
        scanned_at: fields[1],
        event_type: fields[2] || '0',
        verify_mode: fields[3] || '1',
        device_serial: serial,
        external_id: `${serial}:${fields[0]}:${fields[1]}`
      };
    })
    .filter((record) => record.employee_code && record.scanned_at);
}

function optionsResponse(serial) {
  return [
    `GET OPTION FROM: ${serial}`,
    'Stamp=0',
    'OpStamp=0',
    'PhotoStamp=0',
    'ErrorDelay=60',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=1111000000',
    'Realtime=1',
    'Encrypt=0'
  ].join('\n');
}

function ingestAttlog(body, serial) {
  ensureDevice(serial);
  const records = parseAttendance(body, serial);
  return { records, result: records.length ? ingestMany(records, 'solution-adms') : { received: 0, inserted: 0, unmatched: 0 } };
}

module.exports = { ensureDevice, optionsResponse, ingestAttlog, parseAttendance };
