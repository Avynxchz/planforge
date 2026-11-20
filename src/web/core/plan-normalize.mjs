/* PlanForge core: ekstraksi JSON, normalisasi ID, fitur, status, dan isi rencana. */

export function extractJson(text){
  if(text == null) throw new Error("kosong");
  let t = String(text).trim();
  if(t.startsWith("```")) t = t.replace(/^```[a-zA-Z]*\n?/,"").replace(/```$/,"").trim();
  const starts = [];
  for(let i=0;i<t.length;i++){ if(t[i] === "{") starts.push(i); if(starts.length > 6) break; }
  const errs = [];
  for(const s of starts){
    let depth = 0, inStr = false, esc = false;
    for(let i=s;i<t.length;i++){
      const c = t[i];
      if(inStr){ if(esc) esc=false; else if(c==="\\") esc=true; else if(c==='"') inStr=false; continue; }
      if(c==='"') inStr=true;
      else if(c==="{") depth++;
      else if(c==="}"){ depth--; if(depth===0){
        const cand = t.slice(s,i+1);
        try{ return JSON.parse(cand); }catch(e){ errs.push(e.message); break; }
      }}
    }
  }
  try{ return JSON.parse(t); }catch(e){ throw new Error("JSON tidak valid: " + (errs[0]||e.message)); }
}

export function ids(list){ return (list||[]).map(x=>x && x.id).filter(x=>x!=null && String(x).trim()!==""); }

/* ---- kerapian deterministik: ID, nama fitur, status (tanpa AI, tanpa biaya) ---- */
export function normId(s){
  const raw = String(s==null?"":s).trim();
  const m = raw.toUpperCase().match(/^([A-Z]{1,4})[\s_.-]*0*(\d{1,5})$/);
  return m ? m[1] + "-" + m[2].padStart(3, "0") : raw;
}
export const featKey = (s)=>String(s==null?"":s).trim().toLowerCase().replace(/\s+/g," ");
export const DASH = "\\u2013\\u2014\\u2012\\u2015";
export function featTail(s){
  const t = String(s==null?"":s);
  const parts = t.split(new RegExp("(?:[:" + DASH + "]| - )+"));
  for(let i=parts.length-1;i>=0;i--) if(parts[i].trim()) return parts[i].trim();
  return t.trim();
}
export function featMatch(name, list){
  const k = featKey(name); if(!k || !list.length) return null;
  for(const f of list) if(featKey(f) === k) return f;
  const tail = featKey(featTail(name));
  for(const f of list) if(featKey(f) === tail || featKey(featTail(f)) === tail) return f;
  for(const f of list){ const fk = featKey(f); if(fk && (fk.includes(tail) || tail.includes(fk))) return f; }
  const words = (s)=>new Set(featKey(s).split(/[^a-z0-9]+/).filter(w=>w.length > 2));
  let best = null, score = 0, bestOv = 0;
  for(const f of list){
    const a = words(f), b = words(name);
    if(!a.size || !b.size) continue;
    let ov = 0; for(const w of b) if(a.has(w)) ov++;
    const sc = ov / Math.min(a.size, b.size);
    if(sc > score){ score = sc; best = f; bestOv = ov; }
  }
  // ambang ketat: satu kata umum yang sama ("kasir", "data") tidak cukup untuk menyamakan fitur
  return (score >= 0.66 && (bestOv >= 2 || score === 1)) ? best : null;
}
export const STATUS_MAP = {"belum mulai":"belum mulai","belum":"belum mulai","todo":"belum mulai","open":"belum mulai","pending":"belum mulai","not started":"belum mulai","not done":"belum mulai","incomplete":"belum mulai",
  "sedang":"sedang","dikerjakan":"sedang","in progress":"sedang","progress":"sedang","wip":"sedang",
  "selesai":"selesai","done":"selesai","finished":"selesai","complete":"selesai",
  "gagal":"gagal","blocked":"gagal","error":"gagal","batal":"gagal","failed":"gagal"};
export function normStatus(s){
  const k = featKey(s); if(!k) return "belum mulai";
  return STATUS_MAP[k] || null;
}
export function normalizePlan(prd, roadmap, tasks){
  const clone = (o)=>o==null?o:(typeof structuredClone==="function"?structuredClone(o):JSON.parse(JSON.stringify(o)));
  const P = clone(prd), R = clone(roadmap), T = clone(tasks), fixes = [];
  if(!P || !Array.isArray(P.requirements)) return {prd:P, roadmap:R, tasks:T, fixes};
  const next = {R:1, M:1, T:1};
  const usedIds = {R:new Set(), M:new Set(), T:new Set()};
  const collect = (list, p)=>{ for(const o of (list||[])) if(o && o.id != null && String(o.id).trim()) usedIds[p].add(normId(o.id)); };
  collect(P.requirements, "R"); collect(R && R.milestones, "M"); collect(T && T.tasks, "T");
  const slot = (p)=>p + "-" + String(next[p]).padStart(3, "0");
  const free = (p)=>{ while(usedIds[p].has(slot(p))) next[p]++; };
  (["R","M","T"]).forEach(free);
  const bump = (p)=>{ const id = slot(p); usedIds[p].add(id); next[p]++; free(p); return id; };
  const fixId = (obj, p, label)=>{
    if(!obj || obj.id == null || !String(obj.id).trim()) return;
    const raw = String(obj.id).trim(), n = normId(raw);
    if(new RegExp("^" + p + "-\\d{3}$").test(n)){ if(n !== raw){ obj.id = n; fixes.push(label + " " + raw + ": ID dirapikan → '" + n + "'"); } return; }
    obj.id = bump(p); fixes.push(label + " " + raw + ": ID bukan pola '" + p + "-###' → diganti '" + obj.id + "'");
  };
  for(const r of P.requirements) fixId(r, "R", "requirement");
  for(const m of (R && R.milestones) || []) fixId(m, "M", "milestone");
  for(const t of (T && T.tasks) || []) fixId(t, "T", "task");
  if((T && T.tasks) || (R && R.milestones)){
    const mIds = new Set(ids(R && R.milestones));
    const tIds = new Set(ids(T && T.tasks));
    for(const t of (T && T.tasks) || []){
      if(t.milestone_ref != null && String(t.milestone_ref).trim()){
        const n = normId(t.milestone_ref);
        if(mIds.has(n)){ if(n !== String(t.milestone_ref).trim()) fixes.push("task " + t.id + ": milestone_ref '" + t.milestone_ref + "' → '" + n + "'"); t.milestone_ref = n; }
        else { fixes.push("task " + t.id + ": milestone_ref '" + t.milestone_ref + "' dibuang (milestone itu tidak ada)"); t.milestone_ref = ""; }
      }
      if(Array.isArray(t.depends_on)){
        const out = [];
        for(const raw of t.depends_on){
          const n = normId(raw);
          if(!tIds.has(n)){ fixes.push("task " + t.id + ": depends_on '" + raw + "' dibuang (bukan ID task)"); continue; }
          if(!out.includes(n) && n !== t.id) out.push(n);
          else if(n === t.id) fixes.push("task " + t.id + ": depends_on dirinya sendiri dibuang");
        }
        if(out.join() !== t.depends_on.map(x=>String(x).trim()).join()) t.depends_on = out;
      }
      if(t.priority != null && String(t.priority).trim()){
        const pr = String(t.priority).trim().toLowerCase();
        const goal = pr === "pendukung" ? "tambahan" : (["utama","penting","tambahan"].includes(pr) ? pr : "utama");
        if(goal !== String(t.priority).trim()){ fixes.push("task " + t.id + ": priority '" + t.priority + "' dirapikan → '" + goal + "'"); t.priority = goal; }
      }
    }
  }
  const reqIds = ids(P.requirements);
  const feats = (P.features||[]).map(f=>String(f.name==null?"":f.name).trim()).filter(Boolean);
  const refs = (obj, kind)=>{
    if(!obj || !Array.isArray(obj.requirement_refs)) return;
    const out = [];
    for(const raw of obj.requirement_refs){
      const n = normId(raw);
      if(reqIds.includes(n)){
        if(!out.includes(n)) out.push(n);
        if(String(raw).trim() !== n) fixes.push(kind + " " + (obj.id||"?") + ": rujukan '" + raw + "' dirapikan jadi '" + n + "'");
      } else fixes.push(kind + " " + (obj.id||"?") + ": rujukan '" + raw + "' dibuang (ID itu tidak ada di PRD)");
    }
    if(out.length !== obj.requirement_refs.length || out.join() !== obj.requirement_refs.join()) obj.requirement_refs = out;
  };
  const feat = (obj, kind)=>{
    if(!obj || !feats.length) return;
    const raw = obj.feature;
    if(raw == null || !String(raw).trim()) return;
    const m = featMatch(raw, feats);
    if(m && featKey(m) !== featKey(raw)) { obj.feature = m; fixes.push(kind + " " + (obj.id||"?") + ": fitur '" + raw + "' → '" + m + "'"); }
    else if(m) obj.feature = m;
  };
  const bucketTasks = (T && T.tasks) || [];
  const BUCKET_NAME = "Lintas fitur: non-fungsional & rilis";
  const BUCKET_LEAD = /^(non[\s-]?fungsional|non[\s-]?functional|non[\s-]?func|e2e|end[\s-]?to[\s-]?end|smoke|regresi|hardening|rilis|launch|deploy)/i;
  const orphans = bucketTasks.filter(t=>t && !featMatch(t.feature||"", feats) && BUCKET_LEAD.test(String(t.feature||"").trim()));
  if(orphans.length){
    if(!Array.isArray(P.features)) P.features = [];
    let bf = P.features.find(f=>featKey(f && f.name) === featKey(BUCKET_NAME));
    if(!bf){
      bf = {name: BUCKET_NAME, priority:"medium", phase:"Fase rilis", sub_features:[],
        description:"Pekerjaan lintas fitur: mengukur target non-fungsional dan pengecekan akhir sebelum rilis. Wadah ini dibuat otomatis supaya task yang tadinya menggantung punya induk."};
      P.features.push(bf); feats.push(BUCKET_NAME);
      fixes.push("prd: fitur '" + BUCKET_NAME + "' dibuat sebagai wadah " + orphans.length + " task yang tidak terhubung ke fitur mana pun");
    }
    if(!Array.isArray(bf.sub_features)) bf.sub_features = [];
    for(const t of orphans){
      const raw = String(t.feature).trim(), ix = raw.search(/[:—–]/);
      const sub = (ix > 0 && ix < 30) ? raw.slice(ix+1).trim() : raw;
      if(sub && !bf.sub_features.some(s=>featKey(s) === featKey(sub))) bf.sub_features.push(sub);
      fixes.push("task " + (t.id||"?") + ": fitur '" + raw + "' → '" + BUCKET_NAME + "'");
      t.feature = BUCKET_NAME;
    }
  }
  for(const m of (R && R.milestones) || []){ refs(m, "milestone"); if(Array.isArray(m.feature_refs)){
    const out = [];
    for(const raw of m.feature_refs){ const f = featMatch(raw, feats);
      if(f){ if(!out.includes(f)) out.push(f); if(f !== raw) fixes.push("milestone " + (m.id||"?") + ": feature_refs '" + raw + "' → '" + f + "'"); }
      else fixes.push("milestone " + (m.id||"?") + ": feature_refs '" + raw + "' dibuang (tidak ada di prd.features)"); }
    m.feature_refs = out;
  }}
  for(const t of bucketTasks){
    refs(t, "task"); feat(t, "task");
    const rawStatus = t.status;
    if(rawStatus == null || !String(rawStatus).trim()){ t.status = "belum mulai"; }
    else {
      const s = normStatus(rawStatus);
      if(!s){ t.status = "belum mulai"; fixes.push("task " + (t.id||"?") + ": status '" + rawStatus + "' tidak dikenal → 'belum mulai'"); }
      else if(s !== String(rawStatus)){ t.status = s; fixes.push("task " + (t.id||"?") + ": status '" + rawStatus + "' → '" + s + "'"); }
      else t.status = s;
    }
  }
  return {prd:P, roadmap:R, tasks:T, fixes};
}
