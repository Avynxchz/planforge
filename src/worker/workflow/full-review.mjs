import { nextTask, taskList, isDone } from "../ledger/tasks.mjs";
import { log } from "../ledger/log.mjs";
import { callAgent } from "../agents/process.mjs";
import { extractVerdict } from "../agents/verdict.mjs";
import { short } from "../text.mjs";
import { saveCtx } from "../ledger/state.mjs";

export function shouldRunFull(ctx, t){
  const lim = ctx.gates.limits, full = ctx.gates.reviews.filter(r=>r.enabled && r.tier === "full");
  if(!full.length) return false;
  if(ctx.state.sinceFull >= (lim.fullEvery || 6)) return true;
  const next = nextTask(ctx.plan, ctx.state);
  if(next && next.__blocked && ctx.state.sinceFull > 0) return true;
  if(lim.fullAtMilestoneEnd){
    /* The last task also ends a milestone; the budget already includes this review. */
    if(!next && ctx.state.sinceFull > 0) return true;
    if(next && !next.__blocked && next.milestone_ref && next.milestone_ref !== t.milestone_ref) return true;
  }
  return false;
}

/* Unproven full reviews must stop without advancing lastFullMark. */
export function runFullGates(ctx, cwd, upto){
  const list = taskList(ctx.plan);
  const from = ctx.state.lastFullMark || (list[0] && list[0].id) || "T-001";
  const done = Object.keys(ctx.state.tasks).filter(k=>isDone(ctx.state.tasks[k]));
  const scope = "task selesai: " + done.slice(-12).join(", ");
  log(ctx, "gerbang penuh (audit -> fix -> refactor -> performa) atas " + from + ".." + upto.id + " · " + done.length + " task");
  let kenapa = null, terbukti = 0;
  for(const g of ctx.gates.reviews.filter(r=>r.enabled && r.tier === "full")){
    const p = String(g.prompt || "").replace("{FROM}", from).replace("{TO}", upto.id) + "\n\n" + scope + "\nProyek: " + ctx.root;
    const r = callAgent(ctx, g.label + ":\n" + p, { tag: g.id });
    if(r.session) ctx.state.session = r.session;
    /* An empty object does not prove an audit or refactor happened. */
    const vRaw = extractVerdict(String(r.text));
    const v = vRaw && Object.keys(vRaw).length ? vRaw : null;
    log(ctx, "  " + g.id + " " + from + " sampai " + upto.id + ": " + (r.budget
      ? "BUDGET HABIS (" + r.budget + ") — gerbang ini tidak membuktikan apa-apa"
      : r.agenError
      ? "AGEN MENOLAK BEKERJA (" + short(r.agenError, 100) + ") — gerbang ini tidak membuktikan apa-apa"
      : r.kosong
      ? (r.rateLimit ? "rate limit HTTP 429 — jeda lalu coba lagi; gerbang ini tidak membuktikan apa-apa" : "agen balas KOSONG — gerbang ini tidak membuktikan apa-apa")
      : v ? short(JSON.stringify(v).replace(/\s+/g," "), 200) : "TIDAK ADA VERDICT — gerbang ini tidak membuktikan apa-apa"));
    ctx.state.history.push({ at: new Date().toISOString(), gate: g.id, out: short(r.agenError ? String(r.agenError) : r.text, 3000) });
    if(r.budget){ kenapa = r.budget; break; }
    if(r.agenError){ kenapa = "agen menolak bekerja di gerbang " + g.id + ": " + short(r.agenError, 140); break; }
    if(r.kosong){ kenapa = r.rateLimit ? "gerbang " + g.id + " terkena rate limit HTTP 429; tunggu jeda backoff lalu coba lagi" : "gerbang " + g.id + " dibalas kosong (semua tool agen di-deny) — tambah --dangerously-skip-permissions di args agen, atau kerjakan lewat chat IDE"; break; }
    if(!v){ kenapa = "gerbang " + g.id + " tidak mengembalikan JSON verdict — tidak ada yang bisa dinilai dari jawabannya"; break; }
    terbukti++;
  }
  if(kenapa){
    ctx.state.fullHalt = { at: new Date().toISOString(), upto: upto.id, kenapa };
    log(ctx, "  gerbang penuh dihentikan setelah " + terbukti + " gerbang terbukti: " + kenapa);
    log(ctx, "  penanda lastFullMark TETAP di " + from + " — audit atas " + from + ".." + upto.id + " belum pernah terjadi, jangan dianggap sudah.");
    saveCtx(ctx);
    return { ok: false, kenapa, terbukti };
  }
  ctx.state.lastFullMark = upto.id;
  delete ctx.state.fullHalt;
  saveCtx(ctx);
  return { ok: true, terbukti };
}
