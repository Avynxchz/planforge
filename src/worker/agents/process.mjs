import { spawnSync } from "node:child_process";
import { log } from "../ledger/log.mjs";
import { sisaBudget } from "../workflow/budget.mjs";
import { ANSI, short } from "../text.mjs";
import { AGENT_PRESETS } from "../../shared/agent-contracts.mjs";
import { catatBiaya } from "./cost.mjs";

export function callAgent(ctx, promptText, opts){
  opts = opts || {};
  if(ctx.dryRun || !ctx.gates.agent.cmd){
    log(ctx, "  [dry-run] prompt " + promptText.split("\n").length + " baris dikirim ke agen (" + (opts.tag || "task") + ")");
    if(ctx.dryRun) console.log("\n----- prompt yang akan dikirim ke agen (" + (opts.tag || "task") + ") -----\n" + promptText + "\n----- akhir prompt -----\n");
    return { ok: true, text: JSON.stringify({ done: true, dryRun: true }), session: null, dry: true };
  }
  const lewat = sisaBudget(ctx);
  if(lewat){
    log(ctx, "  panggilan TIDAK dikirim: " + lewat);
    return { ok: false, text: "", session: null, budget: lewat };
  }
  const A = ctx.gates.agent, session = opts.session || null;
  if(!Array.isArray(A.args) || !A.args.length) throw new Error("agent.args kosong — jalankan `node worker.mjs init --agent agy` atau sunting gates.json");
  const useCont = !!(session && Array.isArray(A.contArgs) && A.contArgs.length);
  let args = (useCont ? A.contArgs : A.args).slice();
  args = args.map(a=>String(a).replace("{PROMPT}", promptText).replace("{SESSION}", session || ""));
  const r = spawnSync(A.cmd, args, { cwd: ctx.root, encoding: "utf8", timeout: (A.timeoutMin || 20) * 60000, maxBuffer: 40 * 1024 * 1024 });
  ctx.state.calls++;
  ctx.state.callsThisRun = (ctx.state.callsThisRun || 0) + 1;
  const out = ANSI(String(r.stdout || "") + String(r.stderr || ""));
  if(r.error && /ENOENT/.test(String(r.error))){
    throw new Error("perintah agen '" + A.cmd + "' tidak ditemukan di PATH. Ganti agent.name di gates.json, atau pakai: " + Object.keys(AGENT_PRESETS).filter(k=>k!=="none").join(", "));
  }
  let sess = null, text = out, kosong = false, agenError = null;
  const j = jsonObj(out);
  if(j){
    sess = j.session_id || j.conversationId || j.conversation_id || (j.response && j.response.session_id) || null;
    /* Quota/auth refusal is not an answer and must not be graded. */
    agenError = (typeof j.error === "string" && j.error.trim() && j.error)
      || (typeof j.status === "string" && !/^success/i.test(j.status) && j.status) || null;
    /* An empty response can mean every tool was denied, not successful work. */
    const cand = [j.result, j.text, j.response, j.message && j.message.content, j.response && j.response.text];
    const pick = cand.find(x => typeof x === "string" && x.trim());
    if(pick == null) kosong = true; else text = pick;
    catatBiaya(ctx, j, opts.tag || "-");
  } else {
    /* Some unauthenticated CLIs exit zero with plain text; do not count it as work. */
    const polos = out.trim();
    const mintaJson = (useCont ? A.contArgs : A.args).some(x=>/^json$|^--output-format=json$/i.test(String(x)));
    if(!polos) kosong = true;
    else if(mintaJson || (polos.length < 600 && TOLAK_AGEN.test(polos))) agenError = short(polos.replace(/\s+/g, " "), 300);
    else if(r.status !== 0) kosong = true;
  }
  if(r.status !== 0) log(ctx, "  agen keluar dengan code " + r.status + ": " + short(out, 240));
  return { ok: r.status === 0 && !kosong && !agenError, text: String(text), session: sess || (useCont ? session : null), code: r.status, kosong, agenError };
}

export const TOLAK_AGEN = /authentication required|please (use \/)?log ?in|not logged in|unauthori[sz]ed|invalid api key|api key (is )?(missing|invalid)|insufficient (credits|quota|balance)|quota (exceeded|habis)|need at least \d+ ai credits/i;

/* CLI logs may surround the JSON envelope. */
export function jsonObj(out){
  const s = String(out || "").trim();
  if(!s) return null;
  const punya = (o)=>o && typeof o === "object" && ("result" in o || "response" in o || "text" in o || "status" in o || "message" in o || "error" in o || "session_id" in o);
  try{ const one = JSON.parse(s.slice(s.indexOf("{"))); if(punya(one)) return one; } catch(e){}
  for(const line of s.split("\n")){
    const i = line.indexOf("{");
    if(i < 0) continue;
    try{ const o = JSON.parse(line.slice(i)); if(punya(o)) return o; } catch(e){}
  }
  return null;
}
