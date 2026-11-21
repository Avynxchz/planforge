/* Connect, synchronise and progress flows. */
import { el } from "./dom.mjs";
import { readCfg, state, tidyPlan } from "./state.mjs";
import { connectBaca, connectConn, connectTulisFile, simpanKoneksi } from "./connect.mjs";
import { ensureWorkerSource, gates, savePkgDir } from "./runner-config.mjs";
import { draw } from "./views.mjs";
import { AGENT_ADAPTERS, connEntry, connNama, rencanaTulis } from "../core/connect.mjs";
import { planFingerprint } from "../core/handoff.mjs";
import { rubrikRencana } from "../core/plan-readiness.mjs";
import { planTaskList, progresDariState } from "../core/plan-workspace.mjs";
import { runnerBundle } from "../core/runner-package.mjs";
import { starterAktif } from "../core/starter.mjs";

export async function connectSinkron(){
  const last = state.lastConnect;
  if(!last || !last.handle){ state.runnerNote = "Belum ada folder yang pernah di-Connect."; draw("runner"); return; }
  tidyPlan();
  const audit = rubrikRencana(state.docs, state.issues, starterAktif(readCfg()));
  if(!audit.siap){
    state.runnerNote = "Sinkron DITAHAN — rencana masih " + audit.label + ": " + audit.error.slice(0,3).join(" · ")
      + ". Bereskan dulu supaya rencana rusak tidak sampai ke folder proyek.";
    draw("runner"); return;
  }
  const handle = last.handle;
  try{
    let izin = await handle.queryPermission({ mode:"readwrite" });
    if(izin !== "granted") izin = await handle.requestPermission({ mode:"readwrite" });
    if(izin !== "granted"){ state.runnerNote = "Izin menulis folder ditolak — klik 'Connect ke folder proyek' sekali lagi."; draw("runner"); return; }
  }catch(e){ state.runnerNote = "Izin folder tidak bisa dipakai lagi: " + (e && e.message || e); draw("runner"); return; }
  const lama = await connectBaca(handle, ".planforge/state.json");
  let progres = 0;
  try{ progres = Number(JSON.parse(lama || "{}").doneTasks || 0); }catch(e){}
  if(progres > 0 && !confirm("Rencana berubah, tapi " + progres + " task sudah selesai. Progres lama dicadangkan dan ledger dimulai bersih. Lanjut?")) return;
  const conn = last.conn, a = AGENT_ADAPTERS[conn] || AGENT_ADAPTERS.generic;
  const cfg = readCfg();
  const opts = { workerSource: state.workerSource || null, agent:conn, targetAgent:cfg.targetAgent, workerPath:last.path + "/worker.mjs", projectDir:last.path, starter:cfg.starter };
  const files = runnerBundle(state.docs, state.issues, gates(), opts);
  const existing = {};
  for(const f of files) existing[f.name] = await connectBaca(handle, f.name);
  const rencana = rencanaTulis(files, existing, {
    mcpFile: a.file || ".planforge/mcp-universal.json", mcpName:connNama(opts),
    mcpEntry:connEntry(conn, opts), rulesFile:a.rules
  });
  /* yang disentuh cuma rencana, mesin, dan ledger (+cadangannya).
     gates.json, rules, dan config MCP sengaja dibiarkan — tidak perlu daftar ulang connector. */
  const tulis = rencana.filter(r=>r.aksi !== "lewati"
    && /^(worker\.mjs|\.planforge\/plan\.json|\.planforge\/state\.json|\.planforge\/state\.)/.test(r.name));
  const hasil = [];
  try{
    for(const r of tulis){ await connectTulisFile(handle, r.name, r.data); hasil.push(r.name + " (" + r.aksi + ")"); }
  }catch(e){ state.runnerNote = "Sinkron berhenti di tengah: " + (e && e.message || e) + ". Yang sudah tertulis tetap ada."; draw("runner"); return; }
  state.lastConnect = Object.assign({}, last, { fingerprint: planFingerprint(state.docs), at:new Date().toISOString() });
  try{ await simpanKoneksi(state.lastConnect); }catch(e){}
  state.runnerNote = "Sinkron 1 klik berhasil ke " + last.path + ": " + (hasil.join(", ") || "tidak ada yang perlu ditulis")
    + ". Gerbang & server lain dibiarkan; ledger lama dicadangkan. Tidak perlu daftar ulang atau restart aplikasi — suruh agen panggil audit_plan lagi.";
  if(state.connect) state.connect.tahap = "selesai";
  draw("runner");
}

export async function connectPilih(){
  const d = state.docs;
  if(!d.tasks || !planTaskList(d).length){ alert("Belum ada task — jalankan pipeline dulu di kiri."); return; }
  /* Jangan kirim rencana setengah jadi ke folder: agen IDE akan berhenti di audit_plan
     atau lebih parah mengerjakan task yang file dasarnya tidak pernah ada. */
  if(el("runAll").disabled){ state.runnerNote = "Connect ditahan: pipeline masih berjalan. Tunggu semua tahap selesai dulu."; draw("runner"); return; }
  tidyPlan();
  const audit = rubrikRencana(state.docs, state.issues, starterAktif(readCfg()));
  if(!audit.siap){
    state.runnerNote = "Connect DITAHAN — " + audit.label + " (skor " + audit.skor + "): "
      + audit.error.slice(0, 4).join(" · ") + (audit.error.length > 4 ? " (+" + (audit.error.length-4) + " lagi)" : "")
      + ". Betulkan alat ukur/alur di tab Cek rencana, lalu Connect lagi.";
    draw("runner"); return;
  }
  if(typeof window.showDirectoryPicker !== "function"){
    state.runnerNote = "Browser ini tidak punya fitur tulis-folder. Pakai Chrome/Edge, atau tombol unduh paket.";
    draw("runner"); return;
  }
  let handle;
  try{ handle = await window.showDirectoryPicker({ mode:"readwrite" }); }
  catch(e){
    state.runnerNote = (e && e.name === "AbortError") ? "Connect dibatalkan — tidak ada file yang ditulis."
      : "Tidak bisa memilih folder: " + (e && e.message || e);
    draw("runner"); return;
  }
  await ensureWorkerSource();
  /* Folder baru selalu mulai dari path kosong: pkgDir lama bisa menunjuk proyek lain, sehingga
     .planforge tertulis ke folder baru sementara MCP/worker menunjuk proyek lama. */
  state.connect = { handle, nama:handle.name, path:"", tahap:"path", rencana:null, hasil:null, error:null };
  draw("runner");
}

export async function connectCek(){
  const c = state.connect; if(!c) return;
  const audit = rubrikRencana(state.docs, state.issues, starterAktif(readCfg()));
  if(!audit.siap){ c.error = "Rencana belum siap (" + audit.label + "): " + audit.error.slice(0,3).join(" · "); draw("runner"); return; }
  const bersih = String(c.path || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if(!/^[A-Za-z]:\//.test(bersih) && !bersih.startsWith("/")){
    c.error = "Path harus lengkap, contoh D:/PROJECTS/nama-proyek atau /home/kamu/proyek. Nama folder saja tidak cukup.";
    draw("runner"); return;
  }
  c.path = bersih; c.error = null;
  const conn = connectConn(), a = AGENT_ADAPTERS[conn];
  const cfg = readCfg();
  const opts = { workerSource: state.workerSource || null, agent: conn, targetAgent: cfg.targetAgent, workerPath: bersih + "/worker.mjs", projectDir: bersih, starter: cfg.starter };
  const files = runnerBundle(state.docs, state.issues, gates(), opts);
  const existing = {};
  for(const f of files) existing[f.name] = await connectBaca(c.handle, f.name);
  const mcpFile = a.file || ".planforge/mcp-universal.json";
  c.mcpFile = mcpFile;
  c.rencana = rencanaTulis(files, existing, { mcpFile, mcpName: connNama(opts), mcpEntry: connEntry(conn, opts), rulesFile: a.rules });
  c.tahap = "konfirmasi";
  draw("runner");
}

export async function connectTulis(){
  const c = state.connect; if(!c || !c.rencana) return;
  c.tahap = "menulis"; c.error = null; draw("runner");
  const hasil = [];
  try{
    for(const r of c.rencana){
      if(r.aksi === "lewati"){ hasil.push({ name:r.name, aksi:"lewati", alasan:r.alasan }); continue; }
      await connectTulisFile(c.handle, r.name, r.data);
      hasil.push({ name:r.name, aksi:r.aksi, alasan:r.alasan });
    }
  }catch(e){
    /* berhenti di tengah harus kelihatan: sebagian file mungkin sudah tertulis */
    c.error = "Berhenti di tengah: " + (e && e.message || e) + ". Yang sudah tertulis tetap ada, yang belum tidak ditulis.";
    c.hasil = hasil; c.tahap = "selesai"; draw("runner"); return;
  }
  c.hasil = hasil; c.tahap = "selesai";
  /* path baru disimpan setelah seluruh bundle benar-benar tertulis */
  savePkgDir(c.path);
  /* ingat folder ini supaya rencana yang berubah nanti cukup 1 klik Sinkron */
  state.lastConnect = { handle:c.handle, path:c.path, conn:connectConn(), fingerprint:planFingerprint(state.docs), at:new Date().toISOString() };
  simpanKoneksi(state.lastConnect).catch(()=>{});
  draw("runner");
}

export function connectBatal(){ state.connect = null; draw("runner"); }

/* ---------- Progres live: baca state.json dari folder yang sudah di-Connect ----------
   Worker menulis progres ke .planforge/state.json di folder proyek. GUI membacanya lewat
   handle folder yang sama (izin read saja), lalu menampilkan checklist task. Manual lewat
   tombol Refresh — tidak auto-poll supaya tidak minta izin diam-diam atau membakar apa pun. */
export async function bacaProgres(){
  const last = state.lastConnect;
  if(!last || !last.handle){ state.progresError = "Belum ada folder yang pernah di-Connect. Klik 'Connect ke folder proyek' dulu."; state.progres = null; draw("runner"); return; }
  const handle = last.handle;
  try{
    let izin = await handle.queryPermission({ mode:"read" });
    if(izin !== "granted") izin = await handle.requestPermission({ mode:"read" });
    if(izin !== "granted"){ state.progresError = "Izin membaca folder ditolak — klik 'Connect ke folder proyek' sekali lagi."; state.progres = null; draw("runner"); return; }
  }catch(e){ state.progresError = "Izin folder tidak bisa dipakai lagi: " + (e && e.message || e); state.progres = null; draw("runner"); return; }
  const sjRaw = await connectBaca(handle, ".planforge/state.json");
  if(sjRaw == null){ state.progresError = "state.json belum ada di " + last.path + " — agen belum mulai bekerja, atau folder yang di-Connect bukan folder proyek ini."; state.progres = null; draw("runner"); return; }
  let sj; try{ sj = JSON.parse(sjRaw); }catch(e){ state.progresError = "state.json tidak bisa dibaca sebagai JSON: " + (e && e.message || e); state.progres = null; draw("runner"); return; }
  /* daftar task diambil dari plan.json di FOLDER (sumber yang dikerjakan agen), bukan rencana
     di browser yang mungkin sudah berubah; kalau plan.json tak terbaca, pakai rencana browser */
  const planRaw = await connectBaca(handle, ".planforge/plan.json");
  let docs = state.docs;
  if(planRaw != null){ try{ docs = JSON.parse(planRaw); }catch(e){ docs = state.docs; } }
  state.progres = progresDariState(sj, docs);
  state.progresError = null;
  state.progresAt = new Date().toISOString();
  draw("runner");
}
