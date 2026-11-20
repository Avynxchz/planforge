import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runHardGates } from "../verification/hard-gates.mjs";
import { short } from "../text.mjs";
import { VERIF_DILEWATI, runVerification, ringkasVerifikasi } from "../verification/commands.mjs";
import { BEH_DILEWATI, runBehavior } from "../browser/run.mjs";
import { isDone } from "../ledger/tasks.mjs";
import { saveCtx } from "../ledger/state.mjs";
import { ringkasBehavior } from "../browser/spec.mjs";
import { auditPlan } from "../environment/audit.mjs";
import { DIR } from "../ledger/files.mjs";

export function commandVerify(ctx, cwd, args){

  const id = args._[1] || args.only;
  if(!id){ console.error("pakai: node worker.mjs verify T-002"); return 1; }
  const t = ctx.plan.tasks.tasks.find(x=>x.id === id);
  if(!t){ console.error("task " + id + " tidak ada"); return 1; }
  const hard = runHardGates(ctx, cwd);
  hard.forEach(h=>console.log("  gerbang " + h.id + ": " + (h.pass ? "OK" : "GAGAL") + (h.out ? "\n    " + short(String(h.out).replace(/\s+/g, " "), 300) : "")));
  const ver = ctx.lewatiVerifikasi ? Object.assign({}, VERIF_DILEWATI) : runVerification(ctx, cwd, t);
  for(const h of ver.hasil) console.log("  verifikasi: " + (h.pass ? "OK" : "GAGAL") + " (exit " + h.code + ") " + short(h.cmd, 100)
    + (h.out ? "\n    " + short(String(h.out).replace(/\s+/g, " "), 300) : ""));
  const beh = ctx.lewatiVerifikasi ? Object.assign({}, BEH_DILEWATI) : runBehavior(ctx, cwd, t);
  for(const h of (beh.hasil || [])) console.log("  perilaku: " + (h.pass ? "OK" : "GAGAL") + " " + h.check
    + (h.ukur && typeof h.ukur === "object" && h.ukur.pixel != null ? " · " + h.ukur.pixel + "/" + h.ukur.total + " pixel terisi" : "")
    + (h.alasan ? "\n    " + h.alasan : ""));
  const blok = hard.filter(h=>!h.pass && h.blocking);
  const st = ctx.state.tasks[id];
  const head = spawnSync("git", ["log", "-1", "--format=%h %s"], { cwd, encoding: "utf8" });
  const isi = spawnSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd, encoding: "utf8" });
  const files = String(isi.stdout || "").split("\n").map(f=>f.trim()).filter(f=>f && !/^\.planforge(\/|$)/.test(f) && !/^\.agents(\/|$)/.test(f));
  const gate = { hard: hard.map(h=>({ id:h.id, pass:h.pass, blocking:h.blocking, metrics:h.metrics })), light: [],
    verify: { pass: ver.ok, dilewati: !!ver.dilewati, hasil: ver.hasil, kurang: ver.kurang },
    behavior: { pass: beh.ok, dilewati: !!beh.dilewati, wajib: !!beh.wajib, hasil: beh.hasil || [], kurang: beh.kurang || [],
      console: beh.console || [], requests: beh.requests || 0, ms: beh.ms || 0 },
    at:new Date().toISOString() };
  /* Failed measurements must downgrade the ledger; a mismatched commit alone must not. */
  const catatGagal = (kenapa)=>{
    if(isDone(st)) ctx.state.doneTasks = Math.max(0, ctx.state.doneTasks - 1);
    st.status = "gagal"; st.gate = gate;
    st.note = "verifikasi ulang tanpa agen: " + short(kenapa, 240);
    st.finishedAt = new Date().toISOString();
    ctx.state.consecFails++; ctx.state.lastTask = id; saveCtx(ctx);
    console.log("\n" + id + " TETAP gagal (dicatat di ledger): " + kenapa);
    return 1;
  };
  if(blok.length) return catatGagal(blok.map(b=>b.id).join(", ") + " masih merah.");
  if(!ver.ok) return catatGagal(ver.kurang.join(" · "));
  if(!beh.ok) return catatGagal((beh.kurang || []).join(" · "));
  const headTxt = String(head.stdout || "").trim();
  if(!headTxt.includes(id)){ console.log("\n" + id + " TETAP gagal: kommit HEAD bukan milik task ini (" + (headTxt || "belum ada kommit") + ")."); return 1; }
  if(!files.length){ console.log("\n" + id + " TETAP gagal: " + headTxt + " tidak berisi satu file pun selain catatan PlanForge."); return 1; }
  if(!isDone(st)) ctx.state.doneTasks++;
  st.status = "selesai"; st.gate = gate;
  st.note = "verifikasi ulang tanpa agen: gerbang keras hijau di " + short(headTxt, 90) + " · " + files.length + " file (" + short(files.join(", "), 160) + ")"
    + " · " + short(ringkasVerifikasi(ver), 200) + " · " + short(ringkasBehavior(beh), 200);
  st.finishedAt = new Date().toISOString();
  ctx.state.consecFails = 0; ctx.state.lastTask = id; saveCtx(ctx);
  console.log("\n" + id + " -> SELESAI · " + st.note);
  return 0;
}

export function commandAudit(ctx, cwd){
  const a = auditPlan(ctx, cwd);
  console.log("audit rencana · " + a.tasks + " task · 0 panggilan agen");
  for(const x of a.temuan) console.log("  " + (x.lvl === "error" ? "!! " : "~ ") + (x.id + " ").padEnd(7) + x.msg);
  if(!a.temuan.length) console.log("  bersih: setiap gerbang keliatan bisa dijalankan di mesin ini");
  fs.writeFileSync(path.join(cwd, DIR, "PLAN_AUDIT.md"),
    "# Audit rencana\n\n" + (a.temuan.length
      ? a.temuan.map(x=>"- **" + x.lvl + "** " + x.id + " — " + x.msg).join("\n")
      : "Tidak ada temuan.") + "\n\n" + a.error.length + " error · " + a.warn.length + " warning\n");
  console.log("\n" + a.error.length + " error · " + a.warn.length + " warning · laporan: " + DIR + "/PLAN_AUDIT.md");
  if(a.error.length) console.log("Error struktur/kontrak harus diperbaiki sebelum eksekusi. Saran lingkungan tidak menahan Connect, tetapi tes tetap wajib lulus.");
  return a.error.length ? 1 : 0;
}
