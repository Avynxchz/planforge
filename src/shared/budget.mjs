/* Browser budget estimates must agree; estimating calls does not authorize spending. */
export function hitungBudget(n, gates, milestoneSisa){
  const rv = (gates && gates.reviews) || [];
  const light = rv.filter(r=>r && r.enabled && r.tier === "light").length;
  const full = rv.filter(r=>r && r.enabled && r.tier === "full").length;
  const L = (gates && gates.limits) || {};
  const task = Math.max(0, Math.round(Number(n) || 0));
  const every = Math.max(1, Number(L.fullEvery) || 6);
  const kerja = task * (1 + light);
  const putaran = full ? Math.ceil(task / every) + (L.fullAtMilestoneEnd ? Math.max(0, Number(milestoneSisa) || 0) : 0) : 0;
  const penuh = putaran * full;
  const cadangan = Math.ceil((kerja + penuh) * 0.3);
  return { task, kerja, putaran, penuh, cadangan, total: kerja + penuh + cadangan };
}

export function taskMuat(budget, gates, milestoneSisa){
  if(budget == null) return Infinity;
  const b = Number(budget);
  if(!Number.isFinite(b)) return Infinity;
  let n = 0;
  while(n < 2000 && hitungBudget(n + 1, gates, milestoneSisa).total <= b) n++;
  return n;
}

export function sisaMilestone(milestones, tasks, statusOf){
  return (milestones || []).filter(m=>(tasks || []).some(t=>t.milestone_ref === m.id && statusOf(t) !== "selesai")).length;
}
