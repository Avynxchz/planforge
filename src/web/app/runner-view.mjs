/* Runner panel renderer. */
import { esc } from "./dom.mjs";
import { readCfg, state } from "./state.mjs";
import { gates, pkgDir, pkgOpts } from "./runner-config.mjs";
import { connectConn, connectPanel, perluSinkron, progresPanel } from "./connect.mjs";
import { githubPanel } from "./artifacts.mjs";
import { AGENT_ADAPTERS, connConfigJson, connNama, connPrompt } from "../core/connect.mjs";
import { gateCounts } from "../core/gate-counts.mjs";
import { normStatus } from "../core/plan-normalize.mjs";
import { collectPlanIssues, rubrikRencana } from "../core/plan-readiness.mjs";
import { AGENT_PRESETS, hitungBudget, planTaskList, sisaMilestone, taskMuat } from "../core/plan-workspace.mjs";
import { runnerCommand } from "../core/runner.mjs";
import { agentsMd } from "../core/runner-package.mjs";
import { starterAktif } from "../core/starter.mjs";

export function renderRunner(){
  const g = gates(), c = gateCounts(g), d = state.docs, ts = planTaskList(d);
  const ready = !ts.length ? 0 : ts.filter(t=>(normStatus(t.status) || "belum mulai") !== "selesai").length;
  const pk = Object.assign({ agent: connectConn(), starter: readCfg().starter }, pkgOpts());
  const wk = pk.workerPath || "worker.mjs";
  const ck = connectConn(), ad = AGENT_ADAPTERS[ck] || AGENT_ADAPTERS.agy;
  const cmd = runnerCommand(g, pk);
  const h = [];
  h.push("<h1>Eksekusi rencana — pilih chat agen atau runner CLI</h1>");
  h.push("<p class='hint'>Untuk bekerja lewat chat WorkBuddy atau IDE, gunakan <b>Connect</b>, lalu kirim instruksi di aplikasi itu."
    + " Alternatifnya, runner CLI memanggil agen otomatis setelah kamu menjalankan perintahnya; outputnya ada di terminal dan log, bukan selalu di chat. Jangan jalankan kedua mode bersamaan. "
    + "<b>Task tersisa " + ready + " dari " + ts.length + ".</b></p>");
  h.push("<div class='bar'>"
    + "<button class='sm' data-act='gCmd'>⧉ salin perintah jalan</button>"
    + "<button class='sm go' data-act='gPkg'>⬇ unduh paket " + (state.workerSource ? "+ worker.mjs" : "worker") + "</button>"
    + "<button class='sm' data-act='gReset'>↺ pakai bawaan</button>"
    + "<span class='cost'>" + (state.workerSource ? "worker.mjs terbaca, ikut ke paket" : "worker.mjs belum terbaca — jalankan `node worker.mjs embed` lalu muat ulang") + "</span></div>");
  if(state.runnerNote) h.push("<p class='" + (/DITAHAN|ditahan|gagal|Berhenti/i.test(state.runnerNote) ? "warn" : "ok") + "'>" + esc(state.runnerNote) + "</p>");
  /* rubrik kualitas + gerbang 1 klik: tampil di atas panel Connect supaya kelihatan duluan */
  const rubrik = rubrikRencana(d, collectPlanIssues(d), starterAktif(readCfg()));
  h.push("<p class='" + (rubrik.siap ? "ok" : "warn") + "'><b>Kualitas rencana: " + esc(rubrik.label) + " (skor " + rubrik.skor + ")</b>"
    + (rubrik.siap ? " — aman dikirim ke folder proyek." : " — " + esc(rubrik.error.slice(0,3).join(" · "))
      + (rubrik.error.length > 3 ? " (+" + (rubrik.error.length-3) + " lagi)" : "") + ". Connect ditahan sampai beres.") + "</p>");
  if(rubrik.warn.length) h.push("<details class='environment-hints'><summary>Persiapan lingkungan - tidak menahan Connect</summary><ul>"
    + rubrik.warn.map(s=>"<li>" + esc(s) + "</li>").join("") + "</ul></details>");
  h.push("<div class='bar'>"
    + "<button class='sm' data-act='gBetulkanAlias'>Betulkan alat ukur yang jelas</button>"
    + (!rubrik.siap ? "<button class='sm' data-act='tambal'>Minta AI tambal (" + rubrik.error.length + " celah)</button>" : "")
    + (perluSinkron() ? "<button class='sm go' data-act='cSinkron'>Sinkron ke folder (1 klik)</button>" : "")
    + "</div>");
  if(perluSinkron()) h.push("<p class='warn'>Rencana berubah sejak Connect terakhir"
    + (state.lastConnect ? " ke <code>" + esc(state.lastConnect.path) + "</code>" : "")
    + ". Klik <b>Sinkron ke folder</b> — tidak perlu pilih folder, ketik path, atau daftar ulang connector.</p>");
  if(!ts.length) h.push("<p class='warn'>Belum ada task. Jalankan pipeline dulu di kiri — paket worker tetap bisa diunduh, tapi isinya kosong.</p>");

  h.push("<div id='pf-connect'>" + connectPanel() + "</div>");
  h.push(githubPanel());

  h.push(progresPanel());

  h.push("<h2>1. Agen yang dipanggil runner CLI</h2>");
  h.push("<p class='hint'>Preset ini hanya untuk mode runner CLI, bukan pilihan model di chat WorkBuddy atau IDE. Login dan kuota CLI dapat berbeda dari aplikasi desktop.</p>");
  h.push("<div class='row'><div><label>Preset agen</label><select data-g='__agent'>"
    + Object.keys(AGENT_PRESETS).map(k=>"<option value='" + k + "'" + (g.agent.name === k ? " selected" : "") + ">" + esc(AGENT_PRESETS[k].label) + "</option>").join("")
    + "</select></div>"
    + "<div style='flex:0 0 110px'><label>Timeout / panggilan (menit)</label><input type='text' data-g='agent.timeoutMin' value='" + esc(g.agent.timeoutMin || 20) + "'></div></div>");
  h.push("<div class='row'><div><label>Perintah</label><input type='text' data-g='agent.cmd' value='" + esc(g.agent.cmd) + "' placeholder='agy'></div></div>");
  h.push("<label>Argumen (satu per baris; <code>{PROMPT}</code> diganti isi task, <code>{SESSION}</code> untuk melanjutkan sesi)</label>");
  h.push("<textarea data-g='agent.args' style='min-height:74px'>" + esc((g.agent.args || []).join("\n")) + "</textarea>");
  h.push("<label>Argumen saat melanjutkan sesi yang sama (kosong = panggilan baru tiap prompt)</label>");
  h.push("<textarea data-g='agent.contArgs' style='min-height:60px'>" + esc((g.agent.contArgs || []).join("\n")) + "</textarea>");
  h.push("<p class='hint'>Antigravity CLI: <code>agy -p \"&lt;prompt&gt;\" --output-format json</code>. Runner membaca field"
    + " <code>result</code> dan <code>session_id</code> dari JSON itu; keluaran polos juga diterima selama blok JSON terakhir bisa dibaca."
    + " Tanpa <code>--dangerously-skip-permissions</code> (atau daftar izin di pengaturan Antigravity), tiap perintah agen tetap minta klik <i>Allow</i> — di situ \"diem aja\" baru benar-benar tercapai, dan itu tanggung jawabmu sendiri: commit per task adalah satuan pembatalk.</p>");

  h.push("<h2>2. Ritme &amp; rem otomatis</h2>");
  h.push("<div class='row'>"
    + "<div><label>Gerbang penuh tiap N task</label><input type='text' data-g='limits.fullEvery' value='" + esc(g.limits.fullEvery) + "'></div>"
    + "<div><label>Budget panggilan agen</label><input type='text' data-g='limits.maxCalls' value='" + esc(g.limits.maxCalls) + "'></div>"
    + "<div><label>Stop setelah N gagal beruntun</label><input type='text' data-g='limits.maxConsecutiveFails' value='" + esc(g.limits.maxConsecutiveFails) + "'></div></div>");
  h.push("<div class='row'>"
    + "<div><label>Plafon biaya (USD, kosong = tanpa batas)</label><input type='text' data-g='limits.maxCostUsd' value='" + esc(g.limits.maxCostUsd) + "' placeholder='0'></div>"
    + "<div><label>Budget panggilan per sesi</label><input type='text' data-g='limits.maxCallsPerRun' value='" + esc(g.limits.maxCallsPerRun) + "' placeholder='40'></div>"
    + "<div><label>Plafon token (kosong = tanpa batas)</label><input type='text' data-g='limits.maxTokens' value='" + esc(g.limits.maxTokens) + "' placeholder='kosong'></div></div>");
  h.push("<p class='hint'>Plafon biaya <b>0</b> menghentikan runner setelah biaya yang dilaporkan agen melebihi $0."
    + " Ini bukan jaminan gratis: panggilan yang sudah terjadi bisa tetap ditagih, dan laporan $0 belum tentu mencerminkan tagihan provider."
    + " Periksa harga serta batas kuota di aplikasi/provider sebelum menjalankan. Yang dihitung total biaya tercatat di <code>state.json</code>, bukan per sesi.</p>");
  h.push("<div class='row'>"
    + "<div><label>Ronde perbaikan per gerbang gagal</label><input type='text' data-g='limits.fixRounds' value='" + esc(g.limits.fixRounds) + "'></div>"
    + "<div><label>&nbsp;</label><div class='check' style='margin-top:0'><input type='checkbox' id='gME' data-g='limits.fullAtMilestoneEnd'" + (g.limits.fullAtMilestoneEnd ? " checked" : "") + "><label for='gME' style='margin:0'>gerbang penuh juga di akhir milestone</label></div></div>"
    + "<div><label>&nbsp;</label><div class='check' style='margin-top:0'><input type='checkbox' id='gAC' data-g='limits.autoCommit'" + (g.limits.autoCommit !== false ? " checked" : "") + "><label for='gAC' style='margin:0'>commit git tiap task selesai</label></div></div></div>");
  const sisaM = sisaMilestone(d.roadmap && d.roadmap.milestones, ts, t=>normStatus(t.status) || "belum mulai");
  const b = hitungBudget(ready, g, sisaM);
  const kurang = [];
  if(g.limits.maxCalls != null && g.limits.maxCalls < b.total)
    kurang.push("<code>maxCalls " + g.limits.maxCalls + "</code> cuma muat ± <b>" + taskMuat(g.limits.maxCalls, g, sisaM) + " task</b>");
  if(g.limits.maxCallsPerRun != null && g.limits.maxCallsPerRun < b.total)
    kurang.push("<code>maxCallsPerRun " + g.limits.maxCallsPerRun + "</code> memotong satu sesi di ± <b>" + taskMuat(g.limits.maxCallsPerRun, g, sisaM) + " task</b> — sisanya baru jalan kalau runner dijalankan lagi");
  h.push("<p class='hint'>Menghabiskan <b>" + ready + " task tersisa</b> dengan ritme ini butuh ± <b>" + b.total + "</b> panggilan agen:"
    + " " + b.kerja + " kerja + review ringan, " + b.penuh + " gerbang penuh (" + b.putaran + " putaran × " + c.full.length + " reviewer), " + b.cadangan + " cadangan ronde perbaikan."
    + (kurang.length ? "<br><b>Budget sekarang belum cukup:</b> " + kurang.join("; ") + "." : " Budget sekarang cukup untuk satu jalan penuh.")
    + " Angka ini langit-langit, bukan target belanja — kelebihan tidak bikin lebih boros.</p>");
  h.push("<div class='bar'><button class='sm' data-act='gBudget'>⇪ set budget ke " + b.total + " panggilan</button>"
    + "<span class='cost'>plafon biaya tidak ikut diubah</span></div>");

  h.push("<h2>3. Gerbang keras — jalan tiap task, angka bukan klaim</h2>");
  h.push("<p class='hint'>Perintah sungguhan yang dieksekusi runner. Centang \"menahan\" = task dianggap gagal dan"
    + " runner mengirim prompt perbaikan sebelum lanjut. Lighthouse memakai angka yang diukur, bukan laporan model.</p>");
  (g.hard || []).forEach((x,i)=>{
    h.push("<div class='srow" + (x.enabled ? " on" : "") + "' style='align-items:flex-start'>"
      + "<input type='checkbox' data-g='hard." + i + ".enabled'" + (x.enabled ? " checked" : "") + " style='margin-top:6px'>"
      + "<div style='flex:1'>"
      + "<div class='row'><div style='flex:0 0 30%'><label>Nama</label><input type='text' data-g='hard." + i + ".label' value='" + esc(x.label) + "'></div>"
      + "<div><label>Perintah</label><input type='text' data-g='hard." + i + ".cmd' value='" + esc(x.cmd) + "'></div>"
      + "<div style='flex:0 0 86px'><label>Menahan</label><input type='checkbox' id='hb" + i + "' data-g='hard." + i + ".blocking'" + (x.blocking !== false ? " checked" : "") + " style='margin-top:8px'><label for='hb" + i + "' style='margin:0;font-size:11px'>biar gagal</label></div>"
      + "<div style='flex:0 0 auto'><label>&nbsp;</label><button class='sm' data-act='gDelHard' data-i='" + i + "'>hapus</button></div></div>"
      + (x.metrics ? "<div class='hint'>target: FCP ≤ " + x.metrics.firstContentfulPaint_ms + "ms · TTI ≤ " + x.metrics.interactive_ms + "ms · bundle ≤ " + x.metrics.totalByteWeight_kb + "kB"
          + "<input type='text' data-g='hard." + i + ".metrics.firstContentfulPaint_ms' value='" + esc(x.metrics.firstContentfulPaint_ms) + "' style='margin-top:5px'>"
          + "<input type='text' data-g='hard." + i + ".metrics.interactive_ms' value='" + esc(x.metrics.interactive_ms) + "' style='margin-top:5px'>"
          + "<input type='text' data-g='hard." + i + ".metrics.totalByteWeight_kb' value='" + esc(x.metrics.totalByteWeight_kb) + "' style='margin-top:5px'></div>" : "")
      + "</div></div>");
  });
  h.push("<button class='sm' data-act='gAddHard'>+ tambah perintah</button>");

  h.push("<h2>4. Watchlist — yang dikerjakan sebelum lanjut ke task berikutnya</h2>");
  h.push("<p class='hint'>Tier <b>ringan</b> = tiap task (mahal kalau tiap task, jadi satu reviewer pendek saja)."
    + " Tier <b>penuh</b> = lima langkah punyamu: audit → fix bug → refactor &amp; buang kode mati → performa → tambahanmu,"
    + " dijalankan tiap " + g.limits.fullEvery + " task / akhir milestone. Prompt di bawah dikirim apa adanya; token"
    + " <code>{FROM}</code> dan <code>{TO}</code> diisi runner dengan rentang task yang sudah selesai.</p>");
  (g.reviews || []).forEach((x,i)=>{
    h.push("<div class='srow" + (x.enabled ? " on" : "") + "' style='align-items:flex-start'>"
      + "<input type='checkbox' data-g='reviews." + i + ".enabled'" + (x.enabled ? " checked" : "") + " style='margin-top:6px'>"
      + "<div style='flex:1'>"
      + "<div class='row'><div><label>Nama gerbang</label><input type='text' data-g='reviews." + i + ".label' value='" + esc(x.label) + "'></div>"
      + "<div style='flex:0 0 118px'><label>Tier</label><select data-g='reviews." + i + ".tier'>"
      + ["light","full"].map(t=>"<option value='" + t + "'" + (x.tier === t ? " selected" : "") + ">" + (t === "light" ? "ringan / tiap task" : "penuh / berkala") + "</option>").join("")
      + "</select></div>"
      + "<div style='flex:0 0 auto'><label>&nbsp;</label><button class='sm' data-act='gDelFull' data-i='" + i + "'>hapus</button></div></div>"
      + "<label>Prompt</label><textarea data-g='reviews." + i + ".prompt' style='min-height:74px'>" + esc(x.prompt) + "</textarea>"
      + "</div></div>");
  });
  h.push("<button class='sm' data-act='gAddFull'>+ tambah prompt watchlist</button>");

  h.push("<h2>5. Cara menaruh paketnya</h2>");
  h.push("<div class='row'><div><label>Folder proyek di disk (absolut, opsional)</label>"
    + "<input type='text' data-p='dir' value='" + esc(pkgDir()) + "' placeholder='C:/Users/kamu/proyek — kosongkan kalau kamu jalan dari terminal di dalam folder itu'></div></div>");
  h.push("<p class='hint'>Kosong = perintah dan konfigurasi MCP memakai path relatif <code>worker.mjs</code>; jalankan dari folder proyek target."
    + " Tanpa <code>--dir</code>, worker mencari rencana dari folder kerja proses terlebih dahulu, baru dari lokasi worker — jadi bisa memilih proyek lain."
    + " Untuk connector global atau worker terpisah, isi folder absolut agar paket menyertakan path worker dan <code>--dir</code> yang jelas"
    + (pk.projectDir ? " <code>" + esc(pk.projectDir) + "</code>" : "") + ". Tetap cocokkan folder lewat <code>plan_status</code> sebelum bekerja.</p>");
  const mcpFile = ad.file || ".planforge/mcp-universal.json";
  h.push("<pre>" + esc([
    "1. unduh paketnya, ekstrak DI DALAM folder proyek (jangan timpa kode yang sudah ada)",
    "2. hasil ekstrak: worker.mjs, " + ad.rules + ", .planforge/plan.json, .planforge/gates.json, .planforge/state.json, " + mcpFile,
    "3. cocokkan gerbang keras dengan proyekmu (perintah build/test/lint yang benar)",
    "4. tes dulu tanpa biaya:   node " + wk + " run --dry-run",
    "5. satu task buat lihat-lihat: node " + wk + " run --only " + (ts[0] ? ts[0].id : "T-001"),
    "6. lepas:                   " + cmd,
    "7. pantau:                  node " + wk + " status   atau buka .planforge/RUN_LOG.md"
  ].join("\n")) + "</pre>");
  let mcpHint;
  if(ad.globalPath){
    mcpHint = "Supaya " + esc(ad.label) + " bisa baca-tulis state lewat tool (jalur B), gabungkan entri <code>mcpServers." + esc(connNama(pk)) + "</code> ke <code>" + esc(ad.globalPath) + "</code> (global) tanpa menghapus server lain, termasuk legacy <code>planforge</code>."
      + " " + esc(ad.label) + " TIDAK membaca <code>" + esc(mcpFile) + "</code> di folder proyek — file itu cuma tempat menyalin bloknya; restart aplikasi tidak membuat file proyek terbaca.";
  } else if(ad.file && ad.file !== ".planforge/mcp-universal.json"){
    mcpHint = "Supaya " + esc(ad.label) + " bisa baca-tulis state lewat tool (jalur B), blok <code>mcpServers." + esc(connNama(pk)) + "</code> ditulis ke <code>" + esc(mcpFile) + "</code> di folder proyek tanpa menghapus server lain, termasuk legacy <code>planforge</code>."
      + " " + esc(ad.label) + " membaca file itu dari folder proyek; restart aplikasi sesudah menambah server.";
  } else {
    mcpHint = "Supaya " + esc(ad.label) + " bisa baca-tulis state lewat tool (jalur B), salin blok <code>mcpServers." + esc(connNama(pk)) + "</code> dari <code>" + esc(mcpFile) + "</code> ke pengaturan MCP aplikasinya tanpa menghapus server lain, termasuk legacy <code>planforge</code>."
      + " " + esc(ad.label) + " tidak punya file konfigurasi proyek, jadi blok itu hanya tempat menyalin; restart saja tidak mendaftarkan connector.";
  }
  mcpHint += " Tool yang muncul: next_task, get_task, mark_done, mark_failed, mark_blocked, plan_status, gate_list, audit_plan.";
  if(ck === "agy") mcpHint += " Izin default MCP di Antigravity adalah <i>Ask</i> (minta konfirmasi per pemakaian tool) — ubah ke auto-approve hanya kalau kamu memang mau lepas tangan.";
  h.push("<p class='hint'>" + mcpHint + "</p>");
  h.push("<h2>6. Sambungkan ke agen / IDE apa pun (WorkBuddy, Cursor, VS Code, Cline, Qoder, ...)</h2>");
  h.push("<div class='row'><div><label>Pilih agennya</label><select data-p='conn'>"
    + Object.keys(AGENT_ADAPTERS).map(k=>"<option value='" + k + "'" + (k === ck ? " selected" : "") + ">" + esc(AGENT_ADAPTERS[k].label) + "</option>").join("")
    + "</select></div>"
    + "<div style='flex:0 0 170px'><label>&nbsp;</label><button class='sm' data-act='gConnCopy'>⧉ salin blok MCP</button></div></div>");
  h.push("<pre>" + esc([
    "node " + wk + " connect " + ck,
    ad.file ? "  -> nulis " + ad.file + "  (blok MCP)" : "  -> tidak ada file proyek; pakai UI aplikasinya buat tambah MCP server",
    "  -> nulis " + ad.rules + "  (instruksi cara pakai task list)",
    "",
    "lalu di " + ad.label + " tulis: Baca " + ad.rules + ". " + connPrompt(pk)
  ].join("\n")) + "</pre>");
  h.push("<p class='hint'>File konfigurasi tertulis BELUM membuktikan MCP terbaca atau terhubung. Verifikasi lewat <code>plan_status</code> sebelum bekerja.</p>");
  h.push("<p class='hint'>" + esc(ad.hint) + ". Semua agen itu memakai server MCP yang sama ( <code>worker.mjs mcp</code> ),"
    + " jadi plan, progress dan gerbangnya tetap satu sumber — pindah agen tidak mengulang kerjaan."
    + " API model saja tidak menjalankan file atau terminal di komputermu; aplikasi agen yang menyediakan alat tersebut."
    + " Provider yang sama bisa dipakai untuk coding jika didukung aplikasi agen, tetapi model dan autentikasinya diatur terpisah dari planning PlanForge.</p>");
  h.push("<details><summary class='hint'>blok MCP untuk " + esc(ad.label) + "</summary><pre>" + esc(connConfigJson(ck, pk)) + "</pre></details>");
  h.push("<h2>7. " + esc(ad.rules) + " yang akan ikut ke paket</h2>");
  h.push("<details><summary class='hint'>lihat isi lengkap (dibaca otomatis oleh agen IDE)</summary><pre>" + esc(agentsMd(d, g, pk)) + "</pre></details>");
  return h.join("\n");
}
