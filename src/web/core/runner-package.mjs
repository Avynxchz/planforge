/* PlanForge core: AGENTS.md, paket runner, dan handoff GitHub. */
import { AGENT_ADAPTERS } from "../../shared/agent-contracts.mjs";
import { defaultGates, planTaskList, planBundleJson, freshStateJson } from "./plan-workspace.mjs";
import { starterAktif, starterMeta, starterLockLines, starterContractLines, starterFileEntries } from "./starter.mjs";
import { connNama, connPrompt, connConfigJson } from "./connect.mjs";
import { gateCounts } from "./gate-counts.mjs";
import { shellQ, runnerCommand } from "./runner.mjs";
import { prdToMd, featuresToMd, roadmapToMd, tasksToMd, buildAgentPrompt } from "./render.mjs";

export function agentsMd(docs, gates, opts){
  opts = opts || {};
  /* stempel waktu = kapan RENCANANYA dibuat, bukan kapan file ini dibaca ulang */
  const d = (docs && docs.generatedAt ? String(docs.generatedAt).slice(0,16) : new Date().toISOString().slice(0,16)).replace("T"," ");
  const ts = planTaskList(docs), c = gateCounts(gates), L = gates.limits || {};
  const feat = (docs.prd && docs.prd.project_name) || (docs.clarify && docs.clarify.project_name) || "proyek ini";
  const fullOrder = c.full.map((g,i)=>(i+1) + ". " + g.label + " — " + String(g.prompt||"").split(". ")[0] + ".");
  const out = [];
  out.push("# " + feat + " — cara kerja agen (PlanForge)");
  out.push("");
  out.push("Rencana ini dibangkitkan PlanForge pada " + d + " UTC. Yang diikat di sini: **daftar task di"
    + " `.planforge/plan.json`** dan **gerbang kualitas di `.planforge/gates.json`**. Total " + ts.length
    + " task, " + c.hard.length + " gerbang keras (" + c.hardBlocking.length + " menahan loop), "
    + c.full.length + " reviewer penuh tiap " + (L.fullEvery || 6) + " task.");
  out.push("");
  if(starterAktif(opts)){
    const m = starterMeta(), p = m.perintah || {};
    out.push("## Fondasi starter — kode SUDAH ADA; lingkungan belum diverifikasi");
    out.push("");
    out.push(...starterLockLines(opts));
    out.push("");
    out.push(...starterContractLines(opts));
    out.push("Tes sumber starter bukan bukti lingkungan target. Urutan persiapan lokal setelah pengguna menyetujui unduhan dependency dan target DB:");
    out.push("");
    out.push("```");
    out.push("node worker.mjs doctor --environment");
    out.push("node worker.mjs setup-env");
    out.push(p.install || "npm install");
    out.push("# periksa DATABASE_URL di .env.local / .env yang sudah ada; jangan menimpa konfigurasi pengguna");
    out.push("# jika memakai Docker lokal yang sudah terpasang dan disetujui: docker compose up -d db");
    out.push(p.migrasi || "npm run migrate");
    out.push("# seed opsional hanya untuk database demo: " + (p.seed || "npm run seed"));
    out.push(p.dev || "npm run dev");
    out.push("```");
    out.push("");
    out.push("Auth sesi (login/logout/me), tabel users/sessions/items, middleware proteksi /dashboard, contoh CRUD items, Dockerfile + compose, dan test lib sudah terpasang."
      + " Task kamu = DELTA di atasnya: tambah tabel/kolom lewat db/schema.sql atau runner migrasi baru yang direncanakan eksplisit, endpoint/halaman baru, ubah perilaku yang ada."
      + " JANGAN membuat ulang login/DB/kerangka/docker/test. `verification` boleh memakai `" + (p.test || "npm test") + "` / `npm run build` plus test baru untuk delta.");
    out.push("");
  }
  out.push("## Dua cara jalan — pilih satu, jangan dua-duanya bersamaan");
  out.push("");
  out.push("**A. Otomatis penuh (diem aja).** Runner yang menggerakkan agen lewat CLI:");
  out.push("");
  out.push("```");
  out.push(runnerCommand(gates, opts));
  out.push("node " + shellQ(opts.workerPath || "worker.mjs") + (opts.projectDir ? " --dir " + shellQ(opts.projectDir) : "") + " status        # posisi sekarang, tanpa biaya");
  out.push("node " + shellQ(opts.workerPath || "worker.mjs") + (opts.projectDir ? " --dir " + shellQ(opts.projectDir) : "") + " run --dry-run  # lihat prompt dulu, tidak memanggil agen");
  out.push("```");
  out.push("");
  out.push("Runner mengerjakan satu task → gerbang keras → **perintah `verification` task itu dijalankan ulang oleh worker** → reviewer ringan → (tiap " + (L.fullEvery || 6) + " task"
    + (L.fullAtMilestoneEnd ? " atau di akhir milestone" : "") + ") gerbang penuh → commit → task berikut."
    + " Berhenti sendiri kalau budget `" + (L.maxCalls || "-") + "` panggilan habis, `" + (L.maxCallsPerRun == null ? "-" : L.maxCallsPerRun) + "` panggilan sesi ini habis, biaya tercatat melewati `"
    + (L.maxCostUsd == null ? "tanpa batas" : "$" + L.maxCostUsd) + "`, atau "
    + (L.maxConsecutiveFails || 3) + " task gagal beruntun. Log lengkap: `.planforge/RUN_LOG.md`.");
  out.push("");
  out.push("Plafon biaya bawaan **$0**: agen yang melaporkan biaya sepeser pun langsung menghentikan loop setelah panggilan itu."
    + " Ini sengaja — supaya sesi tidur tidak diam-diam membakar kredit berbayar. Mau jalan berbayar? Naikkan `limits.maxCostUsd`"
    + " di `.planforge/gates.json` (atau `--max-cost 2`) sebelum menjalankan. `maxCostUsd` dihitung dari total biaya di `state.json`, bukan per sesi.");
  out.push("");
  out.push("Budget panggilan bawaan (`" + (L.maxCalls || "-") + "`) sering lebih kecil dari yang dibutuhkan rencana ini."
    + " `node " + shellQ(opts.workerPath || "worker.mjs") + (opts.projectDir ? " --dir " + shellQ(opts.projectDir) : "") + " run --auto-budget` menghitung sendiri dari task yang belum selesai:"
    + " kerja + reviewer ringan tiap task, gerbang penuh tiap " + (L.fullEvery || 6) + " task" + (L.fullAtMilestoneEnd ? " dan tiap akhir milestone" : "") + ", plus cadangan ronde perbaikan."
    + " `--auto-budget` hanya menaikkan jumlah panggilan — **plafon biaya tidak pernah disentuh**, jadi agen berbayar tetap berhenti sendiri.");
  out.push("");
  out.push("**B. Agen IDE yang mengerjakan (Antigravity/Cursor/Claude di dalam editor).**"
    + " Connector MCP \"" + connNama(opts) + "\" memberi tool `next_task`, `get_task`, `mark_done`, `mark_failed`, `mark_blocked`, `plan_status`, `gate_list`, `audit_plan`."
    + " Kalau connector belum muncul, JANGAN mengedit `.planforge/state.json` pakai tangan — pakai `node worker.mjs verify <T-xxx>` di folder target yang sudah dipastikan benar.");
  out.push(connPrompt(opts));
  out.push("");
  out.push("## Aturan yang wajib diikuti agen");
  out.push("");
  out.push("1. Satu waktu satu task. Task berikutnya = task paling awal dengan status \"belum mulai\""
    + " yang semua `depends_on`-nya berstatus \"selesai\". Jangan melompat, jangan mengerjakan sebagian task lain.");
  out.push("2. Kerjakan persis isi task: `description`, `acceptance_criteria`, `verification`, `files_or_areas`."
    + " Fitur di luar task = temuan audit, bukan bonus. Sebelum task pertama, panggil `audit_plan` — kalau task yang di depanmu"
    + " berstatus error di sana (struktur rusak atau verification bukan perintah; biner/dependency/DB belum ada = saran lingkungan, bukan error struktur), laporkan dan berhenti, jangan ganti pakai bukti setara.");
  out.push("3. Setelah selesai, jalankan sendiri gerbang keras ini **dan perintah `verification` di kartu task**, lalu tunjukkan outputnya"
    + " (`mark_done` menjalankan keduanya lagi dan MENOLAK kalau masih merah, kalau `verification`-nya cuma kalimat, atau kalau tidak ada file proyek yang berubah): "
    + (c.hard.length ? c.hard.map(h=>"`" + h.cmd + "`").join(" , ") : "(belum diisi — sunting gates.json lewat tab Runner)"));
  out.push("3b. Kalau task itu punya `behavior`, build/test hijau BELUM cukup. Worker membuka Edge/Chrome headless dan mengukur sendiri"
    + " jumlah pixel canvas, teks sesudah klik, request yang benar-benar terkirim, error console, dan overflow di viewport yang ditentukan."
    + " Satu check gagal = task DITOLAK. Pastikan library yang kamu pakai benar-benar dimuat di halaman dan selector yang diukur benar-benar ada."
    + " Jangan mengubah `plan.json` atau check-nya supaya lolos — yang harus berubah kodenya.");
  out.push("4. Kalau salah satu gerbang gagal: perbaiki, jalankan lagi, maksimal " + (L.fixRounds == null ? 2 : L.fixRounds)
    + " ronde. Setelah itu masih gagal → tandai task \"gagal\" beserta pesan gerbangnya, jangan lanjut ke task yang bergantung padanya.");
  out.push("5. Tidak ada informasi yang hilang? Jangan mengarang. Panggil `mark_blocked` dengan id + alasan satu kalimat (bukan `mark_failed`)."
    + " Termasuk data: DILANG mengisi DB proyek dengan baris karangan cuma supaya endpoint kelihatan berisi — pakai fixture CSV atau DB sementara.");
  out.push("6. Satu task selesai = satu commit `" + (ts[0] ? ts[0].id : "T-001") + ": <judul>`."
    + (L.autoCommit === false
      ? " autoCommit mati di gates.json — kamu yang kommit sendiri, pakai path eksplisit, JANGAN `git add -A`."
      : " worker yang mengkommitnya begitu `mark_done` bilang ok, jadi kamu tidak perlu kommit lagi (kommit dua kali = konflik palsu)."));
  out.push("7. Tiap " + (L.fullEvery || 6) + " task" + (L.fullAtMilestoneEnd ? " atau saat task berikutnya pindah milestone" : "")
    + ", jalankan gerbang penuh ini **berurutan**, baru boleh lanjut. Tiap gerbang wajib membalas JSON verdict-nya;"
    + " balasan kosong, amplop error, atau tanpa verdict = gerbang itu TIDAK membuktikan apa-apa, runner berhenti dan"
    + " penanda audit tidak maju. Jangan menganggap rentang task itu sudah pernah diaudit:");
  out.push("");
  out.push(fullOrder.join("\n"));
  out.push("");
  out.push("8. Task yang naik ke status \"selesai\" wajib punya bukti verifikasi nyata. Worker sendiri yang menjalankan perintah"
    + " `verification` dan menyimpan exit code + output aslinya di `state.json` → `tasks[id].gate.verify` dan `note`."
    + " Untuk task UI, hasil pengukuran browser ikut tersimpan di `tasks[id].gate.behavior` (angka pixel, daftar request, error console)."
    + " Tulisanmu di `mark_done` disimpan sebagai klaim, bukan sebagai bukti.");
  out.push("");
  out.push("9. Connector MCP itu proses yang nyala sekali dan tidak reload. Sebelum task pertama: jalankan"
    + " `node worker.mjs doctor` di terminal. Kalau keluar `!! pid ... KODE LAMA`, balasan `mark_done` dari connector"
    + " itu tidak akan pernah mengkommit apa pun — STOP, salin barisnya ke laporan, suruh me-restart connector."
    + " (Banner `!! BUILD LAMA` di jawaban tool hanya bisa muncul kalau prosesnya sudah kode baru, jadi jangan percaya"
    + " pada ketiadaannya.)");
  out.push("10. Gerbang merah karena interpreter (`python` di shell yang satu punya fastapi/pytest, di shell yang lain"
    + " tidak)? Jalankan `node worker.mjs pin`. Dia mencoba interpreter yang ada di PATH satu per satu, menulis path"
    + " absolutnya ke npm script sampai gerbang blocking hijau, dan mengembalikan package.json seperti semula kalau"
    + " semuanya merah. Jangan mengakalinya dengan menyetel PATH sendiri atau mengubah isi gerbang.");
  out.push("11. Kalau `next_task` menjawab **BERHENTI** karena budget sesi/plafon biaya: jangan ambil task lagi, jangan"
    + " menyunting `state.json` pakai tangan, dan jangan mengarang bukti. Salin barisnya ke laporan — manusia yang"
    + " memutuskan menaikkan `limits.maxCallsPerRun` / `maxCostUsd` lalu me-restart connector.");
  out.push("12. Kalau `next_task` menyerahkan `GILIRAN-n` (gerbang penuh: audit, perbaikan, refactor, performa), kerjakan itu"
    + " dulu tanpa menambah fitur, lalu `mark_done` dengan id `GILIRAN-n` dan hasil tiap langkah (`audit: ...`, `fixbug: ...`, dst)."
    + " Worker menjalankan ulang tes + browser task yang dicakup; task baru baru keluar sesudah giliran diterima.");
  out.push("13. **LOOP OTOMATIS — satu trigger = semua task.** Sesudah `mark_done` diterima, panggil `next_task` lagi dan kerjakan"
    + " task berikutnya tanpa minta manusia melanjutkan tiap task. Jangan berhenti cuma karena satu task selesai. Ulangi sampai"
    + " `next_task` menjawab **BERHENTI** (budget habis / terkendala / giliran gagal) atau \"tidak ada task\" (semua selesai), atau kamu"
    + " sendiri memanggil `mark_blocked`. Budget (`maxCalls`/`maxCallsPerRun`/`maxCostUsd`) yang membatasi, bukan kamu berhenti sendiri.");
  out.push("");
  out.push("## Format balasan untuk runner");
  out.push("");
  out.push("Blok JSON di baris terakhir jawabanmu — runner membaca objek JSON **terakhir** yang utuh:");
  out.push("");
  out.push("```");
  out.push('selesai   -> {"done":true,"verification":"<perintah yang kamu jalankan + output aslinya>","files":["..."]}');
  out.push('mentok    -> {"blocked":true,"reason":"<informasi apa yang hilang>"}');
  out.push('reviewer  -> {"pass":false,"issues":["<temuan + file:line>"],"fix":"<yang harus dibetulkan>"}');
  out.push("```");
  out.push("");
  out.push("## Isi plan.json");
  out.push("");
  out.push("`brief` (ide + asumsi) · `prd` (requirements R-xxx, non_functional N-xxx, features) ·"
    + " `roadmap` (milestone M-xxx) · `tasks.tasks` (T-xxx: title, feature, status, description,"
    + " acceptance_criteria, verification, behavior, files_or_areas, requirement_refs, milestone_ref, depends_on, size, agent_hint).");
  out.push("`behavior` = {url, viewport, server:{cmd,ready,timeoutSec}, settleMs, checks[]} yang diukur worker di browser sungguhan."
    + " Wajib untuk task UI; task backend murni boleh tanpa. `ui:false` = keputusan manusia bahwa task itu tidak menyentuh UI"
    + " (audit tetap menandainya, jadi jangan dipakai untuk mengakali check yang gagal).");
  out.push("Status yang dikenal runner: `belum mulai`, `sedang`, `selesai`, `gagal`, `terkendala` (lewat `mark_blocked`).");
  out.push("");
  return out.join("\n");
}

/* paket yang ditaruh di folder proyek: .planforge/ + AGENTS.md + .agents/mcp_config.json (+ worker.mjs kalau ada) */
export function runnerBundle(docs, issues, gates, opts){
  opts = opts || {};
  gates = gates || defaultGates("agy");
  /* paket harus mengikuti aplikasi yang dipilih, bukan selalu Antigravity — produk ini dipakai orang lain.
     cfg.targetAgent berisi label UI, jadi terjemahkan label/kunci ke kunci adaptor yang sah. */
  const kunciAdaptor = (()=>{
    const nama = String(opts.agent == null ? "" : opts.agent).trim();
    if(!nama) return "agy";
    if(AGENT_ADAPTERS[nama]) return nama;
    const kecil = nama.toLowerCase();
    const label = { "claude code":"claude", "cursor":"cursor", "qoder":"qoder", "codex":"codex", "umum":"generic" }[kecil];
    if(label) return label;
    for(const k of Object.keys(AGENT_ADAPTERS))
      if(k.toLowerCase() === kecil || String(AGENT_ADAPTERS[k].label || "").toLowerCase() === kecil) return k;
    return "generic";
  })();
  const a = AGENT_ADAPTERS[kunciAdaptor];
  const f = [];
  if(opts.workerSource) f.push({ name:"worker.mjs", data:opts.workerSource });
  f.push({ name:".planforge/plan.json", data:planBundleJson(docs, issues) });
  f.push({ name:".planforge/gates.json", data:JSON.stringify(gates, null, 1) });
  f.push({ name:".planforge/state.json", data:JSON.stringify(freshStateJson(docs), null, 1) });
  f.push({ name:a.rules, data:agentsMd(docs, gates, opts) });
  /* aplikasi yang cuma punya pengaturan global (Qoder, Codex) tetap dapat bloknya sebagai file buat disalin */
  f.push({ name:a.file || ".planforge/mcp-universal.json", data:connConfigJson(kunciAdaptor, opts) });
  if(starterAktif(opts)) for(const e of starterFileEntries()) f.push(e);
  return f;
}

/* ---------- handoff GitHub (opsional): susun file + urutan Git Data API ----------
   Token TIDAK masuk ke sini: transportasi (http) disuntik dari DOM dan sudah membawa
   Authorization. Core hanya menyusun urutan request, jadi bisa diuji dengan mock tanpa
   jaringan dan tanpa menyentuh token. MCP/Connect tetap jalur utama. */
export function githubPushFiles(docs, opts){
  opts = opts || {};
  const cfg = opts.cfg || {};
  const issues = opts.issues || [];
  const f = [];
  if(docs && docs.prd){
    f.push({path:"PRD.md", content:prdToMd(docs.prd)});
    if(docs.prd.features) f.push({path:"FEATURES.md", content:featuresToMd(docs.prd)});
  }
  if(docs && docs.roadmap) f.push({path:"ROADMAP.md", content:roadmapToMd(docs.roadmap)});
  if(docs && docs.tasks) f.push({path:"TASKS.md", content:tasksToMd(docs.tasks)});
  f.push({path:"AGENT_PROMPT.txt", content:buildAgentPrompt(cfg, docs)});
  /* Satu sumber untuk dua salinan: root plan.json harus sama persis dengan .planforge/plan.json,
     termasuk planFingerprint dan prd.overview.summary yang dibaca worker. */
  const planJson = planBundleJson(docs, issues);
  f.push({path:"plan.json", content:planJson});
  for(const r of runnerBundle(docs, issues, opts.gates, {agent:cfg.targetAgent, starter:cfg.starter, workerSource:opts.workerSource}))
    f.push({path:r.name, content:r.name === ".planforge/plan.json" ? planJson : r.data});
  return f;
}
export async function githubPush(files, opts, http){
  opts = opts || {};
  const repo = String(opts.repo||"").trim();
  const branch = String(opts.branch||"main").trim() || "main";
  const message = String(opts.message||"PlanForge: plan + bundel handoff");
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)) return {ok:false, step:"repo", error:"repo harus berbentuk owner/nama"};
  if(!/^[\w][\w./-]*$/.test(branch)) return {ok:false, step:"branch", error:"nama branch tidak sah"};
  if(!Array.isArray(files)||!files.length) return {ok:false, step:"files", error:"tidak ada file untuk dipush"};
  const base = "/repos/"+repo;
  const fail = (step,r)=>({ok:false, step, status:r&&r.status, error:(r&&r.json&&r.json.message)||("HTTP "+(r&&r.status))});
  let r = await http("GET", base+"/git/ref/heads/"+branch);
  let baseSha = null;
  if(r.status===200) baseSha = r.json && r.json.object && r.json.object.sha;
  else if(r.status!==404) return fail("ref", r);
  let baseTree = null;
  if(baseSha){
    r = await http("GET", base+"/git/commits/"+baseSha);
    if(r.status!==200) return fail("base-commit", r);
    baseTree = r.json && r.json.tree && r.json.tree.sha;
  }
  const tree = [];
  for(const f of files){
    r = await http("POST", base+"/git/blobs", {content:String(f.content==null?"":f.content), encoding:"utf-8"});
    if(r.status!==201) return fail("blob:"+f.path, r);
    tree.push({path:f.path, mode:"100644", type:"blob", sha:r.json.sha});
  }
  const treeBody = {tree};
  if(baseTree) treeBody.base_tree = baseTree;
  r = await http("POST", base+"/git/trees", treeBody);
  if(r.status!==201) return fail("tree", r);
  r = await http("POST", base+"/git/commits", {message, tree:r.json.sha, parents: baseSha?[baseSha]:[]});
  if(r.status!==201) return fail("commit", r);
  const commitSha = r.json.sha;
  if(baseSha){
    r = await http("PATCH", base+"/git/refs/heads/"+branch, {sha:commitSha, force:false});
    if(r.status!==200) return fail("update-ref", r);
  } else {
    r = await http("POST", base+"/git/refs", {ref:"refs/heads/"+branch, sha:commitSha});
    if(r.status!==201) return fail("create-ref", r);
  }
  return {ok:true, commit:commitSha, files:files.length, branch, url:"https://github.com/"+repo+"/commit/"+commitSha};
}
