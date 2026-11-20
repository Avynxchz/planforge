import { spawnSync } from "node:child_process";
import { specBehavior, taskUi, masalahBehavior } from "../../shared/behavior-spec.mjs";
import { cariBrowser } from "./discovery.mjs";
import { SELF_FILE } from "../identity.mjs";
import { short } from "../text.mjs";
import { log } from "../ledger/log.mjs";

export const BEH_DILEWATI = { ok: true, jalan: false, dilewati: true, wajib: false, kurang: [], hasil: [] };

/* A child-process timeout keeps a hung browser from blocking the synchronous worker. */
export function runBehavior(ctx, cwd, t, opsi){
  const spec = specBehavior(t);
  const wajib = taskUi(t);
  if(!spec){
    const kurang = masalahBehavior(t);
    return kurang.length
      ? { ok: false, jalan: false, planRusak: true, wajib, kurang, hasil: [] }
      : { ok: true, jalan: false, dilewati: true, wajib, kurang: [], hasil: [] };
  }
  const rusak = masalahBehavior(t);
  if(rusak.length) return { ok: false, jalan: false, planRusak: true, wajib, kurang: rusak, hasil: [] };
  if(typeof WebSocket === "undefined")
    return { ok: false, jalan: false, lingkungan: true, wajib, kurang: ["Node " + process.version + " tidak punya WebSocket global — gerbang perilaku butuh Node 22+. Perilaku tidak dibuktikan, jadi task tidak boleh dicap selesai."], hasil: [] };
  const bin = cariBrowser();
  if(!bin)
    return { ok: false, jalan: false, lingkungan: true, wajib, kurang: ["browser tidak ditemukan di mesin ini. Pasang Microsoft Edge / Google Chrome, atau set PLANFORGE_BROWSER ke path binary-nya. Tanpa browser, worker tidak bisa membuktikan tampilan — dan tidak akan pura-pura hijau."], hasil: [] };
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [SELF_FILE, "__browser"], {
    cwd, input: JSON.stringify({ spec, cwd }), encoding: "utf8",
    timeout: (spec.timeoutSec + 40) * 1000, maxBuffer: 16 * 1024 * 1024
  });
  const out = String(r.stdout || "").trim();
  let j = null; try{ j = JSON.parse(out.slice(out.indexOf("{"))); }catch(e){}
  if(!j){
    const kenapa = r.error ? String(r.error.message) : "keluar tanpa JSON (code " + r.status + ")";
    return { ok: false, jalan: true, wajib, kurang: ["pengukur perilaku tidak menjawab: " + short(kenapa, 120) + " · " + short(String(r.stderr || "").replace(/\s+/g, " "), 240)], hasil: [], ms: Date.now() - t0 };
  }
  j.wajib = wajib; j.jalan = true;
  log(ctx, "  perilaku " + (j.ok ? "OK" : "GAGAL") + " (" + Math.round((j.ms || Date.now() - t0) / 1000) + "s, " + (j.hasil || []).length + " check, " + (j.requests || 0) + " request"
    + ((j.console || []).length ? ", " + j.console.length + " error console" : "") + "): " + short(spec.url, 80)
    + (j.ok ? "" : " — " + short((j.kurang || []).join(" · "), 220)));
  return j;
}
