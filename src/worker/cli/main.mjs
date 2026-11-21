import path from "node:path";
import { parseArgs } from "./args.mjs";
import { commandInit, commandBrowser, commandEmbed } from "./local-commands.mjs";
import { mcpMain } from "../mcp/stdio.mjs";
import { resolveRoot } from "../ledger/root.mjs";
import { DIR } from "../ledger/files.mjs";
import { commandSetupEnv, commandEnvironment, commandDoctor, commandPin } from "./environment-commands.mjs";
import { loadCtx, saveCtx } from "../ledger/state.mjs";
import { presetAgen } from "../agents/defaults.mjs";
import { budgetRencana } from "../workflow/budget.mjs";
import { log } from "../ledger/log.mjs";
import { commandStatus, commandBuild, commandGiliran } from "./project-commands.mjs";
import { commandRefresh, commandConnect } from "./connect-commands.mjs";
import { commandVerify, commandAudit } from "./verification-commands.mjs";
import { commandRun } from "./run-command.mjs";

export function main(argv){
  const args = parseArgs(argv || process.argv.slice(2));
  const cmd = args._[0];
  if(!cmd){
    console.log("Penggunaan: node worker.mjs <perintah> [opsi]");
    console.log("Perintah: run, status, reset, doctor, setup-env, refresh, pin, build, verify, audit, connect, giliran, init, mcp, embed");
    console.log("Reset: node worker.mjs reset | node worker.mjs reset <task-id>");
    console.log("Contoh: node worker.mjs run --dry-run");
    console.log("Jalankan `node worker.mjs run` untuk memulai loop runner.");
    return 0;
  }
  if(cmd === "init") return commandInit(args);
  if(cmd === "mcp") return mcpMain();
  /* A timed child keeps browser measurement from hanging the synchronous loop. */
  if(cmd === "__browser") return commandBrowser();
  /* Source maintenance does not require a project ledger. */
  if(cmd === "embed") return commandEmbed(args);
  const root = resolveRoot(args);
  if(!root){ console.error("tidak ada " + DIR + "/plan.json di cwd maupun di samping worker.mjs. Ekspor dulu dari PlanForge ke folder proyek, atau jalankan `node worker.mjs init`."); return 1; }
  const cwd = args.cwd ? path.resolve(root, args.cwd) : root;
  if(cmd === "setup-env") return commandSetupEnv(cwd);
  if(cmd === "doctor" && args.environment) return commandEnvironment(cwd);
  const ctx = loadCtx(root);
  if(args.agent) ctx.gates.agent = Object.assign({}, ctx.gates.agent, presetAgen(args.agent) || {}, { name: args.agent });
  /* Total calls never reset; auto-budget adds remaining work before explicit overrides. */
  if(args["auto-budget"]){
    const b = budgetRencana(ctx);
    ctx.gates.limits.maxCalls = (ctx.state.calls || 0) + b.total;
    ctx.gates.limits.maxCallsPerRun = b.total;
    log(ctx, "auto-budget: " + b.task + " task tersisa ≈ " + b.total + " panggilan (kerja " + b.kerja + " + gerbang penuh " + b.penuh + " + cadangan " + b.cadangan + ")"
      + " · maxCalls " + ctx.gates.limits.maxCalls + " (" + (ctx.state.calls || 0) + " sudah terpakai + " + b.total + ") · maxCallsPerRun " + ctx.gates.limits.maxCallsPerRun
      + " · plafon biaya TIDAK diubah: " + (ctx.gates.limits.maxCostUsd == null ? "tanpa batas" : "$" + ctx.gates.limits.maxCostUsd) + ".");
  }
  if(args["max-calls"]) ctx.gates.limits.maxCalls = Number(args["max-calls"]);
  if(args["max-calls-per-run"]) ctx.gates.limits.maxCallsPerRun = Number(args["max-calls-per-run"]);
  if(args["max-cost"] != null && args["max-cost"] !== true) ctx.gates.limits.maxCostUsd = Number(args["max-cost"]);
  if(args["full-every"]) ctx.gates.limits.fullEvery = Number(args["full-every"]);
  if(args["no-gates"]) { ctx.gates.hard.forEach(h=>h.enabled = false); ctx.gates.reviews.forEach(r=>r.enabled = false); ctx.lewatiVerifikasi = true; }
  ctx.dryRun = !!args["dry-run"];
  ctx.allowNoop = !!args["allow-noop"];
  const cap = args["max-tasks"] ? Number(args["max-tasks"]) : null;

  if(cmd === "status") return commandStatus(ctx, cwd);

  if(cmd === "reset"){
    const id = args._[1];
    ctx.state.consecFails = 0;
    if(id){
      if(!ctx.plan.tasks.tasks.some(t=>t.id === id)){ console.error("task " + id + " tidak ada"); return 1; }
      ctx.state.tasks[id] = ctx.state.tasks[id] || { status:"belum mulai", tries:0, gate:null, note:"" };
      ctx.state.tasks[id].status = "belum mulai";
      ctx.state.tasks[id].note = "";
      ctx.state.tasks[id].finishedAt = undefined;
      delete ctx.state.tasks[id].finishedAt;
      console.log(id + " di-reset menjadi belum mulai; consecutive failures di-reset menjadi 0");
    }else{
      for(const t of ctx.plan.tasks.tasks){
        const s = ctx.state.tasks[t.id];
        if(s && s.status === "gagal"){ s.status = "belum mulai"; s.note = ""; s.finishedAt = undefined; delete s.finishedAt; }
      }
      console.log("semua task gagal di-reset menjadi belum mulai; consecutive failures di-reset menjadi 0");
    }
    saveCtx(ctx);
    log(ctx, "reset " + (id || "semua") + ": consecFails=0");
    return 0;
  }

  if(cmd === "build") return commandBuild();

  /* Only the human CLI may reopen or skip a failed full-review turn. */
  if(cmd === "giliran") return commandGiliran(ctx, args);

  if(cmd === "doctor") return commandDoctor(ctx, root, cwd, args);

  if(cmd === "refresh") return commandRefresh(root, ctx, args);

  if(cmd === "pin") return commandPin(ctx, cwd);

  if(cmd === "connect") return commandConnect(root, args);

  if(cmd === "verify" || cmd === "verifikasi") return commandVerify(ctx, cwd, args);

  if(cmd === "audit" || cmd === "audit-plan") return commandAudit(ctx, cwd);

  if(cmd !== "run"){ console.log("pakai: node worker.mjs [run|status|doctor|refresh|pin|build|verify|audit|connect|init|mcp] [--dry-run] [--only T-004] [--max-tasks N] [--auto-budget] [--max-calls N] [--max-calls-per-run N] [--max-cost USD] [--full-every N] [--tunggu MS] [--no-gates] [--semua-gerbang] [--allow-noop] [--agent agy|claude|cursor|gemini|codex|codebuddy|none]"); return 1; }

  return commandRun(ctx, cwd, args, cap);
}
