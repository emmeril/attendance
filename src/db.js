const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    late_tolerance_minutes INTEGER NOT NULL DEFAULT 10,
    work_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    department TEXT,
    position TEXT,
    email TEXT,
    phone TEXT,
    shift_id INTEGER,
    device_user_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    location TEXT,
    model TEXT,
    provider TEXT NOT NULL DEFAULT 'solution',
    external_id TEXT,
    api_url TEXT,
    api_token TEXT,
    status TEXT NOT NULL DEFAULT 'offline',
    last_seen_at TEXT,
    last_sync_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attendance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT,
    employee_id INTEGER,
    employee_code TEXT NOT NULL,
    device_id INTEGER,
    device_serial TEXT,
    scanned_at TEXT NOT NULL,
    verify_mode TEXT DEFAULT 'fingerprint',
    event_type TEXT DEFAULT 'auto',
    source TEXT NOT NULL DEFAULT 'device',
    raw_payload TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
    UNIQUE(device_serial, employee_code, scanned_at)
  );

  CREATE TABLE IF NOT EXISTS daily_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    attendance_date TEXT NOT NULL,
    check_in TEXT,
    check_out TEXT,
    status TEXT NOT NULL DEFAULT 'hadir',
    late_minutes INTEGER NOT NULL DEFAULT 0,
    work_minutes INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE(employee_id, attendance_date)
  );

  CREATE TABLE IF NOT EXISTS employee_device_ids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    device_id INTEGER NOT NULL,
    device_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, device_user_id),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,
    records_count INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_scanned_at ON attendance_logs(scanned_at);
  CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance_logs(employee_id);
  CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_attendance(attendance_date);
`);

// Keep older databases compatible with direct machine connections.
try { db.exec('ALTER TABLE devices ADD COLUMN machine_port INTEGER NOT NULL DEFAULT 4370'); } catch (error) {
  if (!/duplicate column name/i.test(error.message)) throw error;
}
try { db.exec('ALTER TABLE employees ADD COLUMN nik TEXT'); } catch (error) {
  if (!/duplicate column name/i.test(error.message)) throw error;
}
db.prepare("UPDATE employees SET nik = employee_code WHERE nik IS NULL OR trim(nik) = ''").run();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_nik ON employees(nik)');

// Employee Code is an internal company identifier, not the PIN stored on a machine.
const migrateMachineCodes = db.transaction(() => {
  const rows = db.prepare(`SELECT id FROM employees WHERE device_user_id IS NOT NULL AND employee_code = device_user_id`).all();
  const exists = db.prepare('SELECT 1 FROM employees WHERE employee_code = ? AND id <> ?');
  const update = db.prepare('UPDATE employees SET employee_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  for (const row of rows) {
    const base = `EMP-${String(row.id).padStart(6, '0')}`;
    update.run(exists.get(base, row.id) ? `${base}-${row.id}` : base, row.id);
  }
});
migrateMachineCodes();

// Merge records duplicated by the same machine identity while preserving logs.
const mergeDuplicateEmployees = db.transaction(() => {
  const groups = db.prepare(`
    SELECT lower(trim(name)) AS person, GROUP_CONCAT(id) AS ids
    FROM employees GROUP BY lower(trim(name)) HAVING COUNT(*) > 1
  `).all();
  const countFor = (table, employeeId) => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE employee_id = ?`).get(employeeId).count;
  for (const group of groups) {
    const ids = String(group.ids).split(',').map(Number).filter(Boolean);
    const records = ids.map(id => ({
      ...db.prepare('SELECT * FROM employees WHERE id = ?').get(id),
      machineCount: countFor('employee_device_ids', id),
      logCount: countFor('attendance_logs', id),
      dayCount: countFor('daily_attendance', id)
    }));
    const machineUsers = new Set(records.flatMap(row => db.prepare('SELECT device_user_id FROM employee_device_ids WHERE employee_id = ?').all(row.id).map(x => x.device_user_id)));
    const hasSharedMachineId = records.some(row => row.device_user_id && records.some(other => other.id !== row.id && other.device_user_id === row.device_user_id));
    if (!hasSharedMachineId && machineUsers.size === 0) continue;
    records.sort((a, b) => (b.machineCount + b.logCount + b.dayCount) - (a.machineCount + a.logCount + a.dayCount));
    const keep = records[0];
    for (const duplicate of records.slice(1)) {
      db.prepare('UPDATE attendance_logs SET employee_id = ? WHERE employee_id = ?').run(keep.id, duplicate.id);
      db.prepare(`DELETE FROM daily_attendance WHERE employee_id = ? AND EXISTS (
        SELECT 1 FROM daily_attendance kept WHERE kept.employee_id = ? AND kept.attendance_date = daily_attendance.attendance_date
      )`).run(duplicate.id, keep.id);
      db.prepare('UPDATE daily_attendance SET employee_id = ? WHERE employee_id = ?').run(keep.id, duplicate.id);
      const mappings = db.prepare('SELECT device_id,device_user_id FROM employee_device_ids WHERE employee_id = ?').all(duplicate.id);
      for (const mapping of mappings) db.prepare('INSERT OR IGNORE INTO employee_device_ids (employee_id,device_id,device_user_id) VALUES (?,?,?)').run(keep.id, mapping.device_id, mapping.device_user_id);
      db.prepare('DELETE FROM employee_device_ids WHERE employee_id = ?').run(duplicate.id);
      db.prepare('DELETE FROM employees WHERE id = ?').run(duplicate.id);
    }
  }
});
mergeDuplicateEmployees();

module.exports = db;
