/* Runner gates, package paths and worker source helpers. */
import { el } from "./dom.mjs";
import { GATES_NAME, PKG_NAME, state } from "./state.mjs";
import { AGENT_PRESETS, defaultGates } from "../core/plan-workspace.mjs";

export function getGatePath(p){
  let o = gates();
  for(const k of String(p).split(".")){ if(o == null) return ""; o = o[k]; }
  return o == null ? "" : o;
}

/* ===================== RUNNER UI — editor watchlist + paket .planforge/ ===================== */
export function loadGates(){
  try{
    const g = JSON.parse(localStorage.getItem(GATES_NAME) || "null");
    if(g && g.agent && g.limits && Array.isArray(g.hard) && Array.isArray(g.reviews)){
      /* gates yang disimpan sebelum plafon biaya ada harus ikut mewarisi kunci barunya */
      g.limits = Object.assign(defaultGates("agy").limits, g.limits);
      return g;
    }
  }catch(e){ /* gates rusak → default */ }
  return defaultGates("agy");
}

export function saveGates(){ try{ localStorage.setItem(GATES_NAME, JSON.stringify(gates())); }catch(e){} }

export function gates(){ if(!state.gates) state.gates = loadGates(); return state.gates; }

export function resetGates(){ state.gates = defaultGates(gates().agent && gates().agent.name || "agy"); saveGates(); }

/* folder proyek (opsional) — isi kalau IDE-mu memanggil worker dari cwd yang nggak ketebak */
export function pkgDir(){ if(state.pkg == null){ let v = ""; try{ v = localStorage.getItem(PKG_NAME) || ""; }catch(e){} state.pkg = v; } return state.pkg; }

export function savePkgDir(v){ state.pkg = v; try{ v ? localStorage.setItem(PKG_NAME, v) : localStorage.removeItem(PKG_NAME); }catch(e){} }

/* {workerPath, projectDir} untuk semua generasi paket/perintah; kosong = path relatif, worker pakai foldernya sendiri */
export function pkgOpts(){
  const d = String(pkgDir() || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if(!d) return {};
  return { workerPath: d + "/worker.mjs", projectDir: d };
}

/* path datar ala "hard.2.cmd" — dipakai semua field editor supaya satu mekanisme */
export function setGatePath(path, value){
  const seg = String(path).split("."); let o = gates();
  for(let i=0;i<seg.length-1;i++){ if(o == null) return; o = o[seg[i]]; }
  if(o == null || seg[seg.length-1] === "__proto__") return;
  o[seg[seg.length-1]] = value; saveGates();
}

export function applyAgentPreset(name){
  const p = AGENT_PRESETS[name]; if(!p) return;
  state.gates = Object.assign({}, gates(), { agent:{
    name, label:p.label, cmd:p.cmd, args:(p.args||[]).slice(), contArgs:p.contArgs ? p.contArgs.slice() : null,
    timeoutMin: gates().agent ? gates().agent.timeoutMin : 20 } });
  saveGates();
}

export function workerPresetGuess(){
  const target = el("targetAgent") ? String(el("targetAgent").value || "").trim() : "";
  const aliases = {
    "Claude Code":"claude", "Codex":"codex", "Codex CLI":"codex",
    "Antigravity":"agy", "Antigravity CLI":"agy", "Antigravity IDE":"agy",
    "workbuddy":"codebuddy", "WorkBuddy":"codebuddy", "Cursor":"cursor", "Gemini":"gemini",
    "umum":"none", "tidak ada agen (dry-run)":"none"
  };
  if(aliases[target] && Object.prototype.hasOwnProperty.call(AGENT_PRESETS, aliases[target])) return aliases[target];
  const key = String(target).toLowerCase();
  for(const [presetKey, preset] of Object.entries(AGENT_PRESETS)){
    if(presetKey.toLowerCase() === key || String(preset.label || "").toLowerCase() === key) return presetKey;
  }
  return "agy";
}

export async function ensureWorkerSource(){
  if(state.workerSource) return state.workerSource;
  /* di file:// fetch selalu ditolak CORS — jangan dicoba, supaya console tidak merah tiap buka */
  if(location.protocol !== "file:"){
    try{
      const r = await fetch("worker.mjs", {cache:"no-store"});
      if(r.ok) state.workerSource = await r.text();
    }catch(e){ /* server mati — pakai salinan yang ditanam di bawah */ }
  }
  if(!state.workerSource){
    const tanam = document.getElementById("pf-worker-src");
    if(tanam){ try{ const s = JSON.parse(tanam.textContent); if(s) state.workerSource = s; }catch(e){ /* blok rusak → paket tanpa worker, dilaporkan */ } }
  }
  return state.workerSource;
}

export function argLines(v){ return String(v || "").split("\n").map(s=>s.trim()).filter(Boolean); }
