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

async function pullAttendance(device) {
  const result = await withMachine(device, async (zk) => {
    const response = await zk.getAttendances();
    const records = (response.data || []).map((row) => ({
      employee_code: String(row.deviceUserId),
      scanned_at: row.recordTime instanceof Date ? row.recordTime.toISOString() : row.recordTime,
      device_serial: device.serial_number,
      verify_mode: 'fingerprint',
      event_type: 'device'
    }));
    return ingestMany(records, 'solution-direct');
  });
  db.prepare("UPDATE devices SET status='online', last_sync_at=CURRENT_TIMESTAMP, last_seen_at=CURRENT_TIMESTAMP WHERE id=?").run(device.id);
  return result;
}

module.exports = { hostFromDevice, testConnection, pullAttendance };
