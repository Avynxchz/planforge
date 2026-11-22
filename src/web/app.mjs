/* PlanForge UI entry point. Imports stay in baseline order; bootstrap below coordinates startup. */
import { PROFILES, STAGE_MODEL_DEFAULT, KEY_NAME, CFG_NAME, STATE_NAME, HIST_NAME, GATES_NAME, PKG_NAME } from "./app/state.mjs";
import { el } from "./app/dom.mjs";
import { state, num, readCfg, readStageModels, readKeyRecord, keyFor, persist, restore, MAIN_STAGES, hasStage, doneStages, saveDocs, ideaFp, staleReasons, updateSavedLabel, readHistory, pushHistory } from "./app/state.mjs";
import { restorePrev, clearDocs } from "./app/actions.mjs";
import { refreshRail } from "./app/views.mjs";
import { seedFor, STAGE_KEYS } from "./app/state.mjs";
import { PRESETS, STAGE_TOKEN_GUESS, IDR, priceOf, fmtMoney } from "./app/model-picker.mjs";
import { escA } from "./app/dom.mjs";
import { perM, shortName, currentModels, renderStageModelInputs, setStageModel, openPicker, modelMatches, renderModelList, updateCostGuess, cekKredit } from "./app/model-picker.mjs";
import { tabs, rail, setStage, jamTahap, mulaiJam, hentiJam, showView, draw } from "./app/views.mjs";
import { simpanBehavior } from "./app/actions.mjs";
import { getGatePath } from "./app/runner-config.mjs";
import { tidyPlan } from "./app/state.mjs";
import { outAction } from "./app/actions.mjs";
import { tambalNow, tambalKonvergen } from "./app/pipeline.mjs";
import { drawActions } from "./app/views.mjs";
import { copyText, dl, bundleFiles, exportBundle, githubPanel, githubPushNow } from "./app/artifacts.mjs";
import { loadGates, saveGates, gates, resetGates, pkgDir, savePkgDir, pkgOpts, setGatePath, applyAgentPreset, workerPresetGuess } from "./app/runner-config.mjs";
import { esc } from "./app/dom.mjs";
import { renderPanduan } from "./app/views.mjs";
import { renderRunner } from "./app/runner-view.mjs";
import { ensureWorkerSource, argLines } from "./app/runner-config.mjs";
import { downloadRunnerPackage } from "./app/actions.mjs";
import { connectBaca, connectTulisFile, connectConn, IDB_NAME, IDB_KEY, bukaIdb, simpanKoneksi, bacaKoneksi, perluSinkron } from "./app/connect.mjs";
import { connectSinkron, connectPilih, connectCek, connectTulis, connectBatal } from "./app/connect-flow.mjs";
import { connectPanel } from "./app/connect.mjs";
import { bacaProgres } from "./app/connect-flow.mjs";
import { progresPanel } from "./app/connect.mjs";
import { callModel, recordUsage, runStage, ERROR_HINTS, showError, tanyaUser, runAll } from "./app/pipeline.mjs";
import { loadModels, applyManual } from "./app/model-picker.mjs";

el("out").addEventListener("click", (e)=>{
  const act = e.target.closest && e.target.closest("[data-act]");
  if(act){ outAction(act.dataset.act, act); return; }
  const bh = e.target.closest && e.target.closest("[data-bhsave]");
  if(bh){ simpanBehavior(bh.dataset.bhsave); return; }
  const pill = e.target.closest && e.target.closest(".stat");  if(!pill || !state.docs.tasks) return;
  const order = ["belum mulai","sedang","selesai","gagal","terkendala"];
  const t = (state.docs.tasks.tasks||[]).find(x=>x.id === pill.dataset.tid);
  if(!t) return;
  const kini = normStatus(t.status) || (String(t.status || "").trim().toLowerCase() === "terkendala" ? "terkendala" : "belum mulai");
  t.status = order[(order.indexOf(kini) + 1) % order.length];
  state.issues = collectPlanIssues(state.docs, !!readCfg().starter);
  state.docs.issues = state.issues;
  saveDocs(); refreshRail();
  draw(el("tabs").querySelector(".tab.on").dataset.view);
});
/* editor gerbang: satu jalur data-g="path.datar" → gates() → localStorage */
el("out").addEventListener("change", (e)=>{
  const t = e.target, p = t.dataset && t.dataset.g;
  if(t.dataset && t.dataset.p === "dir"){ savePkgDir(t.value.trim()); draw("runner"); return; }
  if(t.dataset && t.dataset.p === "conn"){ state.pkgConn = t.value; draw("runner"); return; }
  if(t.dataset && t.dataset.c === "path" && state.connect){ state.connect.path = t.value; return; }
  if(!p) return;
  if(p === "__agent"){ applyAgentPreset(t.value); draw("runner"); return; }
  let v;
  if(t.type === "checkbox") v = t.checked;
  else if(/(^|\.)args$|contArgs$/.test(p)) v = argLines(t.value);
  else if(p === "limits.maxCostUsd" || p === "limits.maxTokens" || p === "limits.maxCallsPerRun"){
    /* kosong = tanpa batas; maxCostUsd boleh pecahan (mis. 0,5) — dibulatkan jadi 0 kalau dipaksa integer */
    const s = String(t.value).trim();
    if(!s) v = null;
    else {
      const n = Number(s.replace(",", "."));
      if(!Number.isFinite(n) || n < 0){ const lama = getGatePath(p); t.value = lama == null ? "" : String(lama); return; }
      v = p === "limits.maxCostUsd" ? n : Math.round(n);
    }
  }
  else if(p.indexOf("limits.") === 0 || p.indexOf("metrics.") !== -1 || p === "agent.timeoutMin"){
    const n = num(t.value);
    if(n == null || n < 0){ t.value = String(getGatePath(p)); return; }   // input tak sah: kembalikan nilai lama
    v = Math.round(n);
  }
  else v = t.value;
  setGatePath(p, v);
  if(p.indexOf("limits.") === 0){ const on = el("tabs").querySelector(".tab.on"); if(on && on.dataset.view === "runner") draw("runner"); }
});
el("provider").onchange = ()=>{
  el("baseUrl").value = PROFILES[el("provider").value].baseUrl;
  el("apiKey").disabled = !PROFILES[el("provider").value].needsKey;
  el("apiKey").value = keyFor({ provider: el("provider").value, baseUrl: el("baseUrl").value });
  state.modelCatalog = []; state.price = {}; state.varPrice = {}; state.catalog = {};
  el("modelStat").textContent = "katalog belum dimuat";
  persist(); renderStageModelInputs();
  if(state.pickerStage) renderModelList();
};
el("loadModels").onclick = loadModels;
el("runAll").onclick = ()=>runAll(false);
el("rerunAll").onclick = ()=>runAll(true);
el("clearDocs").onclick = clearDocs;
el("restorePrev").onclick = restorePrev;
el("stop").onclick = ()=>{ if(state.abort) state.abort.abort(); };
["idea","projectName","constraints","audience","language","targetAgent","temperature","maxTokens","jsonMode","seedMode","reuse","saveKey","baseUrl"]
  .forEach(id=>el(id).addEventListener("change", ()=>{ persist(); updateSavedLabel(); }));
el("apiKey").addEventListener("change", ()=>{
  persist();
  const k = el("apiKey").value.trim();
  if(k.length > 12 && PROFILES[el("provider").value].listable && !state.modelCatalog.length){
    el("modelStat").textContent = "memeriksa key…"; loadModels();
  }
});
el("presets").addEventListener("click", (e)=>{
  const b = e.target.closest("[data-preset]"); if(!b) return;
  const p = PRESETS[b.dataset.preset]; if(!p) return;
  const known = state.modelCatalog.length ? Object.keys(state.catalog) : [];
  const miss = [];
  const pick = (id)=>{
    if(!known.length) return id;
    if(state.catalog[id]) return id;
    if(state.catalog[id + ":free"]) return id + ":free";
    const alt = known.filter(k=>k.split("/")[1] === id.split("/")[1])[0];
    if(alt) return alt;
    miss.push(id); return null;
  };
  for(const s of STAGE_KEYS){ const id = pick(p[s]); if(id) state.stageModels[s] = id; }
  renderStageModelInputs(); persist();
  if(state.pickerStage) renderModelList();
  if(miss.length) el("modelStat").textContent = "preset dipasang — tidak ada padanan untuk " + miss.join(", ");
});
el("stageModels").addEventListener("click", (e)=>{
  const btn = e.target.closest("[data-pick]");
  if(btn){ openPicker(btn.dataset.pick); return; }
  const row = e.target.closest(".srow");
  if(row && row.dataset.row) openPicker(row.dataset.row);
});
el("modelList").addEventListener("click", (e)=>{
  const r = e.target.closest(".mrow"); if(!r || !r.dataset.id) return;
  const stage = state.pickerStage || "prd";
  setStageModel(stage, r.dataset.id, e.ctrlKey || e.metaKey);
  if(el("manualModel").value) el("manualModel").value = r.dataset.id;
  renderModelList();
});
el("modelSearch").addEventListener("input", renderModelList);
el("modelSort").addEventListener("change", renderModelList);
el("freeOnly").addEventListener("change", renderModelList);
el("applyOne").onclick = ()=>applyManual(false);
el("applyAll").onclick = ()=>applyManual(true);
el("manualModel").addEventListener("keydown", (e)=>{ if(e.key === "Enter") applyManual(e.ctrlKey || e.shiftKey); });
restore();
if(location.protocol.indexOf("http") === 0) ensureWorkerSource();
el("baseUrl").value = el("baseUrl").value || PROFILES[el("provider").value].baseUrl;
el("apiKey").disabled = !PROFILES[el("provider").value].needsKey;
state.stageModels = state.stageModels || {};
renderStageModelInputs();
tabs();
rail();
drawActions();
refreshRail();
updateSavedLabel();
draw(doneStages().slice(-1)[0] || "clarify");
el("cekKredit").onclick = cekKredit;
bacaKoneksi().then((rec)=>{
  if(rec && rec.handle && rec.path){
    state.lastConnect = rec;
    if(el("tabs").querySelector(".tab.on") && el("tabs").querySelector(".tab.on").dataset.view === "runner") draw("runner");
  }
}).catch(()=>{});
// katalog = harga + konteks; ambil diam-diam kalau ada key (atau Ollama lokal)
if(PROFILES[el("provider").value].listable && (el("apiKey").value.trim().length > 12 || el("provider").value === "ollama")){
  el("modelStat").textContent = "memuat katalog…"; loadModels();
}
