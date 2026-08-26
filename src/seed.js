const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');

function seed() {
  const seedTransaction = db.transaction(() => {
    if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
      db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(
        config.admin.name,
        config.admin.email.toLowerCase(),
        bcrypt.hashSync(config.admin.password, 12)
      );
    }

    let shift = db.prepare("SELECT id FROM shifts WHERE lower(name) = 'reguler' LIMIT 1").get();
    if (!shift) {
      const result = db.prepare(`
        INSERT INTO shifts (name, start_time, end_time, check_in_start, check_in_end, check_out_start, check_out_end, late_tolerance_minutes, work_days)
        VALUES ('Reguler', '07:00', '16:00', '06:00', '09:00', '15:00', '18:00', 10, '1,2,3,4,5')
      `).run();
      shift = { id: result.lastInsertRowid };
    }
    if (!db.prepare("SELECT id FROM shifts WHERE lower(name) = 'shift 3' LIMIT 1").get()) {
      db.prepare(`INSERT INTO shifts (name,start_time,end_time,check_in_start,check_in_end,check_out_start,check_out_end,late_tolerance_minutes,work_days) VALUES ('Shift 3','21:00','07:00','20:00','23:59','06:00','09:00',10,'1,2,3,4,5,6,0')`).run();
    }

    const insertEmployee = db.prepare(`
      INSERT OR IGNORE INTO employees
      (employee_code, name, department, position, email, shift_id, device_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertEmployee.run('EMP001', 'Budi Santoso', 'Operasional', 'Supervisor', 'budi@example.com', shift.id, '1');
    insertEmployee.run('EMP002', 'Siti Rahma', 'Keuangan', 'Staf Finance', 'siti@example.com', shift.id, '2');

    db.prepare(`
      INSERT OR IGNORE INTO devices (serial_number, name, location, model, status)
      VALUES ('DEMO-SOLUTION-001', 'Finger Pintu Utama', 'Kantor Pusat', 'Solution Finger', 'offline')
    `).run();
  });

  seedTransaction();
  console.log(`Seed selesai. Login: ${config.admin.email} / ${config.admin.password}`);
}

if (require.main === module) seed();
module.exports = seed;
