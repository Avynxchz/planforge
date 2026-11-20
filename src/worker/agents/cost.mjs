import { now } from "../text.mjs";
import { log } from "../ledger/log.mjs";
import { sisaBudget } from "../workflow/budget.mjs";

export function catatBiaya(ctx, j, tag){
  if(!j || typeof j !== "object") return;
  const usd = Number(j.total_cost_usd != null ? j.total_cost_usd : j.cost_usd);
  const u = j.usage || {};
  const tok = Number(u.input_tokens || u.prompt_tokens || 0) + Number(u.output_tokens || u.completion_tokens || 0);
  if(!Number.isFinite(usd) && !tok) return;
  if(Number.isFinite(usd)){
    ctx.state.costUsd = Math.round(((ctx.state.costUsd || 0) + usd) * 1e5) / 1e5;
    ctx.state.costThisRun = Math.round(((ctx.state.costThisRun || 0) + usd) * 1e5) / 1e5;
  }
  if(tok) ctx.state.tokens = (ctx.state.tokens || 0) + tok;
  ctx.state.spentNotes.push({ at: now(), tag, usd: Number.isFinite(usd) ? usd : null, tokens: tok || null });
  if(Number.isFinite(usd)) log(ctx, "  biaya " + tag + ": $" + usd + " (akumulasi $" + ctx.state.costUsd + ")");
  const lewat = sisaBudget(ctx);
  if(lewat) log(ctx, "  !! " + lewat + " — panggilan berikutnya tidak akan dikirim");
}
