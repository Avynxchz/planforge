import { spawnSync } from "node:child_process";
import { doctorMcp } from "./process.mjs";

/* Replacing worker.mjs cannot reload an existing child; require a proven fresh process. */
export function killPid(pid){
  if(process.platform === "win32"){
    const r = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { encoding:"utf8", timeout:10000 });
    return r.status === 0;
  }
  try{ process.kill(pid, "SIGKILL"); return true; }catch(e){ return false; }
}

export const tidurSync = (ms)=>{ try{ Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }catch(e){} };

export function refreshConnector(root, opts){
  opts = opts || {};
  const scan = opts.scan || (()=>doctorMcp(root));
  const kill = opts.kill || killPid;
  const tidur = opts.tidur || tidurSync;
  const tunggu = opts.tunggu != null ? Number(opts.tunggu) : 4000;
  const proyek = root.replace(/\\/g, "/");
  const sesuai = (scan().proses || []).filter(p=>p.proyek === "sesuai");
  if(!sesuai.length) return { hasil:"tidak-ada", stale:[], dibunuh:[], fresh:[], pesan:
    "BELUM TERVERIFIKASI: tidak ada connector `worker.mjs mcp` yang terbukti melayani " + proyek + ". Connect dulu / buka app lu, lalu cek `node worker.mjs doctor`." };
  const stale = sesuai.filter(p=>p.kodeLama || p.kartuLama);
  if(!stale.length) return { hasil:"udah-baru", stale:[], dibunuh:[], fresh:sesuai.map(p=>p.pid), pesan:
    "Connector proyek ini sudah pakai kode baru (" + sesuai.length + " proses, tidak ada KODE LAMA/KARTU LAMA). Nggak perlu refresh. Langsung kirim trigger." };
  if(opts.dryRun) return { hasil:"dry-run", stale:stale.map(p=>p.pid), dibunuh:[], fresh:[], pesan:
    "DRY-RUN: connector basi yang AKAN dimatikan: " + stale.map(p=>"pid "+p.pid+(p.kodeLama?" (KODE LAMA)":"")+(p.kartuLama?" (KARTU LAMA)":"")).join(", ") + ". Jalankan `node worker.mjs refresh` tanpa --dry-run untuk eksekusi. Matikan hanya saat agen lagi diam, bukan tengah task." };
  const dibunuh = stale.map(p=>({ pid:p.pid, ok:kill(p.pid) }));
  if(tunggu > 0) tidur(tunggu);
  const sesuai2 = (scan().proses || []).filter(p=>p.proyek === "sesuai");
  const fresh = sesuai2.filter(p=>!p.kodeLama && !p.kartuLama);
  const masihBasi = sesuai2.filter(p=>p.kodeLama || p.kartuLama);
  const matiOk = dibunuh.filter(x=>x.ok).map(x=>x.pid);
  if(fresh.length){
    const ekstra = masihBasi.length ? " Peringatan: masih ada connector basi (" + masihBasi.map(p=>"pid "+p.pid).join(", ") + ") yang gagal dibunuh — pastikan app lu memakai yang baru, atau reconnect manual." : "";
    return { hasil:"fresh", stale:stale.map(p=>p.pid), dibunuh, fresh:fresh.map(p=>p.pid), pesan:
      "OK — connector proyek ini lahir lagi pakai kode baru (" + fresh.map(p=>"pid "+p.pid).join(", ") + "). Langsung kirim trigger; pastikan plan_status menyebut folder " + proyek + "." + ekstra };
  }
  if(masihBasi.length) return { hasil:"gagal-bunuh", stale:stale.map(p=>p.pid), dibunuh, fresh:[], pesan:
    "Connector basi masih hidup (" + masihBasi.map(p=>"pid "+p.pid).join(", ") + ") — gagal dimatikan (akses ditolak?). Reconnect manual di app lu: opencode Desktop `opencode service restart`; app lain tombol MCP Reload/reconnect atau tutup-buka app sepenuhnya. Lalu cek `node worker.mjs doctor`." };
  return { hasil:"mati", stale:stale.map(p=>p.pid), dibunuh, fresh:[], pesan:
    "Connector basi sudah dimatikan (" + (matiOk.length ? matiOk.map(p=>"pid "+p).join(", ") : "tidak ada") + "), tapi app lu belum menghidupkan lagi. Dua kemungkinan:\n"
    + "  (a) app respawn waktu agen memanggil lagi -> kirim trigger baru, lalu cek `node worker.mjs doctor`.\n"
    + "  (b) app tidak respawn -> reconnect manual di app lu. opencode Desktop: `opencode service restart`. App lain: tombol MCP Reload/reconnect, atau tutup-buka app sepenuhnya.\n"
    + "JANGAN ambil task sebelum `node worker.mjs doctor` bilang ok (tidak ada KODE LAMA)." };
}
