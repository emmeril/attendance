const db = require('../db');
const config = require('../config');
const directMachine = require('./direct-machine');

const runningDevices = new Set();
let timer = null;

async function syncDevice(device) {
  const deviceId = Number(device?.id);
  if (!deviceId) throw new Error('ID perangkat tidak valid.');
  if (runningDevices.has(deviceId)) return { skipped: true, reason: 'Sinkronisasi perangkat sedang berjalan.' };

  runningDevices.add(deviceId);
  try {
    const result = await directMachine.pullAttendance(device);
    return { ...result, skipped: false };
  } catch (error) {
    db.prepare("UPDATE devices SET status = 'offline' WHERE id = ?").run(deviceId);
    throw error;
  } finally {
    runningDevices.delete(deviceId);
  }
}

async function syncAll() {
  const devices = db.prepare(`
    SELECT * FROM devices
    WHERE is_active = 1 AND api_url IS NOT NULL AND trim(api_url) <> ''
    ORDER BY id
  `).all();

  const results = [];
  for (const device of devices) {
    try {
      const result = await syncDevice(device);
      results.push({ deviceId: device.id, name: device.name, ok: true, ...result });
      if (!result.skipped) {
        console.log(`[auto-sync] ${device.name}: ${result.inserted || 0} log baru dari ${result.received || 0} log.`);
      }
    } catch (error) {
      console.error(`[auto-sync] ${device.name} gagal: ${error.message}`);
      results.push({ deviceId: device.id, name: device.name, ok: false, error: error.message });
    }
  }
  return results;
}

function start() {
  if (!config.machineSync.enabled || timer) return null;

  const run = () => syncAll().catch((error) => console.error(`[auto-sync] Gagal menjalankan scheduler: ${error.message}`));
  const initialTimer = setTimeout(run, config.machineSync.initialDelayMs);
  initialTimer.unref?.();
  timer = setInterval(run, config.machineSync.intervalMs);
  timer.unref?.();
  console.log(`[auto-sync] Aktif setiap ${Math.round(config.machineSync.intervalMs / 1000)} detik.`);
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { syncDevice, syncAll, start, stop };
