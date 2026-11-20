import { taskList, isDone } from "../ledger/tasks.mjs";
import { sisaMilestone, hitungBudget } from "../../shared/budget.mjs";

export function budgetRencana(ctx){
  const ts = taskList(ctx.plan);
  const st = (t)=>ctx.state.tasks[t.id] || {};
  const m = sisaMilestone((ctx.plan.roadmap && ctx.plan.roadmap.milestones) || [], ts, t=>isDone(st(t)) ? "selesai" : "belum mulai");
  const b = hitungBudget(ts.filter(t=>!isDone(st(t))).length, ctx.gates, m);
  b.milestoneSisa = m;
  return b;
}

export function sisaBudget(ctx){
  const lim = (ctx.gates && ctx.gates.limits) || {};
  const biaya = Number(ctx.state.costUsd || 0);
  if(lim.maxCostUsd != null && biaya > Number(lim.maxCostUsd))
    return "biaya $" + biaya + " sudah melewati maxCostUsd $" + lim.maxCostUsd;
  const tok = Number(ctx.state.tokens || 0);
  if(lim.maxTokens != null && tok > Number(lim.maxTokens))
    return "token " + tok + " sudah melewati maxTokens " + lim.maxTokens;
  /* Check inside tasks too: fixes and reviews can exhaust the ceiling mid-task. */
  const total = Number(ctx.state.calls || 0);
  if(lim.maxCalls != null && total >= Number(lim.maxCalls))
    return "panggilan " + total + "/" + lim.maxCalls + " (maxCalls)";
  const sesi = Number(ctx.state.callsThisRun || 0);
  if(lim.maxCallsPerRun != null && sesi >= Number(lim.maxCallsPerRun))
    return "panggilan sesi ini " + sesi + "/" + lim.maxCallsPerRun + " (maxCallsPerRun)";
  return null;
}
