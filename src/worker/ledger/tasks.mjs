export const STATUS = (s)=> (s || "belum mulai").toLowerCase();

export const isDone = (x)=> ["selesai","done","selesai "].includes(STATUS(x && x.status));

export const isFail = (x)=> STATUS(x && x.status) === "gagal";

/* A blocked prerequisite is not a failed attempt and must not be handed out again. */
export const isBlocked = (x)=> STATUS(x && x.status) === "terkendala";

export const taskList = (plan)=>{
  if(!plan) return [];
  if(Array.isArray(plan.tasks)) return plan.tasks;
  return (plan.tasks && Array.isArray(plan.tasks.tasks)) ? plan.tasks.tasks : [];
};

export function nextTask(plan, state){
  const list = taskList(plan);
  const done = (id)=> isDone((state && state.tasks[id]) || list.find(x=>x.id === id));
  const ready = list.filter(t=>{
    const st = (state && state.tasks[t.id]) || { status: t.status };
    if(isDone(st) || isFail(st) || isBlocked(st)) return false;
    return (t.depends_on || []).every(d => done(d));
  });
  if(ready.length) return ready[0];
  const blocked = list.filter(t=>!isDone(state.tasks[t.id]) && !isFail(state.tasks[t.id]) && !isBlocked(state.tasks[t.id]));
  return blocked.length ? { id: blocked[0].id, __blocked: true, needs: (blocked[0].depends_on||[]).filter(d=>!done(d)) } : null;
}

export function hasUnmetDeps(plan, state, t){
  return (t.depends_on || []).filter(d=>!isDone(state.tasks[d] || taskList(plan).find(x=>x.id === d)));
}
