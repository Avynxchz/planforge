/* PlanForge core: shared UI behavior rules plus plan consistency validation. */
import { ids, normId } from "./plan-normalize.mjs";
import { specBehavior, masalahBehavior } from "../../shared/behavior-spec.mjs";

/* The browser and worker must reject the same plans, so the behavior rules live in one shared
   module. These re-exports keep the original top-level bindings and their order in the bundle. */
export { CHECK_BROWSER, PERLU_SELECTOR, UI_FILE, UI_KATA, taskUi, specBehavior, masalahBehavior } from "../../shared/behavior-spec.mjs";
export const CONTOH_BEHAVIOR = { url:"http://127.0.0.1:8000/", server:{ cmd:"", ready:"http://127.0.0.1:8000/", timeoutSec:40 }, checks:[{ type:"noConsoleError" }] };

export function behaviorBaris(t){
  const s = specBehavior(t);
  if(!s) return [];
  const b = t.behavior || {};
  const out = ["url: " + s.url];
  if(b.viewport && b.viewport.width) out.push("viewport: " + b.viewport.width + "x" + (b.viewport.height || 800));
  if(b.server && b.server.cmd) out.push("server: " + b.server.cmd);
  s.checks.forEach((c,i)=>{
    const extra = Object.keys(c).filter(k=>k!=="type"&&k!=="selector").map(k=>k+"="+JSON.stringify(c[k])).join(" ");
    out.push((i+1)+". "+c.type+(c.selector?" "+c.selector:"")+(extra?" ("+extra+")":""));
  });
  return out;
}

export function validatePlan(prd, roadmap, tasks){
  const issues = [];
  if(!prd || !Array.isArray(prd.requirements) || prd.requirements.length === 0){
    issues.push("prd: requirements kosong atau tidak ada"); return issues;
  }
  if(prd.requirements.every(requirement=>
    /^(?:requirement )?sintetis otomatis dari task\b/i.test(String(requirement && requirement.description || "").trim())))
    issues.push("prd: seluruh requirement disintesis otomatis — PRD asli harus diperbaiki");
  const requirementTitles = prd.requirements.map(requirement=>
    String(requirement && requirement.title || "").trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean);
  if(new Set(requirementTitles).size !== requirementTitles.length)
    issues.push("prd: ada judul requirement duplikat");
  const reqIds = ids(prd.requirements).map(normId);
  if(new Set(reqIds).size !== reqIds.length) issues.push("prd: ada ID requirement duplikat");
  const mIds = roadmap && roadmap.milestones ? ids(roadmap.milestones).map(normId) : [];
  if(roadmap && new Set(mIds).size !== mIds.length) issues.push("roadmap: ID milestone duplikat");
  const tIds = tasks && tasks.tasks ? ids(tasks.tasks).map(normId) : [];
  if(new Set(tIds).size !== tIds.length) issues.push("tasks: ID task duplikat");

  const covered = new Set(), implemented = new Set();
  const testOnlyTask = task=>{
    if(/^(?:unit[- ]?)?tests?$/i.test(String(task.type || "").trim())) return true;
    const files = Array.isArray(task.files_or_areas) ? task.files_or_areas.map(String)
      : (Array.isArray(task.files) ? task.files.map(String) : []);
    if(files.length && files.every(file=>/(?:^|[\\/])(?:test|tests|__tests__)(?:[\\/]|$)/i.test(file))) return true;
    const title = String(task.title || "").trim();
    const description = String(task.description || "").trim();
    const testOnlyText = /^(?:(?:write|add|create|buat|tambah(?:kan)?|tulis)\s+(?:(?:unit|integration|e2e)\s+)?tests?\b|(?:unit|integration|e2e)\s+tests?\b|(?:uji|pengujian)\b)/i;
    return testOnlyText.test(title) || testOnlyText.test(description);
  };
  const seenT = new Set();
  for(const t of (tasks && tasks.tasks) || []){
    if(!t.id) issues.push("tasks: ada task tanpa id");
    if(!t.acceptance_criteria || !(Array.isArray(t.acceptance_criteria)?t.acceptance_criteria.length:String(t.acceptance_criteria).length))
      issues.push((t.id||"task") + ": acceptance_criteria kosong");
    if(!t.verification) issues.push((t.id||"task") + ": verification kosong");
    for(const m of masalahBehavior(t)) issues.push((t.id||"task") + ": " + m);
    if(!Array.isArray(t.requirement_refs) || !t.requirement_refs.length)
      issues.push((t.id||"task") + ": tidak merujuk requirement apa pun");
    for(const r of t.requirement_refs||[]){
      if(reqIds.includes(normId(r))){
        covered.add(normId(r));
        if(!testOnlyTask(t)) implemented.add(normId(r));
      }else issues.push((t.id||"task") + ": requirement_refs '" + r + "' tidak dikenal");
    }
    for(const d of t.depends_on||[]){ if(!seenT.has(d) && !seenT.has(normId(d))) issues.push((t.id||"task") + ": depends_on '" + d + "' belum/bukan ID task yang valid (harus task sebelumnya)"); }
    if(t.milestone_ref && mIds.length && !mIds.includes(normId(t.milestone_ref)))
      issues.push((t.id||"task") + ": milestone_ref '" + t.milestone_ref + "' tidak dikenal");
    seenT.add(normId(t.id));
  }
  for(const r of prd.requirements){
    const need = r.scope === "mvp" || r.scope === "must" || r.priority === "must";
    if(need && !covered.has(normId(r.id))) issues.push(normId(r.id) + ": requirement mvp belum dicakup task mana pun");
    else if(r.scope === "mvp" && !implemented.has(normId(r.id)))
      issues.push(normId(r.id) + ": requirement mvp hanya dicakup task pengujian; perlu task implementasi fitur");
  }
  for(const m of (roadmap && roadmap.milestones) || []){
    for(const r of m.requirement_refs||[]) if(!reqIds.includes(normId(r)))
      issues.push((m.id||"milestone") + ": requirement_refs '" + r + "' tidak dikenal");
  }
  const nf = prd.non_functional || [];
  if(!nf.length) issues.push("prd: bagian non_functional kosong — target terukur tidak ada");
  const UKUR = /[<>≤≥]=?\s*\d|\d\s*(ms|s|detik|menit|kb|mb|gb|tb|%|persen|px|fps|hz|req|request|kali|transaksi|item|baris|user|pengguna)/i;
  for(const n of nf){
    const target = String(n.target||"");
    if(!target || !/\d/.test(target)) issues.push((n.id||"N") + ": target non-fungsional belum berupa angka terukur ('" + target + "')");
    else if(!UKUR.test(target)) issues.push((n.id||"N") + ": target non-fungsional punya angka tapi bukan ukuran yang bisa diuji ('" + target + "')");
  }
  const feats = (prd.features || []).map(f=>String(f.name||"").trim());
  if(!feats.length) issues.push("prd: features kosong — lapisan fitur tidak ada, task akan sulit dikelompokkan");
  const norm = s=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");
  const featSet = new Set(feats.map(norm));
  const featTasks = new Map(feats.map(f=>[norm(f), 0]));
  for(const t of (tasks && tasks.tasks) || []){
    const k = norm(t.feature);
    if(!t.feature) issues.push((t.id||"task") + ": tidak menyebut feature");
    else if(featSet.size && !featSet.has(k)) issues.push((t.id||"task") + ": feature '" + t.feature + "' tidak ada di prd.features");
    else featTasks.set(k, (featTasks.get(k)||0) + 1);
    if(t.status && !["belum mulai","sedang","selesai","gagal","terkendala"].includes(norm(t.status)))
      issues.push((t.id||"task") + ": status '" + t.status + "' di luar daftar yang dikenal");
    if(t.priority && !["utama","penting","tambahan"].includes(norm(t.priority)))
      issues.push((t.id||"task") + ": priority '" + t.priority + "' di luar daftar utama/penting/tambahan");
  }
  for(const f of feats){ if(featTasks.get(norm(f)) === 0) issues.push("fitur '" + f + "' belum punya task apa pun"); }
  for(const m of (roadmap && roadmap.milestones) || []){
    for(const f of m.feature_refs||[]) if(featSet.size && !featSet.has(norm(f)))
      issues.push((m.id||"milestone") + ": feature_refs '" + f + "' tidak ada di prd.features");
  }
  const cyc = cycleOf(((tasks&&tasks.tasks)||[]).map(t=>[t.id,(t.depends_on||[])]));
  if(cyc.length) issues.push("tasks: siklus dependensi " + cyc.join(" -> "));
  return issues;
}

export function cycleOf(edges){
  const g = new Map(edges); const stack = [], onStack = new Set(), seen = new Set();
  const dfs = (n)=>{
    if(onStack.has(n)) return stack.slice(stack.indexOf(n)).concat(n);
    if(seen.has(n)) return null;
    seen.add(n); onStack.add(n); stack.push(n);
    for(const m of g.get(n)||[]){ const r = dfs(m); if(r) return r; }
    stack.pop(); onStack.delete(n); return null;
  };
  for(const [n] of g){ const r = dfs(n); if(r) return r; }
  return [];
}
