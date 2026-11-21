/* PlanForge core: chunk task, gabung chunk, jawaban clarify, dan patch. */
import { normId, normalizePlan } from "./plan-normalize.mjs";
import { KATA_SCAFFOLD, masalahStrukturRencana, rubrikRencana } from "./plan-readiness.mjs";
import { validatePlan } from "./plan-rules.mjs";

/* Pecah pembuatan task per milestone supaya model kecil tidak terpotong: tiap chunk
   kecil, total task tetap natural (tidak dipatok). Tanpa milestone -> satu panggilan penuh. */
export function taskChunks(roadmap, prd){
  const ms = (roadmap && roadmap.milestones) || [];
  if(!ms.length) return [];
  const sorted = ms.slice().sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0) || String(a.id||"").localeCompare(String(b.id||"")));
  return sorted.map((m,i)=>({
    milestone_ref: m.id, title: m.title || "",
    feature_refs: m.feature_refs || [], requirement_refs: m.requirement_refs || [],
    isFirst: i === 0, isLast: i === sorted.length - 1
  }));
}

/* Gabung satu chunk task ke daftar yang sudah ada: nomori ulang berurutan (T-001 dst)
   dan petakan ulang depends_on. Dependensi ke task chunk ini dipetakan ke ID baru;
   dependensi ke task chunk sebelumnya (ID global) dipertahankan. Deterministik & teruji. */
export function mergeTaskChunk(existing, chunk){
  const base = Array.isArray(existing) ? existing : [];
  const add = Array.isArray(chunk) ? chunk : [];
  const pad = (n)=>"T-" + String(n).padStart(3,"0");
  const nextNum = base.length + 1;
  const localMap = new Map();
  add.forEach((t,i)=>{ if(t && t.id != null) localMap.set(normId(t.id), pad(nextNum + i)); });
  const existingIds = new Set(base.map(t=>normId(t.id)));
  const out = add.map((t,i)=>{
    const nid = pad(nextNum + i);
    const deps = [];
    for(const d of (t.depends_on || [])){
      const nd = normId(d);
      const mapped = localMap.has(nd) ? localMap.get(nd) : (existingIds.has(nd) ? nd : String(d));
      if(normId(mapped) !== nid && !deps.some(x=>normId(x) === normId(mapped))) deps.push(mapped);
    }
    return Object.assign({}, t, {id:nid, depends_on:deps});
  });
  return base.concat(out);
}

/* Jawaban user dari kuesioner discovery jadi keputusan brief TANPA AI: tiap jawaban
   terisi menambah/memperbarui defaults_chosen supaya PRD menghormatinya; jawaban kosong
   (dilewati) tidak mengubah apa pun. Deterministik & teruji. */
export function terapkanJawabanClarify(clarify, answers){
  const doc = clarify && typeof clarify === "object" ? clarify : {};
  const qs = Array.isArray(doc.questions) ? doc.questions : [];
  const ai = Array.isArray(doc.ai_questions) ? doc.ai_questions : [];
  const byId = new Map(qs.concat(ai).map(q=>[String(q && q.id || ""), q]));
  const list = Array.isArray(answers) ? answers : [];
  const defaults = Array.isArray(doc.defaults_chosen) ? doc.defaults_chosen.slice() : [];
  const bersih = [];
  for(const a of list){
    if(!a) continue;
    const qid = String(a.question_id == null ? "" : a.question_id);
    const ans = String(a.answer == null ? "" : a.answer).trim();
    bersih.push({question_id:qid, answer:ans});
    if(!ans) continue;
    const q = byId.get(qid);
    const pertanyaan = q && q.question ? String(q.question) : (qid || "pertanyaan");
    const idx = defaults.findIndex(d=>String(d && d.question || "") === pertanyaan);
    const entri = {question:pertanyaan, decision:ans, reason:"Jawaban user di kuesioner discovery"};
    if(idx >= 0) defaults[idx] = entri; else defaults.push(entri);
  }
  doc.defaults_chosen = defaults;
  doc.user_answers = bersih;
  return doc;
}

export function applyPatches(docs, patch, options = null){
  const clone = (o)=>o == null ? o : (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const res = {prd:clone(docs.prd), roadmap:clone(docs.roadmap), tasks:clone(docs.tasks), applied:0, skipped:[]};
  const list = (patch && patch.patches) || [];
  const starter = !!(options && options.starter);
  const taskList = res.tasks && Array.isArray(res.tasks.tasks) ? res.tasks.tasks : [];
  const scaffold = taskList.find(t=>KATA_SCAFFOLD.test(String(t && (t.title || "") + " " + (t.description || ""))));
  const validAddedTask = task=>{
    if(!task || typeof task !== "object" || !String(task.id || "").trim() || !String(task.title || "").trim() || !String(task.verification || "").trim()) return false;
    const probe = Object.assign({}, task, {id:"T-001", title:"Buat scaffold"});
    const errors = masalahStrukturRencana({tasks:{tasks:[probe]}}, true);
    return !errors.some(x=>/^T-001: (?:verification|gerbang ini)/.test(x));
  };
  for(const p of list){
    if(!p || !p.document || !p.collection || !p.object){ res.skipped.push("patch tidak lengkap"); continue; }
    const root = res[p.document]; if(!root) { res.skipped.push("document " + p.document); continue; }
    let coll = root[p.collection]; if(!Array.isArray(coll)) { coll = root[p.collection] = []; }
    const obj = p.object;
    const idx = p.target_id && p.action === "update"
      ? coll.findIndex(x => x.id === p.target_id) : -1;
    if(p.action === "update" && idx >= 0){ coll[idx] = Object.assign({}, coll[idx], obj); res.applied++; }
    else if(p.action === "add" || (p.action === "update" && idx < 0)){
      if(p.document === "tasks" && p.collection === "tasks"){
        if(!validAddedTask(obj)){ res.skipped.push("task baru harus punya id, title, dan verification yang valid"); continue; }
        if(!starter && scaffold && String(obj.id).localeCompare(String(scaffold.id)) < 0){
          res.skipped.push("task baru ditolak karena akan ditempatkan sebelum scaffold pertama " + scaffold.id);
          continue;
        }
      }
      if(coll.some(x => x.id === obj.id)){ res.skipped.push("duplikat " + obj.id); continue; }
      coll.push(obj); res.applied++;
    } else res.skipped.push("aksi tak dikenal " + p.action);
  }
  const sortId = (a,b)=>String(a.id||"").localeCompare(String(b.id||""));
  if(res.tasks && Array.isArray(res.tasks.tasks)) res.tasks.tasks.sort(sortId);
  if(res.prd && Array.isArray(res.prd.requirements)) res.prd.requirements.sort(sortId);
  if(res.roadmap && Array.isArray(res.roadmap.milestones)) res.roadmap.milestones.sort(sortId);
  return res;
}

export function applyImprovingPatches(docs, patch, starter){
  const measurePlan = (plan, isStarter)=>{
    const normalized = normalizePlan(plan.prd, plan.roadmap, plan.tasks);
    const candidate = Object.assign({}, plan, normalized);
    const issues = validatePlan(candidate.prd, candidate.roadmap, candidate.tasks);
    const rubric = rubrikRencana(candidate, issues, isStarter);
    return {docs:candidate, issues, problems:issues.length + masalahStrukturRencana(candidate, isStarter).length, score:rubric.skor};
  };
  const before = measurePlan(docs, starter);
  const applied = applyPatches(before.docs, patch, {starter});
  const after = measurePlan(applied, starter);
  const accepted = applied.applied > 0 && after.problems < before.problems && after.score >= before.score;
  return {
    accepted,
    prd:accepted ? after.docs.prd : before.docs.prd,
    roadmap:accepted ? after.docs.roadmap : before.docs.roadmap,
    tasks:accepted ? after.docs.tasks : before.docs.tasks,
    issues:accepted ? after.issues : before.issues,
    applied:accepted ? applied.applied : 0,
    skipped:applied.skipped.concat(accepted ? [] : ["patch ditolak: jumlah masalah tidak berkurang atau skor rubrik turun"]),
    beforeProblems:before.problems,
    afterProblems:accepted ? after.problems : before.problems,
    beforeScore:before.score,
    afterScore:accepted ? after.score : before.score
  };
}
