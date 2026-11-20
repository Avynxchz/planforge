/* PlanForge core: gates bawaan dan berkas .planforge (plan/state/progres). */
import { AGENT_PRESETS } from "../../shared/agent-contracts.mjs";
import { LIGHT_REVIEW, FULL_GATES, HARD_CHECKS } from "../../shared/gate-policy.mjs";
import { planFingerprint } from "./handoff.mjs";
import { normStatus } from "./plan-normalize.mjs";

/* Named re-exports: the UI imports every global it uses through a concrete core module. */
export { AGENT_PRESETS } from "../../shared/agent-contracts.mjs";
export { hitungBudget, taskMuat, sisaMilestone } from "../../shared/budget.mjs";

export function defaultGates(agentName){
  const diminta = agentName || "agy";
  /* Connector memakai nama workbuddy, preset worker bernama codebuddy. */
  const kunci = diminta === "workbuddy" ? "codebuddy" : diminta;
  /* hasOwnProperty: nama seperti "toString" atau "constructor" bukan preset, jadi harus
     melempar Error yang jelas — bukan jatuh ke TypeError karena membaca properti bawaan Object. */
  const a = Object.prototype.hasOwnProperty.call(AGENT_PRESETS, kunci) ? AGENT_PRESETS[kunci] : null;
  if(!a) throw new Error("agen \"" + diminta + "\" tidak dikenal — pilih: " + Object.keys(AGENT_PRESETS).join(", "));
  return {
    v:1,
    agent:{ name:diminta, label:a.label, cmd:a.cmd, args:a.args.slice(), contArgs:a.contArgs ? a.contArgs.slice() : null, timeoutMin:20 },
    limits:{ maxCalls:60, maxCallsPerRun:40, maxCostUsd:0, maxTokens:null,
      maxConsecutiveFails:3, fullEvery:6, fullAtMilestoneEnd:true, fixRounds:2, autoCommit:true },
    hard: JSON.parse(JSON.stringify(HARD_CHECKS)),
    reviews: [{ id:"light", label:"Review ringan tiap task", tier:"light", enabled:true, prompt:LIGHT_REVIEW }]
      .concat(JSON.parse(JSON.stringify(FULL_GATES)))
  };
}
export const planTaskList = (docs)=> ((docs && docs.tasks && docs.tasks.tasks) || []);

/* isi plan.json — format yang dibaca worker.mjs (plan.tasks.tasks, bukan array telanjang).
   Worker membaca ringkasan dari prd.overview.summary; dokumen web menyimpannya di prd.summary. */
export function planBundleJson(docs, issues){
  const prd = Object.assign({}, (docs && docs.prd) || {});
  if(!(prd.overview && prd.overview.summary) && prd.summary){
    const overview = prd.overview && typeof prd.overview === "object" ? prd.overview : {};
    prd.overview = Object.assign({}, overview, { summary:prd.summary });
  }
  return JSON.stringify({
    generatedAt:new Date().toISOString(),
    planFingerprint: planFingerprint(docs),
    brief: (docs && docs.clarify) || null, prd, roadmap: (docs && docs.roadmap) || {},
    tasks: (docs && docs.tasks) || { tasks: [] }, issues: issues || []
  }, null, 2);
}
export function freshStateJson(docs){
  const tasks = {};
  for(const t of planTaskList(docs)) tasks[t.id] = { status: normStatus(t.status) || "belum mulai", tries:0, gate:null, note:"" };
  return { runId:new Date().toISOString().slice(0,10), startedAt:new Date().toISOString(),
    planFingerprint: planFingerprint(docs), rev:0,
    calls:0, spentNotes:[], tasks, history:[], doneTasks:0, sinceFull:0, consecFails:0, lastTask:null };
}
/* Progres eksekusi dibaca dari state.json yang ditulis worker di folder proyek — bukan tebakan.
   Murni (tanpa DOM/async) supaya bisa diuji. Daftar & urutan task dari plan, status dari ledger.
   "terkendala" (mark_blocked) harus dipertahankan: normStatus tidak mengenalnya dan akan
   menjatuhkannya ke "belum mulai", padahal itu kondisi berbeda yang butuh tindakan manusia. */
export function progresDariState(sj, docs){
  const ts = planTaskList(docs), st = (sj && sj.tasks) || {};
  const rows = ts.map(t=>{
    const s = st[t.id] || {};
    const status = s.status === "terkendala" ? "terkendala" : (normStatus(s.status) || "belum mulai");
    return { id:t.id, title:t.title || "", status, finishedAt:s.finishedAt || null, note:s.note || null };
  });
  const done = rows.filter(r=>r.status === "selesai").length;
  return { rows, done, total:rows.length, doneTasks:Number((sj && sj.doneTasks) || done), lastTask:(sj && sj.lastTask) || null };
}
