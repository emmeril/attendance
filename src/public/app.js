function attendanceApp() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const dateOffset = (days) => { const date = new Date(`${today}T00:00:00+07:00`); date.setDate(date.getDate() - days); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date); };
  return {
    section: 'overview', date: today, from: dateOffset(29), to: today, attendanceRange: '30',
    stats: {}, recent: [], attendance: [], employees: [], devices: [], shifts: [], toast: '', attendanceLoading: false, employeeModal: false, deviceModal: false, shiftModal: false, attendanceModal: false, editingEmployee: null, editingShift: null, editingDevice: null, editingAttendance: null,
    queries: { recent:'', attendance:'', employees:'', shifts:'', devices:'' },
    filters: { recent:'', attendance:'', employees:'', shifts:'', devices:'' },
    pages: { recent:1, attendance:1, employees:1, shifts:1, devices:1 },
    perPage: { recent:5, attendance:10, employees:25, shifts:10, devices:6 },
    employeeForm: { nik:'', name:'', department:'', position:'', shift_id:'', device_user_id:'', machine_mappings:{} },
    deviceForm: { serial_number:'', name:'', location:'', model:'', external_id:'', api_url:'', machine_port:4370, api_token:'' },
    shiftForm: { name:'', start_time:'08:00', end_time:'17:00', check_in_start:'07:00', check_in_end:'09:00', check_out_start:'15:00', check_out_end:'18:00', late_tolerance_minutes:10, work_days:'1,2,3,4,5' }, shiftDays: ['1','2','3','4','5'],
    attendanceForm: { id:null, employee_id:'', attendance_date:today, check_in:'', check_out:'', status:'hadir', late_minutes:0, work_minutes:0, notes:'' },
    statCards: [
      { key: 'employees', label: 'Karyawan aktif', icon: 'fa-solid fa-users', color: 'blue' },
      { key: 'hadir', label: 'Hadir hari ini', icon: 'fa-solid fa-circle-check', color: 'green' },
      { key: 'terlambat', label: 'Terlambat', icon: 'fa-solid fa-hourglass-half', color: 'orange' },
      { key: 'belumScan', label: 'Belum scan', icon: 'fa-solid fa-user-xmark', color: 'red' },
      { key: 'devices', label: 'Perangkat', icon: 'fa-solid fa-fingerprint', color: 'violet' }
    ],
    uniqueValues(items, key) { return [...new Set(items.map(item=>String(item[key]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'id')); },
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
    async init() { await Promise.all([this.loadDashboard(), this.loadAttendance(), this.loadEmployees(), this.loadDevices(), this.loadShifts()]); },
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
    async saveEmployee() { try { const editing=Boolean(this.editingEmployee); await this.request(editing?`/api/employees/${this.editingEmployee.id}`:'/api/employees',{method:editing?'PUT':'POST',body:JSON.stringify(this.employeeForm)}); this.employeeModal=false; this.editingEmployee=null; this.employeeForm={nik:'',name:'',department:'',position:'',shift_id:'',device_user_id:'',machine_mappings:{}}; await Promise.all([this.loadEmployees(),this.loadDashboard()]); this.notify(editing?'Karyawan diperbarui.':'Karyawan berhasil disimpan.'); } catch(e) { this.notify(e.message); } },
    async editEmployee(row) { this.editingEmployee=row; const mappings=await this.request(`/api/employees/${row.id}/mappings`).catch(()=>({})); this.employeeForm={nik:row.nik||'',name:row.name||'',department:row.department||'',position:row.position||'',shift_id:row.shift_id||'',device_user_id:row.device_user_id||'',machine_mappings:mappings}; this.employeeModal=true; },
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
