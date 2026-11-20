/* Folder/IndexedDB helpers plus Connect and progress panels. */
import { esc } from "./dom.mjs";
import { state } from "./state.mjs";
import { AGENT_ADAPTERS, connConfigJson, connNama, connPrompt, connUniversal } from "../core/connect.mjs";
import { planFingerprint } from "../core/handoff.mjs";
import { planTaskList } from "../core/plan-workspace.mjs";

/* Browser hanya memberi NAMA folder yang dipilih, bukan path lengkapnya. Path absolut tetap wajib:
   IDE menjalankan connector dari cwd yang tidak bisa ditebak, dan path relatif pernah membuat agen
   diam-diam menyunting state.json pakai tangan alih-alih memanggil tool. */
export async function connectBaca(handle, rel){
  const seg = rel.split("/");
  let dir = handle;
  for(let i=0;i<seg.length-1;i++){
    try{ dir = await dir.getDirectoryHandle(seg[i]); }catch(e){ return null; }
  }
  try{ return await (await (await dir.getFileHandle(seg[seg.length-1])).getFile()).text(); }
  catch(e){ return null; }
}

export async function connectTulisFile(handle, rel, text){
  const seg = rel.split("/");
  let dir = handle;
  for(let i=0;i<seg.length-1;i++) dir = await dir.getDirectoryHandle(seg[i], {create:true});
  const fh = await dir.getFileHandle(seg[seg.length-1], {create:true});
  const w = await fh.createWritable(); await w.write(text); await w.close();
}

export function connectConn(){ return AGENT_ADAPTERS[state.pkgConn] ? state.pkgConn : "workbuddy"; }

/* ---------- Batch 0: rencana berubah = 1 klik Sinkron, bukan Connect ulang ----------
   Handle folder disimpan di IndexedDB (bisa di-clone, beda dengan localStorage yang cuma
   bisa simpan teks). Kalau izinnya sudah dicabut browser, minta sekali lewat dialog izin. */
export const IDB_NAME = "planforge-connect", IDB_KEY = "terakhir";

export function bukaIdb(){
  return new Promise((res, rej)=>{
    if(typeof indexedDB === "undefined") return rej(new Error("IndexedDB tidak tersedia"));
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = ()=>{ if(!r.result.objectStoreNames.contains("data")) r.result.createObjectStore("data"); };
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error || new Error("IndexedDB gagal dibuka"));
  });
}

export async function simpanKoneksi(rec){
  const db = await bukaIdb();
  return new Promise((res, rej)=>{
    const tx = db.transaction("data", "readwrite");
    tx.objectStore("data").put(rec, IDB_KEY);
    tx.oncomplete = ()=>{ db.close(); res(true); };
    tx.onerror = ()=>{ db.close(); rej(tx.error); };
  });
}

export async function bacaKoneksi(){
  try{
    const db = await bukaIdb();
    return await new Promise((res)=>{
      const tx = db.transaction("data", "readonly");
      const q = tx.objectStore("data").get(IDB_KEY);
      q.onsuccess = ()=>res(q.result || null);
      q.onerror = ()=>res(null);
      tx.oncomplete = ()=>db.close();
    });
  }catch(e){ return null; }
}

export function perluSinkron(){
  const last = state.lastConnect;
  if(!last || !planTaskList(state.docs).length) return false;
  try{ return last.fingerprint !== planFingerprint(state.docs); }catch(e){ return false; }
}

export function connectPanel(){
  const c = state.connect, conn = connectConn(), a = AGENT_ADAPTERS[conn];
  const h = [];
  h.push("<h2>0. Connect — sambungkan rencana ini ke aplikasimu</h2>");
  h.push("<p class='hint'>Pilih aplikasi → klik Connect → pilih folder proyekmu. PlanForge menulis rencana, mesin, dan konfigurasi MCP"
    + " langsung ke situ. File konfigurasi tertulis BELUM membuktikan MCP terbaca atau terhubung.</p>");
  h.push("<p class='hint'>Connect tidak otomatis memulai agen atau memilih model. Model eksekusi dipilih di aplikasi agen, bukan lewat API key planning.</p>");
  h.push("<div class='row'><div><label>Aplikasi yang kamu pakai</label><select data-p='conn'>"
    + Object.keys(AGENT_ADAPTERS).map(k=>"<option value='" + k + "'" + (k === conn ? " selected" : "") + ">" + esc(AGENT_ADAPTERS[k].label) + "</option>").join("")
    + "</select></div>"
    + "<div style='flex:0 0 auto'><label>&nbsp;</label><button class='sm go' data-act='gConnect'>Connect ke folder proyek</button></div></div>");
  if(!c){ h.push("<p class='hint'>" + esc(a.hint) + "</p>"); return h.join("\n"); }

  if(c.tahap === "path"){
    h.push("<p class='ok'>Folder dipilih: <b>" + esc(c.nama) + "</b></p>");
    h.push("<label>Path lengkap folder itu</label>");
    h.push("<input type='text' data-c='path' value='" + esc(c.path) + "' placeholder='D:/PROJECTS/nama-proyek'>");
    h.push("<p class='hint'>Browser cuma memberi nama foldernya, bukan path-nya — jadi ini perlu kamu tulis sekali."
      + " Path lengkap dipakai supaya " + esc(a.label) + " selalu menemukan <code>worker.mjs</code>, di mana pun dia menjalankannya.</p>");
    if(c.error) h.push("<p class='warn'>" + esc(c.error) + "</p>");
    h.push("<div class='bar'><button class='sm go' data-act='cCek'>Lanjut — lihat dulu yang akan ditulis</button>"
      + "<button class='sm' data-act='cBatal'>Batal</button></div>");
    return h.join("\n");
  }
  if(c.tahap === "menulis"){ h.push("<p class='hint'>Menulis ke " + esc(c.path) + "…</p>"); return h.join("\n"); }

  if(c.tahap === "konfirmasi"){
    h.push("<p class='ok'>Tujuan: <code>" + esc(c.path) + "</code> · aplikasi: <b>" + esc(a.label) + "</b></p>");
    h.push("<pre>" + esc(c.rencana.map(r=>(r.aksi === "baru" ? "BARU    " : r.aksi === "timpa" ? "TIMPA   " : r.aksi === "gabung" ? "GABUNG  " : "LEWATI  ")
      + r.name + "\n         " + r.alasan).join("\n")) + "</pre>");
    h.push("<p class='hint'>Tidak ada file yang dihapus. Progress task dan gerbang yang sudah kamu sunting dilewati;"
      + " konfigurasi MCP yang sudah ada digabung, server lain tetap utuh.</p>");
    if(!state.workerSource) h.push("<p class='warn'>worker.mjs tidak ikut tertulis — salinan yang ditanam di index.html kosong."
      + " Jalankan <code>node worker.mjs embed</code> di folder PlanForge, lalu muat ulang halaman ini.</p>");
    h.push("<div class='bar'><button class='sm go' data-act='cTulis'>Ya, tulis sekarang</button>"
      + "<button class='sm' data-act='cBatal'>Batal</button></div>");
    return h.join("\n");
  }

  const label = { baru:"BARU", timpa:"DITIMPA", gabung:"DIGABUNG", lewati:"DILEWATI" };
  h.push("<pre>" + esc((c.hasil || []).map(x=>(label[x.aksi] || x.aksi) + "  " + x.name + "\n         " + x.alasan).join("\n")) + "</pre>");
  if(c.error) h.push("<p class='warn'>" + esc(c.error) + "</p>");
  else {
    h.push("<p class='ok'>File selesai diproses. Koneksi ke aplikasi BELUM terverifikasi.</p>");
    h.push("<p>Buka <b>" + esc(a.label) + "</b> di folder <code>" + esc(c.path) + "</code>, pilih model di aplikasi itu, lalu kirim:</p>");
    h.push("<pre>" + esc("Baca " + a.rules + ". " + connPrompt({ projectDir:c.path, workerPath:c.path + "/worker.mjs" })) + "</pre>");
    h.push("<div class='bar'><button class='sm go' data-act='cSalinPrompt'>Salin trigger prompt</button></div>");
    h.push("<p class='hint'>Connector lama tetap dipertahankan. Gunakan nama di prompt ini; jika tidak muncul, daftarkan blok MCP melalui pengaturan aplikasi. Restart saja tidak membetulkan target proyek yang salah.</p>");
  }
  h.push("<p class='hint'>" + esc(a.hint.replace("<nama-server>", connNama({ projectDir:c.path }))) + "</p>");
  /* Kelas B: aplikasi tidak membaca file proyek — blok yang sama harus didaftarkan sekali
     ke config global. Tampilkan path persis + langkah bernomor + blok siap salin, supaya
     pengguna tidak menebak-nebak. PlanForge tidak menulis file global tanpa diminta. */
  if(a.globalPath){
    h.push("<p><b>Registrasi global SEKALI</b> (aturan " + esc(a.label) + ", bukan PlanForge):</p>"
      + "<pre>" + esc("1. Buka file global: " + a.globalPath + "\n"
      + "2. Tempel blok di bawah ke dalam \"mcpServers\" — server lain yang sudah ada jangan dihapus.\n"
      + "3. Simpan file, tutup lalu buka lagi " + a.label + " sepenuhnya.\n"
      + "4. Kembali ke sini, salin trigger prompt di atas, tempel ke agen.") + "</pre>");
    h.push("<pre>" + esc(connConfigJson(conn, { workerPath: c.path + "/worker.mjs", projectDir: c.path })) + "</pre>");
    h.push("<div class='bar'><button class='sm' data-act='cSalinMcp'>Salin blok MCP global</button></div>");
  }
  if(!a.file) h.push("<p class='warn'>" + esc(a.label) + " tidak membaca konfigurasi MCP dari folder proyek — bloknya sudah ditulis sebagai"
    + " <code>.planforge/mcp-universal.json</code>. Salin isinya ke pengaturan MCP aplikasinya:</p>"
    + "<pre>" + esc(connConfigJson(conn, { workerPath: c.path + "/worker.mjs", projectDir: c.path })) + "</pre>");
  if(conn === "generic"){
    const u = connUniversal({ workerPath: c.path + "/worker.mjs", projectDir: c.path });
    h.push("<p><b>Jalur universal — app apa pun yang paham MCP</b></p>");
    h.push("<p class='hint'>App kamu belum punya adapter khusus. Yang penting: app itu menjalankan SATU perintah ini sebagai server MCP (stdio). Nama connector: <code>" + esc(u.nama) + "</code>.</p>");
    h.push("<pre>" + esc(u.perintah) + "</pre>");
    h.push("<div class='bar'><button class='sm' data-act='cSalinUniversal'>Salin perintah universal</button></div>");
    h.push("<p class='hint'>Bungkus JSON-nya beda per app. Pilih blok yang cocok dengan format MCP app kamu, tempel ke pengaturannya (server lain jangan dihapus), simpan, lalu tutup-buka lagi app-nya. Kalau format app kamu tidak ada di sini, yang wajib tetap sama: perintah di atas + nama connector.</p>");
    h.push("<p><b>Format mcpServers</b> — Claude / Cursor / WorkBuddy / Cline / Windsurf / kebanyakan app:</p><pre>" + esc(u.blok.mcpServers) + "</pre>");
    h.push("<p><b>Format servers</b> — VS Code:</p><pre>" + esc(u.blok.servers) + "</pre>");
    h.push("<p><b>Format mcp.servers</b> — opencode:</p><pre>" + esc(u.blok.mcp) + "</pre>");
  }
  h.push("<div class='bar'><button class='sm' data-act='gConnect'>Connect ke folder lain</button>"
    + "<button class='sm' data-act='cBatal'>Tutup</button></div>");
  return h.join("\n");
}

export function progresPanel(){
  const last = state.lastConnect;
  if(!last || !last.handle) return "";
  const h = [];
  h.push("<h2>Progres live — task yang sudah selesai di folder</h2>");
  h.push("<p class='hint'>Dibaca dari <code>.planforge/state.json</code> di <code>" + esc(last.path) + "</code> — progres yang ditulis worker, bukan tebakan. Klik Refresh sesudah agen bekerja.</p>");
  h.push("<div class='bar'><button class='sm go' data-act='cProgres'>↻ Refresh progres</button>"
    + "<span class='cost'>" + (state.progresAt ? "dibaca " + esc(String(state.progresAt).slice(11,19)) + " UTC" : "belum dibaca") + "</span></div>");
  if(state.progresError){ h.push("<p class='warn'>" + esc(state.progresError) + "</p>"); return h.join("\n"); }
  const p = state.progres;
  if(!p){ h.push("<p class='hint'>Klik <b>Refresh progres</b> untuk melihat task mana yang sudah selesai.</p>"); return h.join("\n"); }
  const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
  h.push("<p class='" + (p.total && p.done === p.total ? "ok" : "") + "'><b>" + p.done + " dari " + p.total + " task selesai (" + pct + "%).</b>"
    + (p.lastTask ? " Terakhir dikerjakan: <code>" + esc(p.lastTask) + "</code>." : "") + "</p>");
  h.push("<div style='background:var(--line);border-radius:6px;height:10px;overflow:hidden;margin:6px 0 10px'><div style='background:var(--acc);height:100%;width:" + pct + "%'></div></div>");
  const SYM = { selesai:["✓","var(--acc)"], gagal:["✗","var(--bad)"], terkendala:["⚠","var(--warn)"], sedang:["…","var(--acc2)"], "belum mulai":["○","var(--ink3)"] };
  const baris = p.rows.map(r=>{
    const s = SYM[r.status] || SYM["belum mulai"];
    let cat = "";
    if(r.status === "selesai" && r.finishedAt) cat = "  " + String(r.finishedAt).slice(11,19) + " UTC";
    else if((r.status === "gagal" || r.status === "terkendala") && r.note) cat = "  — " + String(r.note).slice(0,100);
    return "<span style='color:" + s[1] + "'>" + s[0] + " " + esc(r.id) + "  " + esc(String(r.title).slice(0,70)) + esc(cat) + "</span>";
  });
  h.push("<pre>" + (baris.join("\n") || "(belum ada task di rencana)") + "</pre>");
  return h.join("\n");
}
