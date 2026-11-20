/* PlanForge core: metadata starter, aturan kunci, dan entri file starter. */
import { STARTER_FILES } from "planforge:starter";

export function starterMeta(){ try{ return JSON.parse(STARTER_FILES["manifest.json"] || "{}"); }catch(e){ return {}; } }
export function starterAktif(cfg){ return !!(cfg && cfg.starter && STARTER_FILES["manifest.json"]); }
export function starterLockLines(cfg){
  if(!starterAktif(cfg)) return [];
  const m = starterMeta();
  const stack = Object.entries(m.stack || {}).map(([k,v])=>k + ": " + v).join("; ");
  return [
    "STARTER TERPILIH: " + (m.nama || cfg.starter) + " v" + (m.versi || "?") + ". Stack DIKUNCI ke starter: " + stack + ".",
    "Kode fondasi SUDAH ADA; lingkungan target BELUM diperiksa: " + (m.sudahAda || []).join("; ") + ". JANGAN membangun ulang: " + (m.janganBangunUlang || []).join("; ") + ".",
    "template_note WAJIB diisi nama starter ini. Keputusan tech harus cocok dengan stack starter; jangan mengusulkan stack lain.",
    "Rencana = DELTA di atas fondasi: task hanya menambah fitur / mengubah perilaku di atas starter, bukan membuat ulang auth/DB/kerangka/docker/test."
  ];
}
export function starterContractLines(cfg){
  if(!starterAktif(cfg)) return [];
  const pkg = JSON.parse(STARTER_FILES["package.json"]);
  return [
    "KONTRAK STARTER ASLI - package.json scripts: " + JSON.stringify(pkg.scripts),
    "File starter yang benar-benar dikirim (path persis):\n" + Object.keys(STARTER_FILES).filter(f=>f !== "manifest.json").sort().join("\n"),
    "Pakai npm run migrate, BUKAN npm run db:migrate. Pool DB di lib/db.js, bukan lib/db.ts; test bawaan di test/, bukan tests/. File baru boleh dibuat, tapi harus disebut eksplisit dalam files_or_areas task.",
    "Migrasi bawaan hanya menjalankan db/schema.sql lewat scripts/migrate.mjs; BELUM ada runner db/migrations/. Jika butuh migrasi bertahap, rencanakan runner-nya secara eksplisit. Jangan mengaku sudah tersedia.",
    "Script npm baru harus direncanakan eksplisit (nama script + perubahan package.json) sebelum dipakai. Jangan menebak alias script atau melewati verifikasi yang merah.",
    ...saranLingkungan(true)
  ];
}
export function saranLingkungan(starter){
  return starter ? [
    "Prasyarat lingkungan (saran, bukan penahan Connect): kode starter tersedia, tetapi dependency, .env.local, dan PostgreSQL di folder target belum diverifikasi.",
    "Setelah Connect: node worker.mjs doctor --environment (baca saja); node worker.mjs setup-env menyalin .env.example ke .env.local HANYA jika konfigurasi belum ada, tidak menimpa rahasia. Lalu npm install memasang dependency lokal (mengunduh paket dan dapat menjalankan install scripts).",
    "PostgreSQL: gunakan DATABASE_URL milikmu, atau jika Docker sudah terpasang dan pengguna menyetujui layanan lokal, docker compose up -d db. Ini mengunduh image dan membuat volume; hentikan dengan docker compose stop db (data tetap ada). Jangan memasang Docker, membuat cloud DB, atau memakai kredensial tanpa persetujuan.",
    "Jalankan npm run migrate hanya setelah target DB dikonfirmasi: perintah ini mengubah schema. npm run seed opsional untuk DB demo, BUKAN data produksi. Lingkungan belum siap bukan bukti task gagal ataupun selesai; mark_done tetap wajib tes dan pengukuran asli."
  ] : [];
}
export function starterFileEntries(){
  return Object.keys(STARTER_FILES).filter(n=>n !== "manifest.json").map(n=>({ name:n, data:STARTER_FILES[n], starter:true }));
}
