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
    check_in_start TEXT,
    check_in_end TEXT,
    check_out_start TEXT,
    check_out_end TEXT,
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

  CREATE TABLE IF NOT EXISTS leave_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    is_paid INTEGER NOT NULL DEFAULT 1,
    annual_quota_days INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    leave_type_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    total_days INTEGER NOT NULL DEFAULT 1,
    reason TEXT,
    attachment TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    approval_notes TEXT,
    approved_by INTEGER,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id),
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS payroll_settings (
    year INTEGER PRIMARY KEY,
    bpjs_health_employee_rate REAL NOT NULL DEFAULT 1,
    bpjs_health_wage_cap INTEGER NOT NULL DEFAULT 12000000,
    jht_employee_rate REAL NOT NULL DEFAULT 2,
    jp_employee_rate REAL NOT NULL DEFAULT 1,
    jp_wage_cap INTEGER NOT NULL DEFAULT 10547400,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payroll_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(start_date, end_date),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS payroll_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payroll_period_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    base_salary INTEGER NOT NULL DEFAULT 0,
    allowances INTEGER NOT NULL DEFAULT 0,
    overtime_pay INTEGER NOT NULL DEFAULT 0,
    bonus INTEGER NOT NULL DEFAULT 0,
    unpaid_leave_deduction INTEGER NOT NULL DEFAULT 0,
    bpjs_health_employee INTEGER NOT NULL DEFAULT 0,
    jht_employee INTEGER NOT NULL DEFAULT 0,
    jp_employee INTEGER NOT NULL DEFAULT 0,
    pph21 INTEGER NOT NULL DEFAULT 0,
    other_deductions INTEGER NOT NULL DEFAULT 0,
    gross_salary INTEGER NOT NULL DEFAULT 0,
    net_salary INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    UNIQUE(payroll_period_id, employee_id),
    FOREIGN KEY (payroll_period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
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
for (const definition of [
  'base_salary INTEGER NOT NULL DEFAULT 0',
  "tax_status TEXT NOT NULL DEFAULT 'TK/0'",
  'pph21_rate REAL NOT NULL DEFAULT 0',
  'bpjs_health_number TEXT',
  'bpjs_employment_number TEXT',
  'bank_name TEXT',
  'bank_account TEXT'
]) {
  try { db.exec(`ALTER TABLE employees ADD COLUMN ${definition}`); } catch (error) {
    if (!/duplicate column name/i.test(error.message)) throw error;
  }
}
for (const column of ['check_in_start', 'check_in_end', 'check_out_start', 'check_out_end']) {
  try { db.exec(`ALTER TABLE shifts ADD COLUMN ${column} TEXT`); } catch (error) {
    if (!/duplicate column name/i.test(error.message)) throw error;
  }
}
db.exec(`UPDATE shifts SET check_in_start = COALESCE(check_in_start, start_time), check_in_end = COALESCE(check_in_end, start_time), check_out_start = COALESCE(check_out_start, end_time), check_out_end = COALESCE(check_out_end, end_time)`);
try { db.exec('ALTER TABLE daily_attendance ADD COLUMN shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL'); } catch (error) {
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

const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: config.timezone, year: 'numeric' }).format(new Date()));
db.prepare('INSERT OR IGNORE INTO payroll_settings (year) VALUES (?)').run(currentYear);
const insertLeaveType = db.prepare('INSERT OR IGNORE INTO leave_types (name,is_paid,annual_quota_days) VALUES (?,?,?)');
for (const type of [
  ['Cuti Tahunan', 1, 12], ['Sakit', 1, null], ['Izin Pribadi', 1, null],
  ['Dinas Luar', 1, null], ['Cuti Melahirkan', 1, null], ['Tanpa Dibayar', 0, null]
]) insertLeaveType.run(...type);

module.exports = db;
