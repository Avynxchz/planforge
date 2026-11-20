/* Uji Connect di browser sungguhan (Edge/Chrome headless, halaman dibuka lewat file://).
   Jendela pilih folder tidak bisa dijawab otomatis — itu sudah dibuktikan manual. Yang diuji di sini
   seluruh alur sesudah folder dipilih: baca file yang ada, putuskan gabung/lewati, tulis bersarang.
   Handle folder palsu dipakai supaya hasilnya bisa diperiksa tanpa kuota AI dan tanpa klik manusia. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cariBrowser, mcpServerName } from "../worker.mjs";
import { cleanupTempDirs, makeTempDir, sweepStaleTempDirs } from "./temp-dirs.mjs";

const INDEX = fileURLToPath(new URL("../index.html", import.meta.url));
const tidur = (ms)=>new Promise(r=>setTimeout(r, ms));
let pass = 0, fail = 0;
const t = (nama, fn)=>{ try{ fn(); pass++; console.log("  ok   " + nama); }catch(e){ fail++; console.log("  FAIL " + nama + "\n       " + e.message); } };

/* ditanam ke halaman: pohon folder di memori dengan bentuk API yang sama seperti aslinya */
const POHON = `
window.__pfPohon = function(isi){
  const akar = { _dir:true, anak:{}, nama:"proyek" };
  for(const p of Object.keys(isi||{})){
    const seg = p.split("/"); let n = akar;
    for(let i=0;i<seg.length-1;i++){ n.anak[seg[i]] = n.anak[seg[i]] || {_dir:true, anak:{}}; n = n.anak[seg[i]]; }
    n.anak[seg[seg.length-1]] = {_dir:false, teks:isi[p]};
  }
  return akar;
};
window.__pfBungkus = function(node){
  const hilang = ()=>{ const e = new Error("tidak ada"); e.name = "NotFoundError"; return e; };
  return {
    name: node.nama || "",
    async getDirectoryHandle(nama, opt){
      let a = node.anak[nama];
      if(!a){ if(opt && opt.create) a = node.anak[nama] = {_dir:true, anak:{}}; else throw hilang(); }
      if(!a._dir){ const e = new Error("bukan folder"); e.name = "TypeMismatchError"; throw e; }
      a.nama = nama; return window.__pfBungkus(a);
    },
    async getFileHandle(nama, opt){
      let a = node.anak[nama];
      if(!a){ if(opt && opt.create) a = node.anak[nama] = {_dir:false, teks:""}; else throw hilang(); }
      if(a._dir){ const e = new Error("bukan file"); e.name = "TypeMismatchError"; throw e; }
      a.nama = nama;
      return { name:nama,
        async getFile(){ return { async text(){ return a.teks; } }; },
        async createWritable(){ return { async write(x){ a.teks = String(x); }, async close(){} }; } };
    }
  };
};
window.__pfDump = function(node, depan){
  depan = depan || ""; const out = {};
  for(const k of Object.keys(node.anak)){
    const a = node.anak[k];
    if(a._dir) Object.assign(out, window.__pfDump(a, depan + k + "/"));
    else out[depan + k] = a.teks;
  }
  return out;
};
window.__pfSiapkan = function(agent, isi, pathProyek){
  state.pkgConn = agent;
  state.docs = JSON.parse(JSON.stringify(DEMO));
  state.issues = [];
  const pohon = window.__pfPohon(isi);
  state.connect = { handle: window.__pfBungkus(pohon), nama:"proyek", path:pathProyek,
    tahap:"path", rencana:null, hasil:null, error:null, __pohon:pohon };
  return true;
};
window.__pfJalankan = async function(){
  await connectCek();
  const rencana = (state.connect.rencana||[]).map(r=>({name:r.name, aksi:r.aksi}));
  const errorCek = state.connect.error;
  if(state.connect.tahap === "konfirmasi") await connectTulis();
  return { tahap: state.connect.tahap, error: state.connect.error || errorCek, rencana, hasil:state.connect.hasil,
    panel:document.getElementById("pf-connect").innerText,
    isi: window.__pfDump(state.connect.__pohon), workerSource: (state.workerSource||"").length };
};
`;

const bin = cariBrowser();
if(!bin){ console.log("browser tidak ditemukan — uji Connect dilewati"); process.exit(1); }
const tmp = makeTempDir("pf-browser-connect-");
const browser = spawn(bin, ["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",
  "--remote-debugging-port=0","--remote-allow-origins=*","--user-data-dir="+tmp,"about:blank"], { stdio:["ignore","pipe","pipe"] });
browser.stdout.on("data", ()=>{});
const errors = [];
let ws = null, kirim = null;

async function nilai(expr){
  const r = await kirim("Runtime.evaluate", { expression:expr, returnByValue:true, awaitPromise:true });
  if(r.exceptionDetails) throw new Error("halaman melempar: " + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
const jalankan = (agent, isi, p)=>nilai("(async()=>{ window.__pfSiapkan(" + JSON.stringify(agent) + "," + JSON.stringify(isi||{}) + "," + JSON.stringify(p) + "); return await window.__pfJalankan(); })()");

let kode = 1;
try{
  let buf = "";
  const port = await new Promise((res, rej)=>{
    const akhir = Date.now() + 20000;
    browser.stderr.on("data", (d)=>{ buf += d; const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if(m) res(m[1]); });
    const j = setInterval(()=>{ if(Date.now() > akhir){ clearInterval(j); rej(new Error("DevTools tidak muncul")); } }, 100);
  });
  const target = await (await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", { method:"PUT", signal:AbortSignal.timeout(8000) })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej)=>{ ws.onopen = res; ws.onerror = ()=>rej(new Error("WebSocket ditolak")); });
  let id = 0; const tunggu = new Map();
  ws.addEventListener("message", (ev)=>{
    let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
    if(m.id != null && tunggu.has(m.id)){
      const { res, rej } = tunggu.get(m.id); tunggu.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
    else if(m.method === "Runtime.exceptionThrown") errors.push("exception: " + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    else if(m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console: " + (m.params.args||[]).map(a=>a.value||a.description||"").join(" ").slice(0, 300));
    else if(m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("log: " + m.params.entry.text.slice(0, 200));
  });
  kirim = (method, params)=>new Promise((res, rej)=>{
    const n = ++id;
    const timer = setTimeout(()=>{ if(tunggu.has(n)){ tunggu.delete(n); rej(new Error("CDP diam: " + method)); } }, 30000);
    tunggu.set(n, { res:(v)=>{ clearTimeout(timer); res(v); }, rej:(e)=>{ clearTimeout(timer); rej(e); } });
    ws.send(JSON.stringify({ id:n, method, params:params||{} }));
  });
  await kirim("Page.enable"); await kirim("Runtime.enable"); await kirim("Log.enable");
  await kirim("Page.navigate", { url: pathToFileURL(INDEX).href });
  const akhir = Date.now() + 25000; let siap = false;
  while(Date.now() < akhir){
    const v = await nilai("({s:document.readyState,h:location.href})");
    if(v.s === "complete" && v.h !== "about:blank"){ siap = true; break; }
    await tidur(200);
  }
  assert.ok(siap, "index.html tidak selesai dimuat");
  await nilai(POHON);
  await nilai("ensureWorkerSource()");

  console.log("\n1) Connect ke folder kosong");
  const claude = await jalankan("claude", {}, "D:/PROJECTS/uji-claude");
  t("Claude Code: 6 file tertulis, termasuk CLAUDE.md dan .mcp.json", ()=>{
    assert.equal(claude.tahap, "selesai", JSON.stringify(claude.error));
    assert.equal(claude.hasil.length, 6);
    for(const n of ["worker.mjs","CLAUDE.md",".mcp.json",".planforge/plan.json",".planforge/gates.json",".planforge/state.json"])
      assert.ok(Object.keys(claude.isi).includes(n), "tidak tertulis: " + n);
    assert.ok(!Object.keys(claude.isi).includes("AGENTS.md"), "Claude Code tidak membaca AGENTS.md");
  });
  t("worker.mjs yang tertulis utuh, sama dengan yang ditanam di halaman", ()=>{
    assert.equal(claude.isi["worker.mjs"].length, claude.workerSource);
    assert.ok(claude.workerSource > 100000, "worker sumber kosong — embed belum dijalankan");
    assert.equal(claude.isi["worker.mjs"], fs.readFileSync(new URL("../worker.mjs", import.meta.url), "utf8"));
    const copied = path.join(tmp, "worker.mjs");
    fs.writeFileSync(copied, claude.isi["worker.mjs"]);
    const exported = spawnSync(process.execPath, ["--input-type=module", "-e",
      `const w = await import(${JSON.stringify(pathToFileURL(copied).href)});
       if(typeof w.main !== "function" || w.main.length !== 1) throw Error("main export changed");
       process.stdout.write("standalone-main-ok");`
    ], {cwd:tmp, encoding:"utf8", timeout:10000});
    assert.ifError(exported.error);
    assert.equal(exported.status, 0, exported.stderr || exported.stdout);
    assert.equal(exported.stdout, "standalone-main-ok");
    assert.equal(exported.stderr, "");
  });
  t("konfigurasi MCP menunjuk path absolut worker di folder itu", ()=>{
    const j = JSON.parse(claude.isi[".mcp.json"]);
    assert.deepEqual(j.mcpServers[mcpServerName("D:/PROJECTS/uji-claude")].args, ["D:/PROJECTS/uji-claude/worker.mjs","mcp","--dir","D:/PROJECTS/uji-claude"]);
  });
  t("tampilan membedakan file tersimpan dari koneksi terverifikasi dan pemilihan model", ()=>{
    assert.match(claude.panel, /Koneksi ke aplikasi BELUM terverifikasi/);
    assert.match(claude.panel, /Connect tidak otomatis memulai agen atau memilih model/);
    assert.match(claude.panel, /panggil plan_status/);
    assert.ok(claude.panel.includes(mcpServerName("D:/PROJECTS/uji-claude")));
    assert.match(claude.panel, /STOP kalau berbeda/);
  });
  const runnerText = await nilai("(()=>{const el=document.createElement('div');el.innerHTML=renderRunner();return el.textContent;})()");
  t("petunjuk runner tidak menjamin gratis atau menebak folder dan model eksekusi", ()=>{
    assert.match(runnerText, /bukan jaminan gratis/);
    assert.match(runnerText, /laporan \$0 belum tentu mencerminkan tagihan provider/);
    assert.match(runnerText, /folder kerja proses terlebih dahulu/);
    assert.match(runnerText, /cocokkan folder lewat plan_status/);
    assert.match(runnerText, /API model saja tidak menjalankan file atau terminal/);
    assert.match(runnerText, /diatur terpisah dari planning PlanForge/);
    assert.doesNotMatch(runnerText, /tetap jalan dari cwd mana pun/);
  });

  console.log("\n2) Connect ke folder yang sudah berisi pekerjaan orang");
  const legacy = { command:"node", args:["D:/PROJECTS/trade-news/worker.mjs", "mcp", "--dir", "D:/PROJECTS/trade-news"] };
  const lamaCfg = JSON.stringify({ mcpServers:{ github:{ command:"npx", args:["-y","github-mcp"] }, planforge:legacy } }, null, 2);
  const agy = await jalankan("agy", {
    ".agents/mcp_config.json": lamaCfg,
    ".planforge/state.json": '{"doneTasks":7,"tasks":{"T-001":{"status":"selesai"}}}',
    ".planforge/gates.json": '{"limits":{"maxCalls":123}}',
    "AGENTS.md": "# Aturan lama\njangan hapus aku"
  }, "D:/PROJECTS/uji-agy");
  t("Antigravity: connector proyek baru ditambahkan tanpa menimpa connector lama", ()=>{
    const j = JSON.parse(agy.isi[".agents/mcp_config.json"]);
    assert.deepEqual(j.mcpServers.github, { command:"npx", args:["-y","github-mcp"] });
    assert.deepEqual(j.mcpServers.planforge, legacy);
    assert.ok(j.mcpServers[mcpServerName("D:/PROJECTS/uji-agy")], "connector proyek ini tidak masuk");
  });
  t("progress task dan gerbang yang sudah disunting TIDAK direset", ()=>{
    assert.equal(agy.isi[".planforge/state.json"], '{"doneTasks":7,"tasks":{"T-001":{"status":"selesai"}}}');
    assert.equal(agy.isi[".planforge/gates.json"], '{"limits":{"maxCalls":123}}');
    assert.ok(agy.hasil.find(x=>x.name === ".planforge/state.json" && x.aksi === "lewati"));
  });
  t("AGENTS.md yang sudah ada ditambah di akhir, isi lama tetap di depan", ()=>{
    assert.ok(agy.isi["AGENTS.md"].startsWith("# Aturan lama\njangan hapus aku"));
    assert.ok(agy.isi["AGENTS.md"].includes("PlanForge"));
  });

  console.log("\n3) Bentuk konfigurasi tiap aplikasi berbeda");
  const vscode = await jalankan("vscode", {}, "D:/PROJECTS/uji-vscode");
  t("VS Code memakai blok servers + type stdio, bukan mcpServers", ()=>{
    const j = JSON.parse(vscode.isi[".vscode/mcp.json"]);
    assert.ok(j.servers && j.servers[mcpServerName("D:/PROJECTS/uji-vscode")], "blok servers tidak ada");
    assert.equal(j.servers[mcpServerName("D:/PROJECTS/uji-vscode")].type, "stdio");
    assert.equal(j.servers[mcpServerName("D:/PROJECTS/uji-vscode")].cwd, "${workspaceFolder}");
    assert.ok(!j.mcpServers);
    assert.ok(Object.keys(vscode.isi).includes(".github/copilot-instructions.md"));
  });
  const qoder = await jalankan("qoder", {}, "D:/PROJECTS/uji-qoder");
  t("Qoder (tanpa file proyek) tetap dapat blok MCP sebagai file buat disalin", ()=>{
    assert.ok(Object.keys(qoder.isi).includes(".planforge/mcp-universal.json"));
    const j = JSON.parse(qoder.isi[".planforge/mcp-universal.json"]);
    assert.ok(j.mcpServers[mcpServerName("D:/PROJECTS/uji-qoder")]);
  });
  const cursor = await jalankan("cursor", {}, "D:/PROJECTS/uji-cursor");
  t("Cursor memakai .cursor/mcp.json dan .cursorrules", ()=>{
    assert.ok(Object.keys(cursor.isi).includes(".cursor/mcp.json"));
    assert.ok(Object.keys(cursor.isi).includes(".cursorrules"));
  });
  const opencode = await jalankan("opencode", {}, "D:/PROJECTS/uji-opencode");
  t("opencode memakai opencode.json proyek dengan dialect mcp.servers (type local, command array)", ()=>{
    assert.ok(Object.keys(opencode.isi).includes("opencode.json"), "opencode.json proyek tidak ditulis");
    const j = JSON.parse(opencode.isi["opencode.json"]);
    const nama = mcpServerName("D:/PROJECTS/uji-opencode");
    assert.ok(j.mcp && j.mcp.servers && j.mcp.servers[nama], "blok mcp.servers tidak ada");
    assert.ok(!j.mcpServers, "opencode tidak boleh pakai mcpServers");
    assert.equal(j.mcp.servers[nama].type, "local");
    assert.equal(j.mcp.servers[nama].command[0], "node");
    assert.ok(Object.keys(opencode.isi).includes("AGENTS.md"));
  });
  const opencodeLama = await jalankan("opencode", { "opencode.json":JSON.stringify({ mcp:{ servers:{ lain:{ type:"local", command:["x"] } } } }) }, "D:/PROJECTS/uji-opencode-lama");
  t("opencode.json yang sudah ada digabung, server lain tidak hilang", ()=>{
    const j = JSON.parse(opencodeLama.isi["opencode.json"]);
    assert.ok(j.mcp.servers.lain, "server lain hilang");
    assert.ok(j.mcp.servers[mcpServerName("D:/PROJECTS/uji-opencode-lama")], "connector baru tidak masuk");
    assert.ok(opencodeLama.hasil.find(x=>x.name === "opencode.json" && x.aksi === "gabung"));
  });

  console.log("\n4) Penjaga");
  const pendek = await jalankan("claude", {}, "uji-claude");
  t("path tanpa drive ditolak sebelum menulis apa pun", ()=>{
    assert.equal(pendek.tahap, "path");
    assert.match(pendek.error || "", /Path harus lengkap/);
    assert.deepEqual(pendek.isi, {}, "tidak boleh ada file tertulis");
  });
  const rusak = await jalankan("claude", { ".mcp.json":"ini bukan json {{{" }, "D:/PROJECTS/uji-rusak");
  t("konfigurasi rusak dilewati, isinya tidak dihancurkan", ()=>{
    assert.equal(rusak.isi[".mcp.json"], "ini bukan json {{{");
    assert.ok(rusak.hasil.find(x=>x.name === ".mcp.json" && x.aksi === "lewati"));
  });
  const ulang = await jalankan("claude", { "CLAUDE.md":"# PlanForge sudah pernah dipasang" }, "D:/PROJECTS/uji-ulang");
  t("connect kedua ke folder yang sama tidak menumpuk aturan dua kali", ()=>{
    assert.equal(ulang.isi["CLAUDE.md"], "# PlanForge sudah pernah dipasang");
  });
  const sameA = await jalankan("workbuddy", {}, "D:/A/app");
  const sameB = await jalankan("workbuddy", {}, "D:/B/app");
  t("dua folder bernama sama menghasilkan connector yang berbeda", ()=>{
    const a = Object.keys(JSON.parse(sameA.isi[".mcp.json"]).mcpServers);
    const b = Object.keys(JSON.parse(sameB.isi[".mcp.json"]).mcpServers);
    assert.deepEqual(a, [mcpServerName("D:/A/app")]);
    assert.deepEqual(b, [mcpServerName("D:/B/app")]);
    assert.notEqual(a[0], b[0]);
    assert.ok(sameA.panel.includes(a[0]));
    assert.ok(sameB.panel.includes(b[0]));
  });
  const reconnect = await jalankan("workbuddy", sameA.isi, "D:/A/app");
  t("Connect ulang memakai nama yang sama dan tetap meminta verifikasi identitas", ()=>{
    assert.deepEqual(JSON.parse(reconnect.isi[".mcp.json"]), JSON.parse(sameA.isi[".mcp.json"]));
    assert.match(reconnect.panel, /panggil plan_status/);
    assert.match(reconnect.panel, /BELUM terverifikasi/);
  });
  t("tidak ada error console selama seluruh alur", ()=>{
    assert.deepEqual(errors, []);
  });
  kode = fail ? 1 : 0;
}catch(e){
  console.log("GAGAL menjalankan uji: " + (e && e.stack || e));
  fail++;
}finally{
  try{ if(ws) ws.close(); }catch(e){}
  try{ spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], { encoding:"utf8", timeout:10000 }); }catch(e){}
  await tidur(600);
  try{ cleanupTempDirs(); }
  finally{ sweepStaleTempDirs(); }
}
console.log("\n" + pass + " lulus, " + fail + " gagal\n");
process.exit(kode || (fail ? 1 : 0));