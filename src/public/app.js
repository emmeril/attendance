function attendanceApp() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  return {
    section: 'overview', date: today, from: today, to: today,
    stats: {}, recent: [], attendance: [], employees: [], devices: [], shifts: [], toast: '', employeeModal: false, deviceModal: false, shiftModal: false, editingEmployee: null,
    employeeForm: { employee_code:'', name:'', department:'', position:'', shift_id:'', device_user_id:'' },
    deviceForm: { serial_number:'', name:'', location:'', model:'', external_id:'', api_url:'', machine_port:4370, api_token:'' },
    shiftForm: { name:'', start_time:'08:00', end_time:'17:00', late_tolerance_minutes:10, work_days:'1,2,3,4,5' },
    statCards: [
      { key: 'employees', label: 'Karyawan aktif', icon: 'bi bi-people', color: 'blue' },
      { key: 'hadir', label: 'Hadir hari ini', icon: 'bi bi-check2-circle', color: 'green' },
      { key: 'terlambat', label: 'Terlambat', icon: 'bi bi-hourglass-split', color: 'orange' },
      { key: 'belumScan', label: 'Belum scan', icon: 'bi bi-person-x', color: 'red' },
      { key: 'devices', label: 'Perangkat', icon: 'bi bi-fingerprint', color: 'violet' }
    ],
    async request(url, options = {}) { const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Permintaan gagal'); return data; },
    async init() { await Promise.all([this.loadDashboard(), this.loadAttendance(), this.loadEmployees(), this.loadDevices(), this.loadShifts()]); },
    async loadDashboard() { try { const data = await this.request(`/api/dashboard?date=${this.date}`); this.stats=data.stats; this.recent=data.recent; } catch(e) { this.notify(e.message); } },
    async loadAttendance() { try { this.attendance=await this.request(`/api/attendance?from=${this.from}&to=${this.to}`); } catch(e) { this.notify(e.message); } },
    async loadEmployees() { try { this.employees=await this.request('/api/employees'); } catch(e) { this.notify(e.message); } },
    async loadDevices() { try { this.devices=await this.request('/api/devices'); } catch(e) { this.notify(e.message); } },
    async loadShifts() { try { this.shifts=await this.request('/api/shifts'); } catch(e) { this.notify(e.message); } },
    async saveEmployee() { try { await this.request('/api/employees',{method:'POST',body:JSON.stringify(this.employeeForm)}); this.employeeModal=false; this.employeeForm={employee_code:'',name:'',department:'',position:'',shift_id:'',device_user_id:''}; await Promise.all([this.loadEmployees(),this.loadDashboard()]); this.notify('Karyawan berhasil disimpan.'); } catch(e) { this.notify(e.message); } },
    async saveShift() { try { await this.request('/api/shifts',{method:'POST',body:JSON.stringify(this.shiftForm)}); this.shiftModal=false; this.shiftForm={name:'',start_time:'08:00',end_time:'17:00',late_tolerance_minutes:10,work_days:'1,2,3,4,5'}; await this.loadShifts(); this.notify('Shift berhasil disimpan.'); } catch(e) { this.notify(e.message); } },
    async saveDevice() { try { await this.request('/api/devices',{method:'POST',body:JSON.stringify(this.deviceForm)}); this.deviceModal=false; this.deviceForm={serial_number:'',name:'',location:'',model:'',external_id:'',api_url:'',machine_port:4370,api_token:''}; await Promise.all([this.loadDevices(),this.loadDashboard()]); this.notify('Perangkat berhasil didaftarkan.'); } catch(e) { this.notify(e.message); } },
    async testDevice(device) { try { const result=await this.request(`/api/devices/${device.id}/test`, { method:'POST', body:'{}' }); this.notify(result.message || `${device.name} terhubung.`); await this.loadDevices(); } catch(e) { this.notify(`Koneksi gagal: ${e.message}`); } },
    async syncDevice(device) { try { const result=await this.request(`/api/devices/${device.id}/sync`, { method:'POST', body:JSON.stringify({from:this.from,to:this.to}) }); const userText=result.users ? ` ${result.users.total} pengguna terbaca (${result.users.inserted} baru, ${result.users.updated} diperbarui).` : ''; this.notify(`${result.inserted} log absensi baru.${userText}`); await Promise.all([this.loadDashboard(),this.loadAttendance(),this.loadEmployees()]); } catch(e) { this.notify(`Sinkronisasi gagal: ${e.message}`); } },
    formatDate(value) { if (!value) return '—'; return new Date(value).toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short' }); },
    workDays(value) { const names=['Min','Sen','Sel','Rab','Kam','Jum','Sab']; return String(value||'').split(',').map(day=>names[Number(day)]).filter(Boolean).join(', '); },
    notify(message) { this.toast=message; setTimeout(()=>this.toast='', 3500); }
  };
}
