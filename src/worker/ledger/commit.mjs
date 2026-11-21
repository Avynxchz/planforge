import { spawnSync } from "node:child_process";
import { potretKotor, CATATAN_WORKER, bukanKerja } from "./snapshots.mjs";
import { log } from "./log.mjs";
import { short } from "../text.mjs";

/* Commit only task work and worker notes, not unrelated user changes. */
export function gitCommit(ctx, cwd, t, awal){
  const st = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  if(st.status !== 0){
    log(ctx, "  commit " + t.id + " dilewati: folder kerja bukan repo Git. Untuk mengaktifkan auto-commit, jalankan `git init && git add . && git commit -m \"init\"` dari folder proyek.");
    return null;
  }
  const kini = potretKotor(cwd);
  if(!kini) return null;
  const ikut = [], bawaan = [], ditinggal = [];
  for(const f of Object.keys(kini)){
    if(CATATAN_WORKER.test(f)){ ikut.push(f); continue; }
    if(bukanKerja(f) || (awal && awal[f] === kini[f])){ ditinggal.push(f); continue; }
    if(awal && f in awal) bawaan.push(f);
    ikut.push(f);
  }
  const hasil = { ikut, bawaan, ditinggal, ok: false };
  if(!ikut.length){ log(ctx, "  commit " + t.id + ": tidak ada file untuk dikommit"); return hasil; }
  const daftar = { cwd, encoding: "utf8", input: ikut.join("\0") + "\0" };
  const pilih = ["--pathspec-from-file=-", "--pathspec-file-nul"];
  spawnSync("git", ["--literal-pathspecs", "add", "-A", ...pilih], daftar);
  const c = spawnSync("git", ["--literal-pathspecs", "commit", "-m", t.id + ": " + short(t.title, 60), ...pilih], daftar);
  hasil.ok = c.status === 0;
  if(hasil.ok) log(ctx, "  commit " + t.id + ": " + short(String(c.stdout).split("\n")[0], 70) + " · " + ikut.length + " file"
    + (ditinggal.length ? " · tidak ikut: " + short(ditinggal.join(", "), 160) : ""));
  else log(ctx, "  commit gagal: " + short(String(c.stderr || c.stdout), 120));
  return hasil;
}
