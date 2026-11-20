import { spawnSync } from "node:child_process";
import { short } from "../text.mjs";
import { pruneUnavailableGates, runHardGates } from "./hard-gates.mjs";
import { taskList, hasUnmetDeps } from "../ledger/tasks.mjs";
import { VERIF_DILEWATI, runVerification } from "./commands.mjs";
import { BEH_DILEWATI, runBehavior } from "../browser/run.mjs";
import { changedFiles } from "../ledger/snapshots.mjs";

/* The worker must measure evidence instead of trusting the agent that wrote the code. */
export function buktiSelesai(ctx, root, id, verification){
  const v = String(verification || "").trim();
  const kurang = [];
  if(v.length < 12) kurang.push("verification terlalu pendek (" + v.length + " karakter) — tulis perintah yang kamu jalankan + output aslinya");
  else if(/^(selesai|done|ok|lulus|bersih|kelar|sudah|aman)\b/i.test(v) && v.length < 40) kurang.push("verification cuma klaim ('" + short(v, 40) + "'), bukan bukti");
  pruneUnavailableGates(ctx, root);
  const hard = runHardGates(ctx, root);
  const blok = hard.filter(h=>!h.pass && h.blocking);
  if(blok.length) kurang.push("gerbang keras masih merah: " + blok.map(b=>b.id + " -> " + short(String(b.out).replace(/\s+/g, " "), 300)).join(" | "));
  const task = taskList(ctx.plan).find(x=>x.id === id);
  /* MCP callers can supply any ID, so the worker must enforce dependency order. */
  if(task){
    const belum = hasUnmetDeps(ctx.plan, ctx.state, task);
    if(belum.length) kurang.push("dependensi belum selesai: " + belum.join(", ") + " — kerjakan itu dulu lewat next_task");
  }
  const ver = ctx.lewatiVerifikasi ? Object.assign({}, VERIF_DILEWATI)
    : task ? runVerification(ctx, root, task)
    : { ok: false, jalan: false, kurang: ["task " + id + " tidak ada di plan.json — tidak ada verification yang bisa dijalankan"], hasil: [], raw: "" };
  if(!ver.ok) kurang.push(ver.kurang.join(" · "));
  const beh = ctx.lewatiVerifikasi ? Object.assign({}, BEH_DILEWATI)
    : task ? runBehavior(ctx, root, task)
    : { ok: false, jalan: false, kurang: ["task " + id + " tidak ada di plan.json — tidak ada perilaku yang bisa diukur"], hasil: [] };
  if(!beh.ok) kurang.push((beh.kurang || []).join(" · "));
  const head = String(spawnSync("git", ["log", "-1", "--format=%h %s"], { cwd: root, encoding: "utf8" }).stdout || "").trim();
  const files = changedFiles(root);
  /* Outside Git, passing gates remain evidence even though commit proof is unavailable. */
  if(files && !files.length && !head.includes(id)) kurang.push("tidak ada file yang berubah (working tree bersih, HEAD pun bukan kommit " + id + ")");
  return { ok: !kurang.length, hard, ver, beh, kurang, files: files || [], head };
}
