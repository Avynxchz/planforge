import { saveCtx } from "../ledger/state.mjs";

/* The random suffix separates runs started within the same second. */
export function mulaiSesi(ctx){
  ctx.state.runId = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
  ctx.state.runStartedAt = new Date().toISOString();
  ctx.state.callsThisRun = 0;
  ctx.state.costThisRun = 0;
  saveCtx(ctx);
  return ctx.state.runId;
}
