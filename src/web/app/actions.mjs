/* Document actions, output event dispatch and runner package download. */
import { el } from "./dom.mjs";
import { doneStages, HIST_NAME, readCfg, readHistory, pushHistory, saveDocs, state, STATE_NAME, tidyPlan, updateSavedLabel } from "./state.mjs";
import { draw, drawActions, refreshRail } from "./views.mjs";
import { copyText, githubPushNow } from "./artifacts.mjs";
import { ensureWorkerSource, gates, pkgOpts, resetGates, saveGates } from "./runner-config.mjs";
import { connectConn } from "./connect.mjs";
import { bacaProgres, connectBatal, connectCek, connectPilih, connectSinkron, connectTulis } from "./connect-flow.mjs";
import { tambalNow } from "./pipeline.mjs";
import { normalisasiAliasBehavior } from "../core/behavior-alias.mjs";
import { AGENT_ADAPTERS, connConfigJson, connPrompt, connUniversal } from "../core/connect.mjs";
import { makeZip } from "../core/handoff.mjs";
import { normStatus } from "../core/plan-normalize.mjs";
import { masalahBehavior } from "../core/plan-rules.mjs";
import { collectPlanIssues } from "../core/plan-readiness.mjs";
import { hitungBudget, planTaskList, sisaMilestone } from "../core/plan-workspace.mjs";
import { runnerCommand, shellQ } from "../core/runner.mjs";
import { runnerBundle } from "../core/runner-package.mjs";
import { starterAktif } from "../core/starter.mjs";

export function restorePrev(){
  const h = readHistory();
  if(!h.length){ alert("Belum ada versi sebelumnya yang tersimpan."); return; }
  const s = h[0];
  if(!confirm("Kembalikan hasil ke versi " + new Date(s.at).toLocaleString("id-ID") + " (" + s.note + ")? Hasil yang sekarang akan ditumpuk sebagai versi terbaru.")) return;
  pushHistory("sebelum pulihkan " + s.note);
  const h2 = readHistory();
  const rest = h2.filter((_,i)=>i !== 1).slice(0, 6);
  state.docs = {clarify:s.clarify, prd:s.prd, roadmap:s.roadmap, tasks:s.tasks};
  state.issues = collectPlanIssues(state.docs, starterAktif(readCfg()));
  state.docs.issues = state.issues;
  state.savedAt = s.savedAt || s.at;
  state.autoFixes = []; state.auditNote = "Dipulihkan ke versi " + new Date(s.at).toLocaleString("id-ID") + " (" + s.note + ").";
  localStorage.setItem(HIST_NAME, JSON.stringify(rest));
  saveDocs(); refreshRail(); drawActions();
  draw(el("tabs").querySelector(".tab.on").dataset.view);
}

export function clearDocs(){
  if(!doneStages().length){
    localStorage.removeItem(STATE_NAME); state.docs = {}; state.issues = []; state.autoFixes = []; state.auditNote = null;
    refreshRail(); updateSavedLabel(); draw(el("tabs").querySelector(".tab.on").dataset.view); return;
  }
  if(!confirm("Hapus semua hasil (brief, PRD, roadmap, tasks)? Versi sebelumnya masih bisa dipulihkan.")) return;
  pushHistory("sebelum dihapus");
  state.docs = {}; state.issues = []; state.ideaFp = null; state.genBy = null; state.autoFixes = []; state.auditNote = null; localStorage.removeItem(STATE_NAME);
  refreshRail(); updateSavedLabel(); draw(el("tabs").querySelector(".tab.on").dataset.view);
}

/* behavior ditolak di sini juga, bukan cuma di runner: plan yang tidak bisa dibuktikan
   tidak boleh terlihat hijau di layar lalu ditolak semalam saat kredit sudah terbakar */
export function simpanBehavior(id){
  const t = ((state.docs.tasks||{}).tasks||[]).find(x=>x.id===id);
  const ta = el("out").querySelector("[data-bh='"+id+"']");
  const cb = el("out").querySelector("[data-bhui='"+id+"']");
  const msg = el("out").querySelector("[data-bhmsg='"+id+"']");
  if(!t || !ta || !msg) return;
  const asli = t.behavior, uiAsli = t.ui;
  const bukanUi = !!(cb && cb.checked);
  let b = null;
  /* ui:false berarti tidak ada bukti browser — jangan ikut menyimpan kerangka contoh
     yang kebetulan ada di textarea, itu spec palsu yang kelihatan seperti bukti */
  if(!bukanUi){
    const teks = ta.value.trim();
    if(teks){
      try{ b = JSON.parse(teks); }catch(err){ msg.textContent = "JSON-nya belum valid: " + err.message; return; }
      if(typeof b !== "object" || b === null || Array.isArray(b)){ msg.textContent = "behavior harus objek {url, checks}, bukan array atau teks."; return; }
    }
  }
  if(b === null) delete t.behavior; else t.behavior = b;
  if(bukanUi) t.ui = false; else delete t.ui;
  const rusak = masalahBehavior(t);
  if(rusak.length){
    if(asli === undefined) delete t.behavior; else t.behavior = asli;
    if(uiAsli === undefined) delete t.ui; else t.ui = uiAsli;
    msg.textContent = "Belum disimpan — " + rusak.join(" · ");
    return;
  }
  state.issues = collectPlanIssues(state.docs, starterAktif(readCfg()));
  state.docs.issues = state.issues;
  saveDocs(); refreshRail();
  draw(el("tabs").querySelector(".tab.on").dataset.view);
}

export function outAction(act, btn){
  if(act === "gConnCopy"){
    copyText(connConfigJson(AGENT_ADAPTERS[state.pkgConn] ? state.pkgConn : "workbuddy", pkgOpts()), btn);
    return;
  }
  if(act === "gCmd"){
    const pk = pkgOpts(), wk = shellQ(pk.workerPath || "worker.mjs"), dirArg = pk.projectDir ? " --dir " + shellQ(pk.projectDir) : "";
    copyText([runnerCommand(gates(), pk),
      "node " + wk + dirArg + " status",
      "node " + wk + dirArg + " run --dry-run"].join("\n"), btn);
    return;
  }
  if(act === "gPkg"){ downloadRunnerPackage(); return; }
  if(act === "ghPush"){ githubPushNow().catch(e=>{ const t=el("ghToken"); if(t) t.value=""; const m=el("ghMsg"); if(m) m.textContent="Gagal push: "+((e&&e.message)||e); }); return; }
  if(act === "gConnect"){ connectPilih(); return; }
  if(act === "cSalinPrompt"){
    const c = state.connect; if(!c || !c.path) return;
    const a = AGENT_ADAPTERS[connectConn()] || AGENT_ADAPTERS.generic;
    copyText("Baca " + a.rules + ". " + connPrompt({ projectDir:c.path, workerPath:c.path + "/worker.mjs" }), btn);
    return;
  }
  if(act === "cSalinMcp"){
    const c = state.connect; if(!c || !c.path) return;
    copyText(connConfigJson(connectConn(), { workerPath:c.path + "/worker.mjs", projectDir:c.path }), btn);
    return;
  }
  if(act === "cSalinUniversal"){
    const c = state.connect; if(!c || !c.path) return;
    copyText(connUniversal({ workerPath:c.path + "/worker.mjs", projectDir:c.path }).perintah, btn);
    return;
  }
  if(act === "cSinkron"){ connectSinkron(); return; }
  if(act === "cProgres"){ bacaProgres(); return; }
  if(act === "gBetulkanAlias"){
    const r = normalisasiAliasBehavior(state.docs);
    tidyPlan();
    state.runnerNote = r.perbaikan.length
      ? "Alias alat ukur dibetulkan (" + r.perbaikan.length + "): " + r.perbaikan.slice(0,8).join(", ")
        + (r.tersisa.length ? ". TIDAK ditukar (butuh keputusanmu): " + r.tersisa.slice(0,8).join(", ") + " — alat ukur itu tidak punya padanan jujur." : ".")
      : "Tidak ada alias yang bisa dibetulkan otomatis."
        + (r.tersisa.length ? " Yang tersisa butuh keputusanmu: " + r.tersisa.slice(0,8).join(", ") + "." : "");
    saveDocs(); draw("runner");
    return;
  }
  if(act === "cCek"){ connectCek(); return; }
  if(act === "cTulis"){ connectTulis(); return; }
  if(act === "cBatal"){ connectBatal(); return; }
  if(act === "gReset"){
    const keep = gates().agent && gates().agent.name || "agy";
    resetGates(); state.runnerNote = "Gerbang & ritme balik ke bawaan (agent " + keep + "): 5 gerbang keras, watchlist 1-5, gerbang penuh tiap 6 task.";
    draw("runner"); return;
  }
  if(act === "gBudget"){
    const g = gates(), d = state.docs, ts = planTaskList(d);
    const sisa = ts.filter(t=>(normStatus(t.status) || "belum mulai") !== "selesai").length;
    const b = hitungBudget(sisa, g, sisaMilestone(d.roadmap && d.roadmap.milestones, ts, t=>normStatus(t.status) || "belum mulai"));
    g.limits.maxCalls = b.total; g.limits.maxCallsPerRun = b.total;
    saveGates();
    state.runnerNote = "Budget disetel " + b.total + " panggilan untuk " + sisa + " task tersisa (kerja " + b.kerja
      + " + gerbang penuh " + b.penuh + " + cadangan " + b.cadangan + "). Plafon biaya TIDAK diubah: tetap "
      + (g.limits.maxCostUsd == null ? "tanpa batas" : "$" + g.limits.maxCostUsd) + " — kalau agenmu berbayar, dia tetap berhenti sendiri.";
    draw("runner"); return;
  }
  if(act === "gAddHard"){
    const g = gates();
    const used = new Set((g.hard || []).map(item=>String(item && item.id || "")));
    let index = 1;
    while(used.has("cmd" + index)) index++;
    g.hard.push({ id:"cmd" + index, label:"Perintah tambahan", cmd:"", enabled:true, blocking:false, tier:"hard" });
    saveGates(); state.runnerNote = "Baris gerbang keras baru ditambah — isi perintahnya, tanpa perintah baris itu dilewati runner.";
    draw("runner"); return;
  }
  if(act === "gDelHard"){ gates().hard.splice(Number(btn.dataset.i), 1); saveGates(); draw("runner"); return; }
  if(act === "gAddFull"){
    const g = gates();
    const used = new Set((g.reviews || []).map(item=>String(item && item.id || "")));
    let index = 1;
    while(used.has("watch" + index)) index++;
    g.reviews.push({ id:"watch" + index, label:"Prompt watchlist tambahan", tier:"full", enabled:true, prompt:"" });
    saveGates(); state.runnerNote = "Prompt watchlist ditambahkan di tier penuh: ikut jalan tiap " + g.limits.fullEvery + " task, sesudah performa.";
    draw("runner"); return;
  }
  if(act === "gDelFull"){ gates().reviews.splice(Number(btn.dataset.i), 1); saveGates(); draw("runner"); return; }
  if(act === "tidy"){
    const before = state.issues.length;
    const nz = tidyPlan();
    const after = state.issues.length;
    state.auditNote = nz.fixes.length
      ? "Rapikan otomatis menghapus " + (before-after) + " dari " + before + " celah (" + nz.fixes.length + " koreksi diterapkan, tanpa biaya AI). " +
        (after ? "Sisa " + after + " celah perlu ditambal model." : "Sekarang tidak ada celah tersisa.")
      : "Tidak ada yang bisa dirapikan otomatis — " + before + " celah ini benar-benar kurang isi, jadi pakai \"Minta model tambal sisanya\".";
    draw("issues");
    refreshRail();
    return;
  }
  if(act === "tambal"){ tambalNow(btn); return; }
  if(act === "tasks"){
    const b = el("tabs").querySelector('[data-view="tasks"]');
    if(b) b.click();
  }
}

export async function downloadRunnerPackage(){
  const d = state.docs;
  if(!d.tasks || !planTaskList(d).length){ alert("Belum ada task — jalankan pipeline dulu."); return; }
  const before = state.issues.length;
  const nz = tidyPlan();
  const g = gates();
  await ensureWorkerSource();
  const conn = AGENT_ADAPTERS[state.pkgConn] ? state.pkgConn : "workbuddy";
  const cfg = readCfg();
  const files = runnerBundle(d, state.issues, g, Object.assign({workerSource: state.workerSource || null, agent: conn, targetAgent: cfg.targetAgent, starter: cfg.starter}, pkgOpts()));
  const zip = makeZip(files);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([zip], {type:"application/zip"}));
  a.download = ((d.prd && d.prd.project_name || "planforge").replace(/[^\w.-]/g,"_")) + "-planforge.zip";
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  state.runnerNote = "Paket diunduh (" + files.length + " file): " + files.map(x=>x.name).join(" · ")
    + (state.workerSource ? "" : " — worker.mjs TIDAK ikut: salinan yang ditanam di index.html kosong. Jalankan `node worker.mjs embed` di folder PlanForge lalu muat ulang halaman ini.")
    + (nz.fixes.length ? ". Rapikan otomatis " + before + " → " + state.issues.length + " celah sebelum dibungkus." : "");
  draw("runner");
}
