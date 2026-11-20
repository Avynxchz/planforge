/* PlanForge core: connector MCP dan keputusan tulis berkas proyek. */
import { AGENT_ADAPTERS } from "../../shared/agent-contracts.mjs";

export { AGENT_ADAPTERS } from "../../shared/agent-contracts.mjs";
import { planFingerprintPlan } from "../../shared/plan-identity.mjs";
import { starterAktif } from "./starter.mjs";

/* Hash path membedakan basename yang sama; algoritma harus sama dengan worker. */
export function connNama(opts){
  const dir = String((opts && opts.projectDir) || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if(!dir) return "planforge";
  const normal = /^(?:[a-z]:\/|\/\/)/i.test(dir) ? dir.toLowerCase() : dir;
  const slug = normal.split("/").pop().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,32) || "proyek";
  let hash=2166136261;
  for(let i=0;i<normal.length;i++) hash=Math.imul(hash ^ normal.charCodeAt(i),16777619);
  return "planforge-" + slug + "-" + (hash >>> 0).toString(16).padStart(8,"0");
}

export function connPrompt(opts){
  opts = opts || {};
  const dir = String(opts.projectDir || "").trim().replace(/\\/g, "/").replace(/\/+$/, "") || "<path absolut folder target>";
  const worker = opts.workerPath || dir + "/worker.mjs";
  const starterNote = starterAktif(opts) ? " KODE FONDASI STARTER sudah ada di folder target, bukan berarti DB/dependency sudah hidup. Baca petunjuk lingkungan pada aturan proyek; jalankan node worker.mjs doctor --environment. Saran lingkungan tidak menahan Connect/next_task, tetapi jangan klaim selesai sebelum verifikasi benar-benar hijau. Kerjakan task DELTA, jangan bangun ulang auth/DB/kerangka/docker/test." : "";
  return "Gunakan hanya connector MCP \"" + connNama(opts) + "\" untuk folder target \"" + dir + "\"."
    + " Sebelum next_task atau mark_done, panggil plan_status pada connector itu; cocokkan path proyek dan worker yang dilaporkan"
    + " dengan folder target \"" + dir + "\" dan worker \"" + worker + "\"."
    + " STOP kalau berbeda atau identitas belum bisa diverifikasi; jangan panggil tool perubahan pada proyek lain."
    + " Kalau kartu task butuh file/data yang tidak ada dan bukan tugasmu membuatnya, panggil mark_blocked dengan id + alasan —"
    + " JANGAN mark_failed (itu vonis gagal) dan jangan mengarang proyek dasar di luar task."
    + " Setelah cocok, kerjakan task berikutnya sesuai aturan proyek."
    + " LOOP OTOMATIS: satu trigger ini = kerjakan SEMUA task, bukan satu lalu diam. Sesudah tiap mark_done diterima, panggil next_task lagi dan lanjut tanpa minta manusia meneruskan tiap task."
    + " Berhenti HANYA kalau next_task menjawab BERHENTI (budget habis / terkendala / giliran gagal) atau \"tidak ada task\" (semua selesai), atau kamu memanggil mark_blocked."
    + starterNote;
}

/* satu entri server — dipakai baik untuk file baru maupun untuk menggabung ke konfigurasi yang sudah ada */
export function connEntry(key, opts){
  opts = opts || {};
  const worker = opts.workerPath || "worker.mjs";
  const dir = opts.projectDir || "";
  const args = [worker, "mcp"]; if(dir) args.push("--dir", dir);
  const a = AGENT_ADAPTERS[key] || AGENT_ADAPTERS.generic;
  if(a.shape === "servers") return { type:"stdio", command:"node", args, cwd:"${workspaceFolder}" };
  if(a.shape === "mcp") return { type:"local", command:["node"].concat(args), environment:{}, enabled:true };
  return { command:"node", args, env:{}, disabled:false, timeout:600 };
}
export function connConfigJson(key, opts){
  const a = AGENT_ADAPTERS[key] || AGENT_ADAPTERS.generic;
  const entry = {}; entry[connNama(opts)] = connEntry(key, opts);
  if(a.shape === "servers") return JSON.stringify({ servers:entry, inputs:[] }, null, 2);
  if(a.shape === "mcp") return JSON.stringify({ $schema:"https://opencode.ai/config.json", mcp:{ servers:entry } }, null, 2);
  return JSON.stringify({ mcpServers:entry }, null, 2);
}
/* Jalur universal buat app yang belum punya adapter: yang penting SATU perintah ini dijalankan
   sebagai server MCP stdio. Bungkus JSON-nya beda per app, jadi sediakan semua dialect umum
   plus perintahnya — tidak ada app asing yang dikasih blok salah bentuk lagi. */
export function connUniversal(opts){
  opts = opts || {};
  const dir = String(opts.projectDir || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const worker = opts.workerPath || (dir ? dir + "/worker.mjs" : "worker.mjs");
  const args = [worker, "mcp"]; if(dir) args.push("--dir", dir);
  return { nama:connNama(opts), perintah:"node " + args.join(" "),
    blok:{ mcpServers:connConfigJson("generic", opts), servers:connConfigJson("vscode", opts), mcp:connConfigJson("opencode", opts) } };
}

/* Keputusan tulis per file, murni tanpa browser supaya bisa diuji. Aturan utamanya: jangan pernah
   menghapus pekerjaan orang. Progress (state.json) dan gerbang yang sudah disunting (gates.json)
   tidak ditimpa; konfigurasi MCP digabung, bukan diganti; file aturan ditambah di akhir. */
export function rencanaTulis(files, existing, info){
  existing = existing || {}; info = info || {};
  const punya = (n)=> Object.prototype.hasOwnProperty.call(existing, n) && existing[n] != null;
  const out = [];
  let newFp = null, oldFp = null;
  const planFile = files.find(f=>f.name === ".planforge/plan.json");
  if(planFile){ try{ newFp = JSON.parse(planFile.data).planFingerprint || null; }catch(e){} }
  if(punya(".planforge/plan.json")){
    try{ const op = JSON.parse(String(existing[".planforge/plan.json"])); oldFp = op.planFingerprint || planFingerprintPlan(op); }catch(e){ oldFp = null; }
  }
  const oldState = punya(".planforge/state.json") ? String(existing[".planforge/state.json"]) : null;
  /* hanya reset kalau rencana LAMA diketahui (oldFp ada) dan memang beda. Tanpa plan.json lama,
     kita tidak tahu progres ini milik rencana mana — jangan hapus pekerjaan orang karena tebakan. */
  const gantiLedger = oldState != null && newFp && oldFp != null && oldFp !== newFp;
  if(gantiLedger){
    let backup = ".planforge/state." + (oldFp || "lama") + ".json";
    if(punya(backup)) backup = ".planforge/state." + (oldFp || "lama") + "." + Date.now() + ".json";
    out.push({ name:backup, data:oldState, aksi:"baru", alasan:"cadangan progres rencana lama sebelum ledger baru ditulis" });
  }
  for(const f of files){
    const nama = f.name;
    if(!punya(nama)){ out.push({ name:nama, data:f.data, aksi:"baru", alasan:"file belum ada" }); continue; }
    const lama = String(existing[nama]);
    if(f.starter){ out.push({ name:nama, data:lama, aksi:"lewati", alasan:"file starter sudah ada — fondasi/pekerjaan agen tidak ditimpa" }); continue; }
    if(nama === ".planforge/state.json"){
      if(gantiLedger) out.push({ name:nama, data:f.data, aksi:"timpa", alasan:"rencana berubah (" + (oldFp||"lama") + " → " + newFp + ") — progres lama dicadangkan, ledger baru mulai bersih" });
      else out.push({ name:nama, data:lama, aksi:"lewati", alasan:"sudah ada — progress task tidak boleh direset" });
      continue;
    }
    if(nama === ".planforge/gates.json"){ out.push({ name:nama, data:lama, aksi:"lewati", alasan:"sudah ada — gerbang yang kamu sunting tidak ditimpa" }); continue; }
    if(nama === info.mcpFile){
      let j; try{ j = JSON.parse(lama); }catch(e){ out.push({ name:nama, data:lama, aksi:"lewati", alasan:"bukan JSON yang kebaca — biar aman tidak kutulis" }); continue; }
      const namaServer = info.mcpName || "planforge";
      if(j && j.mcp && j.mcp.servers){
        const gabung = Object.assign({}, j, { mcp:Object.assign({}, j.mcp, { servers:Object.assign({}, j.mcp.servers, { [namaServer]: info.mcpEntry }) }) });
        out.push({ name:nama, data:JSON.stringify(gabung, null, 2), aksi:"gabung", alasan:"server lain di mcp.servers tetap utuh" });
        continue;
      }
      const kunci = j && j.mcpServers ? "mcpServers" : (j && j.servers ? "servers" : null);
      if(!kunci){ out.push({ name:nama, data:lama, aksi:"lewati", alasan:"tidak ada blok mcpServers/servers/mcp.servers yang kukenali" }); continue; }
      const gabung = Object.assign({}, j);
      gabung[kunci] = Object.assign({}, j[kunci], { [namaServer]: info.mcpEntry });
      out.push({ name:nama, data:JSON.stringify(gabung, null, 2), aksi:"gabung", alasan:"server lain di " + kunci + " tetap utuh" });
      continue;
    }
    if(nama === info.rulesFile){
      if(/PlanForge/.test(lama)){ out.push({ name:nama, data:lama, aksi:"lewati", alasan:"sudah menyebut PlanForge — tidak kutumpuk" }); continue; }
      out.push({ name:nama, data:lama + "\n\n" + f.data, aksi:"gabung", alasan:"ditambah di akhir file yang sudah ada" });
      continue;
    }
    out.push({ name:nama, data:f.data, aksi:"timpa", alasan:"file PlanForge sendiri, harus versi terbaru" });
  }
  return out;
}
