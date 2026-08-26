const ZKLib = require('node-zklib');
const db = require('../db');
const { ingestMany } = require('./attendance-service');

function hostFromDevice(device) {
  const value = String(device?.api_url || '').trim();
  if (!value) return '';
  try { return new URL(value.includes('://') ? value : `http://${value}`).hostname; } catch { return value; }
}

async function withMachine(device, action) {
  const host = hostFromDevice(device);
  if (!host) throw new Error('IP mesin belum diisi pada kolom IP address / host mesin.');
  const zk = new ZKLib(host, Number(device.machine_port || 4370), 10000, 4000);
  await zk.createSocket();
  try { return await action(zk, host); } finally { await zk.disconnect(); }
}

async function testConnection(device) {
  return withMachine(device, async (zk, host) => ({ ok: true, connected: true, host, port: Number(device.machine_port || 4370), info: await zk.getInfo() }));
}

function employeeCodeFor(id) {
  const base = `EMP-${String(id).padStart(6, '0')}`;
  if (!db.prepare('SELECT 1 FROM employees WHERE employee_code = ? AND id <> ?').get(base, id)) return base;
  return `${base}-${id}`;
}

function syncUsers(users, deviceId = null) {
  const upsert = db.transaction((items) => {
    let inserted = 0;
    let updated = 0;
    for (const user of items) {
      const deviceUserId = String(user.userId ?? user.uid ?? '').trim();
      if (!deviceUserId) continue;
      const name = String(user.name || '').trim() || `Pengguna ${deviceUserId}`;
      const mapped = deviceId ? db.prepare('SELECT employee_id FROM employee_device_ids WHERE device_id = ? AND device_user_id = ?').get(deviceId, deviceUserId) : null;
      const existing = mapped ? db.prepare('SELECT id FROM employees WHERE id = ?').get(mapped.employee_id) : db.prepare(`
        SELECT id FROM employees
        WHERE device_user_id = ? OR LOWER(TRIM(name)) = LOWER(TRIM(?))
        LIMIT 1
      `).get(deviceUserId, name);
      if (existing) {
        db.prepare(`UPDATE employees SET name = ?, device_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(name, deviceUserId, existing.id);
        updated += 1;
      } else {
        const created = db.prepare(`INSERT INTO employees (employee_code, name, device_user_id) VALUES (?, ?, ?)`)
          .run(`AUTO-${deviceId || 0}-${deviceUserId}-${Date.now()}`, name, deviceUserId);
        db.prepare('UPDATE employees SET employee_code = ? WHERE id = ?')
          .run(employeeCodeFor(Number(created.lastInsertRowid)), created.lastInsertRowid);
        inserted += 1;
      }
      if (deviceId) {
        const employeeId = existing?.id || db.prepare('SELECT id FROM employees WHERE device_user_id = ? ORDER BY id DESC LIMIT 1').get(deviceUserId)?.id;
        if (employeeId) db.prepare('INSERT OR IGNORE INTO employee_device_ids (employee_id, device_id, device_user_id) VALUES (?, ?, ?)').run(employeeId, deviceId, deviceUserId);
      }
    }
    return { inserted, updated, total: items.length };
  });
  return upsert(users);
}

async function pullAttendance(device) {
  const result = await withMachine(device, async (zk) => {
    // Read counters before bulk data because some firmware cannot run a
    // second command after transferring the full user list.
    const info = await zk.getInfo();
    const usersResponse = await zk.getUsers();
    const users = usersResponse.data || [];
    const usersSync = syncUsers(users, device.id);
    // Some firmware closes the data channel when there are no logs. Avoid the
    // node-zklib empty-packet bug by checking the log counter first.
    if (!info.logCounts) return { received: 0, inserted: 0, unmatched: 0, results: [], users: usersSync };
    const response = await zk.getAttendances();
    const records = (response.data || []).map((row) => ({
      employee_code: String(row.deviceUserId),
      scanned_at: row.recordTime instanceof Date ? row.recordTime.toISOString() : row.recordTime,
      device_serial: device.serial_number,
      verify_mode: 'fingerprint',
      event_type: 'device'
      , device_id: device.id
    }));
    return { ...ingestMany(records, 'solution-direct'), users: usersSync };
  });
  db.prepare("UPDATE devices SET status='online', last_sync_at=CURRENT_TIMESTAMP, last_seen_at=CURRENT_TIMESTAMP WHERE id=?").run(device.id);
  return result;
}

module.exports = { hostFromDevice, testConnection, pullAttendance, syncUsers };
