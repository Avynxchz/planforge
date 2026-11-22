import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shouldRunFull } from "./full-review.mjs";
import { taskList, isDone, nextTask } from "../ledger/tasks.mjs";
import { log } from "../ledger/log.mjs";
import { runHardGates } from "../verification/hard-gates.mjs";
import { short } from "../text.mjs";
import { runVerification } from "../verification/commands.mjs";
import { runBehavior } from "../browser/run.mjs";

/* GUI agents do full reviews themselves; the worker must recheck their evidence. */
export function giliranJatuh(ctx, t){
  const terminalFailure = arguments[2];
  const hasFullReview = ctx.gates.reviews.some(review=>review.enabled && review.tier === "full");
  if(ctx.state.giliran || !hasFullReview || (!terminalFailure && !shouldRunFull(ctx, t))) return null;
  if(terminalFailure){
    const next = nextTask(ctx.plan, ctx.state);
    if(!ctx.state.sinceFull || (next && !next.__blocked)) return null;
  }
  const list = taskList(ctx.plan);
  const ke = (ctx.state.giliranKe || 0) + 1;
  const g = { id: "GILIRAN-" + ke, from: ctx.state.lastFullMark || (list[0] && list[0].id) || t.id, to: t.id,
    langkah: ctx.gates.reviews.filter(r=>r.enabled && r.tier === "full").map(r=>r.id), dibuka: new Date().toISOString(), tries: 0 };
  ctx.state.giliran = g; ctx.state.giliranKe = ke;
  log(ctx, g.id + " dibuka: gerbang penuh atas " + g.from + ".." + g.to + " (" + g.langkah.join(" -> ") + ") — diserahkan next_task sebelum task baru");
  return g;
}

export function cakupanGiliran(ctx, g){
  const list = taskList(ctx.plan);
  const i = list.findIndex(x=>x.id === g.from), j = list.findIndex(x=>x.id === g.to);
  return list.slice(Math.max(0, i), j + 1).filter(x=>isDone(ctx.state.tasks[x.id]));
}

export function kartuGiliran(ctx, g){
  const full = ctx.gates.reviews.filter(r=>r.enabled && r.tier === "full" && g.langkah.includes(r.id));
  const cakup = cakupanGiliran(ctx, g).map(x=>x.id).join(", ") || "-";
  const keras = ctx.gates.hard.filter(h=>h.enabled).map(h=>h.cmd);
  return [
    g.id + ": GILIRAN GERBANG PENUH atas " + g.from + ".." + g.to + " — ini BUKAN task baru, jangan menambah fitur.",
    "Kerjakan langkah ini berurutan di folder proyek:",
    ...full.map((r, k)=>(k + 1) + ". [" + r.id + "] " + r.label + ": " + String(r.prompt || "").replace("{FROM}", g.from).replace("{TO}", g.to)),
    "",
    "ATURAN:",
    "- Perilaku dan tampilan task yang sudah selesai (" + cakup + ") WAJIB tetap sama. Jangan sunting .planforge/.",
    keras.length ? "- Jalankan sendiri sampai hijau: " + keras.join(" · ") : "- Tidak ada gerbang keras aktif; tetap jalankan tes proyek sendiri.",
    "- Semua langkah selesai: panggil mark_done dengan id \"" + g.id + "\". Di verification tulis hasil tiap langkah, satu baris per langkah diawali id-nya ("
      + full.map(r=>r.id + ": {...}").join(", ") + "), lalu perintah tes yang kamu jalankan beserta output aslinya.",
    "- Worker menjalankan ulang sendiri gerbang keras DAN verification + perilaku browser " + cakup + ". Satu saja merah = giliran ditolak.",
    "- Tidak sanggup setelah 2 ronde perbaikan: mark_failed id \"" + g.id + "\" beserta alasannya, lalu BERHENTI dan laporkan ke manusia."
  ].join("\n");
}

function statusFiles(root){
  const dirs = [], files = [], allDirs = [];
  const walk = (dir, relative)=>{
    for(const entry of fs.readdirSync(dir, { withFileTypes:true })){
      if(entry.name === ".planforge" || entry.name === ".git") continue;
      const rel = relative ? path.join(relative, entry.name) : entry.name;
      const full = path.join(dir, entry.name);
      if(entry.isDirectory()){
        allDirs.push(rel);
        if(/^(?:data|db|storage)$/i.test(entry.name)){
          dirs.push(rel);
          continue;
        }
        walk(full, rel);
      }else if(entry.isFile() && /\.(?:json|csv|db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(entry.name)){
        files.push(rel);
      }
    }
  };
  walk(root, "");
  return { dirs, files, allDirs };
}

function snapshotApplicationState(root, backup){
  const entries = statusFiles(root);
  for(const relative of entries.dirs){
    const target = path.join(backup, relative);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.cpSync(path.join(root, relative), target, { recursive:true });
  }
  for(const relative of entries.files){
    const target = path.join(backup, relative);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.copyFileSync(path.join(root, relative), target);
  }
  return entries;
}

function restoreApplicationState(root, backup, before){
  const current = statusFiles(root);
  for(const relative of current.dirs) fs.rmSync(path.join(root, relative), { recursive:true, force:true });
  for(const relative of current.files) fs.rmSync(path.join(root, relative), { force:true });
  for(const relative of before.dirs){
    const source = path.join(backup, relative);
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.cpSync(source, target, { recursive:true });
  }
  for(const relative of before.files){
    const source = path.join(backup, relative);
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.copyFileSync(source, target);
  }
  const existing = new Set(before.allDirs);
  const after = statusFiles(root).allDirs.sort((a, b)=>b.length - a.length);
  for(const relative of after){
    if(existing.has(relative)) continue;
    const target = path.join(root, relative);
    if(fs.readdirSync(target).length === 0) fs.rmdirSync(target);
  }
}

function runIsolatedState(root, callback){
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "planforge-giliran-"));
  try{
    const before = snapshotApplicationState(root, backup);
    try{ return callback(); }
    finally{ restoreApplicationState(root, backup, before); }
  }finally{
    fs.rmSync(backup, { recursive:true, force:true });
  }
}

export function buktiGiliran(ctx, root, verification){
  const g = ctx.state.giliran;
  const v = String(verification || "").trim();
  const kurang = [];
  if(v.length < 12) kurang.push("verification terlalu pendek (" + v.length + " karakter) — tulis hasil tiap langkah + perintah tes dan outputnya");
  const absen = g.langkah.filter(id=>!new RegExp("(^|[^\\w-])" + id + "\\s*[:=]", "i").test(v));
  if(absen.length) kurang.push("laporan tidak menyebut hasil langkah: " + absen.join(", ") + " — satu baris per langkah, diawali id-nya");
  const hard = runIsolatedState(root, ()=>runHardGates(ctx, root));
  const blok = hard.filter(h=>!h.pass && h.blocking);
  if(blok.length) kurang.push("gerbang keras merah: " + blok.map(b=>b.id + " -> " + short(String(b.out).replace(/\s+/g, " "), 300)).join(" | "));
  const cek = [];
  if(!ctx.lewatiVerifikasi) for(const t of cakupanGiliran(ctx, g)){
    const { ver, beh } = runIsolatedState(root, ()=>{
      const ver = runVerification(ctx, root, t);
      const beh = runBehavior(ctx, root, t);
      return { ver, beh };
    });
    if(!ver.ok) kurang.push("verification " + t.id + " merah sesudah giliran: " + short(ver.kurang.join(" · "), 300));
    if(!beh.ok) kurang.push("perilaku " + t.id + " merah sesudah giliran: " + short((beh.kurang || []).join(" · "), 300));
    cek.push(t.id + (ver.ok && beh.ok ? "=OK" : "=merah"));
  }
  return { ok: !kurang.length, kurang, hard, cek };
}
