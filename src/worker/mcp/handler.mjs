import { spawnSync } from "node:child_process";
import { buildLama, bannerBuildLama, BUILD_AWAL, SELF_FILE } from "../identity.mjs";
import { MCP_TOOLS } from "./schema.mjs";
import { sisaBudget } from "../workflow/budget.mjs";
import { isDone, isFail, isBlocked, nextTask } from "../ledger/tasks.mjs";
import { cetakFile } from "../ledger/files.mjs";
import { log } from "../ledger/log.mjs";
import { potretKotor } from "../ledger/snapshots.mjs";
import { saveCtx } from "../ledger/state.mjs";
import { kartuGiliran, buktiGiliran, giliranJatuh } from "../workflow/giliran.mjs";
import { taskCard } from "../agents/prompts.mjs";
import { environmentReadiness } from "../environment/readiness.mjs";
import { short } from "../text.mjs";
import { gitCommit } from "../ledger/commit.mjs";
import { buktiSelesai } from "../verification/evidence.mjs";
import { ringkasVerifikasi } from "../verification/commands.mjs";
import { ringkasBehavior } from "../browser/spec.mjs";
import { auditPlan } from "../environment/audit.mjs";

export function mcpHandle(msg, ctx, opsi){
  const P = msg.params || {};
  const tua = (opsi && opsi.tua) || buildLama();
  const txt = (s)=>({ jsonrpc:"2.0", id:msg.id, result:{ content:[{ type:"text", text: (tua ? bannerBuildLama() + "\n\n" : "") + s }] } });
  try{
    if(msg.method === "initialize") return { jsonrpc:"2.0", id:msg.id, result:{ protocolVersion:"2024-11-05", capabilities:{ tools:{} }, serverInfo:{ name:"planforge-worker", version:"1.0" } } };
    if(msg.method === "notifications/initialized") return null;
    if(msg.method === "tools/list") return { jsonrpc:"2.0", id:msg.id, result:{ tools: MCP_TOOLS } };
    if(msg.method !== "tools/call") return { jsonrpc:"2.0", id:msg.id, error:{ code:-32601, message:"method tidak didukung: " + msg.method } };
    const t = P.name, a = P.arguments || {};
    /* MCP bypasses callAgent, so it must count its own work against session limits. */
    if(!ctx.sesi) ctx.sesi = { mulai: new Date().toISOString(), kerja: 0 };
    const kerja = (n)=>{ ctx.sesi.kerja += n || 1; ctx.state.mcpCalls = (ctx.state.mcpCalls || 0) + (n || 1); };
    const remSesi = ()=>{
      const lim = ctx.gates.limits || {};
      if(lim.maxCallsPerRun != null && ctx.sesi.kerja >= Number(lim.maxCallsPerRun))
        return "sesi connector ini sudah menyerahkan/menutup " + ctx.sesi.kerja + " task (batas maxCallsPerRun " + lim.maxCallsPerRun + ")";
      return sisaBudget(ctx);
    };
    if(t === "plan_status"){
      const done = Object.keys(ctx.state.tasks).filter(k=>isDone(ctx.state.tasks[k])).length;
      const fail = Object.keys(ctx.state.tasks).filter(k=>isFail(ctx.state.tasks[k])).length;
      const blok = Object.keys(ctx.state.tasks).filter(k=>isBlocked(ctx.state.tasks[k]));
      const lim = ctx.gates.limits || {};
      return txt("folder proyek: " + ctx.root.replace(/\\/g, "/")
        + "\ntotal " + ctx.plan.tasks.tasks.length + " · selesai " + done + " · gagal " + fail + " · terkendala " + blok.length
        + " · task terakhir " + (ctx.state.lastTask || "-") + " · panggilan " + ctx.state.calls
        + (blok.length ? "\nTERKENDALA: " + blok.join(", ") + " — butuh tindakan manusia (lihat RUN_LOG.md); task ini tidak diserahkan lagi." : "")
        + "\nsesi connector ini: " + ctx.sesi.kerja + " tool kerja · mulai " + ctx.sesi.mulai
        + " · biaya tercatat $" + (ctx.state.costUsd || 0) + " (plafon " + (lim.maxCostUsd == null ? "tanpa batas" : "$" + lim.maxCostUsd) + ")"
        + (ctx.state.fullHalt ? "\n!! gerbang penuh berhenti: " + ctx.state.fullHalt.kenapa : "")
        + (ctx.planBerubah ? "\n!! ledger ini dibuat untuk rencana lain (sidik jari " + ctx.planBerubah.dari + " → " + ctx.planBerubah.ke + "). Progres bisa tidak cocok dengan plan.json sekarang — Connect ulang supaya ledger lama dicadangkan, atau periksa plan.json sebelum lanjut." : "")
        + (ctx.state.giliran ? "\ngiliran terbuka: " + ctx.state.giliran.id + " (gerbang penuh " + ctx.state.giliran.from + ".." + ctx.state.giliran.to + ")"
          + (ctx.state.giliran.gagal ? " · GAGAL: " + ctx.state.giliran.gagal : " · ambil lewat next_task") : "")
        + "\nbuild worker yang menjawab kamu: " + BUILD_AWAL + " (" + SELF_FILE.replace(/\\/g, "/") + ") · build di disk: " + cetakFile(SELF_FILE));
    }
    if(t === "next_task"){
      const kena = Object.keys(ctx.state.tasks).filter(k=>isBlocked(ctx.state.tasks[k]));
      if(kena.length) return txt("BERHENTI — task terkendala: " + kena.join(", ")
        + ". Ini BUKAN kegagalan kerja: " + (ctx.state.tasks[kena[0]].note || "syarat task tidak tersedia")
        + ". Jangan mengarang file/data di luar task. Laporkan ke manusia; sesudah syaratnya dipulihkan, panggil mark_done tetap bisa dipakai.");
      const rem = remSesi();
      if(rem){
        log(ctx, "next_task DITOLAK: " + rem);
        return txt("BERHENTI — " + rem + ".\nJangan ambil task baru dan jangan mengarang bukti. Laporkan baris ini ke manusia apa adanya:"
          + " dia yang memutuskan menaikkan limits.maxCallsPerRun / maxCostUsd di .planforge/gates.json, lalu me-restart connector PlanForge.");
      }
      const gl = ctx.state.giliran;
      if(gl && gl.gagal){
        return txt("BERHENTI — " + gl.id + " (gerbang penuh " + gl.from + ".." + gl.to + ") ditandai gagal: " + gl.gagal
          + "\nJangan ambil task baru. Laporkan baris ini ke manusia; dia yang memutuskan lewat terminal proyek:"
          + " `node worker.mjs giliran --ulang` (coba lagi) atau `node worker.mjs giliran --lewati` (dilewati, tercatat di ledger).");
      }
      if(gl){
        if(!gl.diserahkan){ kerja(1); gl.diserahkan = new Date().toISOString(); const p = potretKotor(ctx.root); if(p) gl.kotorAwal = p; saveCtx(ctx); }
        return txt(kartuGiliran(ctx, gl));
      }
      const n = nextTask(ctx.plan, ctx.state);
      if(n && !n.__blocked){
        kerja(1);
        /* Repeated next_task calls must not reclassify agent edits as pre-existing dirt. */
        const s = ctx.state.tasks[n.id];
        if(s && !s.kotorAwal){ const p = potretKotor(ctx.root); if(p){ s.kotorAwal = p; saveCtx(ctx); } }
      }
      return txt(!n ? "tidak ada task" : n.__blocked ? "mentok di " + n.id + ", menunggu " + (n.needs||[]).join(", ") : taskCard(ctx.plan, n)
        + environmentReadiness(ctx.root).findings.map(x=>"\nSaran lingkungan (bukan error struktur): " + x.msg).join(""));
    }
    if(t === "get_task"){
      const gl = ctx.state.giliran;
      if(gl && a.id === gl.id) return txt(kartuGiliran(ctx, gl));
      const x = ctx.plan.tasks.tasks.find(y=>y.id === a.id); return txt(x ? taskCard(ctx.plan, x) : "task " + a.id + " tidak ada");
    }
    if(t === "mark_done" && ctx.state.giliran){
      const gl = ctx.state.giliran;
      if(a.id !== gl.id) return txt("TOLAK " + a.id + ": " + gl.id + " (gerbang penuh " + gl.from + ".." + gl.to + ") belum ditutup. Ambil lewat next_task dan kerjakan dulu.");
      kerja(1);
      const b = buktiGiliran(ctx, ctx.root, a.verification);
      if(!b.ok){
        gl.tries = (gl.tries || 0) + 1; gl.note = "ditolak worker: " + short(b.kurang.join(" · "), 600); saveCtx(ctx);
        log(ctx, gl.id + " mark_done lewat MCP: DITOLAK — " + b.kurang.join(" · "));
        return txt("TOLAK " + gl.id + ": " + b.kurang.join(" · ") + "\nBetulkan dulu, baru panggil mark_done lagi.");
      }
      ctx.state.lastFullMark = gl.to; ctx.state.sinceFull = 0; delete ctx.state.fullHalt;
      ctx.state.history.push({ at: new Date().toISOString(), gate: gl.id, from: gl.from, to: gl.to, cek: b.cek, out: short(a.verification, 3000) });
      const awal = gl.kotorAwal || null;
      delete ctx.state.giliran; saveCtx(ctx);
      let kommit = "";
      if(ctx.gates.limits.autoCommit !== false){
        const g = gitCommit(ctx, ctx.root, { id: gl.id, title: "audit/fix/refactor/performa " + gl.from + ".." + gl.to }, awal);
        const h = String(spawnSync("git", ["log", "-1", "--format=%h %s"], { cwd: ctx.root, encoding: "utf8" }).stdout || "").trim();
        if(h.includes(gl.id)) kommit = " · kommit " + h;
        if(g && g.ditinggal.length) kommit += " · tidak ikut kommit (bukan kerja giliran ini): " + short(g.ditinggal.join(", "), 200);
      }
      log(ctx, gl.id + " mark_done lewat MCP: DITERIMA · cek ulang " + b.cek.join(","));
      return txt("ok, " + gl.id + " diterima — gerbang keras hijau, verification + perilaku dicek ulang worker: " + (b.cek.join(", ") || "-") + kommit + "\nLanjut: panggil next_task.");
    }
    if(t === "mark_done"){
      kerja(1);
      const s = ctx.state.tasks[a.id] || (ctx.state.tasks[a.id] = {});
      const sudah = isDone(s);
      const task = ctx.plan.tasks.tasks.find(x=>x.id === a.id);
      if(!task) return txt("task " + a.id + " tidak ada di plan — tidak kunyatali apa pun");
      const b = buktiSelesai(ctx, ctx.root, a.id, a.verification);
      const gateVerify = { pass: b.ver.ok, dilewati: !!b.ver.dilewati, hasil: b.ver.hasil, kurang: b.ver.kurang };
      const gateBehavior = { pass: b.beh.ok, dilewati: !!b.beh.dilewati, wajib: !!b.beh.wajib, hasil: b.beh.hasil || [], kurang: b.beh.kurang || [],
        console: b.beh.console || [], requests: b.beh.requests || 0, ms: b.beh.ms || 0 };
      if(!b.ok){
        s.note = "ditolak worker: " + b.kurang.join(" · ");
        s.gate = { hard: b.hard.map(h=>({ id:h.id, pass:h.pass, blocking:h.blocking, metrics:h.metrics })), verify: gateVerify, behavior: gateBehavior, at: new Date().toISOString() };
        saveCtx(ctx);
        log(ctx, a.id + " mark_done lewat MCP: DITOLAK — " + b.kurang.join(" · "));
        return txt("TOLAK " + a.id + ": " + b.kurang.join(" · ") + "\nKerjakan dulu beneran, baru panggil mark_done lagi.");
      }
      s.status = "selesai"; s.finishedAt = new Date().toISOString();
      s.note = "bukti: " + short(a.verification, 200) + " · gerbang " + b.hard.filter(h=>h.enabled !== false).map(h=>h.id + (h.pass ? "=OK" : "=gagal")).join(",")
        + " · verifikasi worker: " + short(ringkasVerifikasi(b.ver), 200)
        + " · " + short(ringkasBehavior(b.beh), 200)
        + (b.files.length ? " · " + b.files.length + " file berubah" : " · dari kommit " + short(b.head, 60));
      s.gate = { hard: b.hard.map(h=>({ id:h.id, pass:h.pass, blocking:h.blocking, metrics:h.metrics })), light: [], verify: gateVerify, behavior: gateBehavior, at: new Date().toISOString() };
      if(!sudah){ ctx.state.doneTasks++; ctx.state.sinceFull = (ctx.state.sinceFull || 0) + 1; }
      const awal = s.kotorAwal || null; delete s.kotorAwal;
      ctx.state.consecFails = 0; ctx.state.lastTask = a.id;
      const giliranBaru = sudah ? null : giliranJatuh(ctx, task);
      saveCtx(ctx);
      /* Worker commits provide a recovery point instead of relying on the agent to commit. */
      let kommit = "";
      if(ctx.gates.limits.autoCommit !== false){
        const g = gitCommit(ctx, ctx.root, task, awal);
        const h = spawnSync("git", ["log", "-1", "--format=%h %s"], { cwd: ctx.root, encoding: "utf8" });
        const txt1 = String(h.stdout || "").trim();
        if(txt1.includes(a.id)) kommit = " · kommit " + txt1;
        else log(ctx, a.id + " tercatat selesai tapi HEAD bukan kommitnya: " + (txt1 || "belum ada kommit"));
        if(g && g.ditinggal.length) kommit += " · tidak ikut kommit (bukan kerja task ini): " + short(g.ditinggal.join(", "), 200);
        if(g && g.bawaan.length) kommit += " · sudah berubah sebelum task dimulai tapi ikut kommit karena diubah lagi: " + short(g.bawaan.join(", "), 200);
      }
      log(ctx, a.id + " mark_done lewat MCP: DITERIMA (" + short(a.verification, 120) + ")");
      return txt("ok, " + a.id + " selesai — gerbang keras DAN perintah verification task ini udah ku jalanin sendiri dan hijau. " + s.note + kommit
        + (giliranBaru ? "\nBERIKUTNYA: " + giliranBaru.id + " — gerbang penuh (audit, perbaikan, refactor, performa) atas " + giliranBaru.from + ".." + giliranBaru.to
          + ". Panggil next_task untuk kartunya; task baru baru diserahkan sesudah giliran ini diterima."
          : "\nLANJUT OTOMATIS: panggil next_task lagi sekarang, kerjakan task berikutnya, lalu mark_done lagi. Satu trigger = SEMUA task, bukan satu task lalu diam. Ulangi tanpa minta manusia melanjutkan tiap task, sampai next_task menjawab BERHENTI (budget habis / terkendala / giliran gagal) atau \"tidak ada task\" (semua selesai)."));
    }
    if(t === "mark_failed" && ctx.state.giliran && a.id === ctx.state.giliran.id){
      kerja(1);
      const gl = ctx.state.giliran;
      gl.gagal = short(a.reason, 200);
      ctx.state.fullHalt = { at: new Date().toISOString(), upto: gl.to, kenapa: gl.id + " gagal: " + gl.gagal };
      saveCtx(ctx);
      log(ctx, gl.id + " ditandai gagal lewat MCP: " + gl.gagal + " — next_task berhenti sampai manusia memutuskan");
      return txt("ok, " + gl.id + " ditandai gagal. BERHENTI: task baru tidak diserahkan sampai manusia menjalankan `node worker.mjs giliran --ulang` atau `--lewati`.");
    }
    if(t === "mark_failed"){
      kerja(1);
      const s = ctx.state.tasks[a.id] || (ctx.state.tasks[a.id] = {});
      s.status = "gagal"; s.note = short(a.reason, 200);
      const task = ctx.plan.tasks.tasks.find(x=>x.id === a.id);
      const next = nextTask(ctx.plan, ctx.state);
      const giliranBaru = task && ctx.state.sinceFull > 0 && (!next || next.__blocked)
        ? giliranJatuh(ctx, task, true) : null;
      saveCtx(ctx);
      return txt("ok, " + a.id + " ditandai gagal"
        + (giliranBaru ? "\nBERIKUTNYA: " + giliranBaru.id + " — audit penutup atas pekerjaan selesai sebelum run berhenti. Panggil next_task untuk kartunya."
          : ""));
    }
    if(t === "mark_blocked"){
      kerja(1);
      const task = ctx.plan.tasks.tasks.find(x=>x.id === a.id);
      if(!task) return txt("task " + a.id + " tidak ada di plan — tidak ada yang kucatat");
      const s = ctx.state.tasks[a.id] || (ctx.state.tasks[a.id] = {});
      s.status = "terkendala"; s.note = short(a.reason || "syarat task tidak tersedia", 250);
      s.blockedAt = new Date().toISOString();
      saveCtx(ctx);
      log(ctx, a.id + " TERKENDALA lewat MCP: " + s.note + " — bukan gagal, tidak diserahkan lagi");
      return txt("ok, " + a.id + " dicatat TERKENDALA (bukan gagal): " + s.note
        + "\nBERHENTI. Laporkan ke manusia supaya syaratnya dipulihkan. Jangan mengarang file/data di luar task, dan jangan memanggil mark_failed untuk kondisi ini.");
    }
    if(t === "gate_list"){
      const rows = ctx.gates.reviews.filter(r=>r.enabled).map(r=>r.tier + " · " + r.label);
      return txt("keras (tiap task): " + ctx.gates.hard.filter(h=>h.enabled).map(h=>h.id + (h.blocking?"*":"")).join(", ") + "\n" + rows.join("\n") + "\n* = menahan loop kalau gagal"
        + "\nlewat connector ini, gerbang penuh datang sebagai GILIRAN-n dari next_task tiap " + (ctx.gates.limits.fullEvery || 6) + " task"
        + (ctx.gates.limits.fullAtMilestoneEnd ? " dan di akhir tiap milestone" : "") + "; kamu yang mengerjakannya, worker yang membuktikannya.");
    }
    if(t === "audit_plan"){
      const a = auditPlan(ctx, ctx.root);
      const baris = a.temuan.slice(0, 25).map(x=>"  " + (x.lvl === "error" ? "!!" : "~ ") + " " + x.id + " — " + x.msg);
      return txt("AUDIT " + a.tasks + " task · " + a.error.length + " error · " + a.warn.length + " warning\n" +
        (baris.join("\n") || "  tidak ada temuan statis; belum membuktikan runtime/kelulusan") +
        (a.temuan.length > 25 ? "\n  ... " + (a.temuan.length - 25) + " lagi (node worker.mjs audit)" : "") +
        "\nERROR = struktur/kontrak rusak, perbaiki rencana. WARNING lingkungan = siapkan prasyarat, bukan penahan Connect/next_task; mark_done tetap menjalankan tes asli dan menolak hasil merah.");
    }
    return { jsonrpc:"2.0", id:msg.id, error:{ code:-32602, message:"tool tidak dikenal: " + t } };
  } catch(e){ return { jsonrpc:"2.0", id:msg.id, error:{ code:-32000, message:String(e.message || e) } }; }
}
