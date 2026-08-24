# HadirKu — Manajemen Absensi Multi-Device

Aplikasi absensi berbasis Express.js, SQLite, AdminLTE, dan Alpine.js. Data dari banyak mesin Solution Finger dapat masuk melalui webhook atau ditarik secara berkala menggunakan adapter REST Solution Cloud.

## Menjalankan

```bash
copy .env.example .env
npm install
npm run seed
npm run dev
```

Buka `http://localhost:3000`. Kredensial awal diambil dari `.env` (default `admin@attendance.local` / `admin123`). Ganti password dan `SESSION_SECRET` sebelum production.

Gunakan Node.js 20 atau lebih baru. Untuk production, isi juga `DATA_ENCRYPTION_KEY`; token perangkat disimpan terenkripsi dengan AES-256-GCM.

## Integrasi Solution Cloud / Solution Finger

Endpoint tiap akun Solution Cloud dapat berbeda. Isi `SOLUTION_BASE_URL`, `SOLUTION_API_KEY`, path perangkat dan path attendance di `.env` sesuai dokumentasi/vendor Anda. Format records yang diterima adapter mencakup `employee_code` (atau `pin`/`user_id`), `device_serial` (atau `sn`), dan `scanned_at` (atau `timestamp`).

- **Webhook:** arahkan vendor ke `POST /api/webhooks/solution`, dengan header `x-webhook-secret`.
- **Pull:** daftarkan perangkat pada menu Perangkat Finger, lalu gunakan tombol Tes koneksi dan Sinkronkan.
- **Multi-device:** serial perangkat disimpan di setiap log, dan deduplikasi memakai kombinasi serial + user + waktu scan.

Jika vendor memakai format payload khusus, sesuaikan normalizer di `src/services/attendance-service.js` atau endpoint adapter di `src/services/solution-cloud.js`.

> Koneksi live memerlukan kredensial API, path endpoint, dan contoh payload resmi dari akun Solution Cloud Anda. Website publik vendor tidak mengekspos kontrak API akun, sehingga nilai tersebut sengaja dijadikan konfigurasi dan tidak di-hardcode.
