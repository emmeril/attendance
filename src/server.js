const express = require('express');
const path = require('node:path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const db = require('./db');
const config = require('./config');
const seed = require('./seed');
const { ingestMany } = require('./services/attendance-service');
const adms = require('./services/adms');
const directMachine = require('./services/direct-machine');
const machineSync = require('./services/machine-sync');
const { encrypt } = require('./services/secrets');
const ejs = require('ejs');

seed();
const app = express();
app.engine('html', ejs.renderFile);
app.set('view engine', 'html');
app.set('views', path.join(config.rootDir, 'src', 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use('/vendor/adminlte', express.static(path.join(config.rootDir, 'node_modules', 'admin-lte', 'dist')));
app.use('/vendor/bootstrap', express.static(path.join(config.rootDir, 'node_modules', 'bootstrap', 'dist')));
app.use('/vendor/fontawesome', express.static(path.join(config.rootDir, 'node_modules', '@fortawesome', 'fontawesome-free')));
app.use('/vendor/alpinejs', express.static(path.join(config.rootDir, 'node_modules', 'alpinejs', 'dist')));
app.use('/assets', express.static(path.join(config.rootDir, 'src', 'public')));

// Solution machines use the ZKTeco-compatible ADMS protocol and push data to us.
app.use('/iclock', express.text({ type: '*/*', limit: '2mb' }));
app.get(['/iclock/cdata', '/iclock/cdata.aspx'], (req, res) => {
  const serial = String(req.query.SN || req.query.sn || '').trim();
  if (!serial) return res.status(400).type('text').send('ERROR: Missing SN');
  if (!config.solution.admsAutoRegister && !db.prepare('SELECT id FROM devices WHERE serial_number = ?').get(serial)) {
    return res.status(403).type('text').send('ERROR: Unknown device');
  }
  adms.ensureDevice(serial);
  return res.type('text').send(req.query.options === 'all' ? adms.optionsResponse(serial) : 'OK');
});
app.post(['/iclock/cdata', '/iclock/cdata.aspx'], (req, res) => {
  const serial = String(req.query.SN || req.query.sn || '').trim();
  if (!serial) return res.status(400).type('text').send('ERROR: Missing SN');
  if (!config.solution.admsAutoRegister && !db.prepare('SELECT id FROM devices WHERE serial_number = ?').get(serial)) {
    return res.status(403).type('text').send('ERROR: Unknown device');
  }
  try {
    const { result } = adms.ingestAttlog(req.body, serial);
    return res.type('text').send('OK');
  } catch (error) {
    return res.status(400).type('text').send(`ERROR: ${error.message}`);
  }
});
app.get(['/iclock/getrequest', '/iclock/getrequest.aspx'], (req, res) => res.type('text').send('OK'));
app.post(['/iclock/devicecmd', '/iclock/devicecmd.aspx'], (req, res) => res.type('text').send('OK'));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const isAuthenticated = (req, res, next) => req.session.user ? next() : (req.path.startsWith('/api/') ? res.status(401).json({ error: 'Unauthenticated' }) : res.redirect('/login'));

function saveEmployeeMachineMappings(employeeId, mappings) {
  if (!mappings || typeof mappings !== 'object') return;
  const remove = db.prepare('DELETE FROM employee_device_ids WHERE employee_id = ? AND device_id = ?');
  const add = db.prepare('INSERT OR IGNORE INTO employee_device_ids (employee_id, device_id, device_user_id) VALUES (?, ?, ?)');
  const update = db.transaction(() => {
    for (const [deviceId, value] of Object.entries(mappings)) {
      const id = Number(deviceId);
      const userId = String(value || '').trim();
      if (!Number.isInteger(id) || id <= 0) continue;
      remove.run(employeeId, id);
      if (userId) add.run(employeeId, id, userId);
    }
  });
  update();
}

app.use((req, res, next) => {
  const publicUrl = new URL(config.appUrl);
  res.locals.user = req.session.user;
  res.locals.appName = config.appName;
  res.locals.appUrl = config.appUrl;
  res.locals.admsHost = publicUrl.hostname;
  res.locals.admsPort = publicUrl.port || (publicUrl.protocol === 'https:' ? '443' : '80');
  next();
});

app.get('/login', (req, res) => req.session.user ? res.redirect('/') : res.render('login', { error: null }));
app.post('/login', loginLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
    return res.status(401).render('login', { error: 'Email atau password salah.' });
  }
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  return res.redirect('/');
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/', isAuthenticated, (req, res) => res.render('dashboard'));

app.get('/api/dashboard', isAuthenticated, (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const stats = {
    employees: db.prepare('SELECT COUNT(*) AS count FROM employees WHERE is_active = 1').get().count,
    devices: db.prepare("SELECT COUNT(*) AS count FROM devices WHERE is_active = 1").get().count,
    hadir: db.prepare("SELECT COUNT(*) AS count FROM daily_attendance WHERE attendance_date = ? AND status = 'hadir'").get(date).count,
    terlambat: db.prepare("SELECT COUNT(*) AS count FROM daily_attendance WHERE attendance_date = ? AND status = 'terlambat'").get(date).count,
    belumScan: db.prepare(`SELECT COUNT(*) AS count FROM employees WHERE is_active = 1 AND id NOT IN (SELECT employee_id FROM daily_attendance WHERE attendance_date = ? AND employee_id IS NOT NULL)`).get(date).count
  };
  const recent = db.prepare(`SELECT a.*, e.name employee_name, d.name device_name FROM attendance_logs a LEFT JOIN employees e ON e.id=a.employee_id LEFT JOIN devices d ON d.id=a.device_id ORDER BY a.scanned_at DESC LIMIT 200`).all();
  res.json({ date, stats, recent });
});

app.get('/api/employees', isAuthenticated, (req, res) => res.json(db.prepare(`
  SELECT e.*, e.nik, s.name shift_name,
    COALESCE((
      SELECT GROUP_CONCAT(d.name || ': ' || x.device_user_id, ' | ')
      FROM employee_device_ids x JOIN devices d ON d.id=x.device_id
      WHERE x.employee_id=e.id
    ), e.device_user_id) AS machine_user_ids
  FROM employees e
  LEFT JOIN shifts s ON s.id=e.shift_id
  ORDER BY e.name
`).all()));
app.post('/api/employees', isAuthenticated, (req, res) => {
  const schema = z.object({ nik: z.string().min(1), name: z.string().min(1), department: z.string().optional(), position: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), shift_id: z.preprocess((value) => value === '' || value == null ? undefined : Number(value), z.number().int().positive().optional()), device_user_id: z.string().optional(), base_salary:z.coerce.number().min(0).optional(), tax_status:z.string().optional(), pph21_rate:z.coerce.number().min(0).optional(), bpjs_health_number:z.string().optional(), bpjs_employment_number:z.string().optional() });
  const parsed = schema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  try { const x = parsed.data; const result = db.prepare(`INSERT INTO employees (employee_code,nik,name,department,position,email,phone,shift_id,device_user_id,base_salary,tax_status,pph21_rate,bpjs_health_number,bpjs_employment_number) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`AUTO-${Date.now()}`,x.nik,x.name,x.department||null,x.position||null,x.email||null,x.phone||null,x.shift_id||null,x.device_user_id||null,x.base_salary||0,x.tax_status||'TK/0',x.pph21_rate||0,x.bpjs_health_number||null,x.bpjs_employment_number||null); db.prepare('UPDATE employees SET employee_code=? WHERE id=?').run(`EMP-${String(result.lastInsertRowid).padStart(6,'0')}`,result.lastInsertRowid); saveEmployeeMachineMappings(result.lastInsertRowid, req.body.machine_mappings); res.status(201).json({ id: result.lastInsertRowid }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/employees/:id', isAuthenticated, (req, res) => {
  const x = req.body; try { db.prepare(`UPDATE employees SET nik=?,name=?,department=?,position=?,email=?,phone=?,shift_id=?,device_user_id=?,base_salary=?,tax_status=?,pph21_rate=?,bpjs_health_number=?,bpjs_employment_number=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(x.nik,x.name,x.department||null,x.position||null,x.email||null,x.phone||null,x.shift_id||null,x.device_user_id||null,Number(x.base_salary||0),x.tax_status||'TK/0',Number(x.pph21_rate||0),x.bpjs_health_number||null,x.bpjs_employment_number||null,x.is_active === false ? 0 : 1, req.params.id); saveEmployeeMachineMappings(req.params.id, x.machine_mappings); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/employees/:id/mappings', isAuthenticated, (req, res) => res.json(Object.fromEntries(db.prepare('SELECT device_id, device_user_id FROM employee_device_ids WHERE employee_id = ?').all(req.params.id).map(row => [row.device_id, row.device_user_id]))));
app.delete('/api/employees/:id', isAuthenticated, (req, res) => { try { const result=db.prepare('DELETE FROM employees WHERE id=?').run(req.params.id); if(!result.changes) return res.status(404).json({error:'Karyawan tidak ditemukan'}); res.json({ok:true}); } catch(e) { res.status(400).json({error:e.message}); } });

app.get('/api/shifts', isAuthenticated, (req, res) => res.json(db.prepare('SELECT * FROM shifts ORDER BY name').all()));
app.post('/api/shifts', isAuthenticated, (req, res) => { const x=req.body; try { if(!x.name||!x.start_time||!x.end_time) return res.status(400).json({error:'Nama, jam masuk, dan jam pulang wajib diisi'}); const r=db.prepare('INSERT INTO shifts (name,start_time,end_time,check_in_start,check_in_end,check_out_start,check_out_end,late_tolerance_minutes,work_days) VALUES (?,?,?,?,?,?,?,?,?)').run(x.name,x.start_time,x.end_time,x.check_in_start||x.start_time,x.check_in_end||x.start_time,x.check_out_start||x.end_time,x.check_out_end||x.end_time,Number(x.late_tolerance_minutes||0),x.work_days||'1,2,3,4,5'); res.status(201).json({id:r.lastInsertRowid}); } catch(e) { res.status(400).json({error:e.message}); } });
app.put('/api/shifts/:id', isAuthenticated, (req, res) => { const x=req.body; try { if(!x.name||!x.start_time||!x.end_time) return res.status(400).json({error:'Nama, jam masuk, dan jam pulang wajib diisi'}); const result=db.prepare('UPDATE shifts SET name=?,start_time=?,end_time=?,check_in_start=?,check_in_end=?,check_out_start=?,check_out_end=?,late_tolerance_minutes=?,work_days=? WHERE id=?').run(x.name,x.start_time,x.end_time,x.check_in_start||x.start_time,x.check_in_end||x.start_time,x.check_out_start||x.end_time,x.check_out_end||x.end_time,Number(x.late_tolerance_minutes||0),x.work_days||'1,2,3,4,5',req.params.id); if(!result.changes) return res.status(404).json({error:'Jam kerja tidak ditemukan'}); res.json({ok:true}); } catch(e) { res.status(400).json({error:e.message}); } });
app.delete('/api/shifts/:id', isAuthenticated, (req, res) => { try { const result=db.prepare('DELETE FROM shifts WHERE id=?').run(req.params.id); if(!result.changes) return res.status(404).json({error:'Shift tidak ditemukan'}); res.json({ok:true}); } catch(e) { res.status(400).json({error:e.message}); } });

app.get('/api/leave-types', isAuthenticated, (req, res) => res.json(db.prepare('SELECT * FROM leave_types WHERE is_active=1 ORDER BY name').all()));
app.get('/api/leaves', isAuthenticated, (req, res) => res.json(db.prepare(`SELECT r.*,e.nik,e.name employee_name,t.name leave_type_name FROM leave_requests r JOIN employees e ON e.id=r.employee_id JOIN leave_types t ON t.id=r.leave_type_id ORDER BY r.start_date DESC,r.created_at DESC`).all()));
app.post('/api/leaves', isAuthenticated, (req, res) => {
  const x=req.body; try {
    if(!x.employee_id||!x.leave_type_id||!x.start_date||!x.end_date) return res.status(400).json({error:'Karyawan, jenis izin, tanggal mulai, dan tanggal selesai wajib diisi'});
    if(x.end_date < x.start_date) return res.status(400).json({error:'Tanggal selesai tidak boleh lebih awal dari tanggal mulai'});
    const start=new Date(`${x.start_date}T00:00:00Z`); const end=new Date(`${x.end_date}T00:00:00Z`); const total=Math.floor((end-start)/86400000)+1;
    const result=db.prepare('INSERT INTO leave_requests (employee_id,leave_type_id,start_date,end_date,total_days,reason,attachment) VALUES (?,?,?,?,?,?,?)').run(x.employee_id,x.leave_type_id,x.start_date,x.end_date,total,x.reason||null,x.attachment||null); res.status(201).json({id:result.lastInsertRowid});
  } catch(e) { res.status(400).json({error:e.message}); }
});
app.put('/api/leaves/:id/status', isAuthenticated, (req, res) => { const status=String(req.body.status||''); if(!['pending','approved','rejected','cancelled'].includes(status)) return res.status(400).json({error:'Status izin tidak valid'}); try { const result=db.prepare('UPDATE leave_requests SET status=?,approval_notes=?,approved_by=?,approved_at=CASE WHEN ? IN (\'approved\',\'rejected\') THEN CURRENT_TIMESTAMP ELSE approved_at END WHERE id=?').run(status,req.body.approval_notes||null,req.session.user.id,status,req.params.id); if(!result.changes) return res.status(404).json({error:'Pengajuan izin tidak ditemukan'}); res.json({ok:true}); } catch(e) { res.status(400).json({error:e.message}); } });
app.delete('/api/leaves/:id', isAuthenticated, (req, res) => { try { const result=db.prepare('DELETE FROM leave_requests WHERE id=?').run(req.params.id); if(!result.changes) return res.status(404).json({error:'Pengajuan izin tidak ditemukan'}); res.json({ok:true}); } catch(e) { res.status(400).json({error:e.message}); } });

app.get('/api/payroll/settings', isAuthenticated, (req, res) => { const year=Number(req.query.year||new Date().getFullYear()); let row=db.prepare('SELECT * FROM payroll_settings WHERE year=?').get(year); if(!row){ db.prepare('INSERT OR IGNORE INTO payroll_settings(year) VALUES(?)').run(year); row=db.prepare('SELECT * FROM payroll_settings WHERE year=?').get(year); } res.json(row); });
app.put('/api/payroll/settings/:year', isAuthenticated, (req, res) => { const year=Number(req.params.year); try { db.prepare(`INSERT INTO payroll_settings (year,bpjs_health_employee_rate,bpjs_health_wage_cap,jht_employee_rate,jp_employee_rate,jp_wage_cap,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(year) DO UPDATE SET bpjs_health_employee_rate=excluded.bpjs_health_employee_rate,bpjs_health_wage_cap=excluded.bpjs_health_wage_cap,jht_employee_rate=excluded.jht_employee_rate,jp_employee_rate=excluded.jp_employee_rate,jp_wage_cap=excluded.jp_wage_cap,updated_at=CURRENT_TIMESTAMP`).run(year,Number(req.body.bpjs_health_employee_rate||1),Number(req.body.bpjs_health_wage_cap||12000000),Number(req.body.jht_employee_rate||2),Number(req.body.jp_employee_rate||1),Number(req.body.jp_wage_cap||10547400)); res.json({ok:true}); } catch(e){res.status(400).json({error:e.message});} });
app.get('/api/payroll/periods', isAuthenticated, (req, res) => res.json(db.prepare('SELECT p.*,COUNT(r.id) records_count FROM payroll_periods p LEFT JOIN payroll_records r ON r.payroll_period_id=p.id GROUP BY p.id ORDER BY p.start_date DESC').all()));
app.post('/api/payroll/periods', isAuthenticated, (req, res) => { const x=req.body; try { if(!x.name||!x.start_date||!x.end_date||x.end_date<x.start_date) return res.status(400).json({error:'Nama dan rentang periode payroll wajib benar'}); const result=db.prepare('INSERT INTO payroll_periods (name,start_date,end_date,created_by) VALUES (?,?,?,?)').run(x.name,x.start_date,x.end_date,req.session.user.id); res.status(201).json({id:result.lastInsertRowid}); } catch(e){res.status(400).json({error:e.message});} });
app.post('/api/payroll/periods/:id/calculate', isAuthenticated, (req, res) => {
  const period=db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(req.params.id); if(!period) return res.status(404).json({error:'Periode payroll tidak ditemukan'});
  const year=Number(period.end_date.slice(0,4)); const setting=db.prepare('SELECT * FROM payroll_settings WHERE year=?').get(year)||{bpjs_health_employee_rate:1,bpjs_health_wage_cap:12000000,jht_employee_rate:2,jp_employee_rate:1,jp_wage_cap:10547400};
  const employees=db.prepare('SELECT * FROM employees WHERE is_active=1 ORDER BY name').all(); const upsert=db.prepare(`INSERT INTO payroll_records (payroll_period_id,employee_id,base_salary,gross_salary,unpaid_leave_deduction,bpjs_health_employee,jht_employee,jp_employee,pph21,net_salary) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(payroll_period_id,employee_id) DO UPDATE SET base_salary=excluded.base_salary,gross_salary=excluded.gross_salary,unpaid_leave_deduction=excluded.unpaid_leave_deduction,bpjs_health_employee=excluded.bpjs_health_employee,jht_employee=excluded.jht_employee,jp_employee=excluded.jp_employee,pph21=excluded.pph21,net_salary=excluded.net_salary`);
  const days=[]; for(let cursor=new Date(`${period.start_date}T00:00:00Z`),end=new Date(`${period.end_date}T00:00:00Z`);cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){if(cursor.getUTCDay()!==0&&cursor.getUTCDay()!==6)days.push(cursor.toISOString().slice(0,10));}
  const calculate=db.transaction(()=>{for(const employee of employees){const base=Number(employee.base_salary||0);const unpaid=db.prepare(`SELECT COALESCE(SUM(r.total_days),0) days FROM leave_requests r JOIN leave_types t ON t.id=r.leave_type_id WHERE r.employee_id=? AND r.status='approved' AND t.is_paid=0 AND r.end_date>=? AND r.start_date<=?`).get(employee.id,period.start_date,period.end_date).days;const unpaidDeduction=Math.round((base/Math.max(1,days.length))*Number(unpaid));const health=Math.round(Math.min(base,setting.bpjs_health_wage_cap)*Number(setting.bpjs_health_employee_rate||0)/100);const jht=Math.round(base*Number(setting.jht_employee_rate||0)/100);const jp=Math.round(Math.min(base,setting.jp_wage_cap)*Number(setting.jp_employee_rate||0)/100);const gross=base;const pph=Math.round(gross*Number(employee.pph21_rate||0)/100);const net=Math.max(0,gross-unpaidDeduction-health-jht-jp-pph);upsert.run(period.id,employee.id,base,gross,unpaidDeduction,health,jht,jp,pph,net);}}); calculate(); db.prepare("UPDATE payroll_periods SET status='calculated' WHERE id=?").run(period.id); res.json({ok:true,employees:employees.length});
});
app.get('/api/payroll/periods/:id/records', isAuthenticated, (req, res) => res.json(db.prepare('SELECT r.*,e.nik,e.name FROM payroll_records r JOIN employees e ON e.id=r.employee_id WHERE r.payroll_period_id=? ORDER BY e.name').all(req.params.id)));

app.get('/api/devices', isAuthenticated, (req, res) => res.json(db.prepare('SELECT id,serial_number,name,location,model,provider,external_id,api_url,machine_port,status,last_seen_at,last_sync_at,is_active,created_at FROM devices ORDER BY name').all()));
app.post('/api/devices', isAuthenticated, (req, res) => { const x=req.body; try { const r=db.prepare('INSERT INTO devices (serial_number,name,location,model,provider,external_id,api_url,machine_port,api_token) VALUES (?,?,?,?,?,?,?,?,?)').run(x.serial_number,x.name,x.location||null,x.model||null,x.provider||'solution',x.external_id||null,x.api_url||null,Number(x.machine_port||4370),encrypt(x.api_token)); res.status(201).json({id:r.lastInsertRowid}); } catch(e) { res.status(400).json({error:e.message}); } });
app.put('/api/devices/:id', isAuthenticated, (req, res) => { const x=req.body; try { const result=db.prepare('UPDATE devices SET serial_number=?,name=?,location=?,model=?,external_id=?,api_url=?,machine_port=?,is_active=? WHERE id=?').run(x.serial_number,x.name,x.location||null,x.model||null,x.external_id||null,x.api_url||null,Number(x.machine_port||4370),x.is_active === false ? 0 : 1,req.params.id); if(!result.changes) return res.status(404).json({error:'Perangkat tidak ditemukan'}); if(x.api_token) db.prepare('UPDATE devices SET api_token=? WHERE id=?').run(encrypt(x.api_token),req.params.id); res.json({ok:true}); } catch(e) { res.status(400).json({error:e.message}); } });
app.delete('/api/devices/:id', isAuthenticated, (req, res) => { try { const result=db.prepare('DELETE FROM devices WHERE id=?').run(req.params.id); if(!result.changes) return res.status(404).json({error:'Perangkat tidak ditemukan'}); res.json({ok:true}); } catch(e) { res.status(400).json({error:e.message}); } });
app.post('/api/devices/:id/test', isAuthenticated, async (req, res) => {
  const d = db.prepare('SELECT * FROM devices WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  if (d.api_url) {
    try {
      const result = await directMachine.testConnection(d);
      db.prepare("UPDATE devices SET status='online', last_seen_at=CURRENT_TIMESTAMP WHERE id=?").run(d.id);
      return res.json(result);
    } catch (error) {
      db.prepare("UPDATE devices SET status='offline' WHERE id=?").run(d.id);
      return res.status(502).json({ error: `Koneksi ${directMachine.hostFromDevice(d)}:${d.machine_port || 4370} gagal: ${error.message}` });
    }
  }
  const lastSeen = d.last_seen_at ? Date.parse(`${d.last_seen_at}Z`) : NaN;
  const connected = Number.isFinite(lastSeen) && (Date.now() - lastSeen) < 5 * 60 * 1000;
  return res.json({ ok: connected, connected, status: connected ? 'online' : 'offline', last_seen_at: d.last_seen_at, message: connected ? 'Mesin terakhir terhubung.' : 'Belum ada koneksi ADMS dari mesin.' });
});
app.post('/api/devices/:id/sync', isAuthenticated, async (req, res) => {
  const d = db.prepare('SELECT * FROM devices WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Perangkat tidak ditemukan' });
  if (d.api_url) {
    try { return res.json(await machineSync.syncDevice(d)); }
    catch (error) { return res.status(502).json({ error: `Sinkronisasi gagal: ${error.message}` }); }
  }
  return res.status(400).json({ error: 'Isi IP mesin terlebih dahulu, atau gunakan mode ADMS.' });
});

app.get('/api/attendance', isAuthenticated, (req, res) => { const to=String(req.query.to||new Date().toISOString().slice(0,10)); const fallbackFrom=new Date(`${to}T00:00:00Z`); fallbackFrom.setUTCDate(fallbackFrom.getUTCDate()-29); const from=String(req.query.from||fallbackFrom.toISOString().slice(0,10)); const rows=db.prepare(`SELECT da.*,e.nik,e.employee_code,e.name,e.department,s.name shift_name FROM daily_attendance da JOIN employees e ON e.id=da.employee_id LEFT JOIN shifts s ON s.id=COALESCE(da.shift_id,e.shift_id) WHERE da.attendance_date BETWEEN ? AND ? ORDER BY da.attendance_date DESC,e.name`).all(from,to); res.json(rows); });
app.get('/api/attendance/logs', isAuthenticated, (req, res) => res.json(db.prepare(`SELECT a.*,e.name employee_name,d.name device_name FROM attendance_logs a LEFT JOIN employees e ON e.id=a.employee_id LEFT JOIN devices d ON d.id=a.device_id ORDER BY a.scanned_at DESC LIMIT 200`).all()));
app.put('/api/attendance/:id', isAuthenticated, (req, res) => { const x=req.body; try { const result=db.prepare('UPDATE daily_attendance SET attendance_date=?,check_in=?,check_out=?,status=?,late_minutes=?,work_minutes=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(x.attendance_date,x.check_in||null,x.check_out||null,x.status||'hadir',Number(x.late_minutes||0),Number(x.work_minutes||0),x.notes||null,req.params.id); if(!result.changes) return res.status(404).json({error:'Data absensi tidak ditemukan'}); res.json({ok:true}); } catch(e) { res.status(400).json({error:e.message}); } });
app.delete('/api/attendance/:id', isAuthenticated, (req, res) => { try { const result=db.prepare('DELETE FROM daily_attendance WHERE id=?').run(req.params.id); if(!result.changes) return res.status(404).json({error:'Data absensi tidak ditemukan'}); res.json({ok:true}); } catch(e) { res.status(400).json({error:e.message}); } });

app.post('/api/webhooks/solution', (req, res) => { if(config.solution.webhookSecret && req.get('x-webhook-secret') !== config.solution.webhookSecret) return res.status(401).json({error:'Invalid webhook secret'}); const records=Array.isArray(req.body)?req.body:(req.body.records||req.body.data||[req.body]); try { res.json(ingestMany(records,'solution-cloud-webhook')); } catch(e) { res.status(400).json({error:e.message}); } });

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Terjadi kesalahan pada server.' }); });

if (require.main === module) app.listen(config.port, () => {
  console.log(`${config.appName} berjalan di ${config.appUrl}`);
  machineSync.start();
});
module.exports = app;
