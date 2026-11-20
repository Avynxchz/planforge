import path from "node:path";
import fs from "node:fs";
import { AGENT_ADAPTERS } from "../../shared/agent-contracts.mjs";

export function mcpEntry(root, shape){
  const workerPath = path.join(root, "worker.mjs").replace(/\\/g, "/");
  const args = [workerPath, "mcp", "--dir", root.replace(/\\/g, "/")];
  if(shape === "servers") return { type:"stdio", command:"node", args, cwd:"${workspaceFolder}" };
  if(shape === "mcp") return { type:"local", command:["node"].concat(args), environment:{}, enabled:true };
  return { command:"node", args, env:{}, disabled:false, timeout:600 };
}

export function mcpServerName(projectDir){
  const dir = String(projectDir || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if(!dir) return "planforge";
  const normal = /^(?:[a-z]:\/|\/\/)/i.test(dir) ? dir.toLowerCase() : dir;
  const slug = normal.split("/").pop().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "proyek";
  let hash = 2166136261;
  for(let i = 0; i < normal.length; i++) hash = Math.imul(hash ^ normal.charCodeAt(i), 16777619);
  return "planforge-" + slug + "-" + (hash >>> 0).toString(16).padStart(8, "0");
}

export function mcpSnippet(root, key){
  const a = AGENT_ADAPTERS[key] || AGENT_ADAPTERS.generic;
  const entry = { [mcpServerName(root)]: mcpEntry(root, a.shape) };
  if(a.shape === "servers") return JSON.stringify({ servers: entry, inputs: [] }, null, 2);
  if(a.shape === "mcp") return JSON.stringify({ $schema:"https://opencode.ai/config.json", mcp:{ servers: entry } }, null, 2);
  return JSON.stringify({ mcpServers: entry }, null, 2);
}

/* Different MCP clients need different configuration shapes. */
export function mcpUniversal(root){
  const workerPath = path.join(root, "worker.mjs").replace(/\\/g, "/");
  return { nama:mcpServerName(root), perintah:"node " + workerPath + " mcp --dir " + root.replace(/\\/g, "/"),
    blok:{ mcpServers:mcpSnippet(root, "generic"), servers:mcpSnippet(root, "vscode"), mcp:mcpSnippet(root, "opencode") } };
}

export const rulesText = (root)=>[
  "# PlanForge — aturan buat AI agent di proyek ini",
  "",
  "Task list: `.planforge/plan.json`. Progress: `.planforge/state.json`. Gerbang kualitas: `.planforge/gates.json`.",
  "Connector: `" + mcpServerName(root) + "`. Sebelum mengambil task, panggil `plan_status` melalui connector ini. Folder proyek yang dilaporkan WAJIB sama dengan " + root.replace(/\\/g, "/") + ". Kalau berbeda atau tidak jelas: STOP. Jangan panggil next_task, mark_done, atau mark_failed pada proyek lain.",
  "Alur wajib per task:",
  "1. Panggil tool MCP `audit_plan` dulu — task yang berstatus error di sana gerbangnya tidak bisa dibuktikan: laporkan, jangan dikerjakan.",
  "1b. Kalau kartu task butuh file/data yang tidak ada dan membuatnya di luar cakupan task, panggil `mark_blocked` dengan id + alasan. Itu BUKAN `mark_failed`. Jangan mengarang proyek dasar, jangan menyunting plan.json, dan jangan menukar bukti supaya terlihat lolos.",
  "2. Panggil tool MCP `next_task` — dapat id, judul, acceptance criteria dan cara verifikasinya.",
  "3. Kerjakan HANYA task itu. Jangan nambah fitur di luar task. Dilarang mengarang baris data (mis. isi tabel DB) cuma supaya endpoint kelihatan berisi — pakai fixture CSV atau DB sementara.",
  "4. Jalanin gerbangnya beneran (`npm run build`, `npm test`, `npm run lint`) DAN perintah `verification` yang tertulis di kartu task. Semua harus hijau. Worker menjalankan ulang keduanya sendiri — exit code yang masuk ledger, bukan ceritamu.",
  "5. Lolos -> panggil `mark_done` dengan id + verification: PERINTAH ASLI YANG KAMU JALANKAN DAN OUTPUTNYA. Bukan rencana. Worker menjalankan gerbangnya sendiri, menolak kalau bohong, dan mengkommit atas nama task — kamu tidak perlu kommit lagi.",
  "6. Nggak lolos -> panggil `mark_failed` beserta alasannya. Menandai selesai tanpa bukti dianggap kegagalan.",
  "7. SEBELUM task pertama, jalankan `node worker.mjs doctor` di terminal proyek. Kalau keluar `!! pid ... KODE LAMA`: connector masih jalan dari aturan lama (balasan mark_done-nya tidak akan pernah menyebut \"kommit <sha>\"). STOP, laporkan baris itu, jangan ambil task. Banner `!! BUILD LAMA` di jawaban tool cuma bisa muncul kalau prosesnya sudah kode baru — jangan mengandalkaninya.",
  "8. Gerbang merah karena interpreter (`python` = lotere: shell yang satu punya fastapi/pytest, shell yang lain tidak)? Jalankan `node worker.mjs pin`. Dia menulis path interpreter absolut ke npm script sampai gerbang blocking hijau, dan mengembalikan package.json kalau semuanya merah. Jangan mengakalinya dengan menambah PATH atau mengganti isi gerbang.",
  "9. `verification` yang berupa kalimat (\"buka browser, klik tombol, lihat tampilannya\") TIDAK bisa dijalankan worker, jadi task itu tidak akan pernah lolos. Laporkan ke manusia supaya ditulis ulang sebagai perintah — jangan dikerjakan sambil mengarang bukti.",
  "10. Budget: `limits.maxCostUsd` (bawaan 0 = agen berbayar langsung dihentikan), `maxCallsPerRun`, `maxCalls`. Kalau `next_task` menjawab BERHENTI karena budget, jangan ambil task lagi dan jangan mengakalinya — laporkan baris itu ke manusia, dia yang memutuskan menaikkan batasnya.",
  "11. Kalau `next_task` menyerahkan `GILIRAN-n` (gerbang penuh: audit, perbaikan, refactor, performa), kerjakan itu dulu tanpa menambah fitur, lalu `mark_done` dengan id `GILIRAN-n` dan hasil tiap langkah (`audit: ...`, `fixbug: ...`, dst). Worker menjalankan ulang tes + browser task yang dicakup; task baru baru keluar sesudah giliran diterima.",
  "12. LOOP OTOMATIS: satu trigger dari manusia = kerjakan SEMUA task, bukan satu task lalu diam. Sesudah `mark_done` diterima, panggil `next_task` lagi dan lanjut ke task berikutnya tanpa minta izin ulang. Berhenti HANYA kalau `next_task` menjawab BERHENTI (budget habis / terkendala / giliran gagal) atau \"tidak ada task\" (semua selesai), atau kamu sendiri memanggil `mark_blocked`. Jangan menyunting state.json/gates.json untuk mengakali berhenti.",
  "",
  "Alternatif tanpa kamu pencet-pencet: `node worker.mjs run --max-calls 120` di folder ini.",
  "Folder proyek: " + root.replace(/\\/g, "/")
].join("\n");

export function writeFileChecked(root, rel, text){
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if(fs.existsSync(p)){
    const lama = fs.readFileSync(p, "utf8");
    if(rel.endsWith(".json")){
      let j; try{ j = JSON.parse(lama); } catch(e){ return { file:rel, tulis:false, kenapa:"file-nya bukan JSON yang kebaca — biar aman, tidak kutulis (--force kalau mau timpa)" }; }
      if(j.mcp && j.mcp.servers){
        j.mcp.servers = Object.assign({}, j.mcp.servers, { [mcpServerName(root)]: mcpEntry(root, "mcp") });
        fs.writeFileSync(p, JSON.stringify(j, null, 2));
        return { file:rel, tulis:true, kenapa:"ditempel ke dalam mcp.servers yang sudah ada" };
      }
      const key = j.mcpServers ? "mcpServers" : (j.servers ? "servers" : null);
      if(!key) return { file:rel, tulis:false, kenapa:"tidak ada blok mcpServers/servers/mcp.servers yang kukenali" };
      j[key] = Object.assign({}, j[key], { [mcpServerName(root)]: mcpEntry(root, key === "servers" ? "servers" : "mcpServers") });
      fs.writeFileSync(p, JSON.stringify(j, null, 2));
      return { file:rel, tulis:true, kenapa:"ditempel ke dalam " + key + " yang sudah ada" };
    }
    if(/PlanForge/.test(lama)) return { file:rel, tulis:false, kenapa:"sudah menyebut PlanForge, tidak kutumpuk" };
    fs.appendFileSync(p, "\n\n" + text);
    return { file:rel, tulis:true, kenapa:"ditambah di akhir file yang sudah ada" };
  }
  fs.writeFileSync(p, text);
  return { file:rel, tulis:true, kenapa:"file baru" };
}

export function connectAgent(root, key){
  const a = AGENT_ADAPTERS[key] || AGENT_ADAPTERS.generic;
  const hasil = [];
  if(a.file) hasil.push(Object.assign({ peran:"konfigurasi MCP" }, writeFileChecked(root, a.file, mcpSnippet(root, key))));
  hasil.push(Object.assign({ peran:"instruksi buat agent" }, writeFileChecked(root, a.rules, rulesText(root))));
  return { label:a.label, hint:a.hint, hasil };
}
