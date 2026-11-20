/* PlanForge core: prompt sistem dan pesan per tahap. */
import { SCHEMAS } from "./plan-schema.mjs";
import { ids } from "./plan-normalize.mjs";
import { starterAktif, starterLockLines, starterContractLines } from "./starter.mjs";

export function buildSystemPrompt(cfg){
  const language = cfg.language || "Bahasa Indonesia";
  return [
"Kamu adalah PlanForge: gabungan product manager senior + staff engineer. Tugasmu mengubah ide kasar manusia menjadi rencana yang bisa dieksekusi agen coding tanpa perlu bertanya lagi.",
"",
"ATURAN OUTPUT (melanggar = hasil dianggap gagal)",
"1. Balas HANYA dengan satu objek JSON. Tanpa fenced code block, tanpa paragraf penjelasan, tanpa komentar, tanpa trailing comma.",
"2. Pakai persis kunci yang ada di skema. Tidak ada kunci yang hilang. Array kosong diperbolehkan.",
"3. Semua nilai teks yang dibaca manusia ditulis dalam " + language + ". Identifier kode, path file, perintah shell, dan nama kunci JSON tetap bahasa Inggris.",
"4. ID stabil dan berurutan: R-001, M-001, T-001. Dalam satu dokumen jangan ada ID duplikat atau bolong.",
"",
"ATURAN BERPIKIR",
"5. Jangan mengarang fakta tentang bisnis user. Apa pun yang user tidak sebutkan menjadi asumsi eksplisit dengan tingkat keyakinan dan cara murah memvalidasi.",
"6. Ambil default yang masuk akal daripada macet. Setiap pertanyaan terbuka dijawab dengan opsi termurah dibangun dan termudah diubah nanti, lalu dicatat.",
"7. Potong scope dengan kejam. MVP = irisan terkecil yang masih bikin user nyata memakai ini dua kali. Sisanya masuk v2 beserta alasannya.",
"8. Acceptance criteria harus bisa diuji orang ketiga: perilaku, bukan niat. Bentuk Given/When/Then diprioritaskan.",
"9. Semua harus terlacak. Setiap task merujuk >=1 requirement. Setiap requirement tercakup >=1 task.",
"10. Satu task = satu sesi kerja agen: 1-5 file, satu perubahan perilaku, satu langkah verifikasi yang konkret.",
"11. Urutkan task berdasarkan dependensi. Task hanya boleh bergantung pada ID yang lebih kecil. Tidak ada siklus.",
"12. Pilih teknologi membosankan yang masih dipakai luas sekarang: dokumentasi bagus, komunitas hidup, versi stabil. Hindari infra eksotis kecuali user memintanya.",
"13. Kalau user memberi batasan (budget, hosting, tanpa backend, dsb) batasan itu harga mati dan harus terlihat di keputusan teknis.",
"",
"KONTEKS",
"User: " + (cfg.audience || "tidak disebutkan, tebakpersona yang paling mungkin"),
"Agen eksekutor target: " + (cfg.targetAgent || "umum") + ".",
cfg.targetAgent && cfg.targetAgent !== "umum"
  ? "Sesuaikan granularity task dengan agen tersebut (satu task = satu instruksi yang bisa kamu tempel)."
  : "Buat task yang independen dan jelas agar bisa dikerjakan agen mana pun."
].join("\n");
}

export function briefBlock(cfg){
  return [
"=== BRIEF DARI USER ===",
"Nama proyek (boleh diubah kalau ada yang lebih tepat): " + (cfg.projectName || "(belum ada)"),
"Pengguna/target: " + (cfg.audience || "(tidak disebutkan)"),
"Ide mentah:",
(cfg.idea || "").trim() || "(kosong — minta user mengisi ide dulu)",
"---",
"Batasan & preferensi:"
  ].join("\n") + "\n" + (cfg.constraints || "(tidak ada)");
}

export function buildStageMessages(stage, cfg, docs, focus){
  const sys = buildSystemPrompt(cfg);
  const parts = [briefBlock(cfg)];
  const prdDoc = docs.prd || {};
  const featNames = (prdDoc.features||[]).map(f=>String(f && f.name || "").trim()).filter(Boolean);
  const reqList = ids(prdDoc.requirements);
  const mList = ids((docs.roadmap && docs.roadmap.milestones) || []);
  const ALLOW = (use)=>"DAFTAR RESMI — pakai HANYA nilai dari daftar ini, salin persis (termasuk huruf besar/kecil dan tanda baca). Jangan membuat ID atau nama baru, jangan menambah prefix/suffix pada nama fitur:\n" + use;
  if(stage === "clarify"){
    parts.push("=== TUGAS TAHAP 1: CLARIFY ===",
      "Ubah ide mentah di atas menjadi brief kerja, DAN susun 5 pertanyaan discovery yang akan dijawab user sebelum PRD ditulis.",
      "questions: TEPAT 5 butir, satu per slot BERURUT, id Q-001..Q-005:",
      "  Q-001 slot 'persona' (type text): siapa pengguna utamanya dan bagaimana mereka sekarang mengatasi masalah ini tanpa produkmu.",
      "  Q-002 slot 'aha' (type single): aksi pertama apa yang bikin user langsung paham nilai produk di kunjungan pertama.",
      "  Q-003 slot 'mvp_features' (type multi): tiga fitur yang paling wajib ada di MVP supaya produk berguna.",
      "  Q-004 slot 'value_prop' (type single): kenapa user memilih ini dibanding alternatif yang mereka pakai sekarang.",
      "  Q-005 slot 'retention' (type single): apa yang bikin user kembali lagi setelah pemakaian pertama.",
      "Wording tiap pertanyaan dan options-nya WAJIB spesifik untuk ide ini — sebut nama benda/aksi/peran yang nyata dari ide, BUKAN 'opsi A/B' atau pertanyaan generik yang cocok untuk app apa pun. options 3-5 butir konkret; untuk type text kosongkan options. GUI menambahkan sendiri tombol 'Lainnya' dan 'Lewati', jadi jangan menulis opsi itu.",
      "Selain questions, tetap isi brief sebagai tebakan terbaikmu SEBELUM user menjawab: project_name, one_liner, audience, brief, primary_workflows, assumptions (4-8 paling berbahaya kalau salah), defaults_chosen (4-8 keputusan yang kamu ambil berikut alasan), cut_from_mvp (3-7 yang dibuang), success_signals.",
      "ai_questions: 0-4 pertanyaan klarifikasi BEBAS di luar 5 slot di atas, id A-001 dst. Isi HANYA hal yang kalau tebakanmu salah bikin rencana salah arah: pilihan teknis, bentuk data, batasan scope, integrasi pihak ketiga, atau aturan bisnis yang tidak bisa kamu tebak dari ide. Tiap butir wajib menyebut why = asumsi/keraguan spesifikmu (mis. 'aku belum tahu apakah pembayaran perlu midtrans atau cukup tunai'). JANGAN mengulang isi 5 slot produk. Kalau ide sudah cukup jelas dan tidak ada yang benar-benar ambigu, kembalikan array kosong — jangan mengarang pertanyaan demi terlihat rajin.",
      "Balas sesuai skema objek: " + JSON.stringify(SCHEMAS.clarify));
  }
  if(stage === "prd"){
    parts.push("=== TUGAS TAHAP 2: PRD ===","Brief yang sudah disepakati:", JSON.stringify(docs.clarify,null,1),
      "Kalau brief punya user_answers, itu keputusan user yang WAJIB dihormati dan jadi sumber utama PRD — jangan menimpanya dengan asumsi atau defaults_chosen. Jawaban yang kosong berarti user melewati pertanyaan itu: pakai defaults_chosen sebagai tebakan.",
      "Tulis PRD lengkap dengan tujuh bagian berurut: Overview, Requirements, Core Features, User Flow, Architecture, Database Schema, Tech Stack. Semua bagian itu ada di skema.",
      "requirements (fungsional): 6-14 butir, ID R-001 dst, tiap butir 2-5 acceptance criteria yang bisa diuji. Tandai scope mvp/v2 dan prioritas must/should/could.",
      "non_functional: 4-8 butir dengan target TERUKUR (ms, MB, %, menit), ID N-001 dst. Contoh target bagus: 'halaman menu terbuka < 1,5 detik di 4G'.",
      "features: 5-9 fitur utama, masing-masing 2-5 sub_features. Ini lapisan tengah antara requirement dan task; nama fitur dipakai ulang persis oleh roadmap dan tasks.",
      "Nama fitur = 2-4 kata, tanpa tanda baca penjelas (contoh bagus: 'Katalog item'). Penjelasan panjang masuk ke sub_features, BUKAN ke name — nama berupa kalimat membuat task tidak bisa dikelompokkan.",
      "flows: 3-6 alur, nama diawali huruf (A., B., C.) dan sebut fase-nya; steps berurut dan menyebut layar/aksi konkret.",
      "data: 4-10 tabel; tiap field ditulis 'nama (tipe) — catatan'. Simpan snapshot harga/nama di baris transaksi kalau datanya bisa berubah.",
      "tech: keputusan konkret (bahasa, framework, penyimpanan, deployment) beserta alasan; template_note diisi kerangka awal yang dipakai atau 'tidak ada'.",
      "Stack KAMU yang mengusulkan: pilih yang paling relevan untuk jenis proyek ini dan masih dipakai luas sekarang, bukan yang paling kamu suka. Tiap butir tech wajib menyebut versi mayor yang dipakai (mis. 'FastAPI 0.115', 'React 19'), alasan, dan minimal satu alternatif yang kamu tolak beserta alasannya.",
      "Kalau user tidak menyebut stack sama sekali, tetap putuskan satu stack lengkap — jangan menjawab 'tergantung kebutuhan'. Catat pilihan itu sebagai asumsi yang bisa dibatalkan user. Batasan user tetap harga mati: jangan mengganti bahasa/framework/DB/deployment yang sudah dia sebut, walau menurutmu ada yang lebih baik.",
      "Utamakan yang murah dijalankan dan gampang diubah: padanan lokal/gratis sebelum layanan berlangganan, dan hindari banyak service terpisah untuk MVP.",
      "Balas sesuai skema objek: " + JSON.stringify(SCHEMAS.prd));
    parts.push(...starterLockLines(cfg));
  }
  if(stage === "roadmap"){
    parts.push("=== TUGAS TAHAP 3: ROADMAP ===","PRD:", JSON.stringify(docs.prd,null,1),
      ALLOW("feature_refs = " + JSON.stringify(featNames) + "\nrequirement_refs = " + JSON.stringify(reqList)),
      "Pecah scope mvp menjadi 3-6 fase/milestone berurutan dengan exit criteria yang objektif.",
      "Tiap milestone wajib mengisi feature_refs berisi nama fitur persis seperti di prd.features, dan requirement_refs persis seperti ID di PRD.",
      "Setiap fitur di prd.features harus muncul di minimal satu milestone. Kalau ada fitur yang belum ter-cover, ia v2: sebut di sequencing_notes.",
      "Balas sesuai skema objek: " + JSON.stringify(SCHEMAS.roadmap));
  }
  if(stage === "tasks"){
    const cakupan = focus
      ? "FOKUS CHUNK: hasilkan task HANYA untuk milestone " + focus.milestone_ref + " (" + (focus.title||"") + ") — fitur " + JSON.stringify(focus.feature_refs||[]) + " dan requirement " + JSON.stringify(focus.requirement_refs||[]) + ". JANGAN membuat task untuk milestone/fitur lain di chunk ini."
      : "Hasilkan task yang menutup SEMUA requirement scope mvp DAN semua fitur.";
    parts.push("=== TUGAS TAHAP 4: TASK LIST ===","PRD:", JSON.stringify(docs.prd,null,1),
      "Roadmap:", JSON.stringify(docs.roadmap,null,1),
      ALLOW("feature = " + JSON.stringify(featNames) + "\nrequirement_refs = " + JSON.stringify(reqList) + "\nmilestone_ref = " + JSON.stringify(mList)),
      cakupan + " Jumlah task NATURAL sesuai kebutuhan, BUKAN dipatok ke rentang tertentu. Pecah pekerjaan jadi task sebesar satu sesi kerja agen (1-5 file, satu perubahan perilaku yang bisa diverifikasi). Proyek kompleks boleh puluhan task, proyek sederhana cukup belasan. Yang WAJIB: tiap fitur yang dicakup punya minimal satu task dan tiap requirement mvp yang dicakup tercakup minimal satu task. Jangan menggabungkan banyak perilaku berbeda jadi satu task raksasa demi mengurangi jumlah, dan jangan memecah satu perubahan kecil jadi banyak task remeh.",
      ...(focus ? ["Task yang sudah ada dari chunk sebelumnya: " + JSON.stringify(focus.existingIds||[]) + ". Lanjutkan penomoran ID mulai " + (focus.startId||"T-001") + " dan berurutan naik. depends_on boleh merujuk ID task yang sudah ada itu, atau task di chunk ini yang nomornya lebih kecil."] : []),
      "Tiap task: title berupa kalimat kerja pendek (mulai 'Buat', 'Ubah', 'Sambungkan'), feature = nama fitur persis dari prd.features, status 'belum mulai', priority salah satu dari utama/penting/tambahan. utama = inti MVP yang bikin produk berguna (wajib ada); penting = memperkuat alur utama tapi bukan penentu hidup-mati; tambahan = pelengkap/nice-to-have yang boleh ditunda. Sebar tier dengan jujur: jangan menandai semua task utama — hanya yang benar-benar inti saja utama, sisanya penting atau tambahan.",
      "Jaga keluaran TETAP RINGKAS supaya tidak terpotong di model kecil: description 1-2 kalimat, acceptance_criteria 1-3 butir, agent_hint satu kalimat pendek, files_or_areas yang penting saja. behavior.checks cukup 2-4 check yang benar-benar mengukur angka; jangan menumpuk check atau mengulang penjelasan panjang di tiap task.",
      "Tiap task: satu perubahan perilaku, files_or_areas konkret, depends_on memakai ID task yang sudah ada di daftar ini dan bernomor lebih kecil.",
      "verification WAJIB satu perintah shell yang benar-benar bisa dijalankan di terminal dan menghasilkan exit code (mis. `python -m pytest -q tests/test_x.py`, `npm test`, `node scripts/cek.js`). Worker menjalankannya ulang sendiri sesudah agen selesai: exit code bukan 0 = task GAGAL.",
      "DILARANG menulis verification berupa kalimat atau cek manual ('buka browser', 'klik tab Kasir', 'lihat tampilannya', '<input ...> muncul') — itu tidak bisa dijalankan, jadi task-nya tidak akan pernah terbukti. Untuk perilaku yang cuma bisa dilihat di browser, pakai `behavior` (di bawah), bukan langkah tangan.",
      "behavior WAJIB untuk tiap task yang menyentuh UI: files_or_areas berisi .html/.css/.jsx/.tsx/.vue/.svelte atau folder templates/static/public/assets, ATAU acceptance_criteria bicara soal halaman/tombol/klik/grafik/canvas/viewport/responsif. Worker membuka Edge/Chrome headless dan MENGUKUR SENDIRI checks itu; satu check gagal = task GAGAL walau build/test hijau.",
      "behavior.checks harus mengukur angka yang bisa salah, bukan kehadiran file. Contoh bagus: {type:'canvasNotBlank',selector:'#grafik',minPixels:500} (grafik benar-benar tergambar), {type:'click',selector:\"input[value='60']\"} lalu {type:'text',selector:'#judul',contains:'60'} (judul ikut filter, bukan basi), {type:'request',urlContains:'/api?window=60'} (fetch benar-benar terkirim), {type:'url',contains:'window=60'} (alamat halaman ikut berubah, bukan cuma isinya), {type:'noConsoleError'} (library yang dipakai benar-benar dimuat), {type:'noHorizontalOverflow'} dengan viewport 360x760.",
      "behavior.url harus alamat http(s) yang bisa dibuka. Kalau butuh server lokal, isi behavior.server.cmd supaya worker menyalakannya sendiri lalu mematikannya lagi — jangan mengandalkan server yang kebetulan hidup. Selector harus cocok dengan markup yang task itu sendiri buat.",
      "Task backend murni (skrip impor, perhitungan, migrasi DB, endpoint tanpa tampilan) TIDAK perlu behavior. Jangan mengarang check browser untuk task yang tidak punya halaman.",
      "DILARANG menutup perintah dengan `; echo OK` atau `|| echo Gagal` (echo selalu exit 0, gerbangnya jadi tidak bisa gagal) dan dilarang memakai biner yang belum tentu terpasang. Rangkai dengan `&&`.",
      "Proyek di Windows: cmd.exe TIDAK mengenal kutip satu. `grep -Eq 'a|b'` dipecah jadi dua perintah karena `|` tetap pipe sungguhan — bisa menjalankan perintah lain yang menunggu input. Bungkus argumen dengan kutip dua (`grep -Eq \"a|b\"`) kalau di dalamnya ada | & < >.",
      "Setiap task wajib punya minimal satu requirement_refs yang benar-benar ada di daftar; kalau tidak tahu, pilih requirement yang paling dekat — jangan mengarang ID baru.",
      "Task untuk mengukur non_functional (kecepatan, ukuran penyimpanan, caching) atau audit end-to-end tetap memakai nama fitur dari daftar di atas — pilih fitur terdekat. Jangan membuat nama fitur baru seperti 'Non-functional: Kecepatan' atau 'E2E Audit'.",
      focus
        ? (focus.isFirst ? (starterAktif(cfg) ? "Ini milestone pertama: task pertama MENYESUAIKAN starter yang kodenya sudah tersedia (migrasi DB + seed + tambah tabel/kolom fitur ini), BUKAN membangun skeleton dari nol." : "Ini milestone pertama: task pertama menyiapkan skeleton proyek + penyimpanan.") : focus.isLast ? "Ini milestone terakhir: task terakhir audit end-to-end di layar kecil (360px)." : "Jangan membuat task skeleton atau audit end-to-end di chunk ini — itu sudah ada di milestone pertama/terakhir.")
        : (starterAktif(cfg) ? "Task pertama MENYESUAIKAN starter yang kodenya sudah tersedia (migrasi + seed + tabel/kolom fitur), bukan skeleton dari nol; task terakhir audit end-to-end di layar kecil (360px)." : "Task pertama menyiapkan skeleton proyek + penyimpanan; task terakhir audit end-to-end di layar kecil (360px)."),
      "Sisipkan task untuk tiap butir non_functional yang bisa diuji (mis. ukur waktu muat).",
      "Balas sesuai skema objek: " + JSON.stringify(SCHEMAS.tasks));
    if(starterAktif(cfg)) parts.push(
      "STARTER DIPAKAI: kode fondasi (auth sesi, DB PostgreSQL, kerangka Next.js, docker, test) SUDAH ADA; dependency dan layanan target belum diverifikasi. JANGAN membuat task membangun ulang fondasi itu — tidak ada task 'buat login dari nol', 'setup Next.js', 'buat docker', 'konfigurasi DB pool'.",
      "Task = DELTA fitur di atas starter: tambah tabel/kolom, endpoint baru, halaman baru, ubah perilaku yang sudah ada. files_or_areas merujuk file starter yang sudah ada (app/, lib/, db/) plus file baru untuk fitur.",
      "verification boleh memakai perintah starter (npm test, npm run build) dan menambah test untuk delta. behavior.server.cmd boleh `npm run dev` (setelah dependency dan lingkungan disiapkan) atau server yang task itu nyalakan sendiri; behavior.url mengarah ke halaman starter yang diubah."
    );
  }
  if(stage === "audit"){
    parts.push("=== TUGAS TAHAP 5: AUDIT ===",
      "Masalah integritas yang terdeteksi validator:",
      JSON.stringify(docs.issues,null,1),
      "PRD:", JSON.stringify(docs.prd,null,1),
      "Roadmap:", JSON.stringify(docs.roadmap,null,1),
      "Tasks:", JSON.stringify(docs.tasks,null,1),
      ALLOW("feature = " + JSON.stringify(featNames) + "\nrequirement_refs = " + JSON.stringify(reqList) +
            "\nmilestone_ref = " + JSON.stringify(mList) + "\ntask id yang sudah ada = " + JSON.stringify(ids((docs.tasks&&docs.tasks.tasks)||[]))),
      "Perbaiki HANYA dengan menambal masalah di atas. Jangan menulis ulang isi yang sudah benar.",
      "Untuk masalah 'target non-fungsional belum terukur', buat patch update di document prd, collection non_functional dengan target berisi angka.",
      "Untuk masalah 'requirement mvp belum dicakup', tambahkan patch update pada task yang paling dekat (requirement_refs-nya) atau patch add task baru dengan ID T- berikutnya yang belum dipakai.",
      "Untuk masalah 'task UI tanpa behavior' atau 'behavior tidak bisa diukur', kirim patch update di document tasks, collection tasks, target_id task itu, object berisi behavior lengkap (url + checks yang mengukur angka). Jangan menurunkan task-nya jadi non-UI dan jangan menghapus acceptance_criteria-nya supaya lolos.",
      "Jangan mengirim patch yang isinya sama persis dengan yang sudah ada.",
      "Balas sesuai skema objek: " + JSON.stringify(SCHEMAS.patch));
  }
  if(stage !== "clarify") parts.push(...starterContractLines(cfg));
  return [{role:"system", content:sys}, {role:"user", content:parts.join("\n\n")}];
}
