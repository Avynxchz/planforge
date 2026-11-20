import { taskCard, buildTaskPrompt, buildFixPrompt } from "../agents/prompts.mjs";
import { log } from "../ledger/log.mjs";
import { headSha, potretKotor, changedFiles } from "../ledger/snapshots.mjs";
import { saveCtx } from "../ledger/state.mjs";
import { short } from "../text.mjs";
import { callAgent } from "../agents/process.mjs";
import { extractVerdict } from "../agents/verdict.mjs";
import { runHardGates } from "../verification/hard-gates.mjs";
import { VERIF_DILEWATI, runVerification, ringkasVerifikasi } from "../verification/commands.mjs";
import { BEH_DILEWATI, runBehavior } from "../browser/run.mjs";
import { ringkasBehavior } from "../browser/spec.mjs";
import { isDone } from "../ledger/tasks.mjs";
import { gitCommit } from "../ledger/commit.mjs";
import { shouldRunFull, runFullGates } from "./full-review.mjs";

export function runOne(ctx, t, cwd){
  const st = ctx.state.tasks[t.id];
  const L = (n)=>ctx.gates.reviews.filter(r=>r.enabled && r.tier === n);
  const card = taskCard(ctx.plan, t);

  ctx.state.calls > 0 && log(ctx, "call terpakai: " + ctx.state.calls + "/" + ctx.gates.limits.maxCalls);
  const headBefore = headSha(cwd);
  const kotorAwal = potretKotor(cwd);
  const statusSebelum = st.status;
  /* Quota/auth refusal leaves the task untried, not failed. */
  const berhenti = (r)=>{
    if(!r) return null;
    if(r.budget){
      st.status = statusSebelum; st.note = "belum dicoba: " + r.budget;
      ctx.state.haltNote = r.budget;
      log(ctx, t.id + " DITANGGUH — " + r.budget + " | loop dihentikan, tidak ada yang dianggap selesai");
      saveCtx(ctx); return "halt";
    }
    if(!r.agenError) return null;
    st.status = statusSebelum; st.note = "belum dicoba: agen menolak (" + short(r.agenError, 140) + ")";
    log(ctx, t.id + " DITANGGUH — agen menolak bekerja: " + short(r.agenError, 140) + " | loop dihentikan, tidak ada yang dianggap selesai");
    saveCtx(ctx); return "halt";
  };
  let res = callAgent(ctx, buildTaskPrompt(ctx, t), { tag: t.id });
  /* Dry runs and the none preset must not update task state or commit. */
  if(res.dry) return "dry";
  const h0 = berhenti(res); if(h0) return h0;
  st.status = "sedang"; st.startedAt = new Date().toISOString(); saveCtx(ctx);
  let sess = res.session, verdict = extractVerdict(res.text);

  if(verdict && verdict.blocked){
    st.status = "gagal"; st.note = "diblokir agen: " + short(verdict.reason, 200); ctx.state.consecFails++;
    log(ctx, t.id + " DIBLOKIR: " + short(verdict.reason, 160)); saveCtx(ctx); return "blocked";
  }

  /* An empty response is not proof that the agent could use its tools. */
  if(res.kosong){
    st.status = "gagal"; st.note = "agen membalas kosong: tidak ada satu pun tool yang boleh jalan"; ctx.state.consecFails++;
    log(ctx, t.id + " BALASAN KOSONG — tambah --dangerously-skip-permissions (atau --mode auto) di args agen, atau kerjakan lewat chat IDE");
    saveCtx(ctx); return "fail";
  }

  const hard = runHardGates(ctx, cwd);
  let blockingFail = hard.filter(h=>!h.pass && h.blocking);
  let ver = ctx.lewatiVerifikasi ? Object.assign({}, VERIF_DILEWATI) : runVerification(ctx, cwd, t);
  /* An agent cannot repair plan.json; do not spend fix rounds on invalid verification. */
  const verBisa = ver.dilewati || ver.jalan;
  let beh = ctx.lewatiVerifikasi ? Object.assign({}, BEH_DILEWATI) : runBehavior(ctx, cwd, t);
  /* Agents cannot fix the plan or install the browser; stop instead of spending fix rounds. */
  const behBisa = beh.dilewati || (beh.jalan && !beh.planRusak && !beh.lingkungan);
  if(!behBisa){
    st.status = "gagal";
    st.note = beh.kurang.join(" · ");
    st.gate = { hard: hard.map(h=>({ id: h.id, pass: h.pass, blocking: h.blocking, metrics: h.metrics })), light: [],
      verify: { pass: ver.ok, dilewati: !!ver.dilewati, hasil: ver.hasil, kurang: ver.kurang },
      behavior: { pass: false, dilewati: false, wajib: !!beh.wajib, hasil: [], kurang: beh.kurang }, at: new Date().toISOString() };
    st.finishedAt = new Date().toISOString();
    ctx.state.consecFails++; ctx.state.lastTask = t.id;
    ctx.state.haltNote = "bukti perilaku tidak bisa dijalankan: " + short(beh.kurang.join(" · "), 240);
    log(ctx, t.id + " GAGAL — " + st.note);
    log(ctx, "  !! " + ctx.state.haltNote + " — loop dihentikan; betulkan plan/mesin dulu, jangan bakar panggilan agen");
    saveCtx(ctx);
    return "halt";
  }
  const cekUlang = ()=>{
    const again = runHardGates(ctx, cwd);
    hard.splice(0, hard.length, ...again);
    blockingFail = again.filter(h=>!h.pass && h.blocking);
    if(verBisa && !ver.dilewati) ver = runVerification(ctx, cwd, t);
    if(behBisa && !beh.dilewati) beh = runBehavior(ctx, cwd, t);
  };
  const alasanGagal = ()=>{
    const a = [];
    if(blockingFail.length) a.push("gerbang keras gagal (" + blockingFail.map(b=>b.id).join(", ") + ")");
    if(!ver.ok) a.push("verification gagal");
    if(!beh.ok) a.push("perilaku di browser gagal");
    return a;
  };
  let rounds = 0;
  while((blockingFail.length || (verBisa && !ver.ok) || (behBisa && !beh.ok)) && rounds < (ctx.gates.limits.fixRounds || 2)){
    rounds++; st.tries = (st.tries || 0) + 1;
    log(ctx, "  " + t.id + ": " + alasanGagal().join(" + ") + " -> ronde perbaikan " + rounds);
    const why = [
      blockingFail.map(b=>"[" + b.label + "]\n" + short(b.out, 1200) + (b.metrics && b.metrics.length ? "\n" + b.metrics.join("; ") : "")).join("\n\n"),
      ver.kurang.length ? "[VERIFIKASI task ini — dijalankan worker, bukan klaim kamu]\n" + ver.kurang.join("\n")
        + ver.hasil.filter(h=>!h.pass).map(h=>"\n$ " + h.cmd + "\nexit " + h.code + "\n" + short(h.out, 1200)).join("") : "",
      beh.kurang && beh.kurang.length ? "[PERILAKU di browser sungguhan — worker yang mengukur, bukan klaim kamu]\n" + beh.kurang.join("\n")
        + "\nIni angka hasil pengukuran, bukan tebakan. Perbaiki kodenya sampai check ini hijau; jangan mengubah plan.json." : ""
    ].filter(Boolean).join("\n\n");
    const fx = callAgent(ctx, buildFixPrompt(ctx, t, why), { tag: t.id + "-fix" + rounds, session: sess });
    const hf = berhenti(fx); if(hf) return hf;
    if(fx.session) sess = fx.session;
    cekUlang();
  }

  let light = [];
  if(L("light").length && !blockingFail.length && ver.ok && beh.ok){
    for(const g of L("light")){
      const nilai = ()=>{
        const r = callAgent(ctx, [g.label + " untuk task " + t.id + ":", card, g.prompt].join("\n\n"), { tag: g.id, session: sess });
        const hr = berhenti(r); if(hr) return { halt: hr };
        if(r.session) sess = r.session;
        const raw = extractVerdict(r.text);
        /* A JSON error envelope is not a review verdict. */
        const v = raw && (typeof raw.pass === "boolean" || Array.isArray(raw.issues)) ? raw : null;
        /* No verdict means no evidence, not a clean review. */
        const issues = v ? (v.issues || []) : ["reviewer tidak mengembalikan JSON verdict"];
        const pass = !!v && v.pass !== false && !issues.length;
        log(ctx, "  reviewer " + g.id + ": " + (v ? (pass ? "bersih" : issues.length + " temuan") : "TIDAK ADA VERDICT — dianggap belum lolos"));
        return { pass, issues, v };
      };
      let rv = nilai(); if(rv.halt) return rv.halt;
      if(!rv.pass && (ctx.gates.limits.fixRounds || 2) > 0){
        const fx = callAgent(ctx, buildFixPrompt(ctx, t, rv.issues.join("\n") + "\n" + ((rv.v && rv.v.fix) || "")), { tag: "fix-" + g.id, session: sess });
        const hfx = berhenti(fx); if(hfx) return hfx;
        if(fx.session) sess = fx.session;
        cekUlang();
        /* A verdict predating the fix is not evidence for the changed code. */
        rv = nilai(); if(rv.halt) return rv.halt;
      }
      light.push({ id: g.id, pass: rv.pass, issues: rv.issues });
    }
  }

  const berubah = changedFiles(cwd, headBefore);
  const alasan = [];
  if(blockingFail.length) alasan.push("gerbang gagal: " + blockingFail.map(b=>b.id).join(", "));
  if(!ver.ok) alasan.push(ver.kurang.join(" · "));
  if(!beh.ok) alasan.push((beh.kurang || []).join(" · "));
  /* A rejecting reviewer must block completion, not merely leave a note. */
  const lightGagal = light.filter(x=>!x.pass);
  if(lightGagal.length) alasan.push("reviewer ringan menolak: " + lightGagal.map(x=>x.id + " (" + short((x.issues||[]).join("; "), 160) + ")").join(" | "));
  if(!(verdict && verdict.done === true)) alasan.push('agen tidak melaporkan {"done":true}');
  if(berubah && !berubah.length && !ctx.allowNoop) alasan.push("tidak ada file yang berubah");
  const passAll = !alasan.length;
  st.status = passAll ? "selesai" : "gagal";
  st.gate = { hard: hard.map(h=>({ id: h.id, pass: h.pass, blocking: h.blocking, metrics: h.metrics })), light,
    verify: { pass: ver.ok, dilewati: !!ver.dilewati, hasil: ver.hasil, kurang: ver.kurang },
    behavior: { pass: beh.ok, dilewati: !!beh.dilewati, wajib: !!beh.wajib, hasil: beh.hasil || [], kurang: beh.kurang || [],
      console: beh.console || [], requests: beh.requests || 0, ms: beh.ms || 0 },
    at: new Date().toISOString() };
  st.note = passAll ? "verifikasi (dijalankan worker): " + short(ringkasVerifikasi(ver), 260)
    + " · " + short(ringkasBehavior(beh), 200)
    + (berubah ? " · " + berubah.length + " file berubah" : "") : alasan.join(" · ");
  st.finishedAt = new Date().toISOString();
  /* Rerunning a task must not count its completion twice. */
  const sudahSelesai = isDone({ status: statusSebelum });
  if(passAll){ ctx.state.consecFails = 0; if(!sudahSelesai){ ctx.state.doneTasks++; ctx.state.sinceFull++; } }
  else { ctx.state.consecFails++; if(sudahSelesai) ctx.state.doneTasks = Math.max(0, ctx.state.doneTasks - 1); }
  ctx.state.lastTask = t.id;
  saveCtx(ctx);

  if(passAll && ctx.gates.limits.autoCommit !== false) gitCommit(ctx, cwd, t, kotorAwal);
  log(ctx, t.id + " -> " + (passAll ? "SELESAI" : "GAGAL") + " · " + st.note);

  if(passAll && shouldRunFull(ctx, t)){
    const f = runFullGates(ctx, cwd, t);
    if(f.ok) ctx.state.sinceFull = 0;
    const re = runHardGates(ctx, cwd).filter(h=>!h.pass && h.blocking);
    if(re.length){ log(ctx, "  !! gerbang penuh merusak build/test: " + re.map(x=>x.id).join(", ") + " -> dihentikan, perlu lihat manual"); ctx.state.consecFails = (ctx.gates.limits.maxConsecutiveFails || 3); }
    saveCtx(ctx);
    if(!f.ok){
      ctx.state.haltNote = "gerbang penuh tidak membuktikan apa-apa: " + f.kenapa;
      log(ctx, "  !! " + ctx.state.haltNote + " — loop dihentikan, task berikutnya tidak diambil");
      saveCtx(ctx);
      return "halt";
    }
  }
  return passAll ? "ok" : "fail";
}
