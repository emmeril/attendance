function attendanceApp() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const dateOffset = (days) => { const date = new Date(`${today}T00:00:00+07:00`); date.setDate(date.getDate() - days); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date); };
  return {
    section: localStorage.getItem('hadirku.active-section') || 'overview', date: today, from: dateOffset(29), to: today, attendanceRange: '30',
    sidebarCollapsed: localStorage.getItem('hadirku.sidebar-collapsed') === 'true', mobileSidebarOpen: false,
    stats: {}, recent: [], attendance: [], employees: [], devices: [], shifts: [], leaves: [], leaveTypes: [], holidays: [], holidayYear:Number(today.slice(0,4)), payrollPeriods: [], payrollRecords: [], payrollSettings: {}, selectedPayrollPeriod:'', toast: '', attendanceLoading: false, employeeModal: false, deviceModal: false, shiftModal: false, attendanceModal: false, leaveModal: false, payrollPeriodModal: false, holidayModal: false, editingEmployee: null, editingShift: null, editingDevice: null, editingAttendance: null, editingHoliday: null,
    queries: { recent:'', attendance:'', employees:'', shifts:'', devices:'', leaves:'', payroll:'' },
    filters: { recent:'', attendance:'', employees:'', shifts:'', devices:'', leaves:'', payroll:'' },
    pages: { recent:1, attendance:1, employees:1, shifts:1, devices:1, leaves:1, payroll:1 },
    perPage: { recent:5, attendance:10, employees:25, shifts:10, devices:6, leaves:10, payroll:10 },
    employeeForm: { nik:'', name:'', department:'', position:'', shift_id:'', device_user_id:'', base_salary:0, tax_status:'TK/0', pph21_rate:0, bpjs_health_number:'', bpjs_employment_number:'', machine_mappings:{} },
    deviceForm: { serial_number:'', name:'', location:'', model:'', external_id:'', api_url:'', machine_port:4370, api_token:'' },
    shiftForm: { name:'', start_time:'08:00', end_time:'17:00', check_in_start:'07:00', check_in_end:'09:00', check_out_start:'15:00', check_out_end:'18:00', late_tolerance_minutes:10, work_days:'1,2,3,4,5' }, shiftDays: ['1','2','3','4','5'],
    attendanceForm: { id:null, employee_id:'', attendance_date:today, check_in:'', check_out:'', status:'hadir', late_minutes:0, work_minutes:0, notes:'' },
    leaveForm: { employee_id:'', leave_type_id:'', start_date:today, end_date:today, reason:'' }, leaveEmployeeQuery:'',
    payrollPeriodForm: { name:'', payment_date:'', period_mode:'previous_month', start_date:'', end_date:'', adjusted_payment_date:'' },
    holidayForm: { holiday_date:today, name:'', is_working_day:false },
    statCards: [
      { key: 'employees', label: 'Karyawan aktif', icon: 'fa-solid fa-users', color: 'blue' },
      { key: 'hadir', label: 'Hadir hari ini', icon: 'fa-solid fa-circle-check', color: 'green' },
      { key: 'terlambat', label: 'Terlambat', icon: 'fa-solid fa-hourglass-half', color: 'orange' },
      { key: 'belumScan', label: 'Belum scan', icon: 'fa-solid fa-user-xmark', color: 'red' },
      { key: 'devices', label: 'Perangkat', icon: 'fa-solid fa-fingerprint', color: 'violet' }
    ],
    sectionDetails: {
      overview: { label:'Ringkasan', title:'Selamat datang, pantau hari ini.', description:'Lihat kondisi kehadiran dan aktivitas mesin terbaru dalam satu layar.', icon:'fa-chart-pie' },
      attendance: { label:'Data Absensi', title:'Rekap kehadiran harian', description:'Telusuri jam masuk, jam pulang, keterlambatan, dan hasil sinkronisasi mesin.', icon:'fa-calendar-check' },
      employees: { label:'Karyawan', title:'Direktori karyawan', description:'Kelola identitas, penempatan kerja, payroll, dan ID pengguna di setiap mesin.', icon:'fa-users' },
      shifts: { label:'Jam Kerja', title:'Pola dan jadwal kerja', description:'Atur rentang scan, toleransi keterlambatan, serta hari kerja tim.', icon:'fa-clock' },
      leaves: { label:'Izin', title:'Pengajuan izin karyawan', description:'Tinjau pengajuan, periode cuti, dan status persetujuan dengan lebih cepat.', icon:'fa-file-signature' },
      payroll: { label:'Payroll', title:'Perhitungan payroll', description:'Hitung draft gaji berdasarkan kehadiran, BPJS, pajak, dan potongan.', icon:'fa-money-check-dollar' },
      devices: { label:'Perangkat Finger', title:'Jaringan perangkat absensi', description:'Pantau koneksi, uji perangkat, dan tarik data langsung dari mesin fingerprint.', icon:'fa-fingerprint' }
    },
    currentSection() { return this.sectionDetails[this.section] || this.sectionDetails.overview; },
    navigate(value) { this.section=value; this.mobileSidebarOpen=false; window.scrollTo({top:0,behavior:'smooth'}); },
    toggleSidebar() {
      if(window.matchMedia('(max-width: 991.98px)').matches) { this.mobileSidebarOpen=!this.mobileSidebarOpen; return; }
      this.sidebarCollapsed=!this.sidebarCollapsed;
      localStorage.setItem('hadirku.sidebar-collapsed', String(this.sidebarCollapsed));
    },
    uniqueValues(items, key) { return [...new Set(items.map(item=>String(item[key]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id')); },
    leaveEmployeeOptions() { const query=String(this.leaveEmployeeQuery||'').trim().toLowerCase(); return this.employees.filter(employee=>!query || `${employee.nik||''} ${employee.name||''}`.toLowerCase().includes(query)).slice(0,8); },
    chooseLeaveEmployee(employee) { this.leaveForm.employee_id=employee.id; this.leaveEmployeeQuery=`${employee.nik || ''} - ${employee.name}`; },
    filteredData(type, items) {
      const query=String(this.queries[type]||'').trim().toLowerCase();
      const filter=String(this.filters[type]||'');
      return items.filter(item=>{
        const matchesQuery=!query || Object.values(item).some(value=>String(value??'').toLowerCase().includes(query));
        let matchesFilter=true;
        if(type==='recent' && filter) matchesFilter=String(item.device_name||item.device_serial||'')===filter;
        if(type==='attendance' && filter) matchesFilter=String(item.status||'')===filter;
        if(type==='employees' && filter) matchesFilter=String(item.department||'')===filter;
        if(type==='shifts' && filter) matchesFilter=filter==='pagi' ? String(item.start_time||'')<'12:00' : String(item.start_time||'')>='12:00';
        if(type==='devices' && filter) matchesFilter=String(item.status||'offline')===filter;
        if(type==='leaves' && filter) matchesFilter=String(item.status||'pending')===filter;
        if(type==='payroll' && filter==='absence') matchesFilter=Number(item.absence_days||0)>0;
        if(type==='payroll' && filter==='late') matchesFilter=Number(item.late_minutes_total||0)>0;
        if(type==='payroll' && filter==='complete') matchesFilter=Number(item.scheduled_days||0)>0 && Number(item.attendance_days||0)>=Number(item.scheduled_days||0);
        return matchesQuery && matchesFilter;
      });
    },
    pagedData(type, items) { const filtered=this.filteredData(type,items); const page=Math.min(this.pages[type],Math.max(1,Math.ceil(filtered.length/this.perPage[type]))); const start=(page-1)*this.perPage[type]; return filtered.slice(start,start+this.perPage[type]); },
    pageCount(type, items) { return Math.max(1,Math.ceil(this.filteredData(type,items).length/this.perPage[type])); },
    resetPage(type) { this.pages[type]=1; },
    setAttendanceRange(range) { this.attendanceRange=String(range); if(range==='custom') return; if(range==='all') { this.from='2000-01-01'; this.to=today; } else { this.from=dateOffset(Number(range)-1); this.to=today; } this.pages.attendance=1; this.loadAttendance(); },
    applyAttendanceDates() { this.attendanceRange='custom'; this.pages.attendance=1; this.loadAttendance(); },
    changePage(type, items, direction) { this.pages[type]=Math.min(this.pageCount(type,items),Math.max(1,this.pages[type]+direction)); },
    rangeText(type, items) { const total=this.filteredData(type,items).length; if(!total) return 'Tidak ada data'; const start=(this.pages[type]-1)*this.perPage[type]+1; const end=Math.min(start+this.perPage[type]-1,total); return `${start}-${end} dari ${total} data`; },
    async request(url, options = {}) { const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Permintaan gagal'); return data; },
    async init() { this.$watch('section', value => localStorage.setItem('hadirku.active-section', value)); localStorage.setItem('hadirku.active-section', this.section); window.addEventListener('resize',()=>{ if(window.innerWidth>991) this.mobileSidebarOpen=false; }); this.preparePayrollPeriod(); await Promise.all([this.loadDashboard(), this.loadAttendance(), this.loadEmployees(), this.loadDevices(), this.loadShifts(), this.loadLeaves(), this.loadLeaveTypes(), this.loadPayroll()]); },
    async loadDashboard() { try { const data = await this.request(`/api/dashboard?date=${this.date}`); this.stats=data.stats; this.recent=data.recent; } catch(e) { this.notify(e.message); } },
    async loadAttendance() {
      if(!this.from || !this.to) return;
      if(this.from > this.to) { this.attendance=[]; this.notify('Tanggal mulai tidak boleh setelah tanggal akhir.'); return; }
      this.attendanceLoading=true;
      try {
        this.attendance=await this.request(`/api/attendance?from=${encodeURIComponent(this.from)}&to=${encodeURIComponent(this.to)}`);
        this.pages.attendance=1;
      } catch(e) { this.notify(e.message); }
      finally { this.attendanceLoading=false; }
    },
    async loadEmployees() { try { this.employees=await this.request('/api/employees'); } catch(e) { this.notify(e.message); } },
    async loadDevices() { try { this.devices=await this.request('/api/devices'); } catch(e) { this.notify(e.message); } },
    async loadShifts() { try { this.shifts=await this.request('/api/shifts'); } catch(e) { this.notify(e.message); } },
    async loadLeaveTypes() { try { this.leaveTypes=await this.request('/api/leave-types'); } catch(e) { this.notify(e.message); } },
    async loadLeaves() { try { this.leaves=await this.request('/api/leaves'); } catch(e) { this.notify(e.message); } },
    async submitLeave() { try { if(!this.leaveForm.employee_id) throw new Error('Pilih karyawan dari hasil pencarian.'); await this.request('/api/leaves',{method:'POST',body:JSON.stringify(this.leaveForm)}); this.leaveModal=false; this.leaveForm={employee_id:'',leave_type_id:'',start_date:today,end_date:today,reason:''}; this.leaveEmployeeQuery=''; await this.loadLeaves(); this.notify('Pengajuan izin disimpan.'); } catch(e) { this.notify(e.message); } },
    async setLeaveStatus(row,status) { try { await this.request(`/api/leaves/${row.id}/status`,{method:'PUT',body:JSON.stringify({status})}); await this.loadLeaves(); this.notify(status==='approved'?'Izin disetujui.':'Izin ditolak.'); } catch(e) { this.notify(e.message); } },
    async loadPayroll() { try { [this.payrollPeriods,this.payrollSettings,this.holidays]=await Promise.all([this.request('/api/payroll/periods'),this.request(`/api/payroll/settings?year=${this.holidayYear}`),this.request(`/api/holidays?year=${this.holidayYear}`)]); if(this.selectedPayrollPeriod) await this.loadPayrollRecords(); } catch(e) { this.notify(e.message); } },
    async loadPayrollRecords() { this.pages.payroll=1; if(!this.selectedPayrollPeriod) { this.payrollRecords=[]; return; } try { this.payrollRecords=await this.request(`/api/payroll/periods/${this.selectedPayrollPeriod}/records`); } catch(e) { this.notify(e.message); } },
    selectedPeriod() { return this.payrollPeriods.find(period=>String(period.id)===String(this.selectedPayrollPeriod)) || null; },
    payrollStatusLabel(status) { return ({draft:'Draft',calculated:'Sudah dihitung',locked:'Terkunci',paid:'Sudah dibayar'})[status] || status; },
    defaultPaymentDate() { const base=new Date(`${today}T00:00:00Z`); const day=Math.min(31,Math.max(1,Number(this.payrollSettings.payday_day||10))); if(base.getUTCDate()>=day) base.setUTCMonth(base.getUTCMonth()+1); const maxDay=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,0)).getUTCDate(); base.setUTCDate(Math.min(day,maxDay)); return base.toISOString().slice(0,10); },
    async preparePayrollPeriod() { const payment=this.defaultPaymentDate(); this.payrollPeriodForm={name:'Payroll '+payment.slice(0,7),payment_date:payment,period_mode:this.payrollSettings.period_mode||'previous_month',start_date:'',end_date:'',adjusted_payment_date:''}; await this.previewPayrollPeriod(); },
    async previewPayrollPeriod() { if(!this.payrollPeriodForm.payment_date) return; if(this.payrollPeriodForm.period_mode==='manual') return; try { const preview=await this.request(`/api/payroll/preview?payment_date=${encodeURIComponent(this.payrollPeriodForm.payment_date)}&period_mode=${encodeURIComponent(this.payrollPeriodForm.period_mode)}`); this.payrollPeriodForm.start_date=preview.start_date||''; this.payrollPeriodForm.end_date=preview.end_date||''; this.payrollPeriodForm.adjusted_payment_date=preview.adjusted_payment_date||''; if(!this.payrollPeriodForm.name) this.payrollPeriodForm.name='Payroll '+this.payrollPeriodForm.payment_date.slice(0,7); } catch(e) { this.notify(e.message); } },
    async createPayrollPeriod() { try { const result=await this.request('/api/payroll/periods',{method:'POST',body:JSON.stringify(this.payrollPeriodForm)}); this.payrollPeriodModal=false; this.payrollPeriods=await this.request('/api/payroll/periods'); this.selectedPayrollPeriod=String(result.id); await this.loadPayrollRecords(); this.notify('Periode payroll dibuat.'); } catch(e) { this.notify(e.message); } },
    async calculatePayroll() { try { await this.request(`/api/payroll/periods/${this.selectedPayrollPeriod}/calculate`,{method:'POST'}); await this.loadPayroll(); await this.loadPayrollRecords(); this.notify('Payroll draft berhasil dihitung.'); } catch(e) { this.notify(e.message); } },
    async setPayrollStatus(status) { const period=this.selectedPeriod(); if(!period) return; if(['locked','paid'].includes(status)&&!confirm(status==='paid'?'Tandai payroll ini sudah dibayar?':'Kunci payroll agar tidak dapat dihitung ulang?')) return; try { await this.request(`/api/payroll/periods/${period.id}/status`,{method:'PUT',body:JSON.stringify({status})}); await this.loadPayroll(); this.notify(status==='paid'?'Payroll ditandai sudah dibayar.':'Status payroll diperbarui.'); } catch(e) { this.notify(e.message); } },
    async savePayrollSettings() { try { await this.request(`/api/payroll/settings/${this.payrollSettings.year}`,{method:'PUT',body:JSON.stringify(this.payrollSettings)}); await this.loadPayroll(); this.notify('Aturan payroll disimpan.'); } catch(e) { this.notify(e.message); } },
    async loadHolidays() { try { this.holidays=await this.request(`/api/holidays?year=${this.holidayYear}`); } catch(e) { this.notify(e.message); } },
    async saveHoliday() { try { const editing=Boolean(this.editingHoliday); await this.request(editing?`/api/holidays/${this.editingHoliday.id}`:'/api/holidays',{method:editing?'PUT':'POST',body:JSON.stringify(this.holidayForm)}); this.holidayModal=false; this.editingHoliday=null; this.holidayForm={holiday_date:today,name:'',is_working_day:false}; await this.loadHolidays(); this.notify(editing?'Hari libur diperbarui.':'Hari libur ditambahkan.'); } catch(e) { this.notify(e.message); } },
    editHoliday(row) { this.editingHoliday=row; this.holidayForm={holiday_date:row.holiday_date,name:row.name,is_working_day:Boolean(row.is_working_day)}; this.holidayModal=true; },
    async deleteHoliday(row) { if(!confirm(`Hapus hari libur ${row.name}?`)) return; try { await this.request(`/api/holidays/${row.id}`,{method:'DELETE'}); await this.loadHolidays(); this.notify('Hari libur dihapus.'); } catch(e) { this.notify(e.message); } },
    formatMoney(value) { return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value||0)); },
    formatLongDate(value) { if(!value) return ''; return new Date(`${value}T00:00:00+07:00`).toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); },
    async saveEmployee() { try { const editing=Boolean(this.editingEmployee); await this.request(editing?`/api/employees/${this.editingEmployee.id}`:'/api/employees',{method:editing?'PUT':'POST',body:JSON.stringify(this.employeeForm)}); this.employeeModal=false; this.editingEmployee=null; this.employeeForm={nik:'',name:'',department:'',position:'',shift_id:'',device_user_id:'',base_salary:0,tax_status:'TK/0',pph21_rate:0,bpjs_health_number:'',bpjs_employment_number:'',machine_mappings:{}}; await Promise.all([this.loadEmployees(),this.loadDashboard()]); this.notify(editing?'Karyawan diperbarui.':'Karyawan berhasil disimpan.'); } catch(e) { this.notify(e.message); } },
    async editEmployee(row) { this.editingEmployee=row; const mappings=await this.request(`/api/employees/${row.id}/mappings`).catch(()=>({})); this.employeeForm={nik:row.nik||'',name:row.name||'',department:row.department||'',position:row.position||'',shift_id:row.shift_id||'',device_user_id:row.device_user_id||'',base_salary:row.base_salary||0,tax_status:row.tax_status||'TK/0',pph21_rate:row.pph21_rate||0,bpjs_health_number:row.bpjs_health_number||'',bpjs_employment_number:row.bpjs_employment_number||'',machine_mappings:mappings}; this.employeeModal=true; },
    async deleteEmployee(row) { if(!confirm(`Hapus karyawan ${row.name}?`)) return; try { await this.request(`/api/employees/${row.id}`,{method:'DELETE'}); await Promise.all([this.loadEmployees(),this.loadDashboard()]); this.notify('Karyawan dihapus.'); } catch(e) { this.notify(e.message); } },
    async saveShift() { try { const editing=Boolean(this.editingShift); if(!this.shiftForm.start_time || !this.shiftForm.end_time) throw new Error('Jam masuk dan jam pulang wajib diisi.'); if(!this.shiftDays.length) throw new Error('Pilih minimal satu hari kerja.'); const payload={...this.shiftForm,work_days:this.shiftDays.join(',')}; await this.request(editing?`/api/shifts/${this.editingShift.id}`:'/api/shifts',{method:editing?'PUT':'POST',body:JSON.stringify(payload)}); this.shiftModal=false; this.editingShift=null; this.shiftForm={name:'',start_time:'08:00',end_time:'17:00',check_in_start:'07:00',check_in_end:'09:00',check_out_start:'15:00',check_out_end:'18:00',late_tolerance_minutes:10,work_days:'1,2,3,4,5'}; this.shiftDays=['1','2','3','4','5']; await this.loadShifts(); this.notify(editing?'Jam kerja diperbarui.':'Jam kerja berhasil disimpan.'); } catch(e) { this.notify(e.message); } },
    editShift(row) { this.editingShift=row; this.shiftForm={name:row.name||'',start_time:row.start_time||'08:00',end_time:row.end_time||'17:00',check_in_start:row.check_in_start||row.start_time||'08:00',check_in_end:row.check_in_end||row.start_time||'08:00',check_out_start:row.check_out_start||row.end_time||'17:00',check_out_end:row.check_out_end||row.end_time||'17:00',late_tolerance_minutes:row.late_tolerance_minutes||0,work_days:row.work_days||'1,2,3,4,5'}; this.shiftDays=String(row.work_days||'').split(',').filter(Boolean); this.shiftModal=true; },
    async deleteShift(row) { if(!confirm(`Hapus jam kerja ${row.name}?`)) return; try { await this.request(`/api/shifts/${row.id}`,{method:'DELETE'}); await Promise.all([this.loadShifts(),this.loadEmployees()]); this.notify('Jam kerja dihapus.'); } catch(e) { this.notify(e.message); } },
    async saveDevice() { try { const editing=Boolean(this.editingDevice); await this.request(editing?`/api/devices/${this.editingDevice.id}`:'/api/devices',{method:editing?'PUT':'POST',body:JSON.stringify(this.deviceForm)}); this.deviceModal=false; this.editingDevice=null; this.deviceForm={serial_number:'',name:'',location:'',model:'',external_id:'',api_url:'',machine_port:4370,api_token:''}; await Promise.all([this.loadDevices(),this.loadDashboard()]); this.notify(editing?'Perangkat diperbarui.':'Perangkat berhasil didaftarkan.'); } catch(e) { this.notify(e.message); } },
    editDevice(row) { this.editingDevice=row; this.deviceForm={serial_number:row.serial_number||'',name:row.name||'',location:row.location||'',model:row.model||'',external_id:row.external_id||'',api_url:row.api_url||'',machine_port:row.machine_port||4370,api_token:''}; this.deviceModal=true; },
    async deleteDevice(row) { if(!confirm(`Hapus perangkat ${row.name}?`)) return; try { await this.request(`/api/devices/${row.id}`,{method:'DELETE'}); await Promise.all([this.loadDevices(),this.loadDashboard()]); this.notify('Perangkat dihapus.'); } catch(e) { this.notify(e.message); } },
    editAttendance(row) { this.editingAttendance=row; this.attendanceForm={id:row.id,employee_id:row.employee_id||'',attendance_date:row.attendance_date||'',check_in:row.check_in?String(row.check_in).slice(0,16):'',check_out:row.check_out?String(row.check_out).slice(0,16):'',status:row.status||'hadir',late_minutes:row.late_minutes||0,work_minutes:row.work_minutes||0,notes:row.notes||''}; this.attendanceModal=true; },
    async saveAttendance() { try { const editing=Boolean(this.editingAttendance); await this.request(editing?`/api/attendance/${this.attendanceForm.id}`:'/api/attendance',{method:editing?'PUT':'POST',body:JSON.stringify(this.attendanceForm)}); this.attendanceModal=false; this.editingAttendance=null; await Promise.all([this.loadAttendance(),this.loadDashboard()]); this.notify(editing?'Data absensi diperbarui.':'Data absensi ditambahkan.'); } catch(e) { this.notify(e.message); } },
    async deleteAttendance(row) { if(!confirm(`Hapus data absensi ${row.name} tanggal ${row.attendance_date}?`)) return; try { await this.request(`/api/attendance/${row.id}`,{method:'DELETE'}); await Promise.all([this.loadAttendance(),this.loadDashboard()]); this.notify('Data absensi dihapus.'); } catch(e) { this.notify(e.message); } },
    async testDevice(device) { try { const result=await this.request(`/api/devices/${device.id}/test`, { method:'POST', body:'{}' }); this.notify(result.message || `${device.name} terhubung.`); await this.loadDevices(); } catch(e) { this.notify(`Koneksi gagal: ${e.message}`); } },
    async syncDevice(device) { try { const result=await this.request(`/api/devices/${device.id}/sync`, { method:'POST', body:JSON.stringify({from:this.from,to:this.to}) }); const userText=result.users ? ` ${result.users.total} pengguna terbaca (${result.users.inserted} baru, ${result.users.updated} diperbarui).` : ''; this.notify(`${result.inserted} log absensi baru.${userText}`); await Promise.all([this.loadDashboard(),this.loadAttendance(),this.loadEmployees()]); } catch(e) { this.notify(`Sinkronisasi gagal: ${e.message}`); } },
    formatDate(value) { if (!value) return '-'; return new Date(value).toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short' }); },
    workDays(value) { const names=['Min','Sen','Sel','Rab','Kam','Jum','Sab']; return String(value||'').split(',').map(day=>names[Number(day)]).filter(Boolean).join(', '); },
    notify(message) { this.toast=message; setTimeout(()=>this.toast='', 3500); }
  };
}
