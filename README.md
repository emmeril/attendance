# HadirKu — Manajemen Absensi Multi-Device

Aplikasi absensi berbasis Express.js, SQLite, AdminLTE, dan Alpine.js. Data mesin Solution Finger diterima melalui protokol ADMS/Cloud Data (push realtime) atau webhook.

## Menjalankan

```bash
cp .env.example .env
npm install
npm run seed
npm run dev
```

Buka URL sesuai `APP_URL`. Kredensial awal diambil dari `.env` dan hanya digunakan saat database masih kosong. Ganti password dan seluruh secret sebelum production.

Gunakan Node.js 20 atau lebih baru. Untuk production, isi juga `DATA_ENCRYPTION_KEY`; token perangkat disimpan terenkripsi dengan AES-256-GCM.

## Menjalankan dengan PM2

Konfigurasi production tersedia di `ecosystem.config.cjs` dan berjalan dalam satu proses agar SQLite serta scheduler sinkronisasi tidak dijalankan ganda.

```bash
npm ci --omit=dev
npm run pm2:start
pm2 save
```

Perintah operasional: `npm run pm2:restart`, `npm run pm2:logs`, dan `npm run pm2:stop`.

## Integrasi Solution Cloud / Solution Finger

Solution Cloud publik tidak menyediakan endpoint REST `/api/devices` atau `/api/attendance`. Mesin Solution umumnya memakai protokol ADMS yang mengirim data ke server. Aplikasi ini menyediakan endpoint kompatibel ADMS di `/iclock`.

1. Pastikan `APP_URL` berisi alamat yang dapat dijangkau mesin (contoh `http://192.168.2.40:3200` untuk satu LAN, atau domain publik bila mesin berada di lokasi berbeda).
2. Pada mesin, buka menu **ADMS / Cloud Data**, pilih URL server, isi hostname/IP dari `APP_URL` tanpa `/iclock` dan port aplikasi, lalu aktifkan realtime. Firmware akan menambahkan path `/iclock` sendiri.
3. Daftarkan serial mesin di menu **Perangkat Finger**. Jika `SOLUTION_ADMS_AUTO_REGISTER=true`, mesin juga akan dibuat otomatis saat koneksi pertamanya.
4. Tekan **Tes koneksi** setelah mesin melakukan sinkronisasi. Status berubah online ketika mesin mengakses `/iclock/cdata`.

Format ADMS `ATTLOG` (PIN, waktu, status, verifikasi) diterjemahkan otomatis ke `attendance_logs` dan rekap harian.

- **Webhook:** arahkan vendor ke `POST /api/webhooks/solution`, dengan header `x-webhook-secret`.
- **Pull:** daftarkan perangkat pada menu Perangkat Finger, lalu gunakan tombol Tes koneksi dan Sinkronkan.
- **Multi-device:** serial perangkat disimpan di setiap log, dan deduplikasi memakai kombinasi serial + user + waktu scan.

Jika vendor memakai format payload khusus, sesuaikan normalizer di `src/services/attendance-service.js` atau endpoint adapter di `src/services/solution-cloud.js`.

> Koneksi live memerlukan kredensial API, path endpoint, dan contoh payload resmi dari akun Solution Cloud Anda. Website publik vendor tidak mengekspos kontrak API akun, sehingga nilai tersebut sengaja dijadikan konfigurasi dan tidak di-hardcode.
