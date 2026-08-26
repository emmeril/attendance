function attendanceApp() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  return {
    section: 'overview', date: today, from: today, to: today,
    stats: {}, recent: [], attendance: [], employees: [], devices: [], shifts: [], toast: '', employeeModal: false, deviceModal: false, shiftModal: false, editingEmployee: null,
    queries: { recent:'', attendance:'', employees:'', shifts:'', devices:'' },
    filters: { recent:'', attendance:'', employees:'', shifts:'', devices:'' },
    pages: { recent:1, attendance:1, employees:1, shifts:1, devices:1 },
    perPage: { recent:5, attendance:10, employees:25, shifts:10, devices:6 },
    employeeForm: { employee_code:'', name:'', department:'', position:'', shift_id:'', device_user_id:'' },
    deviceForm: { serial_number:'', name:'', location:'', model:'', external_id:'', api_url:'', machine_port:4370, api_token:'' },
    shiftForm: { name:'', start_time:'08:00', end_time:'17:00', late_tolerance_minutes:10, work_days:'1,2,3,4,5' },
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
    changePage(type, items, direction) { this.pages[type]=Math.min(this.pageCount(type,items),Math.max(1,this.pages[type]+direction)); },
    rangeText(type, items) { const total=this.filteredData(type,items).length; if(!total) return 'Tidak ada data'; const start=(this.pages[type]-1)*this.perPage[type]+1; const end=Math.min(start+this.perPage[type]-1,total); return `${start}-${end} dari ${total} data`; },
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
    formatDate(value) { if (!value) return '-'; return new Date(value).toLocaleString('id-ID', { dateStyle:'short', timeStyle:'short' }); },
    workDays(value) { const names=['Min','Sen','Sel','Rab','Kam','Jum','Sab']; return String(value||'').split(',').map(day=>names[Number(day)]).filter(Boolean).join(', '); },
    notify(message) { this.toast=message; setTimeout(()=>this.toast='', 3500); }
  };
}
