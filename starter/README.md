# PlanForge Starter — Next.js Fullstack (original)

Fondasi siap pakai supaya AI coding agent TIDAK membangun ulang dari nol.
Stack terkunci: Next.js 15 (App Router) + React 19, Route Handlers (Node.js),
PostgreSQL (pg), auth session cookie + scrypt, Docker, test `node --test`.

## Sudah ada (jangan bangun ulang)
- Kerangka App Router: halaman publik, /login, /dashboard (terproteksi).
- Koneksi PostgreSQL + migrasi schema: users, sessions, items.
- Auth: POST /api/auth/login, /api/auth/logout, GET /api/auth/me; middleware proteksi /dashboard.
- Contoh CRUD terlindungi: GET/POST /api/items.
- Dockerfile + docker-compose (app + db).
- Test lib murni: test/auth.test.mjs, test/validate.test.mjs.

## Jalankan lokal
1. `npm install`
2. Salin `.env.example` ke `.env.local`, isi `DATABASE_URL` (PostgreSQL harus jalan).
3. `npm run migrate`  (buat tabel)
4. `npm run seed`     (buat user owner; atur SEED_EMAIL/SEED_PASSWORD bila mau)
5. `npm run dev`      → http://localhost:3000
6. `npm test`         (test lib murni, tanpa DB)

## Jalankan lewat Docker
`docker compose up --build`  → app :3000, db :5432.
Lalu migrasi+seed sekali: `docker compose exec app npm run migrate && docker compose exec app npm run seed`.

## Menambah fitur (delta)
Tambah halaman/route/tabel DI ATAS fond ini. Jangan mengganti auth, koneksi DB,
kerangka app, Docker, atau setup test kecuali diminta eksplisit.