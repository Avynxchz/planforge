import { parseArgs } from "../cli/args.mjs";
import { resolveRoot } from "../ledger/root.mjs";
import { loadCtx, syncCtx } from "../ledger/state.mjs";
import { mulaiSesi } from "../workflow/session.mjs";
import { mcpHandle } from "./handler.mjs";
import { buildLama } from "../identity.mjs";

export function mcpMain(argv){
  const a = parseArgs(argv || process.argv.slice(3));
  const root = resolveRoot(a);
  if(!root){ console.error("tidak ada .planforge/plan.json — taruh worker.mjs di folder proyek atau jalankan dengan --dir <path>"); return 1; }
  let ctx;
  try{ ctx = loadCtx(root); }catch(e){ console.error(String(e.message || e)); return 1; }
  if(a["no-gates"]){ ctx.gates.hard.forEach(h=>h.enabled = false); ctx.gates.reviews.forEach(r=>r.enabled = false); ctx.lewatiVerifikasi = true; }
  if(a["max-cost"] != null && a["max-cost"] !== true) ctx.gates.limits.maxCostUsd = Number(a["max-cost"]);
  if(a["max-calls-per-run"]) ctx.gates.limits.maxCallsPerRun = Number(a["max-calls-per-run"]);
  ctx.sesi = { mulai: new Date().toISOString(), kerja: 0 };
  mulaiSesi(ctx);
  /* stdout is JSON-RPC only; send human-readable logs to stderr. */
  console.log = (...x)=>process.stderr.write(x.join(" ") + "\n");
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d)=>{
    buf += d; let i;
    while((i = buf.indexOf("\n")) >= 0){
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if(!line) continue;
      let msg; try{ msg = JSON.parse(line); } catch(e){ continue; }
      /* Reload human edits without requiring a connector restart. */
      const seg = syncCtx(ctx);
      if(seg.berubah){
        const sesi = ctx.sesi, lewat = ctx.lewatiVerifikasi;
        ctx = seg.ctx; ctx.sesi = sesi; ctx.lewatiVerifikasi = lewat;
        console.error("planforge: plan.json/gates.json/state.json berubah di disk -> dibaca ulang");
      }
      const out = mcpHandle(msg, ctx, { tua: buildLama() });
      if(out) process.stdout.write(JSON.stringify(out) + "\n");
    }
  });
  return 0;
}
