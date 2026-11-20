import path from "node:path";
import fs from "node:fs";
import { DIR, readJson, F_PLAN, F_GATES, F_STATE, cetakFile } from "./files.mjs";
import { defaultGates } from "../agents/defaults.mjs";
import { planFingerprintPlan } from "../../shared/plan-identity.mjs";

export function loadCtx(root){
  const dir = path.join(root, DIR);
  const plan = readJson(path.join(dir, F_PLAN), null);
  if(!plan || !plan.tasks || !Array.isArray(plan.tasks.tasks)) throw new Error("plan.json tidak valid / tidak ada di " + dir);
  const dariDisk = readJson(path.join(dir, F_GATES), {});
  const gates = Object.assign(defaultGates("agy"), dariDisk);
  /* Old gate files need the new limits merged in to enforce their ceilings. */
  gates.limits = Object.assign(defaultGates("agy").limits, dariDisk.limits || {});
  const state = readJson(path.join(dir, F_STATE), null) || {
    runId: new Date().toISOString().slice(0, 10), startedAt: new Date().toISOString(),
    calls: 0, spentNotes: [], tasks: {}, history: [], doneTasks: 0, sinceFull: 0, consecFails: 0, lastTask: null
  };
  /* Connect and older ledgers may omit fields that the worker needs. */
  for(const [k, v] of [["spentNotes", []], ["tasks", {}], ["history", []], ["calls", 0], ["doneTasks", 0], ["sinceFull", 0], ["consecFails", 0]])
    if(state[k] == null) state[k] = v;
  for(const t of plan.tasks.tasks) if(!state.tasks[t.id]) state.tasks[t.id] = { status: t.status || "belum mulai", tries: 0, gate: null, note: "" };
  /* Report a mismatched fingerprint without erasing progress after plan edits. */
  const fp = planFingerprintPlan(plan);
  if(state.planFingerprint == null) state.planFingerprint = fp;
  if(state.rev == null) state.rev = 0;
  const planBerubah = state.planFingerprint !== fp ? { dari: state.planFingerprint, ke: fp } : null;
  return stamp({ root, dir, plan, gates, state, planFingerprint: fp, planBerubah });
}

export const cetakIsi = (ctx)=> [F_PLAN, F_GATES, F_STATE].map(f=>cetakFile(path.join(ctx.dir, f))).join("|");

export function stamp(ctx){ ctx.__print = cetakIsi(ctx); return ctx; }

export function syncCtx(ctx){
  const sekarang = cetakIsi(ctx);
  if(sekarang === ctx.__print) return { ctx, berubah: false };
  const baru = loadCtx(ctx.root);
  return { ctx: baru, berubah: true, dari: ctx.__print, ke: baru.__print };
}

export function saveCtx(ctx){
  fs.mkdirSync(ctx.dir, { recursive: true });
  ctx.state.rev = (ctx.state.rev || 0) + 1;
  /* Atomic rename prevents a partial write from becoming an empty ledger on reload. */
  const tujuan = path.join(ctx.dir, F_STATE);
  const tmp = tujuan + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(ctx.state, null, 1));
  fs.renameSync(tmp, tujuan);
  ctx.__print = cetakIsi(ctx);
}
