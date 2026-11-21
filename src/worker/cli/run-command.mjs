import { pruneUnavailableGates } from "../verification/hard-gates.mjs";
import { mulaiSesi } from "../workflow/session.mjs";
import { log } from "../ledger/log.mjs";
import { budgetRencana, sisaBudget } from "../workflow/budget.mjs";
import { taskMuat } from "../../shared/budget.mjs";
import { nextTask, hasUnmetDeps, isFail } from "../ledger/tasks.mjs";
import { short } from "../text.mjs";
import { runOne } from "../workflow/run-one.mjs";
import { saveCtx } from "../ledger/state.mjs";

export function commandRun(ctx, cwd, args, cap){
  const lim = ctx.gates.limits;
  if(!args["no-gates"]) pruneUnavailableGates(ctx, cwd);
  if(!ctx.dryRun) mulaiSesi(ctx);
  log(ctx, "mulai · sesi " + (ctx.state.runId || "-") + " · agen=" + ctx.gates.agent.name + " · maxCalls=" + lim.maxCalls
    + " · plafon biaya " + (lim.maxCostUsd == null ? "tanpa batas" : "$" + lim.maxCostUsd)
    + " · gerbang keras=" + ctx.gates.hard.filter(h=>h.enabled).map(h=>h.id).join(",") + " · penuh tiap " + lim.fullEvery + " task");
  if(lim.maxCostUsd === 0) log(ctx, "plafon biaya $0 = hanya agen yang melaporkan biaya nol yang boleh jalan terus. Kalau agen ini berbayar, worker berhenti setelah panggilan pertama yang melaporkan biaya — naikkan limits.maxCostUsd di gates.json (atau --max-cost) kalau memang mau membayarnya.");
  const butuh = budgetRencana(ctx);
  const muat = (x)=> x == null ? "tanpa batas" : "±" + taskMuat(x, ctx.gates, butuh.milestoneSisa) + " task";
  log(ctx, "kebutuhan: " + butuh.task + " task tersisa ≈ " + butuh.total + " panggilan (kerja " + butuh.kerja + " + gerbang penuh " + butuh.penuh + " + cadangan " + butuh.cadangan + ")"
    + " · maxCalls " + lim.maxCalls + " muat " + muat(lim.maxCalls) + " · maxCallsPerRun " + (lim.maxCallsPerRun == null ? "tanpa batas" : lim.maxCallsPerRun) + " muat " + muat(lim.maxCallsPerRun));
  if((lim.maxCalls != null && lim.maxCalls < butuh.total) || (lim.maxCallsPerRun != null && lim.maxCallsPerRun < butuh.total))
    log(ctx, "!! budget belum cukup untuk sekali jalan sampai habis — pakai `--auto-budget` (dihitung dari task tersisa) atau naikkan limits.maxCalls/maxCallsPerRun. State tersimpan, jadi run berikutnya melanjutkan, bukan mengulang.");
  let n = 0;
  while(true){
    if(ctx.state.calls >= lim.maxCalls){ log(ctx, "budget panggilan habis (" + lim.maxCalls + ") — naikkan --max-calls kalau memang mau lanjut"); break; }
    const lewat = sisaBudget(ctx);
    if(lewat){ log(ctx, "berhenti: " + lewat + " — tidak ada panggilan lagi yang dikirim. Naikkan batasnya di gates.json kalau memang mau lanjut."); break; }
    if(ctx.state.consecFails >= (lim.maxConsecutiveFails || 3)){ log(ctx, "berhenti: " + ctx.state.consecFails + " kegagalan berturut-turut. Ini biasanya bukan lagi soal model — cek RUN_LOG.md, perbaiki plan, lalu jalankan lagi."); break; }
    if(cap && n >= cap){ log(ctx, "berhenti: batas --max-tasks tercapai"); break; }
    let t;
    if(args.only){
      if(n > 0) break;
      t = ctx.plan.tasks.tasks.find(x=>x.id === args.only);
      if(!t){ console.error("task " + args.only + " tidak ada"); return 1; }
    } else {
      t = nextTask(ctx.plan, ctx.state);
      if(!t){ log(ctx, "tidak ada task tersisa yang siap dijalankan"); break; }
      if(t.__blocked){
        const gagal = (t.needs || []).filter(id=>isFail(ctx.state.tasks[id]));
        if(gagal.length){
          log(ctx, "mentok: " + t.id + " menunggu " + (t.needs||[]).join(", ") + " yang belum selesai/gagal — hentikan loop. Task gagal: "
            + gagal.join(", ") + ". Untuk mencoba ulang, jalankan `node worker.mjs run --only " + gagal[0]
            + "`; setelah selesai, jalankan `node worker.mjs run` untuk melanjutkan antrean.");
        }else log(ctx, "mentok: " + t.id + " menunggu " + (t.needs||[]).join(", ") + " yang belum selesai/gagal — hentikan loop");
        break;
      }
      const unmet = hasUnmetDeps(ctx.plan, ctx.state, t);
      if(unmet.length){ ctx.state.tasks[t.id].note = "menunggu " + unmet.join(", "); log(ctx, "lewati " + t.id + " (belum selesai: " + unmet.join(", ") + ")"); ctx.state.consecFails = (lim.maxConsecutiveFails||3); break; }
    }
    log(ctx, "task berikutnya: " + t.id + " — " + short(t.title, 70));
    const r = runOne(ctx, t, cwd); n++;
    if(r === "dry"){ log(ctx, "dry-run: prompt " + t.id + " sudah ditampilkan di atas — tidak ada task yang diubah, tidak ada commit"); break; }
    if(r === "halt"){ log(ctx, "BERHENTI — " + (ctx.state.haltNote || "agen tidak bisa dipakai (kuota/auth habis)") + ". " + t.id + " dibiarkan apa adanya, bukan dihitung gagal. Cek RUN_LOG.md, betulkan penyebabnya, lalu jalankan lagi."); break; }
    if(args.only || args.one) break;
    if(r === "blocked") log(ctx, "  (agen menyerah di task ini; loop lanjut ke task berikutnya yang tidak bergantung padanya)");
  }
  if(!ctx.dryRun) saveCtx(ctx);
  if(ctx.dryRun){ log(ctx, "selesai dry-run: " + n + " prompt dilihat · tidak ada task yang diubah, tidak ada commit"); return 0; }
  log(ctx, "selesai sesi: " + n + " task diproses · " + ctx.state.doneTasks + "/" + ctx.plan.tasks.tasks.length + " selesai total · "
    + ctx.state.calls + " panggilan agen (sesi ini " + (ctx.state.callsThisRun || 0) + ")"
    + (ctx.state.costUsd ? " · biaya $" + ctx.state.costUsd + " (sesi ini $" + (ctx.state.costThisRun || 0) + ")" : ""));
  return 0;
}
