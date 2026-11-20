import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/* Agent commits still count as changed work even when the working tree is clean. */
export function changedFiles(cwd, since){
  const r = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  if(r.status !== 0) return null;
  const files = new Set();
  for(const l of String(r.stdout || "").split("\n")){
    const f = l.slice(3).trim().split(" -> ").pop();
    if(f) files.add(f);
  }
  if(since){
    const d = spawnSync("git", ["diff", "--name-only", since + "..HEAD"], { cwd, encoding: "utf8" });
    if(d.status === 0) for(const f of String(d.stdout || "").split("\n")) if(f.trim()) files.add(f.trim());
  }
  /* Worker-owned files must not defeat the no-op guard. */
  return [...files].filter(f=>!bukanKerja(f));
}

export const bukanKerja = (f)=> /^\.planforge(\/|$)/.test(f) || /^\.agents(\/|$)/.test(f) || /^(\.mcp\.json|worker\.mjs|AGENTS\.md|CLAUDE\.md)$/.test(f);

export const CATATAN_WORKER = /^\.planforge\/(state\.json|RUN_LOG\.md)$/;

/* Unchanged pre-existing dirty files are not work done by this task. */
export function potretKotor(cwd){
  const r = spawnSync("git", ["status", "--porcelain", "-z", "-uall"], { cwd, encoding: "utf8" });
  if(r.status !== 0) return null;
  /* Git reports root-relative paths; restrict snapshots to the target subtree. */
  const pf = spawnSync("git", ["rev-parse", "--show-prefix"], { cwd, encoding: "utf8" });
  const prefix = pf.status === 0 ? String(pf.stdout || "").trim() : "";
  const rel = (p)=> prefix ? (p.startsWith(prefix) ? p.slice(prefix.length) : null) : p;
  const out = {};
  const e = String(r.stdout || "").split("\0");
  for(let i = 0; i < e.length; i++){
    if(!e[i]) continue;
    const xy = e[i].slice(0, 2), f = e[i].slice(3);
    if(xy[0] === "R" || xy[0] === "C"){ i++; if(e[i]){ const o = rel(e[i]); if(o !== null) out[o] = "-"; } }
    const t = rel(f); if(t === null) continue;
    let isi;
    try{ isi = crypto.createHash("sha1").update(fs.readFileSync(path.join(cwd, t))).digest("hex"); }catch{ isi = "-"; }
    out[t] = isi;
  }
  return out;
}

export function headSha(cwd){
  const r = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd, encoding: "utf8" });
  return r.status === 0 ? String(r.stdout || "").trim() : null;
}
