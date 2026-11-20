import path from "node:path";
import { runCmd } from "./commands.mjs";
import { short } from "../text.mjs";
import { log } from "../ledger/log.mjs";
import { readJson } from "../ledger/files.mjs";

export function parseLighthouse(text){
  try{
    const j = JSON.parse(text.slice(text.indexOf("{")));
    const a = j.audits || {};
    const num = (k)=> a[k] ? Math.round(a[k].numericValue) : null;
    return { fcp: num("first-contentful-paint"), tti: num("interactive"),
      si: num("largest-contentful-paint"), score: a["performance"] ? Math.round((a["performance"].score||0)*100) : null,
      bytes: Object.values(a).reduce((s2,x)=>s2 + ((x.details&&x.details.totalByteWeight)||0), 0) / 1024 };
  } catch(e){ return null; }
}

export function metricProblems(res, budgets){
  const bad = []; if(!budgets) return bad;
  const lh = parseLighthouse(res.out);
  if(!lh){ bad.push("lighthouse tidak mengembalikan JSON yang bisa dibaca"); return bad; }
  if(budgets.firstContentfulPaint_ms != null && lh.fcp != null && lh.fcp > budgets.firstContentfulPaint_ms) bad.push("FCP " + lh.fcp + "ms > " + budgets.firstContentfulPaint_ms + "ms");
  if(budgets.interactive_ms != null && lh.tti != null && lh.tti > budgets.interactive_ms) bad.push("TTI " + lh.tti + "ms > " + budgets.interactive_ms + "ms");
  if(budgets.totalByteWeight_kb != null && lh.bytes && lh.bytes > budgets.totalByteWeight_kb) bad.push("bundle " + Math.round(lh.bytes) + "kB > " + budgets.totalByteWeight_kb + "kB");
  return bad;
}

export function runHardGates(ctx, cwd, opsi){
  const res = [];
  /* A scaffold task may have created package.json since the last gate run. */
  pruneUnavailableGates(ctx, cwd);
  /* Soft gates may wait for a server; doctor and pin only need blocking evidence. */
  const hanyaBlocking = opsi && opsi.hanyaBlocking;
  for(const c of (ctx.gates.hard || []).filter(x=> x && x.enabled && x.cmd && !(hanyaBlocking && x.blocking === false))){
    const t0 = Date.now();
    const r = runCmd(c.cmd, cwd, 900000);
    const bad = c.metrics ? metricProblems(r, c.metrics) : [];
    const pass = r.code === 0 && !bad.length;
    res.push({ id: c.id, label: c.label, pass, code: r.code, blocking: c.blocking !== false, ms: Date.now() - t0, out: short(r.out, 4000), metrics: bad });
    log(ctx, "  gerbang " + c.id + ": " + (pass ? "OK" : "GAGAL") + " (" + Math.round((Date.now()-t0)/1000) + "s)" + (bad.length ? " — " + bad.join(", ") : ""));
  }
  return res;
}

/* Flags around run must not be mistaken for the npm script name. */
export function npmScriptNama(cmd){
  const m = /^\s*(?:npm|yarn|pnpm|bun)\b([\s\S]*)$/.exec(String(cmd || ""));
  if(!m) return null;
  const kata = m[1].trim().split(/\s+/).filter(t=>t && !t.startsWith("-") && t !== "run");
  const nama = kata[0];
  if(!nama || !/^[\w:.\-]+$/.test(nama) || nama === "install" || nama === "ci") return null;
  return nama;
}

/* Only auto-disabled gates may revive when their missing script appears. */
export function pruneUnavailableGates(ctx, cwd){
  const pj = readJson(path.join(cwd, "package.json"), null);
  const scripts = (pj && pj.scripts) || {};
  const off = [];
  for(const h of ctx.gates.hard || []){
    if(!h || !h.cmd) continue;
    const nama = npmScriptNama(h.cmd);
    if(!nama) continue;
    if(Object.prototype.hasOwnProperty.call(scripts, nama)){
      if(h.autoOff){
        h.enabled = true; delete h.autoOff;
        log(ctx, "  gerbang " + h.id + " dihidupkan lagi: package.json sekarang punya script \"" + nama + "\"");
      }
      continue;
    }
    if(!h.enabled) continue;
    h.enabled = false; h.autoOff = true; off.push({ id: h.id, script: nama });
    log(ctx, "  gerbang " + h.id + " dimatikan: " + (pj ? "package.json tidak punya script \"" + nama + "\"" : "tidak ada package.json di proyek ini") + " — sunting di tab Runner kalau perlu");
  }
  return off;
}
