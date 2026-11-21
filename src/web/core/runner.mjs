/* PlanForge core: perintah runner siap tempel. */

/* satu baris perintah siap tempel; opsi yang nilainya sama dengan gates.json tidak ditulis */
export const shellQ = (s)=> /\s/.test(String(s)) ? '"' + String(s) + '"' : String(s);
export function runnerCommand(gates, opts){
  opts = opts || {};
  /* Label UI dan kunci adaptor bukan nama preset worker. */
  const presetAgen = (nama)=>{
    const teks = String(nama == null ? "" : nama).trim();
    if(!teks) return null;
    const kunci = teks.toLowerCase();
    if(kunci === "workbuddy" || kunci === "workbuddy / codebuddy") return "codebuddy";
    if(kunci === "claude code") return "claude";
    if(kunci === "codex cli") return "codex";
    if(kunci === "antigravity cli" || kunci === "antigravity ide") return "agy";
    return ["agy", "claude", "codex", "codebuddy", "none"].includes(kunci) ? kunci : null;
  };
  const L = gates.limits || {};
  const parts = ["node", shellQ(opts.workerPath || "worker.mjs"), "run"];
  if(opts.projectDir) parts.push("--dir", shellQ(opts.projectDir));
  const preset = presetAgen(opts.targetAgent || opts.agent);
  if(preset) parts.push("--agent", shellQ(preset));
  if(L.maxCalls != null) parts.push("--max-calls", String(L.maxCalls));
  if(L.maxCallsPerRun != null) parts.push("--max-calls-per-run", String(L.maxCallsPerRun));
  if(L.maxCostUsd != null) parts.push("--max-cost", String(L.maxCostUsd));
  if(L.fullEvery != null) parts.push("--full-every", String(L.fullEvery));
  return parts.join(" ");
}
