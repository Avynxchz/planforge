import path from "node:path";
import fs from "node:fs";

/* Agent claims are not evidence; the worker reruns the verification command. */
export const AWAL_PERINTAH = /^\s*(shell|bash|perintah|command|cmd)\s*:?\s*/i;

export const BUKAN_PERINTAH = /^(buka|lihat|cek|pastikan|verifikasi|bandingkan|amati|klik|scroll|coba|screenshot|manual|uji\s+manual|test\s+manual)/i;

export const BUILTIN = new Set(["echo", "cd", "time", "export", "set", "source", "true", "test", "if", "then", "do", "done", "for", "while"]);

export const BERISIKO = { npx: "bisa minta izin install lalu menggantung selamanya", docker: "butuh daemon yang jalan", code: "buka GUI, tidak pernah balas di terminal" };

export const TOKEN_FILE = /([\w.@\/-]+\.(?:py|csv|json|db|html|js|mjs|sh|md|sql|toml|ini|ya?ml))\b/g;

export function hasBin(name){
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for(const d of dirs) for(const e of exts){
    try{ if(fs.statSync(path.join(d, name + e)).isFile()) return true; }catch(_){ /* Expected PATH miss; try the next directory. */ }
  }
  return false;
}

/* Quoted separators belong to one command, not extra missing shell binaries. */
export const segmen = (v)=>{
  const s = String(v), out = [];
  let cur = "", q = null;
  for(let i=0;i<s.length;i++){
    const ch = s[i];
    if(q){ cur += ch; if(ch === q) q = null; continue; }
    if(ch === '"' || ch === "'" || ch === "`"){ q = ch; cur += ch; continue; }
    if((ch === "&" && s[i+1] === "&") || (ch === "|" && s[i+1] === "|")){ out.push(cur); cur = ""; i++; continue; }
    if(ch === ";" || ch === "\n" || ch === "|"){ out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x=>x.trim()).filter(Boolean);
};

export const tokenAwal = (s)=> (s.match(/^["'`]?([^\s"'`|&]+)/) || [, ""])[1];

export const desimal = (s)=> new Set([...String(s || "").matchAll(/\d+[.,]\d+/g)].map(m=>m[0].replace(",", ".")));

/* Sentences are not executable evidence, both before and after agent work. */
export function bukanPerintah(v){
  const awal = segmen(v)[0] || "";
  if(!awal) return "kosong";
  const tok0 = tokenAwal(awal);
  const pathish = /[\/\\]/.test(tok0) || /^[A-Za-z]:/.test(tok0) || /\.exe$/i.test(tok0);
  if(BUKAN_PERINTAH.test(awal) || /^[^a-zA-Z~._\/-]/.test(tok0) || (!pathish && /^[A-Z]/.test(tok0))) return awal;
  return null;
}

/* Single quotes do not protect cmd.exe operators; double quotes do. */
export function kutipSatuBocor(v){
  const luar = String(v || "").replace(/"[^"]*"/g, '""');
  const m = [...luar.matchAll(/'([^']*)'/g)].find(x=>/[|&<>]/.test(x[1]));
  return m ? m[0] : null;
}
