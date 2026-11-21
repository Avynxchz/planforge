import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as W from "../worker.mjs";
import { cleanupTempDirs, cleanupTempDirsSince, makeTempDir, tempDirCheckpoint, sweepStaleTempDirs } from "./temp-dirs.mjs";

/* Uji penegak perilaku: browser sungguhan (Edge/Chrome headless lewat CDP), bukan tiruan.
   Fixture-nya meniru tiga bug yang lolos di pilot: canvas kosong, judul basi sesudah klik,
   dan library yang tidak pernah dimuat. */

const NODE = process.execPath;
const WORKER = fileURLToPath(new URL("../worker.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));
const BIN = W.cariBrowser();

let pass = 0, fail = 0;
const antrian = [];
const t = (name, fn)=> antrian.push({ name, fn });
const judul = (s)=> antrian.push({ judul: s });

const RADIOS = '<input type="radio" name="w" value="15"><input type="radio" name="w" value="30" checked><input type="radio" name="w" value="60">';
const GAMBAR = "function gambar(){var x=document.getElementById('grafik').getContext('2d');x.fillStyle='#3a7';x.fillRect(10,10,120,80);}";

function halaman(opts){
  const o = opts || {};
  return '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Event Detail — Window 30 menit</title></head><body>'
    + '<h1 id="judul">Window 30 menit</h1><p id="catatan">Menampilkan statistik window 30 menit.</p>'
    + '<canvas id="grafik" width="300" height="150"></canvas>' + RADIOS
    + (o.lebar ? '<div style="width:2000px;height:20px">lebar sekali</div>' : "")
    + (o.skripHilang ? '<script src="tidak-ada.js"></script>' : "")
    + "<script>" + GAMBAR
    + (o.gambarAwal ? "gambar();" : "")
    + (o.error ? "new Chart(document.getElementById('grafik'),{type:'doughnut'});" : "")
    + "document.querySelectorAll('input[name=w]').forEach(function(r){r.addEventListener('change',function(){"
    + "fetch('/api?window='+r.value).then(function(){"
    + "document.getElementById('catatan').textContent='Menampilkan statistik window '+r.value+' menit.';"
    + (o.judulIkut ? "document.getElementById('judul').textContent='Window '+r.value+' menit';document.title='Event Detail — Window '+r.value+' menit';" : "")
    + (o.gambarKlik ? "gambar();" : "")
    + (o.urlIkut ? "history.replaceState({},'','?window='+r.value);" : "")
    + "});});});</script></body></html>";
}

function fixture(){
  const dir = makeTempDir("planforge-browser-");
  fs.writeFileSync(path.join(dir, "baik.html"), halaman({ gambarAwal:true, judulIkut:true, gambarKlik:true }));
  fs.writeFileSync(path.join(dir, "kosong.html"), halaman({ judulIkut:true }));
  fs.writeFileSync(path.join(dir, "basi.html"), halaman({ gambarAwal:true, gambarKlik:true }));
  fs.writeFileSync(path.join(dir, "error.html"), halaman({ gambarAwal:true, judulIkut:true, error:true }));
  fs.writeFileSync(path.join(dir, "lebar.html"), halaman({ gambarAwal:true, judulIkut:true, lebar:true }));
  fs.writeFileSync(path.join(dir, "url.html"), halaman({ gambarAwal:true, judulIkut:true, gambarKlik:true, urlIkut:true }));
  fs.writeFileSync(path.join(dir, "skrip-hilang.html"), halaman({ gambarAwal:true, judulIkut:true, skripHilang:true }));
  return dir;
}

/* port kosong dipilih OS supaya uji tidak rebutan dengan aplikasi user */
async function serve(dir){
  const srv = http.createServer((req, res)=>{
    const u = new URL(req.url, "http://x");
    if(u.pathname === "/api"){ res.writeHead(200, { "content-type":"application/json" }); res.end(JSON.stringify({ window:Number(u.searchParams.get("window")) || 15 })); return; }
    if(u.pathname === "/gantung"){ res.writeHead(200, { "content-type":"text/html; charset=utf-8" }); res.write("<!doctype html><title>tidak pernah selesai"); return; }
    if(u.pathname === "/lambat"){ setTimeout(()=>{ res.writeHead(200, { "content-type":"text/html; charset=utf-8" }); res.end(fs.readFileSync(path.join(dir, "error.html"))); }, 1500); return; }
    const f = path.join(dir, u.pathname.replace(/^\/+/, "") || "baik.html");
    if(!f.startsWith(dir) || !fs.existsSync(f)){ res.writeHead(404); res.end("tidak ada"); return; }
    res.writeHead(200, { "content-type":"text/html; charset=utf-8" }); res.end(fs.readFileSync(f));
  });
  await new Promise((res, rej)=>{ srv.once("error", rej); srv.listen(0, "127.0.0.1", res); });
  return { srv, url: "http://127.0.0.1:" + srv.address().port };
}

/* spawnSync membekukan event loop proses ini, jadi server fixture harus di proses lain
   kalau yang diuji adalah runBehavior yang sinkron */
const SKRIP_SERVER = 'import fs from "node:fs";import path from "node:path";import http from "node:http";\n'
  + 'const dir=process.argv[2];\n'
  + 'const srv=http.createServer((req,res)=>{const u=new URL(req.url,"http://x");\n'
  + 'if(u.pathname==="/api"){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({window:Number(u.searchParams.get("window"))||15}));return;}\n'
  + 'const f=path.join(dir,u.pathname.replace(/^\\/+/, "")||"baik.html");\n'
  + 'if(!f.startsWith(dir)||!fs.existsSync(f)){res.writeHead(404);res.end("tidak ada");return;}\n'
  + 'res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(fs.readFileSync(f));});\n'
  + 'srv.listen(0,"127.0.0.1",()=>{console.log("PORT="+srv.address().port);});\n';

async function serveLuar(dir){
  const skrip = path.join(dir, "server-luar.mjs");
  fs.writeFileSync(skrip, SKRIP_SERVER);
  const p = spawn(NODE, [skrip, dir], { stdio:["ignore", "pipe", "pipe"] });
  const port = await new Promise((res, rej)=>{
    let buf = "";
    const timer = setTimeout(()=>rej(new Error("server luar tidak hidup dalam 15s")), 15000);
    p.stdout.on("data", (d)=>{ buf += d; const m = buf.match(/PORT=(\d+)/); if(m){ clearTimeout(timer); res(m[1]); } });
    p.on("exit", (c)=>{ clearTimeout(timer); rej(new Error("server luar keluar sendiri (code " + c + ")")); });
  });
  return { url: "http://127.0.0.1:" + port, tutup: ()=>{ try{ p.kill(); }catch(e){} } };
}

/* async: kalau pakai spawnSync, server fixture di proses ini tidak bisa menjawab browser */
function ukur(spec, cwd){
  return new Promise((res, rej)=>{
    const p = spawn(NODE, [WORKER, "__browser"], { cwd: cwd || process.cwd(), stdio:["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(()=>{ try{ p.kill(); }catch(e){} rej(new Error("pengukur tidak selesai dalam 150s")); }, 150000);
    p.stdout.on("data", (d)=>{ out += d; });
    p.stderr.on("data", (d)=>{ err += d; });
    p.on("error", (e)=>{ clearTimeout(timer); rej(e); });
    p.on("exit", ()=>{
      clearTimeout(timer);
      let j = null; try{ j = JSON.parse(out.slice(out.indexOf("{"))); }catch(e){}
      if(!j) return rej(new Error("pengukur tidak mengembalikan JSON: " + out.slice(0,300) + " | stderr " + err.slice(0,300)));
      res(j);
    });
    p.stdin.end(JSON.stringify({ spec, cwd: cwd || process.cwd() }));
  });
}
const spec = (url, checks, extra)=> Object.assign({ url, checks, settleMs: 500, timeoutSec: 60 }, extra || {});
const alasan = (j)=> (j.kurang || []).join(" | ");

async function daftar(){
  judul("\n1) spec behavior: divalidasi sebelum browser dinyalakan");

  t("task UI tanpa behavior = plan rusak, bukan sesuatu yang bisa diperbaiki agen", ()=>{
    const r = W.runBehavior({ gates:{} }, process.cwd(), { id:"T-001", title:"Buat grafik distribusi", files_or_areas:["static/js/chart.js","templates/detail.html"], acceptance_criteria:["grafik tampil"] });
    assert.equal(r.ok, false); assert.equal(r.planRusak, true);
    assert.match(alasan(r), /tidak punya `behavior`/);
  });
  t("task backend tanpa behavior dilewati — bukan UI, tidak perlu browser", ()=>{
    const r = W.runBehavior({ gates:{} }, process.cwd(), { id:"T-002", title:"Buat skrip impor CSV", files_or_areas:["scripts/import_data.py"], acceptance_criteria:["exit code 0"] });
    assert.equal(r.ok, true); assert.equal(r.dilewati, true);
  });
  t("kata tombol di kriteria backend tidak menghentikan worker sebagai UI", ()=>{
    const r = W.runBehavior({ gates:{} }, process.cwd(), { id:"T-003", title:"Perbarui data tombol aktif",
      files_or_areas:["src/utils.js"], acceptance_criteria:["API mengembalikan status tombol"] });
    assert.equal(r.ok, true); assert.equal(r.dilewati, true);
    assert.equal(r.planRusak, undefined);
  });
  t("type check asing ditolak dengan daftar yang dikenal", ()=>{
    const bad = W.masalahBehavior({ behavior:{ url:"http://x/", checks:[{ type:"screenshot" }] } });
    assert.equal(bad.length, 1); assert.match(bad[0], /tidak dikenal/); assert.match(bad[0], /canvasNotBlank/);
  });
  t("check tanpa selector / tanpa pembanding ditolak", ()=>{
    const bad = W.masalahBehavior({ behavior:{ url:"http://x/", checks:[{ type:"text" }, { type:"count", selector:"input" }, { type:"click" }, { type:"url" }] } });
    assert.equal(bad.length, 5, JSON.stringify(bad));
    assert.match(bad.join(" "), /butuh selector/);
    assert.match(bad.join(" "), /butuh contains\/matches\/equals/);
    assert.match(bad.join(" "), /\(url\) butuh contains\/matches\/equals/);
  });
  t("url bukan http ditolak — kalimat tidak bisa dibuka browser", ()=>{
    const bad = W.masalahBehavior({ behavior:{ url:"buka halaman detail lalu lihat", checks:[{ type:"noConsoleError" }] } });
    assert.match(bad.join(" "), /behavior\.url harus alamat http/);
  });
  t("checks kosong bukan bukti", ()=>{
    assert.match(W.masalahBehavior({ behavior:{ url:"http://x/", checks:[] } }).join(" "), /checks kosong/);
  });
  t("taskUi membaca file dan kata kunci, bukan menebak dari judul saja", ()=>{
    assert.equal(W.taskUi({ files_or_areas:["templates/index.html"] }), true);
    assert.equal(W.taskUi({ files_or_areas:["static/css/style.css"] }), true);
    assert.equal(W.taskUi({ acceptance_criteria:["Given viewport 360px, Then tabel terbaca"] }), true);
    assert.equal(W.taskUi({ files_or_areas:["scripts/compute_stats.py"], acceptance_criteria:["sample_count terisi"] }), false);
  });

  if(!BIN){
    judul("\n  (browser tidak ditemukan di mesin ini — uji pengukuran dilewati)");
    t("cariBrowser mengembalikan null kalau memang tidak ada, bukan path karangan", ()=>{ assert.equal(BIN, null); });
    return null;
  }

  judul("\n2) pengukuran di browser sungguhan: " + BIN);
  const dir = fixture();
  const { srv, url } = await serve(dir);

  t("canvas yang tidak menggambar apa pun = GAGAL, dengan angka pixel", async ()=>{
    const j = await ukur(spec(url + "/kosong.html", [{ type:"canvasNotBlank", selector:"#grafik" }]));
    assert.equal(j.ok, false, alasan(j));
    assert.match(alasan(j), /0 pixel terisi dari 45000/);
    assert.equal(j.hasil[0].ukur.pixel, 0);
  });
  t("canvas yang benar-benar terisi = lulus, angkanya tercatat", async ()=>{
    const j = await ukur(spec(url + "/baik.html", [{ type:"canvasNotBlank", selector:"#grafik", minPixels: 500 }]));
    assert.equal(j.ok, true, alasan(j));
    assert.ok(j.hasil[0].ukur.pixel >= 500, JSON.stringify(j.hasil[0]));
  });
  t("judul basi sesudah klik = GAGAL (kelas bug T-016)", async ()=>{
    const j = await ukur(spec(url + "/basi.html", [
      { type:"text", selector:"#judul", contains:"30" },
      { type:"click", selector:"input[value='60']" },
      { type:"text", selector:"#judul", contains:"60" }
    ]));
    assert.equal(j.ok, false, "judul basi harus ketahuan");
    assert.match(alasan(j), /tidak memuat "60"/);
  });
  t("judul ikut window sesudah klik = lulus, tanpa reload", async ()=>{
    const j = await ukur(spec(url + "/baik.html", [
      { type:"click", selector:"input[value='60']" },
      { type:"text", selector:"#judul", contains:"60" },
      { type:"text", selector:"title", contains:"60" },
      { type:"request", urlContains:"/api?window=60" }
    ]));
    assert.equal(j.ok, true, alasan(j));
    assert.ok(j.requests >= 2, "fetch harus tercatat: " + j.requests);
  });
  t("fetch yang tidak pernah jalan = GAGAL", async ()=>{
    const j = await ukur(spec(url + "/baik.html", [{ type:"request", urlContains:"/api?window=60" }]));
    assert.equal(j.ok, false); assert.match(alasan(j), /fetch-nya tidak pernah jalan/);
  });
  t("alamat halaman ikut berubah sesudah klik = lulus (replaceState terukur)", async ()=>{
    const j = await ukur(spec(url + "/url.html", [
      { type:"click", selector:"input[value='60']" },
      { type:"url", contains:"window=60" }
    ]));
    assert.equal(j.ok, true, alasan(j));
    assert.match(j.hasil[1].ukur.href, /window=60/);
  });
  t("isi berubah tapi alamat tidak = GAGAL lewat url", async ()=>{
    const j = await ukur(spec(url + "/baik.html", [
      { type:"click", selector:"input[value='60']" },
      { type:"text", selector:"#judul", contains:"60" },
      { type:"url", contains:"window=60" }
    ]));
    assert.equal(j.ok, false, "judul ikut tapi URL basi harus tetap ketahuan");
    assert.match(alasan(j), /URL tidak diperbarui/);
  });
  t("library hilang yang melempar error = GAGAL lewat noConsoleError", async ()=>{
    const j = await ukur(spec(url + "/error.html", [{ type:"noConsoleError" }]));
    assert.equal(j.ok, false, "ReferenceError harus ketahuan");
    assert.match(alasan(j), /error console/);
    assert.ok(j.console.length >= 1);
  });
  t("halaman bersih tetap lulus noConsoleError walau browser minta favicon sendiri", async ()=>{
    const j = await ukur(spec(url + "/baik.html", [{ type:"noConsoleError" }]));
    assert.equal(j.ok, true, "404 favicon bukan error kode aplikasi — kalau dihitung, setiap task situs statis ditolak selamanya: " + alasan(j));
    assert.equal(j.console.length, 0, JSON.stringify(j.console));
  });
  t("resource aplikasi yang hilang tetap dihitung error, bukan ikut dimaafkan", async ()=>{
    const j = await ukur(spec(url + "/skrip-hilang.html", [{ type:"noConsoleError" }]));
    assert.equal(j.ok, false, "skrip yang benar-benar dipakai halaman harus tetap ketahuan");
    assert.match(alasan(j), /tidak-ada\.js/);
  });
  t("halaman lambat tidak boleh diukur sebelum selesai dimuat (regresi hijau palsu)", async ()=>{
    const j = await ukur(spec(url + "/lambat", [{ type:"noConsoleError" }], { settleMs: 200 }));
    assert.equal(j.ok, false, "about:blank ikut kirim frameStoppedLoading — kalau itu dipercaya, halaman error dianggap hijau");
    assert.match(alasan(j), /error console/);
  });
  t("overflow horizontal di viewport 360px = GAGAL", async ()=>{
    const j = await ukur(spec(url + "/lebar.html", [{ type:"noHorizontalOverflow" }], { viewport:{ width:360, height:760 } }));
    assert.equal(j.ok, false); assert.match(alasan(j), /overflow horizontal/);
  });
  t("viewport 360px dipakai untuk halaman yang sama = lulus", async ()=>{
    const j = await ukur(spec(url + "/baik.html", [{ type:"noHorizontalOverflow" }, { type:"count", selector:"input[type=radio]", equals:3 }], { viewport:{ width:360, height:760 } }));
    assert.equal(j.ok, true, alasan(j));
  });
  t("selector yang tidak ada = GAGAL, bukan dianggap lolos", async ()=>{
    const j = await ukur(spec(url + "/baik.html", [{ type:"text", selector:"#tidak-ada", contains:"x" }]));
    assert.equal(j.ok, false); assert.match(alasan(j), /tidak ada di halaman/);
  });
  t("elemen terlihat dan jumlah radio terukur", async ()=>{
    const j = await ukur(spec(url + "/baik.html", [{ type:"visible", selector:"#grafik" }, { type:"count", selector:"input", min:3 }]));
    assert.equal(j.ok, true, alasan(j));
  });
  t("halaman yang tidak pernah selesai dimuat = GAGAL, bukan menggantung selamanya", async ()=>{
    const j = await ukur(spec(url + "/gantung", [{ type:"noConsoleError" }], { timeoutSec: 40 }));
    assert.equal(j.ok, false); assert.match(alasan(j), /pengukuran perilaku gagal/);
  });
  t("server yang diminta tapi tidak pernah hidup = GAGAL dengan alasan jelas", async ()=>{
    const j = await ukur(spec("http://127.0.0.1:9/api", [{ type:"noConsoleError" }],
      { server:{ cmd:'"' + NODE + '" -e "process.exit(0)"', ready:"http://127.0.0.1:9/api", timeoutSec:3 }, timeoutSec:30 }));
    assert.equal(j.ok, false); assert.match(alasan(j), /tidak menjawab/);
  });
  t("server yang KITA start dibunuh lagi sesudah mengukur", async ()=>{
    const port = 8791;
    const skrip = path.join(dir, "server-uji.mjs");
    fs.writeFileSync(skrip, 'import http from "node:http";http.createServer((q,s)=>{s.writeHead(200,{"content-type":"text/html; charset=utf-8"});s.end("<canvas id=grafik width=10 height=10></canvas>")}).listen(' + port + ',"127.0.0.1");');
    const j = await ukur(spec("http://127.0.0.1:" + port + "/", [{ type:"count", selector:"canvas", equals:1 }],
      { server:{ cmd:'"' + NODE + '" "' + skrip + '"', ready:"http://127.0.0.1:" + port + "/", timeoutSec:15 } }));
    assert.equal(j.ok, true, alasan(j));
    const cek = spawnSync(NODE, ["-e", "fetch('http://127.0.0.1:" + port + "/',{signal:AbortSignal.timeout(1500)}).then(()=>process.exit(0),()=>process.exit(1))"], { encoding:"utf8", timeout:15000 });
    assert.equal(cek.status, 1, "server yang worker start harus mati lagi — jangan tinggalkan proses liar");
  });
  t("runBehavior lewat jalur worker: angka masuk log, bukan klaim", async ()=>{
    const luar = await serveLuar(dir);
    const ctx = { gates:{}, state:{}, dir };
    const asli = console.log; console.log = ()=>{};
    let r, baik;
    try{
      r = W.runBehavior(ctx, dir, { id:"T-026", title:"grafik", files_or_areas:["static/js/chart.js"],
        behavior:{ url: luar.url + "/kosong.html", checks:[{ type:"canvasNotBlank", selector:"#grafik" }] } });
      baik = W.runBehavior(ctx, dir, { id:"T-026", title:"grafik", files_or_areas:["static/js/chart.js"],
        behavior:{ url: luar.url + "/baik.html", checks:[{ type:"canvasNotBlank", selector:"#grafik" }] } });
    } finally{ console.log = asli; luar.tutup(); }
    assert.equal(r.ok, false); assert.equal(r.jalan, true);
    assert.match(W.ringkasBehavior(r), /perilaku GAGAL/);
    assert.equal(baik.ok, true, alasan(baik));
    assert.match(W.ringkasBehavior(baik), /pixel/);
    const log = fs.readFileSync(path.join(dir, "RUN_LOG.md"), "utf8");
    assert.match(log, /perilaku GAGAL/, "log harus menyebut gagal: " + log.slice(-300));
    assert.match(log, /perilaku OK \(\d+s, 1 check/, "log harus menyebut jumlah check yang dijalankan: " + log.slice(-300));
  });

  judul("\n3) penegak perilaku di dalam loop worker: runOne tidak boleh mencap selesai tanpa bukti");
  const luar = await serveLuar(dir);
  const VERIF = '"' + NODE + '" -e "console.log(1)"';
  const tugas = (behavior, extra)=> Object.assign({ id:"T-026", title:"Grafik distribusi base rate",
    files_or_areas:["static/js/chart.js"], acceptance_criteria:["grafik tergambar di halaman detail"],
    verification: VERIF, status:"belum mulai" }, behavior ? { behavior } : {}, extra || {});
  function proyek(task, gates){
    const root = makeTempDir("planforge-loop-");
    fs.mkdirSync(path.join(root, ".planforge"));
    fs.writeFileSync(path.join(root, ".planforge", "plan.json"), JSON.stringify({
      generatedAt:new Date().toISOString(), brief:{}, prd:{}, roadmap:{}, tasks:{ tasks:[task] }, issues:[] }));
    fs.writeFileSync(path.join(root, ".planforge", "gates.json"), JSON.stringify(Object.assign({
      agent:{ name:"fake", cmd:NODE, args:[FAKE, "{PROMPT}"], contArgs:[FAKE, "{PROMPT}"], timeoutMin:1 },
      hard:[], reviews:[],
      limits:{ maxCalls:200, maxConsecutiveFails:3, fullEvery:99, fixRounds:1, autoCommit:false, maxCostUsd:null, maxCallsPerRun:null }
    }, gates || {})));
    return { root, ctx: W.loadCtx(root) };
  }
  const jalan = (p)=>{ const asli = console.log; console.log = ()=>{}; try{ return W.runOne(p.ctx, p.ctx.plan.tasks.tasks[0], p.root); } finally{ console.log = asli; } };

  t("behavior gagal -> task GAGAL walau agen lapor done dan verification hijau", ()=>{
    const p = proyek(tugas({ url: luar.url + "/kosong.html", checks:[{ type:"canvasNotBlank", selector:"#grafik" }] }));
    assert.equal(jalan(p), "fail");
    const st = p.ctx.state.tasks["T-026"];
    assert.equal(st.status, "gagal");
    assert.equal(st.gate.behavior.pass, false);
    assert.equal(st.gate.verify.pass, true, "verification memang hijau — yang merah perilakunya");
    assert.match(st.note, /0 pixel terisi dari 45000/);
    assert.equal(p.ctx.state.doneTasks, 0);
  });
  t("angka hasil pengukuran sampai ke prompt perbaikan, bukan cuma 'gagal'", ()=>{
    const p = proyek(tugas({ url: luar.url + "/kosong.html", checks:[{ type:"canvasNotBlank", selector:"#grafik" }] }));
    process.env.PF_FIX_VERIF = "1";
    try{ jalan(p); } finally{ delete process.env.PF_FIX_VERIF; }
    const prompt = fs.readFileSync(path.join(p.root, "prompt-perbaikan.txt"), "utf8");
    assert.match(prompt, /PERILAKU di browser sungguhan/);
    assert.match(prompt, /0 pixel terisi dari 45000/);
  });
  t("behavior hijau -> task selesai, angkanya tercatat di ledger", ()=>{
    const p = proyek(tugas({ url: luar.url + "/baik.html", checks:[{ type:"canvasNotBlank", selector:"#grafik", minPixels: 500 }] }));
    assert.equal(jalan(p), "ok");
    const st = p.ctx.state.tasks["T-026"];
    assert.equal(st.status, "selesai");
    assert.equal(st.gate.behavior.pass, true);
    assert.ok(st.gate.behavior.hasil[0].ukur.pixel >= 500);
    assert.match(st.note, /perilaku hijau/);
    assert.equal(p.ctx.state.doneTasks, 1);
  });
  t("task UI tanpa behavior -> loop BERHENTI, tidak membakar ronde perbaikan", ()=>{
    const p = proyek(tugas(null));
    assert.equal(jalan(p), "halt");
    assert.equal(p.ctx.state.calls, 1, "cuma panggilan kerja yang terpakai, tidak ada ronde perbaikan: " + p.ctx.state.calls);
    assert.equal(p.ctx.state.tasks["T-026"].status, "gagal");
    assert.match(p.ctx.state.haltNote, /tidak punya `behavior`/);
    assert.equal(p.ctx.state.doneTasks, 0);
  });
  t("behavior rusak (checks kosong) -> berhenti juga, bukan dianggap lolos", ()=>{
    const p = proyek(tugas({ url: luar.url + "/baik.html", checks:[] }));
    assert.equal(jalan(p), "halt");
    assert.equal(p.ctx.state.calls, 1);
    assert.match(p.ctx.state.haltNote, /checks kosong/);
  });
  t("ui:false = keputusan manusia yang tercatat, bukan lolos diam-diam", ()=>{
    const p = proyek(tugas(null, { ui:false }));
    assert.equal(jalan(p), "ok");
    assert.equal(p.ctx.state.tasks["T-026"].gate.behavior.dilewati, true);
    const a = W.auditPlan(p.ctx, p.root);
    assert.ok(a.warn.some(x=>x.id === "T-026" && /ui:false/.test(x.msg)), "audit harus menandai pembebasan manual ini");
  });
  t("audit menolak plan yang task UI-nya tanpa behavior, sebelum kredit dibakar", ()=>{
    const p = proyek(tugas(null));
    const a = W.auditPlan(p.ctx, p.root);
    assert.ok(a.error.some(x=>x.id === "T-026" && /tidak punya `behavior`/.test(x.msg)), JSON.stringify(a.temuan));
  });

  return ()=>{ try{ srv.closeAllConnections(); srv.close(); }catch(e){} luar.tutup(); fs.rmSync(dir, { recursive:true, force:true, maxRetries:5, retryDelay:100 }); };
}

let tutup = null;
try{
tutup = await daftar();
t("environment TCP probe never claims DB authentication or task success", async ()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pf-env-port-"));
  const srv=http.createServer();
  try{
    fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({dependencies:{pg:"8.13.1"}}));
    await new Promise((resolve,reject)=>{srv.once("error",reject);srv.listen(0,"127.0.0.1",resolve);});
    const env={DATABASE_URL:"postgres://user:private@127.0.0.1:"+srv.address().port+"/appdb"};
    const open=W.environmentReadiness(dir,{env,probe:true});
    assert.equal(open.database,"tcp-open-auth-unverified");
    assert.match(open.findings.find(x=>x.code==="database-probe").msg,/BELUM diverifikasi/);
    assert.ok(!JSON.stringify(open).includes("private"));
    await new Promise(resolve=>srv.close(resolve));
    const closed=W.environmentReadiness(dir,{env,probe:true});
    assert.equal(closed.database,"unreachable");
    assert.ok(closed.findings.every(x=>x.lvl==="warn"));
  }finally{srv.close();fs.rmSync(dir,{recursive:true,force:true});}
});
for(const item of antrian){
  if(item.judul){ console.log(item.judul); continue; }
  const checkpoint = tempDirCheckpoint();
  try{ await item.fn(); pass++; console.log("  ok   " + item.name); }
  catch(e){ fail++; console.log("  FAIL " + item.name + "\n       " + String(e.stack || e).split("\n").slice(0,3).join("\n       ")); }
  finally{ cleanupTempDirsSince(checkpoint); }
}
}finally{
  try{ if(tutup) tutup(); }
  finally{
    try{ cleanupTempDirs(); }
    finally{ sweepStaleTempDirs(); }
  }
}
console.log("\n" + pass + " lulus, " + fail + " gagal\n");
process.exitCode = fail ? 1 : 0;