import { shouldRunFull } from "./full-review.mjs";
import { taskList, isDone } from "../ledger/tasks.mjs";
import { log } from "../ledger/log.mjs";
import { runHardGates } from "../verification/hard-gates.mjs";
import { short } from "../text.mjs";
import { runVerification } from "../verification/commands.mjs";
import { runBehavior } from "../browser/run.mjs";

/* GUI agents do full reviews themselves; the worker must recheck their evidence. */
export function giliranJatuh(ctx, t){
  if(ctx.state.giliran || !shouldRunFull(ctx, t)) return null;
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

export function buktiGiliran(ctx, root, verification){
  const g = ctx.state.giliran;
  const v = String(verification || "").trim();
  const kurang = [];
  if(v.length < 12) kurang.push("verification terlalu pendek (" + v.length + " karakter) — tulis hasil tiap langkah + perintah tes dan outputnya");
  const absen = g.langkah.filter(id=>!new RegExp("(^|[^\\w-])" + id + "\\s*[:=]", "i").test(v));
  if(absen.length) kurang.push("laporan tidak menyebut hasil langkah: " + absen.join(", ") + " — satu baris per langkah, diawali id-nya");
  const hard = runHardGates(ctx, root);
  const blok = hard.filter(h=>!h.pass && h.blocking);
  if(blok.length) kurang.push("gerbang keras merah: " + blok.map(b=>b.id + " -> " + short(String(b.out).replace(/\s+/g, " "), 300)).join(" | "));
  const cek = [];
  if(!ctx.lewatiVerifikasi) for(const t of cakupanGiliran(ctx, g)){
    const ver = runVerification(ctx, root, t);
    if(!ver.ok) kurang.push("verification " + t.id + " merah sesudah giliran: " + short(ver.kurang.join(" · "), 300));
    const beh = runBehavior(ctx, root, t);
    if(!beh.ok) kurang.push("perilaku " + t.id + " merah sesudah giliran: " + short((beh.kurang || []).join(" · "), 300));
    cek.push(t.id + (ver.ok && beh.ok ? "=OK" : "=merah"));
  }
  return { ok: !kurang.length, kurang, hard, cek };
}
