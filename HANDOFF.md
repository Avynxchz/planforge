# HANDOFF — lanjutkan PlanForge

Baca seluruh dokumen ini sebelum bertindak. Ini north star + status + scope jujur + batasan keras.
Dua aturan utama: **jangan bangun ulang yang sudah jadi**, dan **jangan mengejar dinding pihak ketiga seolah itu bug PlanForge**.

---

## 0. North star (tujuan pengguna — jangan melenceng)

PlanForge = pipa pribadi murah (BYOK) yang mengubah **ide -> rencana (AI) -> proyek jadi (agent coding)**,
dengan `worker.mjs` sebagai "mandor" tanpa AI yang menegakkan gerbang / bukti browser / identitas / budget
supaya hasil **benar-benar sesuai rencana** dan biaya terkendali.

Alur impian pengguna (ini yang harus dijaga, bukan dipersulit):

> buka PlanForge -> masukin API key (BYOK) -> pilih model -> klik generate (4 dokumen planning) ->
> Connect (pilih app coding + folder proyek) -> buka agent coding -> tempel SATU trigger prompt -> tinggal tunggu.

**Definisi sukses:** bisa dipakai BERULANG dengan aman, GUI maupun CLI, output sesuai plan.
BUKAN sekadar uji hijau, BUKAN satu pilot yang kebetulan jadi.

Pengguna: builder Indonesia, hemat biaya, pakai model murah BYOK. Paham konsep LLM, tapi lemah di mekanik terminal.
Jadi: langkah GUI point-and-click bernomor, jelaskan perintah shell (arti per baris + cara undo + risiko),
Bahasa Indonesia langsung tapi ramah pemula. Setiap balasan akhir diakhiri heading persis: `Kesimpulan untuk Agus:`.

---

## 1. Apa itu PlanForge (dua fase, dua kunci terpisah)

- **Fase planning (browser, `index.html`):** AI memakai kunci OpenRouter/provider milik pengguna (BYOK) untuk
  menghasilkan 4 dokumen: brief/clarify, PRD, roadmap, tasks. Ini kunci planning.
- **Fase eksekusi (agent coding eksternal):** model AI di aplikasi agen (WorkBuddy/Antigravity/Cursor/dll) yang
  membangun proyek, terhubung lewat MCP. Model & autentikasinya diatur di aplikasi agen, TERPISAH dari kunci planning.
- **`worker.mjs` = mandor tanpa AI.** Bisa jadi: (a) runner CLI yang menyetir agent CLI sendiri dalam loop, atau
  (b) server MCP stdio yang dipanggil agent. Worker menjalankan ulang gerbang + verification + bukti browser sendiri;
  exit code yang masuk ledger, bukan cerita agen. Ia menolak klaim "selesai" tanpa bukti.

8 tool MCP: `plan_status`, `next_task`, `get_task`, `mark_done`, `mark_failed`, `mark_blocked`, `gate_list`, `audit_plan`.
`mark_blocked` (status `terkendala`, BUKAN `gagal`) dipakai agen saat kartu task butuh file/data yang tidak ada
dan membuatnya di luar cakupan task — tercatat di ledger, tidak diserahkan lagi, tidak menghitung kegagalan.

---

## 2. Sumber & status (SUDAH jadi & terbukti — JANGAN dibangun ulang)

- **Sumber canonical: `D:\PROJECTS\planforge`** (`index.html` + `worker.mjs` + `test/`).
  Sudah dipindah dari C: dan terverifikasi **305 uji hijau di lokasi ini**. C: sudah dihapus.
  (Ada mirror verifikasi lama di `D:\TOOLS\pf-probe\foundation-fix` — ABAIKAN, itu bukan canonical.)
- **Worker tertanam di `index.html`** (blob JSON antara `<!-- PF-WORKER-BEGIN -->` / `<!-- PF-WORKER-END -->`).
  Sync WAJIB setelah mengedit worker: `node worker.mjs embed`. Ada uji round-trip (embedded == worker.mjs persis).
- **`AGENT_ADAPTERS` HARUS identik** di `index.html` (web-core, antara CORE-BEGIN/CORE-END) dan `worker.mjs`.
  Ada uji deep-equal. Kontrak file terkunci uji — JANGAN ubah field `file`/`shape`/`rules`:
  - workbuddy -> `.mcp.json` (shape mcpServers, rules AGENTS.md)
  - agy -> `.agents/mcp_config.json` (mcpServers, AGENTS.md)
  - claude -> `.mcp.json` (mcpServers, CLAUDE.md)
  - cursor -> `.cursor/mcp.json` (mcpServers, .cursorrules)
  - vscode -> `.vscode/mcp.json` (shape **servers**, .github/copilot-instructions.md)
  - cline -> `.cline/cline_mcp_settings.json` (mcpServers, .clinerules)
  - windsurf -> `.windsurf/mcp_config.json` (mcpServers, .windsurfrules)
  - qoder, codex -> `file:null` (blok ditulis sebagai `.planforge/mcp-universal.json`, rules AGENTS.md)
  - generic -> `.planforge/mcp-universal.json`

**Yang sudah jadi & terbukti (ada receipt di disk):**
- Planning GUI -> 4 dokumen; isolasi kunci per provider+baseUrl; sidik jari rencana (CRC32) web==worker.
- Enforcement worker: gerbang keras, review ringan (gagal = blokir kelulusan), bukti browser nyata (CDP),
  identitas `plan_status` (folder harus cocok, kalau beda STOP), budget/maxCalls/plafon biaya, dedup doneTasks,
  dependensi task ditegakkan, pemulihan sesi.
- Connect: tulis 6 file (worker.mjs, rules, config MCP, .planforge/plan.json, gates.json, state.json),
  gabung config MCP (server lain utuh), JAGA progress/gerbang yang sudah disunting, backup ledger saat sidik jari berubah.
- **Trigger prompt satu-tempel SUDAH ADA:** fungsi `connPrompt` (index.html). Menghasilkan prompt berisi nama connector
  unik + cek identitas plan_status + STOP kalau folder beda. Ditampilkan di panel Connect GUI dan CLI `connect`.
  Ini persis "copy-paste sekali" yang diinginkan pengguna. JANGAN bikin ulang.
- 305 uji hijau (core 122, worker 115, connect 17, browser 33, ui-probe 18) — baseline sebelum upgrade 15 Nov 2026.
  Sesudah upgrade Batch 0–4: **315 uji hijau** (core 126, worker 118, connect 17, browser 33, ui-probe 23).
  Sesudah regresi audit 20 Nov 2026: **534 uji hijau** (core 258, worker 147, connect 19, browser 34, ui-probe 76).
- Pilot nyata: WarungKasir T-001 selesai dengan gerbang + bukti browser + commit (receipt di D:\TOOLS\pf-probe\hasil-kerja-nyata.json).
- Hint Connect WorkBuddy/Antigravity baru diperbaiki jadi jujur (file proyek tidak dibaca otomatis; wajib registrasi global).
  Ada uji regresinya di core.test.mjs ("hint Connect WorkBuddy & Antigravity jujur").

---

## 3. Sisa pekerjaan (scope jujur, kerjakan berurutan)

### 3a. Koneksi universal — DUA kelas app, JANGAN disamakan
- **Kelas A — BACA file config proyek (VS Code / Cursor / Claude Code):**
  - **VS Code: TERBUKTI end-to-end oleh pengguna (15 Nov 2026).** `.vscode/mcp.json` shape `servers` dibaca,
    agen Copilot Chat nyambung ke connector `planforge-vscodeee-abbee093`, lalu memanggil `plan_status`,
    `doctor`, `audit_plan`, `next_task`, `get_task`. Dua kali agen berhenti BENAR karena rencananya cacat
    (27 `behavior.checks` bertipe asing, lalu task pertama bukan scaffold di folder kosong) — bukan karena koneksi.
    Itu bukti gerbang bekerja. **Yang belum: agen mengeksekusi task sampai gerbang hijau + commit lewat VS Code.**
  - **Claude Code:** terbukti membaca `.mcp.json` proyek (`claude mcp list`) + handshake stdio + `plan_status`
    menjawab (receipt `D:\PROJECTS\pf-e2e-claude\bukti-kelas-a-claude.json`). Belum ada run task penuh.
  - **Cursor:** belum diuji (GUI-only), jangan klaim kompatibel.
- **Kelas B — TIDAK baca file proyek (WorkBuddy, Antigravity, Cline, Qoder):** butuh **registrasi GLOBAL sekali**.
  Ini **DINDING PIHAK KETIGA**, bukan bug PlanForge. **TUGAS: buat langkah ini semulus mungkin** — Connect menampilkan
  blok salin + path global persis + langkah klik bernomor. Boleh menawarkan menulis config global HANYA dengan
  persetujuan eksplisit pengguna (jangan otomatis). **JANGAN janji "zero-click" untuk kelas ini.**

### 3b. UX menuju alur impian
Minimalisir langkah, perjelas guidance, pastikan trigger prompt satu-tempel muncul jelas di GUI & CLI.
- GUI: buka index.html -> key -> model -> generate -> Connect (app + folder) -> tempel trigger prompt ke agent -> tunggu.
- CLI: `node worker.mjs run` di folder proyek (worker menyetir agent CLI sendiri, loop + gerbang), ATAU agent connect
  via MCP lalu tempel trigger prompt. Jelaskan ke pengguna mana yang cocok untuk situasinya.

### 3c. Opsional (pengerasan, BUKAN penghalang untuk memakai)
- #31 verifikasi koneksi sebelum mulai task (sebagian sudah lewat cek plan_status).
- #33 full-auto lewat CLI WorkBuddy (runner) — loop sudah ada & diuji dengan fake-agent; buktikan dengan agen nyata.
- #38 standar kelayakan workflow GUI/CLI (ini yang menyentuh ambisi "universal").
- #39 perbaiki rekap basi + tes alur yang memberi kelulusan keliru.
- #26 ide uji tetap + rubrik penilaian kualitas plan.

### 3d. Upgrade yang SUDAH dikerjakan (15 Nov 2026, semua dengan uji regresi)

**Batch 0 — rencana berubah = 1 klik, bukan Connect ulang**
- Handle folder + aplikasi + sidik jari rencana disimpan di IndexedDB (`state.lastConnect`).
- Lampu "Rencana berubah sejak Connect terakhir" + tombol **Sinkron ke folder (1 klik)**.
  Yang ditulis ulang cuma `worker.mjs`, `.planforge/plan.json`, `state.json` (+cadangan ledger).
  `gates.json`, aturan agen, dan config MCP dibiarkan — tidak perlu daftar ulang / restart aplikasi.
- Kalau `doneTasks > 0`, minta konfirmasi dulu; progres dicadangkan lewat `rencanaTulis`.
- Connect dikunci saat pipeline masih jalan atau rencana belum siap.
- Keterbatasan jujur: browser bisa mencabut izin folder → targetnya 1 klik (+ 1 dialog izin), bukan nol klik.

**Batch 1 — nunggu tidak bikin was-was**
- Jam per tahap (`mikir… 37 dtk · batas 120 dtk`), batas 120 detik per panggilan AI dengan pesan yang menjelaskan
  bahwa "lama tanpa error" BUKAN kredit habis.
- Tombol **Cek sisa kredit** → `GET https://openrouter.ai/api/v1/key` (gratis, tidak memanggil model),
  tampilkan `limit_remaining`, `usage`, `usage_daily`.
- Tahap 5 (tambal AI) **opsional** (checkbox `autoTambal`, default mati); tombol "Minta AI tambal" tetap tersedia.
- Estimasi jumlah panggilan AI di `costGuess`; pesan `401/402/403/429` diperjelas (402 menyebut batas key & in-flight).

**Batch 2 — rencana cacat tidak boleh sampai ke folder**
- `rubrikRencana()` = "Siap dieksekusi / Perlu diperbaiki" + skor; `connectPilih`/`connectCek`/`connectSinkron` DITAHAN kalau ada celah.
- `masalahStrukturRencana()`: task pertama WAJIB `T-001` dan berkata scaffold — ini yang bikin kasus VSCode T-002 ketahan.
- `normalisasiAliasBehavior()`: hanya alias yang jujur (`attribute`→`attr`, `textContains`→`text`,
  `noHorizontalScroll`→`noHorizontalOverflow`) dan selalu dengan catatan tertulis. `css`/`style`/`file`/`hover`/`focus`
  TIDAK ditukar diam-diam. Tombol "Betulkan alat ukur yang jelas" di tab Runner.
- `auditPlan` worker: folder kosong + task pertama bukan scaffold + verifikasi build + file yang disebut tidak ada
  = **error** (bukan cuma peringatan), disertai saran "tambahkan T-001 scaffold / pulihkan file aplikasi".
- `mark_blocked` (tool ke-8): status `terkendala`, bukan `gagal`; `next_task` berhenti, `plan_status` melaporkannya.
  `connPrompt`, `agentsMd`, dan `rulesText` sudah menyebutnya.

**Batch 3/4 — dokumentasi & orang baru**
- Tab **Panduan** di GUI: coba gratis (Demo), BYOK, Connect, cara pakai Sinkron, tabel `401/402/403/429`,
  larangan "ulang dari nol" saat jalan, dan penjelasan registrasi global kelas B.
- HANDOFF bagian 1/2/3a/4/6 diperbarui dengan status terkini (VS Code terbukti, 8 tool, 315 uji).

**Belum (jujur):** #31/#33/#38/#39/#26 penuh, Cursor/VS Code eksekusi task sampai commit, dan
satu orang baru mencoba dari nol tanpa ditemani. Tampilan/UI sengaja ditunda sampai pengguna bilang oke.

---

## 4. Fakta koneksi per app (SUDAH diverifikasi — jangan tebak ulang)

- **WorkBuddy Desktop:** HANYA membaca config global `C:\Users\t495s\.workbuddy-ai\mcp.json`.
  File `.mcp.json` di folder proyek DIABAIKAN (bukti: dekompilasi app.asar UserMcpProvider/resolveMcpServers +
  log daemon projectMcpCount:0). Sudah ada entri lama: `planforge` -> D:/PROJECTS/trade-news/worker.mjs dan
  `planforge-testing-planforge-6ce2e316` -> D:/PROJECTS/testing-planforge/worker.mjs.
  **Risiko tabrakan:** untuk proyek baru, pakai nama connector UNIK (connNama meng-hash path lengkap), jangan `planforge` lama.
  Rem pengaman: cek identitas `plan_status` (folder harus cocok) sebelum kerja.
- **Antigravity IDE:** HANYA membaca `~/.gemini/config/mcp_config.json` (global) atau `plugins/<plugin>/mcp_config.json`.
  `.agents/mcp_config.json` di proyek TIDAK dibaca (bukti: agy-customizations/docs/mcp_servers.md). Restart IDE tidak membuat file proyek terbaca.
- **Cline:** HANYA global `~/.cline/data/settings/cline_mcp_settings.json`. (Ekstensi belum terpasang di sistem ini.)
- **Qoder:** tidak ada file config proyek; daftar lewat App settings > MCP (settings.json). Connect menulis blok sebagai `.planforge/mcp-universal.json` untuk disalin.
- **VS Code / Cursor / Claude Code:** membaca file proyek (`.vscode/mcp.json` shape servers / `.cursor/mcp.json` / `.mcp.json`).
  VS Code SUDAH terbukti membaca config + agen nyambung (lihat 3a), Claude Code terbukti baca config + server menjawab,
  Cursor masih belum diuji. Eksekusi task sampai gerbang hijau + commit lewat app-app ini belum dibuktikan.
- **Windsurf / Codex CLI:** belum terpasang di sistem ini. Jangan klaim kompatibel.

---

## 5. Batasan keras (WAJIB — jangan dilanggar)

- **Jangan ekstrak/pakai token/kredensial login app apa pun** (termasuk kredensial WorkBuddy untuk CLI-nya).
- **Jangan ubah setting global WorkBuddy/Antigravity atau restart app tanpa persetujuan spesifik pengguna.**
- **Jangan panggil AI berbayar / otomatisasi berbayar terbuka tanpa diminta.**
- **File baru di D:** (C: hampir penuh). **Jangan hapus `C:\Users\t495s\WorkBuddy AI\trade-news`.**
  **Jangan fabrikasi baris data ke `trader_news.db`** (pakai fixture CSV / DB sementara untuk uji).
- **`worker.mjs` & `index.html`: TANPA karakter CJK.** Setelah edit worker -> `node worker.mjs embed`.
  Jaga `AGENT_ADAPTERS` identik web<->worker. Jangan ubah field file/shape/rules (terkunci uji).
- **Jangan sunting `.planforge/state.json` manual.** Jangan commit/deploy tanpa diminta. Jangan ubah di luar acceptance criteria diam-diam. Laporkan perubahan.
- **URL tool harus sesuai target tugas.** Jangan ganti ke alamat proxy sementara (routify dll). Verifikasi ulang tiap panggilan.
- Bahasa Indonesia, langsung, ramah pemula. Langkah GUI point-and-click bernomor. Perintah shell: jelaskan arti + undo + risiko.
  Uji harus self-diagnose + tinggalkan receipt di disk. Setiap balasan akhir diakhiri heading persis: `Kesimpulan untuk Agus:`.
- Jangan menebak kompatibilitas app hanya karena nama file adapter ada. Bedakan "terbukti uji" vs "asumsi dokumentasi".

---

## 6. Verifikasi / definition of done

- Jalankan semua uji dari `D:\PROJECTS\planforge`:
  ```
  node test/core.test.mjs
  node test/worker.test.mjs
  node test/connect.test.mjs
  node test/browser.test.mjs
  node test/ui-probe.mjs
  ```
  Semua harus hijau (self-report "N lulus, M gagal"). Terakhir diverifikasi 15 Nov 2026:
  **534 lulus, 0 gagal** (core 258, worker 147, connect 19, browser 34, ui-probe 76).
  Cek: embed round-trip (embedded==worker.mjs), adapter equality (web==worker), no-CJK di index.html & worker.mjs.
- Harness: core/worker mengekstrak PF dari index.html (CORE-BEGIN/CORE-END) via new Function;
  connect/browser/ui-probe memakai headless Edge sungguhan lewat CDP di file://. ui-probe menulis receipt ke ../ui-receipt.json.
- **Garis finis SEBENARNYA: SATU run end-to-end NYATA pada proyek sungguhan**
  (plan -> Connect -> agent eksekusi task pertama sampai gerbang hijau + commit). Itu yang membuktikan PlanForge
  "bisa dipakai", bukan sekadar uji hijau. Bagian yang butuh pengguna (login/kuota app, klik registrasi global,
  menyuruh agen jalan) tidak boleh dilakukan agen tanpa izin — siapkan sampai titik itu, lalu dampingi pengguna.

---

## 7. Ringkasan untuk agent berikutnya

Inti PlanForge SUDAH jadi dan terbukti. Jangan bangun ulang.
Yang SUDAH kelar (lihat 3d): registrasi global kelas B dimuluskan, trigger satu-tempel, VS Code & Claude Code
terbukti nyambung, sinkron rencana 1 klik, gerbang kualitas rencana, `mark_blocked`, timer/timeout/cek kredit,
fase 5 opsional, tab Panduan. Resolusi adapter GitHub/runner kini memakai aturan kanonik; `--agent` hanya dipakai untuk preset CLI worker dan label IDE dikeluarkan dengan instruksi dinamis. Path Connect aman saat folder/reset, preview runner sejajar dengan worker, preflight web sejajar dengan `auditPlan`, status `terkendala` diterima, dan cleanup `os.tmpdir()` bersih meski callback gagal. **534 uji hijau.**
Sisa yang bernilai: (1) satu run eksekusi task sampai gerbang hijau + commit lewat app kelas A (VS Code/Cursor),
(2) #31/#33/#38/#39/#26, (3) uji satu orang baru dari nol tanpa ditemani, (4) publikasi, (5) tampilan paling akhir.
Garis finis = bisa dipakai berulang oleh orang lain, bukan uji hijau semata.
Jaga north star: pipa murah yang bisa dipakai berulang, output sesuai rencana, pengguna cukup klik minimal lalu tunggu.