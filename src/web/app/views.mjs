/* Tabs, rail, stage timer, render dispatcher, action bar and guide view. */
import { el, esc } from "./dom.mjs";
import { hasStage, readCfg, state } from "./state.mjs";
import { ensureWorkerSource } from "./runner-config.mjs";
import { renderRunner } from "./runner-view.mjs";
import { copyText, exportBundle } from "./artifacts.mjs";
import { masalahStrukturRencana } from "../core/plan-readiness.mjs";
import { STAGES } from "../core/plan-schema.mjs";
import { buildAgentPrompt, renderMarkdown, tasksToMd } from "../core/render.mjs";
import { saranLingkungan, starterAktif } from "../core/starter.mjs";

export function refreshRail(){
  for(const s of ["clarify","prd","roadmap","tasks"]) setStage(s, hasStage(s) ? "done" : "", hasStage(s) ? "tersimpan" : "");
  if(hasStage("prd")) setStage("audit", state.issues.length ? "err" : "done", state.issues.length ? state.issues.length + " celah" : "bersih");
}

export function tabs(){
  const names = [["clarify","Brief"],["prd","PRD"],["roadmap","Roadmap"],["tasks","Tasks"],["issues","Cek rencana"],["runner","Runner"],["panduan","Panduan"],["raw","JSON mentah"]];
  el("tabs").innerHTML = names.map((n,i)=>'<button class="tab' + (i===0?" on":"") + '" data-view="' + n[0] + '">' + n[1] + '</button>').join("");
  el("tabs").querySelectorAll(".tab").forEach(b=>b.onclick = ()=>{
    el("tabs").querySelectorAll(".tab").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); draw(b.dataset.view);
  });
}

export function rail(){
  el("rail").innerHTML = STAGES.map(s=>'<div class="stage" data-k="' + s.key + '"><i class="dot"></i><b>' + esc(s.label) + '</b><span></span></div>').join("");
}

export function setStage(k, cls, note){
  const n = el("rail").querySelector('[data-k="' + k + '"]');
  if(!n) return;
  n.className = "stage" + (cls ? " " + cls : "");
  n.querySelector("span").textContent = note || "";
}

/* Jam per tahap: "mikir… 37 dtk" bikin beda antara model yang sedang bekerja
   dan koneksi yang nggantung. Tidak ada angka = pengguna hanya bisa menebak. */
export let jamTahap = null;

export function mulaiJam(k){
  hentiJam();
  const mulai = Date.now();
  const update = ()=>setStage(k, "run", "mikir… " + Math.floor((Date.now()-mulai)/1000) + " dtk · batas 120 dtk");
  update();
  jamTahap = { k, id:setInterval(update, 1000) };
}

export function hentiJam(){ if(jamTahap){ clearInterval(jamTahap.id); jamTahap = null; } }

export function showView(v){ const b = el("tabs").querySelector('[data-view="' + v + '"]'); if(b){ b.click(); return; } draw(v); }

export function draw(view){
  const d = state.docs;
  if(view === "issues") { el("out").innerHTML = renderMarkdown("issues", state.issues, {fixes:state.autoFixes, auditNote:state.auditNote, struktur:masalahStrukturRencana(state.docs, starterAktif(readCfg())), warn:saranLingkungan(starterAktif(readCfg()))}); return; }
  if(view === "runner"){ el("out").innerHTML = renderRunner();
    if(!state.workerChecked){ state.workerChecked = true; ensureWorkerSource().then((s)=>{ if(s) draw("runner"); }); }
    return; }
  if(view === "panduan"){ el("out").innerHTML = renderPanduan(); return; }
  if(view === "raw"){ el("out").innerHTML = renderMarkdown("raw", {brief:d.clarify, prd:d.prd, roadmap:d.roadmap, tasks:d.tasks, issues:state.issues}); return; }
  if(!d[view]){
    el("out").innerHTML = "<h1>Belum ada hasil</h1><p class='hint'>Isi ide di kiri lalu klik <b>Jalankan pipeline</b>. Tahap 1 menghasilkan brief dan asumsi, lalu PRD, roadmap, dan task list. Tahap <b>cek konsistensi</b> memeriksa dokumen rencana — bukan kode, karena kode belum ada.</p>"
      + "<h2>Caranya bekerja</h2><pre>" + [
        "1. ide user      -> dibaca apa adanya, tanpa dirapikan",
        "2. stage clarify  -> asumsi + default + apa yang dibuang dari MVP",
        "3. stage prd      -> 7 bagian: overview, requirements (fungsional & non-fungsional terukur),",
        "                    core features (fitur -> sub-fitur), user flow, architecture, schema, tech stack",
        "4. stage roadmap  -> milestone M-xxx yang menutup fitur & requirement mvp",
        "5. stage tasks    -> T-xxx per fitur, status, verifikasi, depends_on",
        "6. rapikan otomatis -> ID R-7 jadi R-007, 'Admin: Pesan' jadi 'Pesan', 'done' jadi 'selesai' (gratis, tanpa AI)",
        "7. validator lokal-> ID duplikat, ref rusak, mvp/fitur tanpa task, target tak terukur, siklus",
        "8. stage cek rencana -> tambal sisanya lewat patch add/update (hanya kalau masih ada celah)",
        "9. ekspor         -> ZIP dokumen + tab Runner: paket .planforge/ buat agen yang mengerjakan task-nya otomatis"
      ].join("\n") + "</pre>";
    return;
  }
  el("out").innerHTML = renderMarkdown(view, d[view], d);
}

export function drawActions(){
  const bar = el("tabs");
  if(bar.querySelector("#btnExport")) return;
  const mk = (label, id)=>{ const b = document.createElement("button"); b.className="tab"; b.id=id; b.textContent=label; return b; };
  const exp = mk("⬇ ekspor ZIP","btnExport");
  exp.onclick = exportBundle;
  const cp = mk("⧉ salin TASKS.md","btnCopy");
  cp.onclick = ()=>copyText(tasksToMd(state.docs.tasks||{tasks:[]}), cp);
  const ap = mk("⧉ salin prompt agen","btnAgent");
  ap.onclick = ()=>copyText(buildAgentPrompt(readCfg(), state.docs), ap);
  bar.appendChild(exp); bar.appendChild(cp); bar.appendChild(ap);
}

/* Panduan orang baru: point-and-click, tanpa istilah teknis yang tidak dijelaskan. */
export function renderPanduan(){
  const h = [];
  h.push("<h1>Panduan pakai PlanForge (dari nol)</h1>");
  h.push("<p class='hint'>Dua kunci yang berbeda: <b>kunci planning</b> (API key di halaman ini, buat bikin 4 dokumen rencana) "
    + "dan <b>model di aplikasi coding</b> (diatur di aplikasi itu sendiri). Keduanya tidak saling menggantikan.</p>");
  h.push("<h2>Coba gratis dulu (tanpa API key)</h2>");
  h.push("<pre>" + esc("1. Di kiri, Provider pilih 'Demo offline (tanpa key, hasil contoh)'.\n"
    + "2. Isi kotak 'Deskripsi mentah' dengan satu kalimat ide (bebas, tidak perlu rapi).\n"
    + "3. Klik 'Jalankan pipeline'. Tunggu sampai 5 tahap selesai.\n"
    + "4. Lihat tab Brief, PRD, Roadmap, Tasks — keempatnya harus berisi.") + "</pre>");
  h.push("<h2>Pakai ide sendiri (BYOK)</h2>");
  h.push("<pre>" + esc("1. Provider pilih 'OpenRouter (BYOK)', tempel API key kamu.\n"
    + "2. Klik 'Cek sisa kredit' — gratis, tidak memanggil AI. Kalau 402, isi kredit dulu.\n"
    + "3. Klik 'Muat katalog model', pilih preset 'Hemat' atau model murah.\n"
    + "4. Isi ide, lalu 'Jalankan pipeline'.\n"
    + "5. Kalau fase 5 masih ada celah, klik 'Minta AI tambal' (atau centang 'tambal otomatis').") + "</pre>");
  h.push("<h2>Connect ke aplikasi coding</h2>");
  h.push("<pre>" + esc("1. Buka tab 'Runner'. Pastikan tulisan 'Kualitas rencana: Siap dieksekusi'.\n"
    + "2. Pilih aplikasi, klik 'Connect ke folder proyek', pilih folder (boleh yang masih kosong).\n"
    + "3. Tulis path lengkapnya sekali, mis. D:/PROJECTS/proyekku.\n"
    + "4. Klik 'Lanjut', lihat daftar file, lalu 'Ya, tulis sekarang'.\n"
    + "5. Klik 'Salin trigger prompt', buka aplikasi coding di folder itu, tempel SEKALI, tunggu.") + "</pre>");
  h.push("<p class='hint'>Kalau rencana berubah sesudah Connect, <b>jangan ulang Connect</b>: klik "
    + "<b>'Sinkron ke folder (1 klik)'</b> di tab Runner, lalu suruh agen panggil <code>audit_plan</code> lagi.</p>");
  h.push("<h2>Kalau macet</h2>");
  h.push("<pre>" + esc("401 = key salah/kedaluwarsa -> tempel ulang.\n"
    + "402 = kredit habis / batas key tercapai -> cek menu Credits DAN menu Keys di OpenRouter.\n"
    + "403 = batas budget menolak -> cek pengaturan budget.\n"
    + "429 = terlalu cepat / rate limit -> tunggu sebentar, terutama model :free.\n"
    + "Lama tanpa pesan error = model masih mikir (ada jam per tahap), BUKAN kredit habis.\n"
    + "Jangan klik 'ulang dari nol' saat sedang jalan: tahap yang sudah jadi tersimpan,\n"
    + "dan 'Jalankan pipeline' cukup melanjutkan yang belum. Kalau perlu berhenti, klik Stop.") + "</pre>");
  h.push("<h2>Registrasi global sekali (WorkBuddy / Antigravity / Cline / Qoder)</h2>");
  h.push("<p>Aplikasi-aplikasi ini <b>tidak membaca file config dari folder proyek</b>. Itu aturan mereka, bukan PlanForge rusak. "
    + "Panel Connect kasih path global persis + blok siap salin + langkah bernomor. "
    + "Tempel blok itu ke dalam <code>mcpServers</code> (jangan hapus server lain), simpan, lalu <b>tutup dan buka lagi aplikasinya</b>. "
    + "Tidak ada janji nol-klik untuk kelompok ini.</p>");
  h.push("<p class='hint'>VS Code, Cursor, dan Claude Code membaca file config dari folder proyek — Connect sudah menulis format yang benar. "
    + "VS Code sudah terbukti nyambung end-to-end; Cursor belum diuji di mesin ini.</p>");
  return h.join("\n");
}
