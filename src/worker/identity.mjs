import path from "node:path";
import { fileURLToPath } from "node:url";
import { cetakFile } from "./ledger/files.mjs";

/* IDE cwd is not reliable; the bundled worker artifact is the fallback root. */
export const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));

export const SELF_FILE = fileURLToPath(import.meta.url);

export const BUILD_AWAL = cetakFile(SELF_FILE);

export const buildLama = ()=> cetakFile(SELF_FILE) !== BUILD_AWAL;

export function bannerBuildLama(){
  return [
    "!! BUILD LAMA: worker.mjs di disk sudah diganti, tapi proses MCP yang menjawab ini masih jalan dari kode lama.",
    "   build jalan : " + BUILD_AWAL + "   ·   build di disk : " + cetakFile(SELF_FILE),
    "   Artinya aturan baru (kommit per task, audit_plan, gerbang yang dibetulkan) BELUM berlaku di sesi ini.",
    "   Berhenti: jangan ambil task berikutnya, jangan mark_done. Laporkan baris ini apa adanya ke manusia —",
    "   dia perlu me-restart connector PlanForge atau membuka sesi baru sebelum lanjut."
  ].join("\n");
}
