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

function syncUsers(users) {
  const upsert = db.transaction((items) => {
    let inserted = 0;
    let updated = 0;
    for (const user of items) {
      const deviceUserId = String(user.userId ?? user.uid ?? '').trim();
      if (!deviceUserId) continue;
      const name = String(user.name || '').trim() || `Pengguna ${deviceUserId}`;
      const existing = db.prepare(`
        SELECT id FROM employees
        WHERE device_user_id = ? OR employee_code = ?
        LIMIT 1
      `).get(deviceUserId, deviceUserId);
      if (existing) {
        db.prepare(`UPDATE employees SET name = ?, device_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(name, deviceUserId, existing.id);
        updated += 1;
      } else {
        db.prepare(`INSERT INTO employees (employee_code, name, device_user_id) VALUES (?, ?, ?)`)
          .run(deviceUserId, name, deviceUserId);
        inserted += 1;
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
    const usersSync = syncUsers(users);
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
    }));
    return { ...ingestMany(records, 'solution-direct'), users: usersSync };
  });
  db.prepare("UPDATE devices SET status='online', last_sync_at=CURRENT_TIMESTAMP, last_seen_at=CURRENT_TIMESTAMP WHERE id=?").run(device.id);
  return result;
}

module.exports = { hostFromDevice, testConnection, pullAttendance, syncUsers };
