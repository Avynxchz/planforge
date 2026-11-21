/* Verifikasi UI fondasi di browser sungguhan (Edge/Chrome headless, file://), TANPA panggilan AI.
   Yang diperiksa: halaman planning render bersih, isolasi kunci per provider (keamanan),
   sidik jari rencana di bundel ekspor (progres), validasi behavior task UI (kelulusan),
   dan panel Connect meminta verifikasi identitas. Meninggalkan receipt di disk. */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cariBrowser } from "../worker.mjs";
import { cleanupTempDirs, makeTempDir, sweepStaleTempDirs } from "./temp-dirs.mjs";
import { browserArgs, browserSpawnOptions, closeBrowser } from "./browser-process.mjs";

const INDEX = fileURLToPath(new URL("../index.html", import.meta.url));
const RECEIPT = fileURLToPath(new URL("../ui-receipt.json", import.meta.url));
const tidur = (ms)=>new Promise(r=>setTimeout(r, ms));
const hasil = [];
const catat = (nama, lulus, detail)=>{ hasil.push({nama, lulus, detail}); console.log((lulus?"  ok   ":"  FAIL ")+nama+(detail?" — "+detail:"")); };

const bin = cariBrowser();
if(!bin){ console.log("browser tidak ditemukan — probe UI dilewati"); process.exit(1); }
const tmp = makeTempDir("pf-browser-ui-");
const browser = spawn(bin, browserArgs(tmp), browserSpawnOptions());
browser.stdout.on("data", ()=>{});
const errors = [];
let ws = null, kirim = null;
async function nilai(expr){
  const r = await kirim("Runtime.evaluate", { expression:expr, returnByValue:true, awaitPromise:true });
  if(r.exceptionDetails) throw new Error("halaman melempar: " + JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
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
    if(m.id != null && tunggu.has(m.id)){ const { res, rej } = tunggu.get(m.id); tunggu.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
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
  catat("halaman index.html selesai dimuat lewat file://", siap);
  await nilai("ensureWorkerSource()");

  console.log("\n1) UI planning render");
  const ui = await nilai(`(()=>{
    const ada = (id)=>!!document.getElementById(id);
    return { idea:ada("idea"), provider:ada("provider"), apiKey:ada("apiKey"), baseUrl:ada("baseUrl"),
      runAll:ada("runAll"), out:ada("out"), connect:ada("pf-connect"),
      cekKredit:ada("cekKredit"), autoTambal:ada("autoTambal"),
      panduan:!!document.querySelector('[data-view="panduan"]'),
      profiles:Object.keys(PROFILES), demoTasks:planTaskList(DEMO).length };
  })()`);
  catat("kontrol planning utama ada (idea/provider/apiKey/runAll)", ui.idea&&ui.provider&&ui.apiKey&&ui.runAll, JSON.stringify(ui));
  catat("DEMO memuat task lewat planTaskList", ui.demoTasks>0, ui.demoTasks+" task");
  catat("kontrol baru: cek kredit, tambal opsional, tab Panduan", ui.cekKredit&&ui.autoTambal&&ui.panduan, JSON.stringify({k:ui.cekKredit,a:ui.autoTambal,p:ui.panduan}));
  const rubrik = await nilai(`(()=>{
    const r = rubrikRencana(DEMO, []);
    return { siap:r.siap, skor:r.skor, label:r.label, error:r.error.slice(0,2) };
  })()`);
  catat("rubrik rencana contoh lolos gerbang kualitas", rubrik.siap===true, JSON.stringify(rubrik));
  const skorRunner = await nilai(`(()=>{
    const sd=state.docs, si=state.issues;
    try{
      state.docs={tasks:{tasks:[{id:"T-001",title:"Buat scaffold CLI untuk data tombol",files_or_areas:["src/utils.js"],
        verification:"buka halaman lalu lihat",acceptance_criteria:["API mengembalikan status tombol"]}]}};
      state.issues=["prd: requirements kosong"];
      const r=rubrikRencana(state.docs,state.issues,starterAktif(readCfg()));
      const txt=renderRunner();
      return {skor:r.skor, error:r.error.length, runnerSkor:(txt.match(/Kualitas rencana:[\\s\\S]*?skor (\\d+)/)||[])[1]||"",
        warning:txt.includes("Connect ditahan sampai beres"), readiness:txt.includes("Perlu diperbaiki")};
    }finally{state.docs=sd;state.issues=si;}
  })()`);
  catat("skor rubrik 60 dan peringatan kesiapan konsisten di tab Runner",
    skorRunner.skor===60&&skorRunner.runnerSkor==="60"&&skorRunner.warning&&skorRunner.readiness,JSON.stringify(skorRunner));
  const preset = await nilai(`(()=>{
    const asli=localStorage.getItem(CFG_NAME), models=JSON.parse(JSON.stringify(state.stageModels||{}));
    try{
      document.querySelector('[data-preset="hemat"]').click();
      const saved=JSON.parse(localStorage.getItem(CFG_NAME)||"{}");
      return { tersimpan:STAGE_KEYS.every(s=>saved.stageModels&&saved.stageModels[s]===state.stageModels[s]),
        model:Object.keys(saved.stageModels||{}).length };
    }finally{
      state.stageModels=models;
      if(asli==null)localStorage.removeItem(CFG_NAME);else localStorage.setItem(CFG_NAME,asli);
      renderStageModelInputs();
    }
  })()`);
  catat("preset model terbaru tersimpan sebelum reload",preset.tersimpan&&preset.model>0,JSON.stringify(preset));
  const timeoutError = await nilai(`(async()=>{
    const asliFetch=window.fetch, asliTimer=window.setTimeout, provider=el("provider").value, base=el("baseUrl").value,
      out=el("out").innerHTML, railHtml=el("rail").innerHTML;
    let ms=0, pesan="";
    try{
      el("provider").value="custom"; el("baseUrl").value="https://nim.example/v1";
      window.setTimeout=(fn,delay)=>{ms=delay;return asliTimer(fn,0);};
      window.fetch=(url,opts)=>new Promise((resolve,reject)=>{
        opts.signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});
      });
      try{await callModel([],"prd",{provider:"custom",baseUrl:"https://nim.example/v1",stageModels:{prd:"uji/model"},seedMode:false},null);}
      catch(e){pesan=String(e.message||e);}
      showError(new Error("HTTP 402: provider menolak request"));
      return {ms,pesan,customHint:el("out").textContent, hasOpenRouter:el("out").textContent.includes("OpenRouter")};
    }finally{
      window.fetch=asliFetch; window.setTimeout=asliTimer; el("provider").value=provider;el("baseUrl").value=base;
      el("out").innerHTML=out;el("rail").innerHTML=railHtml;
    }
  })()`);
  catat("timeout panggilan 240 detik dan bantuan 402 tidak menyebut OpenRouter untuk provider custom",
    timeoutError.ms===240000&&/240 detik/.test(timeoutError.pesan)&&!timeoutError.hasOpenRouter,
    JSON.stringify({ms:timeoutError.ms,pesan:timeoutError.pesan,hint:timeoutError.hasOpenRouter}));
  const emptyPlan = await nilai(`(()=>{
    const sd=state.docs, si=state.issues, out=el("out").innerHTML;
    try{
      state.docs={};state.issues=[];draw("issues");
      return {teks:el("out").textContent, netral:!el("out").textContent.includes("masalah struktur yang menahan Connect")};
    }finally{state.docs=sd;state.issues=si;el("out").innerHTML=out;}
  })()`);
  catat("tab Cek rencana menampilkan status netral ketika plan belum ada",emptyPlan.netral&&/Belum ada rencana/.test(emptyPlan.teks),emptyPlan.teks);
  const panduan = await nilai(`(()=>{ const b=document.querySelector('[data-view="panduan"]'); if(!b) return ""; b.click(); return document.getElementById("out").textContent; })()`);
  catat("tab Panduan memuat langkah bernomor + kode error 402/429", /Coba gratis dulu/.test(panduan) && /402/.test(panduan) && /429/.test(panduan), panduan.slice(0,80));
  const gerbang = await nilai(`(()=>{
    const docs = { tasks:{ tasks:[{ id:"T-002", title:"Definisikan token warna gelap", description:"atur warna", files_or_areas:["index.html"], verification:"npm run build" }] } };
    const r = rubrikRencana(docs, []);
    return { siap:r.siap, skor:r.skor, pertama:r.error[0] || "" };
  })()`);
  catat("gerbang kualitas menolak rencana tanpa T-001 scaffold", gerbang.siap === false && /bukan T-001|bukan scaffold/.test(gerbang.pertama), JSON.stringify(gerbang));
  const sinkron = await nilai(`(()=>{
    const simpanDocs = state.docs, simpanLast = state.lastConnect;
    state.docs = JSON.parse(JSON.stringify(DEMO));
    const fp = planFingerprint(state.docs);
    state.lastConnect = { handle:null, path:"D:/X", conn:"vscode", fingerprint:"sidik-lama" };
    const beda = perluSinkron();
    state.lastConnect.fingerprint = fp;
    const sama = perluSinkron();
    state.docs = simpanDocs; state.lastConnect = simpanLast;
    return { beda, sama };
  })()`);
  catat("lampu 'perlu sinkron' nyala hanya saat sidik jari rencana berubah", sinkron.beda === true && sinkron.sama === false, JSON.stringify(sinkron));

  const railReset = await nilai(`(()=>{
    const sd=state.docs, si=state.issues, sa=state.autoFixes, sn=state.auditNote, railHtml=el("rail").innerHTML,
      saved=localStorage.getItem(STATE_NAME), out=el("out").innerHTML;
    try{
      state.docs={};state.issues=[];state.autoFixes=[];state.auditNote=null;
      setStage("audit","err","1 celah");
      clearDocs();
      const audit=el("rail").querySelector('[data-k="audit"]');
      return {kelas:audit.className,catatan:audit.querySelector("span").textContent,reset:!audit.classList.contains("err")};
    }finally{
      state.docs=sd;state.issues=si;state.autoFixes=sa;state.auditNote=sn;
      if(saved==null)localStorage.removeItem(STATE_NAME);else localStorage.setItem(STATE_NAME,saved);
      el("rail").innerHTML=railHtml;el("out").innerHTML=out;
    }
  })()`);
  catat("Hapus hasil mengosongkan indikator audit rail",railReset.reset,JSON.stringify(railReset));

  console.log("\n2) Isolasi kunci per provider (keamanan)");
  const kunci = await nilai(`(()=>{
    const K = "sk-or-UIPROBE-1234567890";
    el("provider").value = "openrouter";
    el("baseUrl").value = PROFILES.openrouter.baseUrl;
    el("apiKey").value = K; el("saveKey").checked = true;
    let persistOk = true; try{ persist(); }catch(e){ persistOk = String(e); }
    const tersimpan = keyFor({provider:"openrouter", baseUrl:PROFILES.openrouter.baseUrl});
    el("provider").value = "custom"; el("provider").onchange();
    const bocor = el("apiKey").value;
    el("provider").value = "openrouter"; el("provider").onchange();
    const balik = el("apiKey").value;
    return { persistOk, tersimpan, bocor, balik, K };
  })()`);
  catat("kunci openrouter tersimpan scoped ke provider+baseUrl", kunci.tersimpan===kunci.K, "persist="+kunci.persistOk);
  catat("pindah provider TIDAK membocorkan kunci openrouter", kunci.bocor!==kunci.K, "field custom='"+kunci.bocor+"'");
  catat("balik ke openrouter memulihkan kunci yang benar", kunci.balik===kunci.K);

  console.log("\n3) Sidik jari rencana di bundel ekspor (progres)");
  const fp = await nilai(`(()=>{
    state.docs = JSON.parse(JSON.stringify(DEMO));
    const bundle = JSON.parse(planBundleJson(state.docs, []));
    const st = freshStateJson(state.docs);
    const web = planFingerprint(state.docs);
    const ubah = JSON.parse(JSON.stringify(state.docs));
    ubah.tasks.tasks[0].title = "judul baru probe";
    return { bundleFp:bundle.planFingerprint, stateFp:st.planFingerprint, web, rev:st.rev,
      beda:planFingerprint(ubah)!==web, hex:/^[0-9a-f]{8}$/.test(web) };
  })()`);
  catat("planBundleJson menanam sidik jari == freshStateJson == planFingerprint", fp.bundleFp===fp.stateFp&&fp.stateFp===fp.web, fp.web);
  catat("sidik jari berbentuk 8 hex dan rev mulai 0", fp.hex&&fp.rev===0);
  catat("mengubah isi task mengubah sidik jari (rencana baru terdeteksi)", fp.beda);

  console.log("\n4) Validasi behavior task UI (kelulusan)");
  const beh = await nilai(`(()=>{
    const uiTanpa = {title:"Buat halaman menu", files_or_areas:["src/menu.html"], acceptance_criteria:["tombol muncul"]};
    const tanpa = masalahBehavior(uiTanpa);
    const uiAda = {title:"Buat halaman menu", files_or_areas:["src/menu.html"],
      behavior:{url:"http://localhost:8000", checks:[{type:"text", selector:"h1", contains:"Menu"}]}};
    const ada = masalahBehavior(uiAda);
    const backend = {title:"Hitung total di server", files_or_areas:["src/api.py"], acceptance_criteria:["total benar"]};
    return { tanpa, ada, backend:masalahBehavior(backend) };
  })()`);
  catat("task UI tanpa behavior DITOLAK (tidak boleh dicap selesai)", beh.tanpa.length>0, JSON.stringify(beh.tanpa));
  catat("task UI dengan behavior sah diterima", beh.ada.length===0, JSON.stringify(beh.ada));
  catat("task backend tanpa behavior dilewati (bukan UI)", beh.backend.length===0);

  console.log("\n5) Connect golden path di UI: tulis lalu panel minta verifikasi identitas (keamanan)");
  const conn = await nilai(`(async()=>{
    const hilang = ()=>{ const e = new Error("tidak ada"); e.name = "NotFoundError"; return e; };
    const bungkus = (node)=>({
      name: node.nama || "proyek",
      async getDirectoryHandle(nama, opt){
        let a = node.anak[nama];
        if(!a){ if(opt&&opt.create) a = node.anak[nama] = {_dir:true, anak:{}}; else throw hilang(); }
        a.nama = nama; return bungkus(a);
      },
      async getFileHandle(nama, opt){
        let a = node.anak[nama];
        if(!a){ if(opt&&opt.create) a = node.anak[nama] = {_dir:false, teks:""}; else throw hilang(); }
        a.nama = nama;
        return { name:nama, async getFile(){ return { async text(){ return a.teks; } }; },
          async createWritable(){ return { async write(x){ a.teks = String(x); }, async close(){} }; } };
      }
    });
    state.pkgConn = "claude";
    state.docs = JSON.parse(JSON.stringify(DEMO));
    state.connect = { handle:bungkus({_dir:true, anak:{}, nama:"proyek"}), nama:"proyek",
      path:"D:/PROJECTS/uji-ui", tahap:"path", rencana:null, hasil:null, error:null };
    draw("runner");
    const adaPanel = !!document.getElementById("pf-connect");
    await connectCek();
    const tahapKonf = state.connect.tahap;
    await connectTulis();
    draw("runner");
    const panel = document.getElementById("pf-connect").innerText;
    return { adaPanel, tahapKonf, tahapAkhir:state.connect.tahap, jumlah:(state.connect.hasil||[]).length,
      belum:/BELUM terverifikasi/.test(panel), status:/panggil plan_status/.test(panel), stop:/STOP kalau berbeda/.test(panel) };
  })()`);
  catat("panel Connect muncul sesudah draw(runner)", conn.adaPanel);
  catat("Connect golden path: cek -> konfirmasi -> tulis 6 file", conn.tahapKonf==="konfirmasi"&&conn.tahapAkhir==="selesai"&&conn.jumlah===6, JSON.stringify({k:conn.tahapKonf,a:conn.tahapAkhir,n:conn.jumlah}));
  catat("panel Connect menandai koneksi BELUM terverifikasi", conn.belum);
  catat("panel Connect menyuruh panggil plan_status dulu", conn.status);
  catat("panel Connect menyuruh STOP kalau folder berbeda", conn.stop);

  console.log("\n5b) Jalur universal generic di UI: perintah + tiga dialect muncul di panel");
  const uni = await nilai(`(async()=>{
    const hilang = ()=>{ const e = new Error("tidak ada"); e.name = "NotFoundError"; return e; };
    const bungkus = (node)=>({
      name: node.nama || "proyek",
      async getDirectoryHandle(nama, opt){
        let a = node.anak[nama];
        if(!a){ if(opt&&opt.create) a = node.anak[nama] = {_dir:true, anak:{}}; else throw hilang(); }
        a.nama = nama; return bungkus(a);
      },
      async getFileHandle(nama, opt){
        let a = node.anak[nama];
        if(!a){ if(opt&&opt.create) a = node.anak[nama] = {_dir:false, teks:""}; else throw hilang(); }
        a.nama = nama;
        return { name:nama, async getFile(){ return { async text(){ return a.teks; } }; },
          async createWritable(){ return { async write(x){ a.teks = String(x); }, async close(){} }; } };
      }
    });
    state.pkgConn = "generic";
    state.docs = JSON.parse(JSON.stringify(DEMO));
    state.connect = { handle:bungkus({_dir:true, anak:{}, nama:"proyek"}), nama:"proyek",
      path:"D:/PROJECTS/uji-universal", tahap:"path", rencana:null, hasil:null, error:null };
    draw("runner");
    await connectCek();
    await connectTulis();
    draw("runner");
    const panel = document.getElementById("pf-connect").innerText;
    return { tahap:state.connect.tahap,
      judul:panel.includes("Jalur universal"),
      perintah:panel.includes("node D:/PROJECTS/uji-universal/worker.mjs mcp --dir D:/PROJECTS/uji-universal"),
      ms:panel.includes("Format mcpServers"), sv:panel.includes("Format servers"), mc:panel.includes("Format mcp.servers"),
      tombol:!!document.querySelector("[data-act='cSalinUniversal']") };
  })()`);
  catat("generic: Connect selesai menulis", uni.tahap==="selesai", uni.tahap);
  catat("panel universal menampilkan judul Jalur universal", uni.judul);
  catat("panel universal menampilkan perintah node worker.mjs mcp --dir", uni.perintah);
  catat("panel universal menyediakan tiga dialect (mcpServers/servers/mcp.servers)", uni.ms&&uni.sv&&uni.mc, JSON.stringify({ms:uni.ms,sv:uni.sv,mc:uni.mc}));
  catat("ada tombol salin perintah universal", uni.tombol);

  console.log("\n5c) Progres live di UI: baca state.json folder -> checklist task (tanpa AI)");
  const prog = await nilai(`(async()=>{
    const hilang = ()=>{ const e = new Error("tidak ada"); e.name = "NotFoundError"; return e; };
    const bungkus = (node)=>({
      name: node.nama || "proyek",
      async getDirectoryHandle(nama, opt){
        let a = node.anak[nama];
        if(!a){ if(opt&&opt.create) a = node.anak[nama] = {_dir:true, anak:{}}; else throw hilang(); }
        a.nama = nama; return bungkus(a);
      },
      async getFileHandle(nama, opt){
        let a = node.anak[nama];
        if(!a){ if(opt&&opt.create) a = node.anak[nama] = {_dir:false, teks:""}; else throw hilang(); }
        a.nama = nama;
        return { name:nama, async getFile(){ return { async text(){ return a.teks; } }; },
          async createWritable(){ return { async write(x){ a.teks = String(x); }, async close(){} }; } };
      }
    });
    const izin = (h)=>{ h.queryPermission = async()=>"granted"; h.requestPermission = async()=>"granted"; return h; };
    const simpan = { last:state.lastConnect, docs:state.docs, p:state.progres, e:state.progresError, at:state.progresAt };
    state.docs = JSON.parse(JSON.stringify(DEMO));
    const plan = { tasks:{ tasks:[
      {id:"T-001",title:"Scaffold halaman"},{id:"T-002",title:"Pasang font"},
      {id:"T-003",title:"Kartu bento"},{id:"T-004",title:"Responsif"} ] } };
    const ledger = { doneTasks:1, lastTask:"T-001", tasks:{
      "T-001":{status:"selesai", finishedAt:"2026-11-16T14:32:00.000Z", note:"bukti: hijau"},
      "T-002":{status:"sedang"},
      "T-003":{status:"terkendala", note:"assets tidak ada"} } };
    const root = {_dir:true, nama:"proyek", anak:{ ".planforge":{_dir:true, nama:".planforge", anak:{
      "plan.json":{_dir:false, nama:"plan.json", teks:JSON.stringify(plan)},
      "state.json":{_dir:false, nama:"state.json", teks:JSON.stringify(ledger)} } } } };
    state.lastConnect = { handle:izin(bungkus(root)), path:"D:/PROJECTS/uji-progres", conn:"opencode", fingerprint:"x" };
    state.progres = null; state.progresError = null; state.progresAt = null;
    await bacaProgres();
    const p = state.progres;
    draw("runner");
    const panel = document.getElementById("out").innerText;
    const happy = { ada:!!p, total:p&&p.total, done:p&&p.done, lastTask:p&&p.lastTask,
      status:p&&p.rows.map(r=>r.status), judul:p&&p.rows.map(r=>r.title), err:state.progresError,
      tombol:!!document.querySelector("[data-act='cProgres']"),
      teksSelesai:/1 dari 4 task selesai/.test(panel), adaJudul:/Scaffold halaman/.test(panel),
      adaTerkendala:/assets tidak ada/.test(panel), adaTombolTeks:/Refresh progres/.test(panel) };
    state.lastConnect = { handle:izin(bungkus({_dir:true,nama:"kosong",anak:{}})), path:"D:/X", conn:"opencode", fingerprint:"x" };
    state.progres = null; state.progresError = null;
    await bacaProgres();
    const kosong = { prog:state.progres, err:state.progresError };
    state.lastConnect = simpan.last; state.docs = simpan.docs; state.progres = simpan.p; state.progresError = simpan.e; state.progresAt = simpan.at;
    return { happy, kosong };
  })()`);
  catat("bacaProgres membaca state.json folder: 4 task, 1 selesai, lastTask T-001", prog.happy.ada && prog.happy.total===4 && prog.happy.done===1 && prog.happy.lastTask==="T-001", JSON.stringify({t:prog.happy.total,d:prog.happy.done,l:prog.happy.lastTask}));
  catat("status per task terbaca benar (selesai/sedang/terkendala/belum mulai)", JSON.stringify(prog.happy.status)===JSON.stringify(["selesai","sedang","terkendala","belum mulai"]), JSON.stringify(prog.happy.status));
  catat("judul task diambil dari plan.json FOLDER, bukan rencana browser", prog.happy.judul && prog.happy.judul[0]==="Scaffold halaman", JSON.stringify(prog.happy.judul));
  catat("panel progres live menampilkan checklist + tombol Refresh", prog.happy.tombol && prog.happy.teksSelesai && prog.happy.adaJudul && prog.happy.adaTombolTeks, JSON.stringify({tombol:prog.happy.tombol,teks:prog.happy.teksSelesai,judul:prog.happy.adaJudul}));
  catat("task terkendala tampil dengan alasannya (tidak hilang jadi belum mulai)", prog.happy.adaTerkendala);
  catat("folder tanpa state.json -> pesan error jujur, bukan checklist palsu", prog.kosong.prog===null && /state\.json belum ada/.test(prog.kosong.err||""), prog.kosong.err);

  console.log("\n6) task list terpotong -> ulang ringkas otomatis (bukan gagal mulu)");
  const retry = await nilai(`(async()=>{
    state.docs = JSON.parse(JSON.stringify(DEMO));
    const asli = window.callModel;
    let n = 0; const jejak = [];
    window.callModel = async function(msgs, stage, cfg, controller){
      n++;
      jejak.push({ stage:stage, ringkas: msgs.some(m=>/LEBIH RINGKAS/.test(String(m.content||""))) });
      if(n === 1){ const e = new Error("keluaran terpotong di tahap tasks — simulasi"); e.terpotong = true; e.stage = stage; throw e; }
      return { text: JSON.stringify(DEMO.tasks), usage:{} };
    };
    const cfg = { provider:"openrouter", baseUrl:"https://openrouter.ai/api/v1", stageModels:{ tasks:"uji/model:free" } };
    let ok = false, err = "";
    try{ const r = await runStage("tasks", cfg); ok = !!(r && Array.isArray(r.tasks)); }catch(e){ err = String(e && e.message || e); }
    window.callModel = asli;
    return { ok:ok, err:err, n:n, jejak:jejak };
  })()`);
  catat("task list terpotong pulih sendiri: ulang sekali, tidak gagal", retry.ok && retry.n===2, JSON.stringify({ok:retry.ok,n:retry.n,err:retry.err}));
  catat("ulangan membawa instruksi LEBIH RINGKAS", !!(retry.jejak[1] && retry.jejak[1].ringkas), JSON.stringify(retry.jejak));

  const retryAudit = await nilai(`(async()=>{
    state.docs = JSON.parse(JSON.stringify(DEMO));
    state.docs.issues = ["T-003: requirement_refs 'R-077' tidak dikenal"];
    const asli = window.callModel;
    let n = 0; const jejak = [];
    window.callModel = async function(msgs, stage, cfg, controller){
      n++;
      jejak.push({ stage:stage, ringkas: msgs.some(m=>/LEBIH RINGKAS/.test(String(m.content||""))) });
      if(n === 1){ const e = new Error("keluaran terpotong di tahap audit — simulasi"); e.terpotong = true; e.stage = stage; throw e; }
      return { text: JSON.stringify({patches:[]}), usage:{} };
    };
    const cfg = { provider:"openrouter", baseUrl:"https://openrouter.ai/api/v1", stageModels:{ audit:"uji/model:free" } };
    let ok = false, err = "";
    try{ const r = await runStage("audit", cfg); ok = !!(r && Array.isArray(r.patches)); }catch(e){ err = String(e && e.message || e); }
    window.callModel = asli;
    return { ok:ok, err:err, n:n, jejak:jejak };
  })()`);
  catat("audit (tahap 5) terpotong pulih sendiri: ulang sekali lebih ringkas", retryAudit.ok && retryAudit.n===2, JSON.stringify({ok:retryAudit.ok,n:retryAudit.n,err:retryAudit.err}));
  catat("ulangan audit membawa instruksi LEBIH RINGKAS", !!(retryAudit.jejak[1] && retryAudit.jejak[1].ringkas), JSON.stringify(retryAudit.jejak));

  console.log("\n7) clarify interaktif: kuesioner discovery 5-slot di browser sungguhan");
  const q = await nilai(`(async()=>{
    const sd = state.docs, sa = state.abort;
    state.docs = JSON.parse(JSON.stringify(DEMO)); state.abort = new AbortController();
    const cd = state.docs.clarify;
    const p = tanyaUser(cd);
    const out = document.getElementById("out");
    const render = { jumlah:out.querySelectorAll(".q").length, counter:!!out.querySelector("#qCounter"),
      kirim:!!out.querySelector("#qKirim"), lewati:!!out.querySelector("#qLewati"),
      slot:[...out.querySelectorAll(".q .pill")].map(x=>x.textContent) };
    out.querySelector(".q[data-qid='Q-001'] [data-role='text']").value = "Bu Sari, buku tulis";
    out.querySelector(".q[data-qid='Q-002'] [data-role='opt']").checked = true;
    const m = out.querySelectorAll(".q[data-qid='Q-003'] [data-role='opt']"); m[0].checked = true; m[1].checked = true;
    out.querySelector(".q[data-qid='Q-001'] [data-role='text']").dispatchEvent(new Event("input",{bubbles:true}));
    const counterTeks = out.querySelector("#qCounter").textContent;
    out.querySelector("#qKirim").click();
    const jawab = await p;
    const opt2 = cd.questions[1].options[0], opt3 = cd.questions[2].options[0] + "; " + cd.questions[2].options[1];
    const cek = { text:jawab[0].answer==="Bu Sari, buku tulis", single:jawab[1].answer===opt2, multi:jawab[2].answer===opt3, kosong:jawab[3].answer===""&&jawab[4].answer==="" };
    state.docs = sd; state.abort = sa;
    return { render, cek, counterTeks };
  })()`);
  catat("kuesioner render 5 slot + counter + tombol kirim/lewati", q.render.jumlah===5 && q.render.counter && q.render.kirim && q.render.lewati, JSON.stringify(q.render));
  catat("slot berurut persona/aha/mvp_features/value_prop/retention", JSON.stringify(q.render.slot)===JSON.stringify(["persona","aha","mvp_features","value_prop","retention"]), JSON.stringify(q.render.slot));
  catat("counter hidup: 3 terjawab sesudah 3 pertanyaan diisi", /3\/5/.test(q.counterTeks), q.counterTeks);
  catat("kirim mengumpulkan jawaban text/single/multi dengan benar", q.cek.text && q.cek.single && q.cek.multi && q.cek.kosong, JSON.stringify(q.cek));

  const q2 = await nilai(`(async()=>{
    const sa = state.abort; state.abort = new AbortController();
    const p = tanyaUser(JSON.parse(JSON.stringify(DEMO.clarify)));
    document.querySelector("#qLewati").click();
    const jawab = await p; state.abort = sa;
    return { semuaKosong:jawab.every(a=>a.answer===""), n:jawab.length };
  })()`);
  catat("'Lewati semua' menghasilkan 5 jawaban kosong (pakai tebakan model)", q2.semuaKosong && q2.n===5, JSON.stringify(q2));

  const q3 = await nilai(`(async()=>{
    const sa = state.abort; state.abort = new AbortController();
    const p = tanyaUser(JSON.parse(JSON.stringify(DEMO.clarify)));
    const out = document.getElementById("out");
    const sk = out.querySelector(".q[data-qid='Q-001'] [data-role='skip']");
    sk.checked = true; sk.dispatchEvent(new Event("change",{bubbles:true}));
    const disabled = out.querySelector(".q[data-qid='Q-001'] [data-role='text']").disabled;
    const b4 = out.querySelector(".q[data-qid='Q-004']");
    b4.querySelector("[data-role='opt'][value='__other__']").checked = true;
    b4.querySelector("[data-role='other']").value = "karena gratis dan offline";
    out.querySelector("#qKirim").click();
    const jawab = await p; state.abort = sa;
    return { skipKosong:jawab[0].answer==="", otherTertangkap:jawab[3].answer==="karena gratis dan offline", disabled };
  })()`);
  catat("Lewati per pertanyaan mengosongkan jawaban + menonaktifkan input", q3.skipKosong && q3.disabled, JSON.stringify(q3));
  catat("opsi 'Lainnya' menangkap teks bebas user", q3.otherTertangkap, JSON.stringify(q3));

  const q4 = await nilai(`(async()=>{
    const sa = state.abort, ctrl = new AbortController(); state.abort = ctrl;
    const p = tanyaUser(JSON.parse(JSON.stringify(DEMO.clarify)));
    let nama = ""; const hp = p.then(()=>{nama="resolve";},(e)=>{nama=(e&&e.name)||"error";});
    ctrl.abort(); await hp; state.abort = sa;
    return { nama };
  })()`);
  catat("Stop saat kuesioner terbuka membatalkan dengan AbortError (bukan menggantung)", q4.nama==="AbortError", JSON.stringify(q4));

  const q5 = await nilai(`(async()=>{
    const sd = state.docs, sa = state.abort;
    el("provider").value="openrouter"; el("baseUrl").value="https://openrouter.ai/api/v1";
    el("apiKey").value="sk-or-UIPROBE"; el("saveKey").checked=false; el("idea").value="uji clarify interaktif";
    el("clarifyInteraktif").checked=true; el("reuse").checked=false; el("autoTambal").checked=false;
    for(const s of ["clarify","prd","roadmap","tasks","audit"]){ const i=document.querySelector('input[type=hidden][data-stage="'+s+'"]'); if(i) i.value="uji/model:free"; }
    const asli = window.callModel; const panggilan=[];
    window.callModel = async function(msgs, stage){ panggilan.push(stage); return { text:JSON.stringify(DEMO[stage]||{patches:[]}), usage:{} }; };
    state.docs = {}; document.getElementById("out").innerHTML = "";
    const jalan = runAll(true);
    let muncul=false; for(let i=0;i<150;i++){ if(document.querySelector("#qKirim")){muncul=true;break;} await new Promise(r=>setTimeout(r,20)); }
    let dikirim=false;
    if(muncul){ const t=document.querySelector(".q[data-qid='Q-001'] [data-role='text']"); if(t) t.value="Pemilik warung, buku tulis"; document.querySelector("#qKirim").click(); dikirim=true; }
    else if(state.abort) state.abort.abort();
    let runErr=""; try{ await jalan; }catch(e){ runErr=String((e&&e.message)||e); }
    const cd = state.docs.clarify||{};
    const hasil = { muncul, dikirim, runErr, panggilan, prdAda:!!state.docs.prd,
      adaUA:Array.isArray(cd.user_answers), jawab1:(cd.user_answers&&cd.user_answers[0]&&cd.user_answers[0].answer)||"" };
    window.callModel = asli; state.docs = sd; state.abort = sa; el("apiKey").value="";
    return hasil;
  })()`);
  catat("runAll berhenti di kuesioner setelah clarify lalu lanjut PRD sesudah dijawab", q5.muncul && q5.dikirim && q5.prdAda && !q5.runErr, JSON.stringify({muncul:q5.muncul,prd:q5.prdAda,err:q5.runErr,panggilan:q5.panggilan}));
  catat("jawaban user dari kuesioner masuk ke brief clarify (jadi sumber PRD)", q5.adaUA && q5.jawab1==="Pemilik warung, buku tulis", JSON.stringify({ua:q5.adaUA,j:q5.jawab1}));

  console.log("\n7b) clarify+: slot bebas AI ikut dirender & terjawab di browser sungguhan");
  const qa = await nilai(`(async()=>{
    const sa = state.abort; state.abort = new AbortController();
    const cd = JSON.parse(JSON.stringify(DEMO.clarify));
    cd.ai_questions = [
      {id:"A-001", question:"Perlu payment gateway?", why:"belum tahu metode bayar", type:"text", options:[]},
      {id:"A-002", question:"Satu toko atau multi?", why:"scope data", type:"single", options:["satu","multi"]}
    ];
    const p = tanyaUser(cd);
    const out = document.getElementById("out");
    const render = { jumlah:out.querySelectorAll(".q").length,
      pill:[...out.querySelectorAll(".q .pill")].map(x=>x.textContent),
      why:!!out.querySelector(".q[data-qid='A-001'] .hint") };
    out.querySelector(".q[data-qid='A-001'] [data-role='text']").value = "cukup tunai";
    out.querySelector(".q[data-qid='A-002'] [data-role='opt']").checked = true;
    out.querySelector(".q[data-qid='A-001'] [data-role='text']").dispatchEvent(new Event("input",{bubbles:true}));
    const counterTeks = out.querySelector("#qCounter").textContent;
    out.querySelector("#qKirim").click();
    const jawab = await p;
    const a1 = jawab.find(x=>x.question_id==="A-001"), a2 = jawab.find(x=>x.question_id==="A-002");
    state.abort = sa;
    return { render, counterTeks, a1:a1&&a1.answer, a2:a2&&a2.answer, total:jawab.length };
  })()`);
  catat("kuesioner gabungan render 5 slot + 2 slot bebas = 7", qa.render.jumlah===7, JSON.stringify(qa.render));
  catat("pill slot bebas berlabel 'AI bingung' + alasan why tampil", qa.render.pill.filter(x=>x==="AI bingung").length===2 && qa.render.why, JSON.stringify(qa.render.pill));
  catat("counter hidup menghitung total gabungan (2/7)", /2\/7/.test(qa.counterTeks), qa.counterTeks);
  catat("jawaban slot bebas A- terkumpul benar", qa.a1==="cukup tunai" && qa.a2==="satu" && qa.total===7, JSON.stringify({a1:qa.a1,a2:qa.a2,total:qa.total}));
  const qb = await nilai(`(async()=>{
    const sa = state.abort; state.abort = new AbortController();
    const cd = JSON.parse(JSON.stringify(DEMO.clarify));
    cd.ai_questions = [{id:"A-001", question:"x?", why:"y", type:"text", options:[]}];
    const p = tanyaUser(cd);
    document.querySelector("#qLewati").click();
    const j = await p; state.abort = sa;
    return { n:j.length, semuaKosong:j.every(x=>x.answer==="") };
  })()`);
  catat("lewati semua mengosongkan 5 slot + slot bebas (6)", qb.n===6 && qb.semuaKosong, JSON.stringify(qb));

  console.log("\n7c) starter: pilihan GUI mengunci stack + ikut ke bundel ZIP (tanpa AI)");
  const st = await nilai(`(()=>{
    state.docs = JSON.parse(JSON.stringify(DEMO));
    const sel = document.getElementById("starterPilih");
    const ada = !!sel;
    const opsi = ada ? [...sel.options].map(o=>o.value) : [];
    sel.value = "nextjs-fullstack";
    const cfg = readCfg();
    const prdMsg = buildStageMessages("prd", cfg, DEMO)[1].content;
    const files = bundleFiles();
    const starterEntries = files.filter(f=>f.name.startsWith("starter/")).map(f=>f.name);
    const zip = makeZip(files);
    const pk = zip[0]===0x50 && zip[1]===0x4b;
    sel.value = "";
    const cfg2 = readCfg();
    const files2 = bundleFiles();
    const n2 = files2.filter(f=>f.name.startsWith("starter/")).length;
    const prdMsg2 = buildStageMessages("prd", cfg2, DEMO)[1].content;
    return { ada, opsi, cfgStarter:cfg.starter, terkunci:prdMsg.includes("STARTER TERPILIH"),
      jumlahStarter:starterEntries.length, adaPackage:starterEntries.includes("starter/package.json"),
      adaCookie:starterEntries.includes("starter/lib/cookie.js"), pk,
      cfgKosong:cfg2.starter, jumlahStarter2:n2, terkunci2:prdMsg2.includes("STARTER TERPILIH") };
  })()`);
  catat("select starter ada di GUI dengan opsi nextjs-fullstack + kosong", st.ada && st.opsi.includes("nextjs-fullstack") && st.opsi.includes(""), JSON.stringify(st.opsi));
  catat("readCfg membaca pilihan starter; prompt prd ikut mengunci stack", st.cfgStarter==="nextjs-fullstack" && st.terkunci, JSON.stringify({cfg:st.cfgStarter,terkunci:st.terkunci}));
  catat("bundleFiles ZIP menyertakan fondasi starter di bawah starter/ (package.json + cookie.js)", st.jumlahStarter>=27 && st.adaPackage && st.adaCookie, JSON.stringify({n:st.jumlahStarter,pkg:st.adaPackage,cookie:st.adaCookie}));
  catat("ZIP bundel bertanda tangan PK sah walau memuat starter", st.pk, "pk="+st.pk);
  catat("mematikan starter menghapus fondasi dari bundel + kunci dari prompt", st.cfgKosong==="" && st.jumlahStarter2===0 && !st.terkunci2, JSON.stringify({cfg:st.cfgKosong,n:st.jumlahStarter2,terkunci:st.terkunci2}));

  console.log("\n7d) diagram ER + sequence: SVG inline ter-render & terukur di Edge, string model di-escape");
  const dg = await nilai(`(()=>{
    const sd = state.docs;
    state.docs = JSON.parse(JSON.stringify(DEMO));
    draw("prd");
    const out = document.getElementById("out");
    const svgs = [...out.querySelectorAll("svg")];
    const er = svgs.find(s=>s.getAttribute("aria-label")==="Diagram ER");
    const seq = svgs.find(s=>s.getAttribute("aria-label")==="Diagram alur");
    const txt = (e)=>[...e.querySelectorAll("text")].map(t=>t.textContent);
    const r = {
      jumlah: svgs.length, erAda:!!er, seqAda:!!seq,
      erRect: er?er.querySelectorAll("rect").length:0,
      erTabel: er?txt(er).filter(x=>["Item","TxLine","Transaction"].includes(x)).length:0,
      erPK: er?txt(er).filter(x=>x==="PK").length:0,
      erFK: er?txt(er).filter(x=>x==="FK").length:0,
      erGaris: er?er.querySelectorAll("line[marker-end]").length:0,
      seqCircle: seq?seq.querySelectorAll("circle").length:0,
      seqGaris: seq?seq.querySelectorAll("line[marker-end]").length:0,
      seqLangkah: seq?txt(seq).filter(x=>/ketuk item|tekan Simpan/.test(x)).length:0,
      erBox: er?Math.round(er.getBoundingClientRect().width):0,
      seqBox: seq?Math.round(seq.getBoundingClientRect().width):0,
      viewBox: er?er.getAttribute("viewBox"):"",
      lebar: er?er.style.width:""
    };
    state.docs = sd;
    return r;
  })()`);
  catat("ER + sequence SVG benar-benar ter-render di DOM (2 svg inline)", dg.jumlah===2 && dg.erAda && dg.seqAda, JSON.stringify({n:dg.jumlah,er:dg.erAda,seq:dg.seqAda}));
  catat("ER: 3 tabel + 2 PK + 2 FK + 2 garis relasi terukur di Edge", dg.erRect>=3 && dg.erTabel===3 && dg.erPK===2 && dg.erFK===2 && dg.erGaris===2, JSON.stringify({rect:dg.erRect,tabel:dg.erTabel,PK:dg.erPK,FK:dg.erFK,garis:dg.erGaris}));
  catat("Sequence: 9 langkah bernomor + 7 panah urutan + teks langkah tampil", dg.seqCircle===9 && dg.seqGaris===7 && dg.seqLangkah===2, JSON.stringify({circle:dg.seqCircle,garis:dg.seqGaris,langkah:dg.seqLangkah}));
  catat("diagram responsif: viewBox + width:100%, lebar terukur > 0 (bukan SVG mati)", !!dg.viewBox && dg.lebar==="100%" && dg.erBox>0 && dg.seqBox>0, JSON.stringify({vb:dg.viewBox,lebar:dg.lebar,erBox:dg.erBox,seqBox:dg.seqBox}));
  const dg2 = await nilai(`(()=>{
    const sd = state.docs;
    window.__pwn = 0;
    const jahat = { project_name:"X", version:"1.0", one_liner:"x", summary:"s",
      problem:{statement:"p",who:"w",current_alternatives:[]}, personas:[], goals:[], non_goals:[],
      requirements:[], non_functional:[], features:[], tech:[], template_note:"", risks:[], metrics:[], open_questions:[],
      flows:[{name:'<img src=x onerror=window.__pwn=1>', steps:['<script>window.__pwn=2</script>','ok & "fine"']}],
      data:[{entity:'<img src=y onerror=window.__pwn=3>', note:'n & "q"', fields:['<script>window.__pwn=4</script> (text) — z']}] };
    state.docs = { prd: jahat };
    draw("prd");
    const out = document.getElementById("out");
    const r = { pwn: window.__pwn, imgHidup: out.querySelectorAll("img").length,
      scriptHidup: out.querySelectorAll("script").length, svg: out.querySelectorAll("svg").length,
      escaped: out.innerHTML.includes("&lt;script&gt;") || out.innerHTML.includes("&lt;img") };
    delete window.__pwn;
    state.docs = sd;
    return r;
  })()`);
  catat("string model jahat di-escape: tidak ada img/script hidup, __pwn tetap 0", dg2.pwn===0 && dg2.imgHidup===0 && dg2.scriptHidup===0 && dg2.svg===2 && dg2.escaped, JSON.stringify(dg2));

  console.log("\n7e) handoff GitHub opsional di GUI: panel + push mock + token tidak disimpan (tanpa jaringan nyata)");
  const gh1 = await nilai(`(()=>{
    const sd = state.docs;
    state.docs = JSON.parse(JSON.stringify(DEMO));
    draw("runner");
    const out = document.getElementById("out");
    const repo = document.getElementById("ghRepo"), branch = document.getElementById("ghBranch"), tok = document.getElementById("ghToken");
    const r = {
      repoAda:!!repo, branchAda:!!branch, branchMain:branch?branch.value==="main":false,
      tokenAda:!!tok, tokenPassword:tok?tok.type==="password":false, tokenAutocomplete:tok?tok.getAttribute("autocomplete")==="off":false,
      pushAda:!!out.querySelector("[data-act='ghPush']"), msgAda:!!document.getElementById("ghMsg"),
      utama:out.innerText.includes("MCP/Connect") && out.innerText.includes("jalur utama"),
      tidakDisimpan:out.innerText.includes("tidak disimpan"),
      cfgTanpaToken:!("ghToken" in readCfg())
    };
    state.docs = sd;
    return r;
  })()`);
  catat("panel GitHub ada: repo + branch(main) + token(password,autocomplete off) + tombol push + pesan", gh1.repoAda&&gh1.branchAda&&gh1.branchMain&&gh1.tokenAda&&gh1.tokenPassword&&gh1.tokenAutocomplete&&gh1.pushAda&&gh1.msgAda, JSON.stringify(gh1));
  catat("hint jujur: MCP/Connect tetap jalur utama + token tidak disimpan; readCfg tidak menangkap token", gh1.utama&&gh1.tidakDisimpan&&gh1.cfgTanpaToken, JSON.stringify({utama:gh1.utama,tdk:gh1.tidakDisimpan,cfg:gh1.cfgTanpaToken}));
  const gh2 = await nilai(`(async()=>{
    const sd = state.docs, si = state.issues, asliFetch = window.fetch;
    const TOKEN = "ghp_FAKEUIPROBE0000000000000000000000";
    const calls = [];
    const json = (status,obj)=>({ status, ok:status>=200&&status<300, json:async()=>obj, text:async()=>JSON.stringify(obj) });
    window.fetch = async (url, init)=>{
      const u = String(url), method = (init&&init.method)||"GET", h = (init&&init.headers)||{};
      let body = null; try{ body = init&&init.body ? JSON.parse(init.body) : null; }catch(e){}
      calls.push({ url:u, method, auth:h["Authorization"]||h["authorization"]||"", body });
      if(/\\/git\\/ref\\/heads\\//.test(u)) return json(200,{object:{sha:"baseSHA"}});
      if(/\\/git\\/commits\\/baseSHA/.test(u)) return json(200,{tree:{sha:"baseTREE"}});
      if(/\\/git\\/blobs$/.test(u)) return json(201,{sha:"blob"+calls.length});
      if(/\\/git\\/trees$/.test(u)) return json(201,{sha:"newTREE"});
      if(/\\/git\\/commits$/.test(u)) return json(201,{sha:"newCOMMIT"});
      if(/\\/git\\/refs\\/heads\\//.test(u)) return json(200,{});
      if(/\\/git\\/refs$/.test(u)) return json(201,{});
      return json(404,{message:"not found"});
    };
    let r;
    try{
      state.docs = JSON.parse(JSON.stringify(DEMO)); state.issues = [];
      const sel = document.getElementById("starterPilih"); const sv = sel?sel.value:""; if(sel) sel.value="";
      draw("runner");
      document.getElementById("ghRepo").value = "o/r";
      document.getElementById("ghBranch").value = "main";
      document.getElementById("ghToken").value = TOKEN;
      await githubPushNow();
      const msg = document.getElementById("ghMsg");
      const nBlob = calls.filter(c=>c.method==="POST" && /\\/git\\/blobs$/.test(c.url)).length;
      const tree = calls.find(c=>/\\/git\\/trees$/.test(c.url));
      const commit = calls.find(c=>c.method==="POST" && /\\/git\\/commits$/.test(c.url));
      const patch = calls.find(c=>c.method==="PATCH" && /\\/git\\/refs\\/heads\\//.test(c.url));
      let lsAdaToken = false;
      for(let i=0;i<localStorage.length;i++){ const k = localStorage.key(i); if(String(localStorage.getItem(k)).includes(TOKEN)) lsAdaToken = true; }
      const bundel = githubPushFiles(state.docs, {cfg:readCfg(), issues:state.issues, workerSource:state.workerSource, gates:gates()});
      r = {
        total:calls.length,
        semuaApi:calls.every(c=>c.url.startsWith("https://api.github.com/")),
        semuaBearer:calls.length>0 && calls.every(c=>c.auth==="Bearer "+TOKEN),
        adaRef:calls.some(c=>c.method==="GET" && /\\/git\\/ref\\/heads\\/main$/.test(c.url)),
        adaBaseCommit:calls.some(c=>c.method==="GET" && /\\/git\\/commits\\/baseSHA$/.test(c.url)),
        nBlob, treeBaseTree:tree&&tree.body?tree.body.base_tree:null, treeJumlah:tree&&tree.body?tree.body.tree.length:0,
        commitParents:commit&&commit.body?commit.body.parents:null, commitTree:commit&&commit.body?commit.body.tree:null,
        patchSha:patch&&patch.body?patch.body.sha:null, patchForce:patch&&patch.body?patch.body.force:null,
        tokenKosong:document.getElementById("ghToken").value==="",
        msgTerpush:/Terpush/.test(msg.textContent), msgCommit:msg.innerHTML.includes("newCOMM"),
        msgLink:(msg.querySelector("a")||{}).href||"",
        lsAdaToken, cfgAdaToken:JSON.stringify(readCfg()).includes(TOKEN), bundelAdaToken:JSON.stringify(bundel).includes(TOKEN)
      };
      if(sel) sel.value = sv;
    } finally {
      window.fetch = asliFetch; state.docs = sd; state.issues = si;
      const t = document.getElementById("ghToken"); if(t) t.value="";
    }
    return r;
  })()`);
  catat("push mock: semua request ke api.github.com + Authorization Bearer token (token hanya di transport)", gh2.semuaApi&&gh2.semuaBearer&&gh2.total>0, JSON.stringify({total:gh2.total,api:gh2.semuaApi,bearer:gh2.semuaBearer}));
  catat("urutan Git Data API benar: ref->base commit->blobs->tree(base_tree)->commit(parents)->PATCH(force false)", gh2.adaRef&&gh2.adaBaseCommit&&gh2.nBlob>0&&gh2.treeBaseTree==="baseTREE"&&gh2.treeJumlah===gh2.nBlob&&JSON.stringify(gh2.commitParents)==='["baseSHA"]'&&gh2.commitTree==="newTREE"&&gh2.patchSha==="newCOMMIT"&&gh2.patchForce===false, JSON.stringify({ref:gh2.adaRef,base:gh2.adaBaseCommit,blob:gh2.nBlob,baseTree:gh2.treeBaseTree,parents:gh2.commitParents,force:gh2.patchForce}));
  catat("token dibersihkan dari field sesudah push + tidak bocor ke localStorage/readCfg/bundel", gh2.tokenKosong&&!gh2.lsAdaToken&&!gh2.cfgAdaToken&&!gh2.bundelAdaToken, JSON.stringify({kosong:gh2.tokenKosong,ls:gh2.lsAdaToken,cfg:gh2.cfgAdaToken,bundel:gh2.bundelAdaToken}));
  catat("ghMsg lapor sukses jujur: commit pendek + tautan commit repo", gh2.msgTerpush&&gh2.msgCommit&&gh2.msgLink.includes("github.com/o/r/commit/newCOMMIT"), JSON.stringify({terpush:gh2.msgTerpush,commit:gh2.msgCommit,link:gh2.msgLink}));

  console.log("\n7f) gerbang scaffold sadar-starter: rencana migrasi-first lolos saat starter aktif, tab Cek rencana jujur");
  const sgOn = await nilai(`(()=>{
    const sd = state.docs, si = state.issues;
    const sel = document.getElementById("starterPilih"); const sv = sel ? sel.value : "";
    try{
      state.docs = { tasks:{ tasks:[{ id:"T-001", title:"Buat migrasi tabel categories dan expenses di atas starter", description:"tambah tabel fitur di DB starter yang sudah jalan", files_or_areas:["db/migrations/001.sql","lib/db.js"], verification:"npm test", acceptance_criteria:["tabel dibuat"] }] } };
      state.issues = [];
      if(sel) sel.value = "nextjs-fullstack";
      const aktif = starterAktif(readCfg());
      const r = rubrikRencana(state.docs, state.issues, aktif);
      draw("issues");
      const out = document.getElementById("out").textContent;
      return { aktif, siap:r.siap, skor:r.skor, error:r.error, tabBersih:/Lolos cek struktur/.test(out), tabAdaMasalah:/Masalah struktur/.test(out) };
    } finally { state.docs = sd; state.issues = si; if(sel) sel.value = sv; }
  })()`);
  catat("starter aktif di GUI: rencana migrasi-first T-001 lolos gerbang Connect (skor 100)", sgOn.aktif===true&&sgOn.siap===true&&sgOn.skor===100, JSON.stringify(sgOn));
  catat("starter aktif: tab Cek rencana bersih, tidak menampilkan masalah struktur palsu", sgOn.tabBersih&&!sgOn.tabAdaMasalah, JSON.stringify({bersih:sgOn.tabBersih,masalah:sgOn.tabAdaMasalah}));
  const sgOff = await nilai(`(()=>{
    const sd = state.docs, si = state.issues;
    const sel = document.getElementById("starterPilih"); const sv = sel ? sel.value : "";
    try{
      state.docs = { tasks:{ tasks:[{ id:"T-001", title:"Buat migrasi tabel categories dan expenses", description:"tambah tabel fitur", files_or_areas:["db/001.sql"], verification:"npm test", acceptance_criteria:["tabel dibuat"] }] } };
      state.issues = [];
      if(sel) sel.value = "";
      const aktif = starterAktif(readCfg());
      const r = rubrikRencana(state.docs, state.issues, aktif);
      draw("issues");
      const out = document.getElementById("out").textContent;
      return { aktif, siap:r.siap, skor:r.skor, adaScaffold:/bukan scaffold/.test(r.error.join(" ")), tabAdaMasalah:/Masalah struktur/.test(out), tabKlaimLolos:/Lolos cek struktur/.test(out) };
    } finally { state.docs = sd; state.issues = si; if(sel) sel.value = sv; }
  })()`);
  catat("tanpa starter: migrasi-first tetap ditahan gerbang (bukan scaffold, skor 80)", sgOff.aktif===false&&sgOff.siap===false&&sgOff.adaScaffold&&sgOff.skor===80, JSON.stringify(sgOff));
  catat("tanpa starter: tab Cek rencana JUJUR menampilkan masalah struktur yang menahan Connect", sgOff.tabAdaMasalah&&!sgOff.tabKlaimLolos, JSON.stringify({masalah:sgOff.tabAdaMasalah,klaimLolos:sgOff.tabKlaimLolos}));

  console.log("\n7g) environment warnings vs strict starter contract");
  const envUi = await nilai(`(()=>{
    const sd=state.docs, si=state.issues, sel=el("starterPilih"), sv=sel.value;
    try{
      state.docs={tasks:{tasks:[{id:"T-001",title:"Tambah tabel",verification:"npm run migrate",files_or_areas:["db/schema.sql"],acceptance_criteria:["tabel tersedia"]}]}};
      state.issues=[]; sel.value="nextjs-fullstack";
      const good=rubrikRencana(state.docs,[],true); draw("issues");
      const issueText=el("out").textContent;
      draw("runner"); const runnerText=el("out").textContent;
      state.docs.tasks.tasks[0].verification="npm run db:migrate";
      const bad=rubrikRencana(state.docs,[],true); draw("issues");
      return {good:good.siap, score:good.skor, hints:good.warn.length,
        issuesHints:issueText.includes("tidak menahan Connect")&&issueText.includes("doctor --environment"),
        runnerHints:runnerText.includes("Persiapan lingkungan")&&runnerText.includes("setup-env"),
        bad:!bad.siap, badVisible:el("out").textContent.includes("db:migrate")};
    }finally{state.docs=sd;state.issues=si;sel.value=sv;}
  })()`);
  catat("environment hints do not block Connect or lower score", envUi.good&&envUi.score===100&&envUi.hints>0, JSON.stringify(envUi));
  catat("issues and Runner both show actionable environment steps", envUi.issuesHints&&envUi.runnerHints, JSON.stringify(envUi));
  catat("unknown starter script remains a visible hard error", envUi.bad&&envUi.badVisible, JSON.stringify(envUi));
  catat("tidak ada error console selama seluruh probe", errors.length===0, errors.slice(0,3).join(" | "));
  kode = hasil.every(h=>h.lulus) ? 0 : 1;
}catch(e){
  console.log("GAGAL menjalankan probe: " + (e && e.stack || e));
  catat("probe berjalan tanpa exception", false, String(e && e.message || e));
  kode = 1;
}finally{
  try{ if(ws) ws.close(); }catch(e){}
  try{ await closeBrowser(browser); }
  finally{
    await tidur(600);
    try{ cleanupTempDirs(); }
    finally{ sweepStaleTempDirs(); }
  }
}
const lulus = hasil.filter(h=>h.lulus).length, gagal = hasil.length - lulus;
fs.writeFileSync(RECEIPT, JSON.stringify({ waktu:new Date().toISOString(), index:INDEX, lulus, gagal, errors, hasil }, null, 2));
console.log("\n" + lulus + " lulus, " + gagal + " gagal — receipt: " + RECEIPT.replace(/\\/g,"/") + "\n");
process.exit(kode);