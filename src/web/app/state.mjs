/* Application state, configuration, persistence, document history and stage helpers. */
import { el } from "./dom.mjs";
import { crc32 } from "../core/handoff.mjs";
import { normalizePlan } from "../core/plan-normalize.mjs";
import { normalisasiAliasBehavior } from "../core/behavior-alias.mjs";
import { sanitizePlanChecks } from "../core/verification-lint.mjs";
import { collectPlanIssues } from "../core/plan-readiness.mjs";
import { starterAktif } from "../core/starter.mjs";

/* ===================== UI + TRANSPORT ===================== */
export const PROFILES = {
  openrouter:{baseUrl:"https://openrouter.ai/api/v1", needsKey:true, listable:true},
  custom:{baseUrl:"https://api.openai.com/v1", needsKey:true, listable:true},
  ollama:{baseUrl:"http://localhost:11434/v1", needsKey:false, listable:true},
  demo:{baseUrl:"demo", needsKey:false, listable:false}
};

export const STAGE_MODEL_DEFAULT = {
  clarify:"deepseek/deepseek-v4.1-flash", prd:"deepseek/deepseek-v4.1-flash",
  roadmap:"deepseek/deepseek-v4.1-flash", tasks:"qwen/qwen3-coder-flash", audit:"deepseek/deepseek-v4.1-flash"
};

export const KEY_NAME = "planforge.apiKey", CFG_NAME = "planforge.config", STATE_NAME = "planforge.docs", HIST_NAME = "planforge.history", GATES_NAME = "planforge.gates", PKG_NAME = "planforge.pkg";

export let state = {docs:{}, issues:[], status:{}, cost:[], abort:null,
  autoFixes:[], auditNote:null, gates:null, workerSource:null, workerChecked:false, runnerNote:null,
  modelCatalog:[], price:{}, varPrice:{}, catalog:{}, pickerStage:null, stageModels:{}, pkg:null, pkgConn:null, connect:null,
  githubRepo:"", githubBranch:"main", progres:null, progresError:null, progresAt:null};

export function num(v){ const n = parseFloat(String(v==null?"":v).replace(",",".")); return Number.isFinite(n) ? n : null; }

export function readCfg(){
  return {
    provider: el("provider").value, baseUrl: el("baseUrl").value.trim(),
    apiKey: el("apiKey").value.trim(), saveKey: el("saveKey").checked,
    stageModels: readStageModels(),
    temperature: num(el("temperature").value),
    maxTokens: num(el("maxTokens").value),
    jsonMode: el("jsonMode").checked, seedMode: el("seedMode").checked, reuse: el("reuse").checked,
    autoTambal: el("autoTambal").checked, clarifyInteraktif: el("clarifyInteraktif").checked,
    pkgConn: state.pkgConn,
    idea: el("idea").value, projectName: el("projectName").value.trim(),
    constraints: el("constraints").value, audience: el("audience").value,
    language: el("language").value, targetAgent: el("targetAgent").value,
    starter: el("starterPilih").value
  };
}

export function readStageModels(){
  const out = {};
  for(const s of STAGE_KEYS){
    const i = document.querySelector('input[type=hidden][data-stage="' + s + '"]');
    if(i) out[s] = i.value.trim();
  }
  return out;
}

export function readKeyRecord(){
  const raw = localStorage.getItem(KEY_NAME); if(!raw) return null;
  try{ const j = JSON.parse(raw); if(j && typeof j === "object" && typeof j.key === "string") return j; }catch(e){}
  return { key: raw, legacy: true };
}

export function keyFor(cfg){
  const r = readKeyRecord(); if(!r) return "";
  if(r.legacy) return cfg.provider === "openrouter" ? r.key : "";
  return (r.provider === cfg.provider && r.baseUrl === cfg.baseUrl) ? r.key : "";
}

export function persist(){
  const cfg = readCfg(); const k = cfg.apiKey; delete cfg.apiKey;
  cfg.v = 3;
  localStorage.setItem(CFG_NAME, JSON.stringify(cfg));
  const rec = readKeyRecord();
  if(cfg.saveKey && k) localStorage.setItem(KEY_NAME, JSON.stringify({ provider: cfg.provider, baseUrl: cfg.baseUrl, key: k }));
  else if(!cfg.saveKey) localStorage.removeItem(KEY_NAME);
  else if(!k && rec && !rec.legacy && rec.provider === cfg.provider && rec.baseUrl === cfg.baseUrl) localStorage.removeItem(KEY_NAME);
}

export function restore(){
  try{
    const cfg = JSON.parse(localStorage.getItem(CFG_NAME) || "null");
    if(cfg){
      el("provider").value = PROFILES[cfg.provider] ? cfg.provider : "openrouter";
      el("baseUrl").value = cfg.baseUrl || PROFILES[el("provider").value].baseUrl;
      el("temperature").value = cfg.v === 3 && cfg.temperature != null ? cfg.temperature : "";
      el("maxTokens").value = cfg.v === 3 && cfg.maxTokens != null ? cfg.maxTokens : "";
      el("jsonMode").checked = !!cfg.jsonMode;
      el("seedMode").checked = cfg.seedMode !== false;
      el("reuse").checked = cfg.reuse !== false;
      el("autoTambal").checked = cfg.autoTambal === true;
      el("clarifyInteraktif").checked = cfg.clarifyInteraktif !== false;
      state.pkgConn = cfg.pkgConn || null;
      el("idea").value = cfg.idea || ""; el("projectName").value = cfg.projectName || "";
      el("constraints").value = cfg.constraints || ""; el("audience").value = cfg.audience || "";
      if(cfg.language) el("language").value = cfg.language;
      if(cfg.targetAgent) el("targetAgent").value = cfg.targetAgent;
      if(cfg.starter) el("starterPilih").value = cfg.starter;
      state.stageModels = cfg.stageModels || {};
    }
    const k = keyFor({ provider: el("provider").value, baseUrl: el("baseUrl").value });
    el("apiKey").value = k; el("saveKey").checked = !!readKeyRecord();
    const docs = JSON.parse(localStorage.getItem(STATE_NAME) || "null");
    if(docs && (docs.clarify || docs.prd || docs.roadmap || docs.tasks)){
      state.docs = docs;
      state.issues = collectPlanIssues(docs, starterAktif(readCfg()));
      state.docs.issues = state.issues;
      state.savedAt = docs.savedAt || null; state.ideaFp = docs.ideaFp || null; state.genBy = docs.genBy || null;
      state.autoFixes = Array.isArray(docs.autoFixes) ? docs.autoFixes : [];
      state.auditNote = docs.auditNote || null;
      delete state.docs.savedAt; delete state.docs.done; delete state.docs.ideaFp; delete state.docs.genBy;
      delete state.docs.autoFixes; delete state.docs.auditNote;
    }
  }catch(e){ /* config rusak: pakai default */ }
}

/* ---- hasil tersimpan: auto-save, riwayat, dan lanjutan run ---- */
export const MAIN_STAGES = ["clarify","prd","roadmap","tasks"];

export function hasStage(s){ const d = state.docs[s]; return !!d && typeof d === "object" && Object.keys(d).length > 0; }

export function doneStages(){ return MAIN_STAGES.filter(hasStage); }

export function saveDocs(){
  state.savedAt = new Date().toISOString();
  if(!state.ideaFp) state.ideaFp = ideaFp();
  localStorage.setItem(STATE_NAME, JSON.stringify(Object.assign({}, state.docs,
    {issues:state.issues, savedAt:state.savedAt, done:doneStages(), ideaFp:state.ideaFp, genBy:state.genBy||null,
     autoFixes:state.autoFixes||[], auditNote:state.auditNote||null})));
  updateSavedLabel();
}

export function ideaFp(){
  const c = readCfg();
  return crc32(new TextEncoder().encode([c.projectName, c.idea, c.constraints, c.audience, c.language].join("|")));
}

export function staleReasons(){
  const out = [];
  if(!doneStages().length) return out;
  if(state.ideaFp && state.ideaFp !== ideaFp()) out.push("teks ide sudah diganti sejak hasil ini dibuat");
  if(state.genBy && state.genBy !== el("provider").value) out.push("hasil lama dibuat dengan provider " + state.genBy);
  return out;
}

export function updateSavedLabel(){
  const n = el("savedAt"); if(!n) return;
  const done = doneStages();
  if(!done.length){ n.textContent = "belum ada hasil tersimpan"; el("restorePrev").disabled = !readHistory().length; return; }
  const t = state.savedAt ? new Date(state.savedAt).toLocaleTimeString("id-ID") : "?";
  const stale = staleReasons();
  n.textContent = "tersimpan otomatis: " + done.join(", ") + " (" + t + ")" + (stale.length ? " — " + stale[0] : "");
  el("restorePrev").disabled = !readHistory().length;
}

export function readHistory(){ try{ return JSON.parse(localStorage.getItem(HIST_NAME) || "[]") || []; }catch(e){ return []; } }

export function pushHistory(note){
  if(!doneStages().length) return false;
  const snap = {at:new Date().toISOString(), note:note || "", savedAt:state.savedAt,
    clarify:state.docs.clarify, prd:state.docs.prd, roadmap:state.docs.roadmap, tasks:state.docs.tasks, issues:state.issues};
  const h = readHistory(); h.unshift(snap);
  localStorage.setItem(HIST_NAME, JSON.stringify(h.slice(0, 6)));
  return true;
}

export function seedFor(cfg){
  const src = [cfg.projectName, cfg.idea, cfg.language, cfg.constraints, cfg.audience].join("|");
  return cfg.provider === "demo" ? 0 : crc32(new TextEncoder().encode(src)) % 2147483647;
}

export const STAGE_KEYS = ["clarify","prd","roadmap","tasks","audit"];

/* ---- tombol di panel audit ---- */
export function tidyPlan(note){
  if(!state.docs.prd) return {fixes:[]};
  const nz = normalizePlan(state.docs.prd, state.docs.roadmap, state.docs.tasks);
  if(nz.fixes.length){
    state.docs.prd = nz.prd; state.docs.roadmap = nz.roadmap; state.docs.tasks = nz.tasks;
    state.autoFixes = (state.autoFixes||[]).concat(nz.fixes);
  }
  normalisasiAliasBehavior(state.docs);
  const checkFixes = sanitizePlanChecks(state.docs);
  if(checkFixes.length) state.autoFixes = (state.autoFixes || []).concat(checkFixes);
  state.issues = collectPlanIssues(state.docs, starterAktif(readCfg()));
  state.docs.issues = state.issues;
  if(note) state.auditNote = note;
  saveDocs();
  return nz;
}
