import { isDone, isFail } from "../ledger/tasks.mjs";
import { short } from "../text.mjs";
import { budgetRencana } from "../workflow/budget.mjs";
import { taskMuat } from "../../shared/budget.mjs";
import { cetakFile } from "../ledger/files.mjs";
import { SELF_FILE } from "../identity.mjs";
import { saveCtx } from "../ledger/state.mjs";
import { log } from "../ledger/log.mjs";

export function commandStatus(ctx, cwd){
  for(const t of ctx.plan.tasks.tasks){
    const s = ctx.state.tasks[t.id];
    console.log((isDone(s) ? "x " : isFail(s) ? "! " : "  ") + t.id + " [" + (s.status||"belum mulai") + "] " + t.title + " · " + (t.feature||"") + (s.note ? " · " + short(s.note, 60) : ""));
  }
  console.log("\nselesai " + ctx.state.doneTasks + " · call " + ctx.state.calls + "/" + ctx.gates.limits.maxCalls + " · agen " + ctx.gates.agent.name + " · " + cwd
    + (ctx.state.costUsd ? " · biaya $" + ctx.state.costUsd : "")
    + " · plafon biaya " + (ctx.gates.limits.maxCostUsd == null ? "tanpa batas" : "$" + ctx.gates.limits.maxCostUsd));
  if(ctx.state.fullHalt) console.log("!! gerbang penuh berhenti: " + ctx.state.fullHalt.kenapa);
  const b = budgetRencana(ctx), L = ctx.gates.limits;
  console.log("task tersisa " + b.task + " · butuh ≈ " + b.total + " panggilan · maxCalls " + L.maxCalls + " muat ±" + taskMuat(L.maxCalls, ctx.gates, b.milestoneSisa)
    + " task · maxCallsPerRun " + (L.maxCallsPerRun == null ? "tanpa batas" : L.maxCallsPerRun + " muat ±" + taskMuat(L.maxCallsPerRun, ctx.gates, b.milestoneSisa) + " task")
    + (b.total > 0 && ((L.maxCalls != null && L.maxCalls < b.total) || (L.maxCallsPerRun != null && L.maxCallsPerRun < b.total)) ? " · belum cukup: node worker.mjs run --auto-budget" : ""));
  return 0;
}

export function commandBuild(){
  console.log("worker.mjs terbaru: " + cetakFile(SELF_FILE) + " · " + SELF_FILE.replace(/\\/g, "/"));
  console.log("bandingkan dengan baris `build worker yang menjawab kamu` di jawaban tool MCP agen.");
  console.log("kalau beda: restart connector PlanForge, atau pakai `node worker.mjs verify <T-xxx>` yang selalu pakai kode terbaru.");
  return 0;
}

export function commandGiliran(ctx, args){
  const g = ctx.state.giliran;
  if(!g){ console.log("tidak ada giliran terbuka · gerbang penuh terakhir sampai " + (ctx.state.lastFullMark || "-") + " · " + (ctx.state.sinceFull || 0) + " task sejak itu"); return 0; }
  if(args.ulang){
    delete g.gagal; delete g.diserahkan; delete ctx.state.fullHalt; saveCtx(ctx);
    log(ctx, g.id + " dibuka ulang oleh manusia — next_task akan menyerahkannya lagi");
    console.log(g.id + " dibuka ulang. Minta agen memanggil next_task.");
    return 0;
  }
  if(args.lewati){
    const dilewatiSampai = g.to;
    ctx.state.history.push({ at: new Date().toISOString(), gate: g.id, from: g.from, to: g.to, out: "DILEWATI manusia" + (g.gagal ? " sesudah gagal: " + g.gagal : "") });
    delete ctx.state.giliran; delete ctx.state.fullHalt; ctx.state.sinceFull = 0; ctx.state.lastFullMark = dilewatiSampai; saveCtx(ctx);
    log(ctx, g.id + " DILEWATI manusia — audit atas " + g.from + ".." + dilewatiSampai + " dilewati manusia (tercatat di history); giliran berikutnya dimulai setelah " + dilewatiSampai);
    console.log(g.id + " dilewati dan dicatat di ledger. Task berikutnya bisa diambil.");
    return 0;
  }
  console.log(g.id + " · gerbang penuh " + g.from + ".." + g.to + " · " + (g.gagal ? "GAGAL: " + g.gagal : g.diserahkan ? "sedang dikerjakan agen" : "menunggu next_task")
    + (g.note ? "\n  catatan terakhir: " + g.note : "") + "\n  --ulang = coba lagi · --lewati = lewati (tercatat)");
  return 0;
}
