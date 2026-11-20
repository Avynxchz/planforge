import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readJson } from "../ledger/files.mjs";
import { runHardGates } from "../verification/hard-gates.mjs";
import { loadCtx } from "../ledger/state.mjs";

/* The app PATH can select a different interpreter than the human terminal. */
export function kandidatInterpreter(cwd){
  const cariPerintah = process.platform === "win32" ? "where" : "which";
  const keluar = [];
  for(const nama of ["python", "python3"]){
    const r = spawnSync(cariPerintah, process.platform === "win32" ? [nama] : ["-a", nama], { cwd, encoding: "utf8" });
    for(const baris of String(r.stdout || "").split(/\r?\n/)){
      const p = baris.trim();
      if(p && !keluar.includes(p)) keluar.push(p);
    }
  }
  return keluar;
}

/* Windows short paths avoid nested-quote truncation in npm shell commands. */
export function jalurAman(p){
  const mentah = String(p);
  if(process.platform !== "win32" || !/\s/.test(mentah)) return mentah;
  const r = spawnSync('for %A in ("' + mentah + '") do @echo %~sA', { shell: true, encoding: "utf8" });
  const pendek = String(r.stdout || "").trim();
  return pendek && !/\s/.test(pendek) && fs.existsSync(pendek) ? pendek : mentah;
}

export function absolutkanScript(pkg, abs){
  const baru = JSON.parse(JSON.stringify(pkg));
  const rapi = process.platform === "win32" ? jalurAman(abs) : String(abs).replace(/\\/g, "/");
  /* npm wraps scripts in quotes; a space-free path avoids nested cmd.exe quoting. */
  const token = /\s/.test(rapi) ? '"' + rapi + '"' : rapi;
  for(const k of Object.keys(baru.scripts || {})){
    baru.scripts[k] = String(baru.scripts[k]).split(/(&&|\|\||;|\|)/).map(bagian=>{
      const mulai = bagian.replace(/^\s+/, "");
      const m = /^(python3?|pytest)\b([\s\S]*)$/.exec(mulai);
      if(!m) return bagian;
      const sisa = m[2] || "";
      const lead = bagian.slice(0, bagian.length - mulai.length);
      return m[1] === "pytest" ? lead + token + " -m pytest" + sisa : lead + token + sisa;
    }).join("");
  }
  return baru;
}

export function pinInterpreter(ctx, cwd, kandidat){
  const file = path.join(cwd, "package.json");
  let mentah = "";
  try{ mentah = fs.readFileSync(file, "utf8"); }catch(_){ mentah = ""; }
  const asli = readJson(file, null);
  if(!asli || !asli.scripts) return { ok: false, kenapa: "tidak ada package.json dengan blok scripts di " + cwd + " — pin cuma untuk proyek yang gerbangnya lewat npm script" };
  const daftar = kandidat === undefined ? kandidatInterpreter(cwd) : kandidat;
  if(!daftar.length) return { ok: false, kenapa: "tidak ada python/python3 yang ketemu di PATH mesin ini" };
  /* Failed interpreter trials must restore the user file byte-for-byte. */
  const crlf = /\r\n/.test(mentah);
  const akhiran = (mentah.match(/(?:\r?\n)+$/) || [""])[0];
  const indent = (mentah.match(/^\{\s*(?:\r?\n)([ \t]+)/) || [, "  "])[1];
  const tulis = (obj)=>{
    let teks = JSON.stringify(obj, null, indent) + akhiran;
    if(crlf) teks = teks.replace(/\r?\n/g, "\r\n");
    fs.writeFileSync(file, teks);
  };
  const coba = [];
  for(const abs of daftar){
    const usul = absolutkanScript(asli, abs);
    if(JSON.stringify(usul) === JSON.stringify(asli)){ continue; }
    tulis(usul);
    const g = runHardGates(ctx, cwd, { hanyaBlocking: true });
    const merah = g.filter(x=>!x.pass);
    coba.push({ abs, hijau: !merah.length, merah: merah.map(x=>x.id) });
    if(!merah.length){
      ctx.gates = loadCtx(ctx.root).gates;
      return { ok: true, abs, coba, gate: g };
    }
  }
  fs.writeFileSync(file, mentah);
  return { ok: false, coba, kenapa: "tidak ada interpreter yang bikin gerbang hijau — package.json kunembalikan seperti semula" };
}
