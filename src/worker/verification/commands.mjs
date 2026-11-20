import { spawnSync } from "node:child_process";
import { AWAL_PERINTAH, bukanPerintah } from "../environment/shell.mjs";
import { short } from "../text.mjs";
import { log } from "../ledger/log.mjs";

export function runCmd(cmd, cwd, timeoutMs){
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs || 300000, maxBuffer: 20 * 1024 * 1024 });
  const out = String(r.stdout || "") + String(r.stderr || "");
  return { code: r.status === null ? -1 : r.status, out: out.replace(/\u001b\[[0-9;]*m/g, ""), timeout: r.status === null && /ETIMEDOUT|killed/i.test(String(r.error || "")) };
}

export function perintahVerifikasi(t){
  const raw = String((t && t.verification) || "").trim();
  const bersih = raw.replace(AWAL_PERINTAH, "");
  return { raw, bersih, baris: bersih.split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean) };
}

export const VERIF_DILEWATI = { ok: true, jalan: false, dilewati: true, kurang: [], hasil: [], raw: "" };

export function runVerification(ctx, cwd, t, opsi){
  const { raw, bersih, baris } = perintahVerifikasi(t);
  const hasil = [], kurang = [];
  if(!baris.length)
    return { ok: false, jalan: false, kurang: ["verification kosong — tidak ada perintah yang bisa membuktikan task ini"], hasil, raw };
  const bukan = bukanPerintah(bersih);
  if(bukan)
    return { ok: false, jalan: false, kurang: ["verification bukan perintah shell (\"" + short(bukan, 80)
      + "\") — worker tidak bisa menjalankannya, jadi tidak ada bukti. Tulis ulang sebagai perintah yang menghasilkan exit code,"
      + " atau kerjakan task ini lewat jalur manual dan jangan tandai selesai lewat worker."], hasil, raw };
  for(const cmd of baris){
    const t0 = Date.now();
    const r = runCmd(cmd, cwd, (opsi && opsi.timeoutMs) || 300000);
    const pass = r.code === 0;
    hasil.push({ cmd, code: r.code, pass, ms: Date.now() - t0, out: short(r.out, 2000) });
    log(ctx, "  verifikasi " + (pass ? "OK" : "GAGAL") + " (exit " + r.code + ", " + Math.round((Date.now() - t0) / 1000) + "s): " + short(cmd, 110));
    if(!pass){
      kurang.push("verification gagal (exit " + r.code + "): " + short(cmd, 90) + " -> " + short(String(r.out).replace(/\s+/g, " ").trim(), 300));
      if(/localhost:|127\.0\.0\.1:/.test(cmd))
        kurang.push("perintah ini butuh server yang hidup — nyalakan dulu, jangan tukar buktinya dengan yang lain");
      break;
    }
  }
  return { ok: !kurang.length, jalan: true, kurang, hasil, raw };
}

export function ringkasVerifikasi(ver){
  if(!ver || ver.dilewati) return "verifikasi dilewati (--no-gates)";
  if(!ver.jalan) return ver.kurang.join(" · ");
  const ekor = ver.hasil.length ? String(ver.hasil[ver.hasil.length - 1].out).replace(/\s+/g, " ").trim() : "";
  return ver.hasil.map(h=>h.cmd + " -> exit " + h.code).join(" · ") + (ekor ? " · " + short(ekor, 160) : "");
}
