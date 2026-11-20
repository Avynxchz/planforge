export const LIGHT_REVIEW = [
  "Kamu reviewer, bukan penulis. Nilai HANYA task di atas, jangan yang lain.",
  "Cek: (1) semua acceptance criteria terpenuhi, (2) verification bisa dijalankan dan benar-benar dijalankan,",
  "(3) tidak ada file/fungsi mati atau duplikasi yang baru saja kamu tambah, (4) tidak ada fitur di luar task,",
  "(5) tidak ada TODO sementara yang tertinggal.",
  "Balas HANYA JSON: {\"pass\": true|false, \"issues\": [\"<temuan singkat + file:line>\"], \"fix\": \"<kalau pass=false: apa yang harus dibetulkan>\"}"
].join("\n");

export const FULL_GATES = [
  { id: "audit", label: "Audit menyeluruh", tier: "full", enabled: true,
    prompt: "Audit kualitas kode dari task " + "{FROM}" + " sampai " + "{TO}" + " tanpa menambah fitur. Cari: bug batas (empty/null/0/negatif), state yang tidak konsisten, error yang ditelan diam-diam, akses data tanpa validasi, celah keamanan dasar. Jangan perbaiki dulu. Balas HANYA JSON: {\"issues\":[{\"file\":\"\",\"line\":0,\"severity\":\"high|med|low\",\"what\":\"\",\"why\":\"\"}]}" },
  { id: "fixbug", label: "Perbaiki bug hasil audit", tier: "full", enabled: true,
    prompt: "Perbaiki HANYA temuan severity high dan med dari audit barusan, satu per satu, tanpa mengubah perilaku tampilan dan tanpa menambah fitur. Setelah selesai balas HANYA JSON: {\"fixed\":[\"...\"],\"skipped\":[\"...\"],\"reason_skipped\":\"...\"}" },
  { id: "refactor", label: "Rapikan & buang kode mati", tier: "full", enabled: true,
    prompt: "Refactor tanpa mengubah perilaku: hapus kode mati/unused export/duplikasi, kecilkan fungsi yang lebih dari 40 baris, beri nama yang jelas. Tampilan dan hasil verifikasi WAJIB sama. Jangan naikkan versi dependency. Balas HANYA JSON: {\"changed\":[\"...\"],\"removed\":[\"...\"]}" },
  { id: "perf", label: "Performa (target HP kentang)", tier: "full", enabled: true,
    prompt: "Optimalkan performa untuk HP rendah dan jaringan lambat: kurangi render ulang, tunda muat aset besar, hindari loop sinkron berat di thread utama, kecilkan bundle. Tidak boleh mengubah fitur. Ukur sebelum/sesudah kalau ada alatnya. Balas HANYA JSON: {\"changes\":[\"...\"],\"measured\":\"<angka atau 'tidak terukur'>\"}" },
  { id: "watch", label: "Watchlist tambahanmu", tier: "full", enabled: false, prompt: "" }
];

export const HARD_CHECKS = [
  { id: "build", label: "Build + type-check", cmd: "npm run build", enabled: true, blocking: true, tier: "hard" },
  { id: "tsc", label: "Type-check saja", cmd: "npx tsc --noEmit", enabled: false, blocking: true, tier: "hard" },
  { id: "test", label: "Test otomatis", cmd: "npm test", enabled: true, blocking: true, tier: "hard" },
  { id: "lint", label: "Lint & kode mati", cmd: "npm run lint", enabled: true, blocking: false, tier: "hard" },
  { id: "perf", label: "Lighthouse (HP lambat)", cmd: "npx lighthouse http://localhost:3000 --output=json --only-categories=performance --quiet --chrome-flags=\"--headless\"",
    enabled: false, blocking: false, tier: "hard", metrics: { firstContentfulPaint_ms: 1500, interactive_ms: 3500, totalByteWeight_kb: 600 } }
];
