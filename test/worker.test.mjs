import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as W from "../worker.mjs";
import { cleanupTempDirs, cleanupTempDirsSince, makeTempDir, tempDirCheckpoint, sweepStaleTempDirs } from "./temp-dirs.mjs";

/* harness: tiap skenario dapat proyek temporer + agen bohongan */
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ca = html.indexOf("/* ===================== CORE-BEGIN ===================== */");
const cb = html.indexOf("/* ===================== CORE-END ===================== */");
const PF = new Function(html.slice(ca, cb) + "; return {DEMO, defaultGates, runnerBundle, agentsMd, planTaskList};")();

let pass = 0, fail = 0;
/* konsol disenyapkan selama badan uji supaya log runner tidak menumpuk di output */
const t = (name, fn)=>{
  const checkpoint = tempDirCheckpoint();
  let err = null; mute();
  try{ fn(); } catch(e){ err = e; }
  finally{
    unmute();
    try{ cleanupTempDirsSince(checkpoint); }catch(e){ if(!err) err = e; }
  }
  if(err){ fail++; console.log("  FAIL " + name + "\n       " + String(err.stack || err).split("\n").slice(0,3).join("\n       ")); }
  else { pass++; console.log("  ok   " + name); }
};

const FAKE = new URL("./fake-agent.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const NODE = process.execPath;
const okCheck = { id:"build", label:"Build", cmd:'"' + NODE + '" -e "console.log(1)"', enabled:true, blocking:true };
const badCheck = { id:"build", label:"Build", cmd:'"' + NODE + '" -e "process.exit(1)"', enabled:true, blocking:true };
const agentCfg = { name:"fake", cmd:NODE, args:[FAKE, "{PROMPT}"], contArgs:[FAKE, "{PROMPT}"], timeoutMin:1 };
const quiet = { reviews: [], hard: [okCheck], limits:{ maxCalls:200, maxConsecutiveFails:3, fullEvery:99, fixRounds:1, autoCommit:false } };

/* Worker sekarang MENJALANKAN perintah verification tiap task. Task DEMO adalah contoh
   aplikasi kasir yang file-nya tidak ada di folder uji, jadi verification-nya ditukar
   dengan perintah yang beneran hijau. Task list buatan uji (verification:"v", kalimat
   "Buka browser...") TIDAK disentuh — justru itu yang dipakai menguji penolakan. */
const VERIF_UJI = '"' + NODE + '" -e "console.log(\'verifikasi uji hijau\')"';
/* ui:false = keputusan manusia yang tercatat di plan: task fixture ini dipakai menguji mekanisme
   loop, bukan bukti tampilan. behavior ikut dibuang supaya runner tidak menyalakan browser sungguhan
   di tiap uji. Penegak perilaku diuji sendiri di browser.test.mjs. */
const tasksUji = (list)=> JSON.parse(JSON.stringify(list)).map(x=>{ const c = Object.assign(x, { verification: VERIF_UJI, ui: false }); delete c.behavior; return c; });
/* agen bohongan melaporkan $0.0042 per panggilan; rem biaya/sesi dimatikan di harness
   supaya yang diuji perilakunya. Remnya sendiri diuji terpisah di bagian 7. */
const limitsUji = (l)=> Object.assign({ maxCostUsd:null, maxCallsPerRun:null }, l || {});

function project(gates, taskList){
  const dir = makeTempDir("planforge-worker-");
  fs.mkdirSync(path.join(dir, ".planforge"));
  fs.writeFileSync(path.join(dir, ".planforge", "plan.json"), JSON.stringify({
    generatedAt:new Date().toISOString(), brief:PF.DEMO.clarify, prd:PF.DEMO.prd, roadmap:PF.DEMO.roadmap,
    tasks:{ tasks: taskList || tasksUji(PF.DEMO.tasks.tasks) }, issues:[]
  }));
  const g = Object.assign({ agent: agentCfg }, gates);
  g.limits = limitsUji(g.limits);
  fs.writeFileSync(path.join(dir, ".planforge", "gates.json"), JSON.stringify(g));
  return dir;
}
const read = (dir)=>({
  state: JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "state.json"), "utf8")),
  log: fs.readFileSync(path.join(dir, ".planforge", "RUN_LOG.md"), "utf8")
});
/* senyapkan konsol runner supaya hasil uji enak dibaca */
const say = console.log, mute = ()=>{ console.log = ()=>{}; }, unmute = ()=>{ console.log = say; };
function run(args){ mute(); try{ const c = W.main(args); return c; } finally{ unmute(); } }

console.log("\n1) loop happy path — task per task dengan jeda gerbang");

t("sembilan task selesai satu per satu, reviewer + gerbang penuh ikut jalan", ()=>{
  const dir = project({
    limits:{ maxCalls:300, maxConsecutiveFails:3, fullEvery:3, fullAtMilestoneEnd:false, fixRounds:1, autoCommit:false },
    hard:[okCheck],
    reviews: [{ id:"light", label:"Review ringan tiap task", tier:"light", enabled:true, prompt:"nilai task di atas" },
      ...W.FULL_GATES.map(g=>Object.assign({}, g, { enabled: g.id !== "watch" }))]
  });
  run(["run", "--dir", dir]);
  const r = read(dir);
  assert.equal(r.state.doneTasks, 9, JSON.stringify(Object.entries(r.state.tasks).map(([k,v])=>k+":"+v.status)));
  assert.ok(r.state.calls >= 9 + 9 + 3, "reviewer/gerbang penuh tidak terhitung: " + r.state.calls);
  assert.match(r.log, /gerbang penuh/);
  assert.match(r.log, /reviewer light: bersih/);
  assert.equal(r.state.tasks["T-001"].gate.hard.length, 1);
  assert.equal(r.state.tasks["T-001"].gate.hard[0].pass, true);
  assert.equal(r.state.tasks["T-001"].status, "selesai");
  assert.ok(Math.abs(r.state.costUsd - r.state.calls*0.0042) < 1e-4, "biaya per panggilan tidak terakumulasi: " + r.state.costUsd + " vs " + r.state.calls);
  assert.equal(r.state.spentNotes.length, r.state.calls, "setiap panggilan harus ada catatan biayanya");
});

t("urutan eksekusi menghormati depends_on (rantai T-001 -> T-009)", ()=>{
  const dir = project(quiet);
  run(["run", "--dir", dir]);
  const order = read(dir).log.split("\n").filter(l=>/task berikutnya:/.test(l)).map(l=>/T-\d{3}/.exec(l)[0]);
  assert.deepEqual(order, ["T-001","T-002","T-003","T-004","T-005","T-006","T-007","T-008","T-009"], order.join(","));
});

t("milestone berikutnya memicu gerbang penuh sebelum task pertama milestone itu", ()=>{
  const dir = project({
    limits:{ maxCalls:300, fullEvery:99, fullAtMilestoneEnd:true, fixRounds:1, autoCommit:false },
    hard:[okCheck],
    reviews:[{ id:"audit", label:"Audit menyeluruh", tier:"full", enabled:true, prompt:"audit {FROM} sampai {TO}" }]
  });
  run(["run", "--dir", dir]);
  const r = read(dir);
  assert.ok(/gerbang penuh/.test(r.log), "gerbang penuh akhir milestone tidak jalan");
  assert.match(r.log, /audit T-001 sampai/);
});

t("--max-tasks memotong loop; --only mengerjakan satu task melompati antrean", ()=>{
  const dir = project(quiet);
  run(["run", "--dir", dir, "--max-tasks", "2"]);
  assert.equal(read(dir).state.doneTasks, 2);
  run(["run", "--dir", dir, "--only", "T-004"]);
  const r = read(dir);
  assert.equal(r.state.tasks["T-004"].status, "selesai");
  assert.equal(r.state.doneTasks, 3);
  assert.match(r.log, /batas --max-tasks tercapai/);
});

t("--dry-run mencetak prompt tanpa memanggil agen dan tanpa menghitung panggilan", ()=>{
  const dir = project(Object.assign({}, quiet, { hard:[] }));
  run(["run", "--dir", dir, "--dry-run", "--max-tasks", "1"]);
  const logTxt = fs.readFileSync(path.join(dir, ".planforge", "RUN_LOG.md"), "utf8");
  assert.match(logTxt, /\[dry-run\]/);
  assert.equal(fs.existsSync(path.join(dir, ".planforge", "state.json")), false, "dry-run tidak boleh menulis state.json");
});

t("--dry-run tidak boleh menandai task selesai maupun commit", ()=>{
  const dir = project(Object.assign({}, quiet, { limits:{ maxCalls:200, maxConsecutiveFails:3, fullEvery:99, fixRounds:1, autoCommit:true } }));
  W.saveCtx(W.loadCtx(dir));                       // state.json seperti punya paket web
  const before = fs.readFileSync(path.join(dir, ".planforge", "state.json"), "utf8");
  let printed = "";
  const say2 = console.log; console.log = (...a)=>{ printed += a.join(" ") + "\n"; };
  let code; try{ code = W.main(["run", "--dir", dir, "--dry-run"]); } finally{ console.log = say2; }
  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(dir, ".planforge", "state.json"), "utf8"), before, "dry-run mengubah state.json");
  assert.match(printed, /prompt yang akan dikirim ke agen \(T-001\)/, "prompt harus ikut ditampilkan: " + printed.slice(0, 200));
  assert.match(printed, /TASK T-001/);
  assert.match(read(dir).log, /tidak ada task yang diubah/);
});

t("--no-gates mematikan semua gerbang (mode cepat)", ()=>{  const dir = project({ reviews:[{ id:"light", label:"Review ringan", tier:"light", enabled:true, prompt:"x" }], hard:[badCheck], limits:quiet.limits });
  run(["run", "--dir", dir, "--no-gates", "--max-tasks", "1"]);
  const r = read(dir);
  assert.equal(r.state.tasks["T-001"].status, "selesai", "dengan gerbang mati task harus lolos: " + JSON.stringify(r.state.tasks["T-001"]));
});

console.log("\n2) gerbang keras: gagal berarti gagal, loop berhenti");

t("gate blocking gagal -> ronde perbaikan -> task gagal, tidak dihitung selesai", ()=>{
  const dir = project({ hard:[badCheck], reviews:[], limits:{ maxCalls:60, maxConsecutiveFails:5, fullEvery:99, fixRounds:1, autoCommit:false } });
  run(["run", "--dir", dir, "--max-tasks", "1"]);
  const r = read(dir);
  assert.equal(r.state.tasks["T-001"].status, "gagal");
  assert.equal(r.state.doneTasks, 0, "task gagal dihitung selesai!");
  assert.match(r.log, /ronde perbaikan 1/);
  assert.match(JSON.stringify(r.state.tasks["T-001"].gate.hard), /"pass":false/);
});

t("rantai berhenti dengan rapi: T-002 tidak sempat jalan karena T-001 gagal", ()=>{
  const dir = project({ hard:[badCheck], reviews:[], limits:{ maxCalls:60, maxConsecutiveFails:5, fullEvery:99, fixRounds:0, autoCommit:false } });
  run(["run", "--dir", dir]);
  const r = read(dir);
  assert.match(r.log, /mentok: T-002/);
  assert.match(r.log, /node worker\.mjs run --only T-001/);
  assert.equal(Object.values(r.state.tasks).filter(x=>x.status === "sedang").length, 0, "ada task tertinggal di status sedang");
});
t("task gagal bisa dicoba ulang dengan --only lalu antrean dilanjutkan", ()=>{
  const tasks = [
    { id:"T-001", title:"Perbaiki fondasi", depends_on:[], verification:VERIF_UJI, ui:false },
    { id:"T-002", title:"Lanjut fitur", depends_on:["T-001"], verification:VERIF_UJI, ui:false }
  ];
  const dir = project(quiet, tasks), ctx = W.loadCtx(dir);
  ctx.state.tasks["T-001"].status = "gagal";
  W.saveCtx(ctx);
  run(["run", "--dir", dir]);
  assert.match(read(dir).log, /node worker\.mjs run --only T-001/);
  run(["run", "--dir", dir, "--only", "T-001"]);
  assert.equal(read(dir).state.tasks["T-001"].status, "selesai");
  run(["run", "--dir", dir]);
  assert.equal(read(dir).state.tasks["T-002"].status, "selesai");
});

t("tiga kegagalan berturut-turut menghentikan sesi (batas maxConsecutiveFails)", ()=>{
  const par = [
    { id:"T-001", title:"a", feature:"Kerangka aplikasi", depends_on:[], acceptance_criteria:["x"], verification:"v", requirement_refs:["R-001"], milestone_ref:"M-001" },
    { id:"T-002", title:"b", feature:"Kerangka aplikasi", depends_on:[], acceptance_criteria:["x"], verification:"v", requirement_refs:["R-001"], milestone_ref:"M-001" },
    { id:"T-003", title:"c", feature:"Kerangka aplikasi", depends_on:[], acceptance_criteria:["x"], verification:"v", requirement_refs:["R-001"], milestone_ref:"M-001" },
    { id:"T-004", title:"d", feature:"Kerangka aplikasi", depends_on:[], acceptance_criteria:["x"], verification:"v", requirement_refs:["R-001"], milestone_ref:"M-001" }
  ];
  const dir = project({ hard:[badCheck], reviews:[], limits:{ maxCalls:60, maxConsecutiveFails:3, fullEvery:99, fixRounds:0, autoCommit:false } }, par);
  run(["run", "--dir", dir]);
  const r = read(dir);
  assert.equal(Object.values(r.state.tasks).filter(x=>x.status === "gagal").length, 3);
  assert.equal(r.state.tasks["T-004"].status, "belum mulai", "task ke-4 tidak boleh disentuh");
  assert.match(r.log, /berhenti: 3 kegagalan/);
});

t("agen menyerah (blocked) dicatat sebagai gagal dengan alasannya", ()=>{
  const dir = project({ hard:[okCheck], reviews:[], limits:{ maxCalls:40, fullEvery:99, fixRounds:0, autoCommit:false } });
  fs.writeFileSync(path.join(dir, ".planforge", "force-block"), "1");
  run(["run", "--dir", dir, "--max-tasks", "1"]);
  const r = read(dir);
  assert.equal(r.state.tasks["T-001"].status, "gagal");
  assert.match(r.state.tasks["T-001"].note, /diblokir agen/);
  assert.match(r.state.tasks["T-001"].note, /informasi skema/);
});

t("budget panggilan habis -> berhenti, bukan jalan terus", ()=>{
  const dir = project({ hard:[okCheck], reviews:[], limits:{ maxCalls:3, fullEvery:99, autoCommit:false } });
  run(["run", "--dir", dir]);
  assert.match(read(dir).log, /budget panggilan habis \(3\)/);
});

t("perintah agen tidak ada di PATH -> pesan yang bisa ditindaklanjuti", ()=>{
  const dir = project(Object.assign({}, quiet, { agent:{ name:"fake", cmd:"agy-tidak-ada", args:["{PROMPT}"], contArgs:null, timeoutMin:1 } }));
  assert.throws(()=>run(["run", "--dir", dir, "--max-tasks", "1"]), /tidak ditemukan di PATH/);
});

console.log("\n3) MCP server: jalur agen-IDE (tanpa runner)");
const mcpCtx = ()=>{
  const dir = project({ hard:[okCheck], reviews:[], limits:{ maxCalls:9, fullEvery:99, autoCommit:false } });
  return W.loadCtx(dir);
};
t("initialize + tools/list memberi kontrak tool yang sah", ()=>{
  const ctx = mcpCtx();
  const init = W.mcpHandle({ jsonrpc:"2.0", id:1, method:"initialize" }, ctx);
  assert.equal(init.result.protocolVersion, "2024-11-05");
  assert.equal(init.result.serverInfo.name, "planforge-worker");
  const names = W.mcpHandle({ jsonrpc:"2.0", id:2, method:"tools/list" }, ctx).result.tools.map(x=>x.name);
  for(const n of ["plan_status","next_task","get_task","mark_done","mark_failed","gate_list"]) assert.ok(names.includes(n), "tool hilang: " + n);
  for(const tool of W.mcpHandle({ jsonrpc:"2.0", id:3, method:"tools/list" }, ctx).result.tools) assert.ok(tool.inputSchema && tool.inputSchema.type === "object", tool.name);
});
t("next_task memberi kartu tugas, mark_done menulis state yang dibaca runner", ()=>{
  const ctx = mcpCtx();
  const txt = W.mcpHandle({ jsonrpc:"2.0", id:4, method:"tools/call", params:{ name:"next_task", arguments:{} } }, ctx).result.content[0].text;
  for(const s of ["TASK T-001", "KRITERIA SELESAI", "VERIFIKASI", "DEPENDENCY", "PROYEK:"]) assert.ok(txt.includes(s), "kurang: " + s + "\n" + txt.slice(0, 200));
  W.mcpHandle({ jsonrpc:"2.0", id:5, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"halaman menu 1,2 detik" } } }, ctx);
  const st = JSON.parse(fs.readFileSync(path.join(ctx.dir, "state.json"), "utf8"));
  assert.equal(st.tasks["T-001"].status, "selesai");
  assert.equal(st.doneTasks, 1);
  assert.match(W.mcpHandle({ jsonrpc:"2.0", id:6, method:"tools/call", params:{ name:"plan_status", arguments:{} } }, ctx).result.content[0].text, /selesai 1/);
});
t("mark_done menolak klaim tipis, bukan bukti", ()=>{
  const ctx = mcpCtx();
  const out = W.mcpHandle({ jsonrpc:"2.0", id:20, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"selesai udah kelar kok" } } }, ctx).result.content[0].text;
  assert.match(out, /^TOLAK T-001/, out);
  assert.match(out, /verification cuma klaim/, out);
  const pendek = W.mcpHandle({ jsonrpc:"2.0", id:25, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"lulus" } } }, ctx).result.content[0].text;
  assert.match(pendek, /terlalu pendek/, pendek);
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(ctx.dir, "state.json"), "utf8")).tasks["T-001"].status, "selesai");
});
t("mark_done menjalankan gerbang sendiri — build merah berarti ditolak", ()=>{
  const dir = project({ hard:[badCheck], reviews:[], limits:{ maxCalls:9, fullEvery:99, autoCommit:false } });
  const ctx = W.loadCtx(dir);
  const out = W.mcpHandle({ jsonrpc:"2.0", id:21, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"npm test -> 9 passed, halaman 360px kebaca" } } }, ctx).result.content[0].text;
  assert.match(out, /gerbang keras masih merah/, out);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "state.json"), "utf8")).tasks["T-001"].status !== "selesai", true);
});
t("di repo git, mark_done menolak kalau nggak ada satu file pun yang berubah", ()=>{
  const dir = project({ hard:[okCheck], reviews:[], limits:{ maxCalls:9, fullEvery:99, autoCommit:false } });
  for(const c of [["init","-q"],["config","user.email","uji@test"],["config","user.name","uji"]]) spawnSync("git", c, { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","awal"], { cwd:dir, encoding:"utf8" });
  const ctx = W.loadCtx(dir);
  const out = W.mcpHandle({ jsonrpc:"2.0", id:22, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"npm test -> 9 passed in 1s, semua kriteria tercakup" } } }, ctx).result.content[0].text;
  assert.match(out, /tidak ada file yang berubah/, out);
});
t("file connector PlanForge yang belum di-commit BUKAN bukti kerja", ()=>{
  const dir = project({ hard:[okCheck], reviews:[], limits:{ maxCalls:9, fullEvery:99, autoCommit:false } });
  for(const c of [["init","-q"],["config","user.email","uji@test"],["config","user.name","uji"]]) spawnSync("git", c, { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","awal"], { cwd:dir, encoding:"utf8" });
  for(const f of ["AGENTS.md", "worker.mjs", ".mcp.json"]) fs.writeFileSync(path.join(dir, f), "x");
  assert.ok(String(spawnSync("git", ["status", "--porcelain"], { cwd:dir, encoding:"utf8" }).stdout).trim(), "fixture harus benar-benar kotor");
  assert.deepEqual(W.changedFiles(dir), [], "file infra tidak boleh muncul sebagai bukti");
  const ctx = W.loadCtx(dir);
  const out = W.mcpHandle({ jsonrpc:"2.0", id:26, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"npm test -> 9 passed in 1s, semua kriteria tercakup" } } }, ctx).result.content[0].text;
  assert.match(out, /tidak ada file yang berubah/, "file milik PlanForge sendiri tidak boleh jadi bukti: " + out);
});
t("mark_done yang sah menulis state dan hanya menambah hitungan sekali", ()=>{
  const ctx = mcpCtx();
  const ok = W.mcpHandle({ jsonrpc:"2.0", id:23, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"npm test -> 9 passed; GET localhost:8000 balas 200" } } }, ctx).result.content[0].text;
  assert.match(ok, /^ok, T-001 selesai/, ok);
  W.mcpHandle({ jsonrpc:"2.0", id:24, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"npm test -> 9 passed lagi" } } }, ctx);
  const s = JSON.parse(fs.readFileSync(path.join(ctx.dir, "state.json"), "utf8"));
  assert.equal(s.doneTasks, 1, "panggil dua kali tidak boleh menghitung dua: " + s.doneTasks);
  assert.match(s.tasks["T-001"].note, /bukti: npm test/);
});
t("mark_done menolak task yang dependensinya belum selesai, lalu menerima sesudah urut", ()=>{
  const tasks = [
    { id:"T-001", title:"fondasi", description:"", agent_hint:"", acceptance_criteria:["ada"], depends_on:[], verification:VERIF_UJI, ui:false },
    { id:"T-002", title:"lanjutan", description:"", agent_hint:"", acceptance_criteria:["ada"], depends_on:["T-001"], verification:VERIF_UJI, ui:false }
  ];
  const dir = project({ hard:[okCheck], reviews:[], limits:{ maxCalls:9, fullEvery:99, autoCommit:false } }, tasks);
  const ctx = W.loadCtx(dir);
  const panggil = (id)=> W.mcpHandle({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:"mark_done", arguments:{ id, verification:'node -e "console.log(1)" -> verifikasi uji hijau' } } }, ctx).result.content[0].text;
  const tolak = panggil("T-002");
  assert.match(tolak, /^TOLAK T-002/, tolak);
  assert.match(tolak, /dependensi belum selesai: T-001/, tolak);
  const s = JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "state.json"), "utf8"));
  assert.notEqual(s.tasks["T-002"].status, "selesai", "task terkunci dependensi tidak boleh dicap selesai");
  assert.match(panggil("T-001"), /^ok, T-001 selesai/);
  assert.match(panggil("T-002"), /^ok, T-002 selesai/, "sesudah dependensi selesai, task boleh ditutup");
});
t("method dan tool tak dikenal -> error JSON-RPC, tidak crash", ()=>{
  const ctx = mcpCtx();
  assert.equal(W.mcpHandle({ jsonrpc:"2.0", id:7, method:"foo/bar" }, ctx).error.code, -32601);
  assert.equal(W.mcpHandle({ jsonrpc:"2.0", id:8, method:"tools/call", params:{ name:"tidak_ada", arguments:{} } }, ctx).error.code, -32602);
  assert.equal(W.mcpHandle({ jsonrpc:"2.0", id:9, method:"notifications/initialized" }, ctx), null);
});
t("gate_list menyebut ritme dan gerbang yang menahan loop", ()=>{
  const ctx = mcpCtx();
  ctx.gates.reviews[0] = { id:"audit", label:"Audit menyeluruh", tier:"full", enabled:true, prompt:"x" };
  const txt = W.mcpHandle({ jsonrpc:"2.0", id:10, method:"tools/call", params:{ name:"gate_list", arguments:{} } }, ctx).result.content[0].text;
  assert.match(txt, /build\*/);
  assert.match(txt, /full · Audit menyeluruh/);
});

console.log("\n4) potongan logika yang dipakai ulang");

t("nextTask tidak pernah memberi task yang dependensinya belum selesai", ()=>{
  const plan = { tasks: JSON.parse(JSON.stringify(PF.DEMO.tasks.tasks)) };
  const state = { tasks:{} };
  assert.equal(W.nextTask(plan, state).id, "T-001");
  state.tasks["T-001"] = { status:"selesai" };
  assert.equal(W.nextTask(plan, state).id, "T-002");
  for(const x of plan.tasks) state.tasks[x.id] = { status:"selesai" };
  assert.equal(W.nextTask(plan, state), null, "antrean habis harus null");
});
t("task yang tidak bisa lagi dicapai dilaporkan sebagai __blocked beserta penyebabnya", ()=>{
  const plan = { tasks: JSON.parse(JSON.stringify(PF.DEMO.tasks.tasks)) };
  const n = W.nextTask(plan, { tasks:{ "T-001":{ status:"gagal" } } });
  assert.ok(n.__blocked, JSON.stringify(n));
  assert.deepEqual(n.needs, ["T-001"]);
});
t("hanya verdict JSON terakhir dari agen yang dipercaya", ()=>{
  assert.equal(W.extractVerdict('selesai {"done":true,"verification":"ok"} catatan penutup').done, true);
  assert.equal(W.extractVerdict("saya butuh informasi: {belum lengkap}"), null);
  assert.equal(W.extractVerdict("tidak ada json"), null);
  assert.deepEqual(W.extractVerdict('rimbit {"a":{"dalam":1},"done":true}'), {a:{dalam:1}, done:true});
  assert.equal(W.extractVerdict('{"done":false} lalu terpotong {"done":tru').done, false, "verdict utuh terakhir yang dipakai kalau potongan terakhir rusak");
});
t("performa diukur: budget Lighthouse menandai angka yang lewat", ()=>{
  const fake = { out: JSON.stringify({ audits:{
    "first-contentful-paint": { numericValue: 2400 }, "interactive": { numericValue: 5100 },
    "largest-contentful-paint": { numericValue: 3000 }, "performance": { score: 0.42 } } }) };
  const bad = W.metricProblems(fake, { firstContentfulPaint_ms:1500, interactive_ms:3500 });
  assert.equal(bad.length, 2, JSON.stringify(bad));
  assert.match(bad.join(" "), /FCP 2400ms > 1500ms/);
  assert.match(bad.join(" "), /TTI 5100ms > 3500ms/);
  assert.deepEqual(W.metricProblems({ out:"bukan json" }, { firstContentfulPaint_ms:1500 }).length, 1);
  assert.deepEqual(W.metricProblems(fake, null), []);
});
t("kartu tugas memuat fitur induk, sub-fitur, dan requirement yang dirujuk", ()=>{
  const dir = project(Object.assign({}, quiet));
  const ctx = W.loadCtx(dir);
  const card = W.taskCard(ctx.plan, ctx.plan.tasks.tasks[3]);
  assert.match(card, /TASK T-004/);
  assert.match(card, /FITUR INDUK: Pesan & kasir/);
  assert.match(card, /R-00\d/);
});
t("gates.json bawaan = watchlist 1-5 dengan ritme bertingkat", ()=>{
  const g = W.defaultGates("agy");
  assert.equal(g.agent.cmd, "agy");
  assert.equal(g.limits.fullEvery, 6);
  assert.deepEqual(g.reviews.map(r=>r.tier), ["light","full","full","full","full","full"]);
  assert.equal(g.reviews.filter(r=>r.enabled).length, 5, "watchlist kosong tidak boleh ikut aktif");
  assert.deepEqual(g.hard.filter(h=>h.enabled).map(h=>h.id), ["build","test","lint"]);
});
t("preset agen tersedia untuk Antigravity, Claude, Cursor, Gemini, Codex", ()=>{
  for(const k of ["agy","claude","cursor","gemini","codex"]){
    const p = W.AGENT_PRESETS[k];
    assert.ok(p.cmd && p.args.includes("{PROMPT}"), k);
  }
});
t("nama adapter WorkBuddy resolves ke preset CLI-nya — perintah yang dicetak Connect tidak boleh crash", ()=>{
  const g = W.defaultGates("workbuddy");
  assert.equal(g.agent.name, "workbuddy");
  assert.equal(g.agent.cmd, W.AGENT_PRESETS.codebuddy.cmd);
  assert.deepEqual(g.agent.args, W.AGENT_PRESETS.codebuddy.args);
  assert.equal(W.presetAgen("workbuddy").label, W.AGENT_PRESETS.codebuddy.label);
});
t("nama agen asing ditolak dengan daftar pilihan, bukan TypeError yang tidak bisa dibaca", ()=>{
  assert.throws(()=>W.defaultGates("qoder"), /tidak dikenal/);
  assert.throws(()=>W.defaultGates("qoder"), /codebuddy/);
  assert.equal(W.presetAgen("tidak-ada"), null);
  assert.equal(W.defaultGates().agent.cmd, "agy");
});

console.log("\n5) paket dari tab Runner (index.html) benar-benar bisa dijalankan worker");

/* tulis isi runnerBundle apa adanya ke folder proyek, hanya agen ditukar ke agen bohongan */
function webPackage(extraGates, bundleOpts){
  const dir = makeTempDir("planforge-pkg-");
  const gates = Object.assign(PF.defaultGates("agy"), extraGates || {});
  gates.agent = agentCfg;
  gates.hard = [okCheck];
  gates.limits = Object.assign({}, gates.limits, { maxCostUsd:null, maxCallsPerRun:null });
  for(const f of PF.runnerBundle({clarify:PF.DEMO.clarify, prd:PF.DEMO.prd, roadmap:PF.DEMO.roadmap, tasks:{tasks:tasksUji(PF.DEMO.tasks.tasks)}}, [], gates, bundleOpts || {})){
    const p = path.join(dir, f.name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.data);
  }
  return dir;
}
function workerAt(dir){
  const copy = path.join(dir, "worker.mjs");
  fs.copyFileSync(fileURLToPath(new URL("../worker.mjs", import.meta.url)), copy);
  return copy;
}

t("plan.json + gates.json + state.json hasil web dibaca worker tanpa penyesuaian", ()=>{
  const dir = webPackage();
  const ctx = W.loadCtx(dir);
  assert.equal(ctx.plan.tasks.tasks.length, 9);
  assert.equal(ctx.gates.limits.fullEvery, 6);
  assert.equal(Object.keys(ctx.state.tasks).length, 9);
  assert.equal(W.nextTask(ctx.plan, ctx.state).id, "T-001");
  assert.ok(ctx.gates.reviews.some(r=>r.enabled && r.id === "audit"), "watchlist audit tidak ikut terbaca");
});
t("runner mengerjakan task pertama dari paket web, lalu berhenti sesuai batas", ()=>{
  const dir = webPackage({limits:Object.assign(PF.defaultGates("agy").limits, {maxCalls:60, fullEvery:99, fixRounds:1, autoCommit:false})});
  const code = run(["run", "--dir", dir, "--max-tasks", "1"]);
  assert.equal(code, 0);
  const s = JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "state.json"), "utf8"));
  assert.equal(s.tasks["T-001"].status, "selesai");
  assert.equal(s.doneTasks, 1);
  assert.ok(fs.existsSync(path.join(dir, ".planforge", "RUN_LOG.md")));
});
t("AGENTS.md ikut terekstrak di akar proyek dan menyebut runner + watchlist", ()=>{
  const dir = webPackage();
  const md = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.ok(md.includes("node worker.mjs run"), "perintah jalan tidak tertulis");
  assert.ok(md.includes("1. Audit menyeluruh"), "urutan watchlist tidak tertulis");
  assert.ok(/\bfake\b|perintah/.test(md));
});
t("mcp_config.json hasil web: relatif kalau folder dikosongkan, absolut + --dir kalau diisi", ()=>{
  const dir = webPackage();
  const rel = JSON.parse(fs.readFileSync(path.join(dir, ".agents", "mcp_config.json"), "utf8"));
  assert.equal(rel.mcpServers.planforge.command, "node");
  assert.ok(rel.mcpServers.planforge.args.includes("mcp"));
  assert.ok(!rel.mcpServers.planforge.args.includes("--dir"),
    "paket tanpa folder proyek tidak boleh mengunci --dir: " + rel.mcpServers.planforge.args.join(" "));
  const fwd = dir.replace(/\\/g, "/");
  const other = webPackage(null, { projectDir: fwd, workerPath: fwd + "/worker.mjs" });
  const cfg = JSON.parse(fs.readFileSync(path.join(other, ".agents", "mcp_config.json"), "utf8"));
  const args = cfg.mcpServers[W.mcpServerName(fwd)].args;
  assert.equal(args[0], fwd + "/worker.mjs", "worker path harus absolut: " + args.join(" "));
  assert.equal(args[args.indexOf("--dir") + 1], fwd, "connector global harus tahu folder proyeknya");
  workerAt(dir);
  const st = spawnSync(process.execPath, args, { cwd: os.tmpdir(), encoding:"utf8", timeout:30000,
    input: JSON.stringify({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:"next_task", arguments:{} } }) + "\n" });
  assert.equal(st.status, 0, "config absolut hasil web gagal jalan sendiri: " + (st.stderr || st.stdout));
  assert.match(st.stdout, /TASK T-001/);
});

t("nama script npm dibaca benar walau flag-nya di mana saja", ()=>{
  assert.equal(W.npmScriptNama("npm run build"), "build");
  assert.equal(W.npmScriptNama("npm --silent run build"), "build", "flag sebelum run pernah membuat 'run' dianggap nama script");
  assert.equal(W.npmScriptNama("npm run --silent build"), "build");
  assert.equal(W.npmScriptNama("npm test"), "test");
  assert.equal(W.npmScriptNama("yarn build"), "build");
  assert.equal(W.npmScriptNama("pnpm run lint:fix"), "lint:fix");
  assert.equal(W.npmScriptNama("npm run build -- --watch"), "build");
  assert.equal(W.npmScriptNama("npm install"), null);
  assert.equal(W.npmScriptNama("npm ci"), null);
  assert.equal(W.npmScriptNama("npx tsc --noEmit"), null);
  assert.equal(W.npmScriptNama("node --test test/x.mjs"), null);
});

t("script npm yang tidak ada di package.json tidak membuat semua task gagal", ()=>{
  const dir = project(Object.assign({}, quiet, { hard: W.defaultGates("agy").hard }));
  const ctx = W.loadCtx(dir);
  assert.deepEqual(ctx.gates.hard.filter(h=>h.enabled).map(h=>h.id), ["build","test","lint"]);
  const off0 = W.pruneUnavailableGates(ctx, dir);
  assert.deepEqual(off0.map(x=>x.id), ["build","test","lint"], "tanpa package.json gerbang npm mustahil jalan — harus dimatikan, bukan tasknya disalahkan");
  assert.deepEqual(ctx.gates.hard.filter(h=>h.enabled).map(h=>h.id), []);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({name:"x", scripts:{build:"node -e 0", lint:"node -e 0"}}));
  const c2 = W.loadCtx(dir);
  const off = W.pruneUnavailableGates(c2, dir);
  assert.deepEqual(off.map(x=>x.id), ["test"], "hanya gerbang tanpa script yang dimatikan: " + JSON.stringify(off));
  assert.deepEqual(c2.gates.hard.filter(h=>h.enabled).map(h=>h.id), ["build","lint"]);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({name:"x", scripts:{build:"node -e 0", test:"node -e 0", lint:"node -e 0"}}));
  const c3 = W.loadCtx(dir);
  assert.deepEqual(W.pruneUnavailableGates(c3, dir), []);
  assert.deepEqual(c3.gates.hard.filter(h=>h.enabled).map(h=>h.id), ["build","test","lint"]);
});

t("gerbang npm hidup lagi setelah task scaffold membuat package.json", ()=>{
  const dir = project(Object.assign({}, quiet, { hard: W.defaultGates("agy").hard }));
  const ctx = W.loadCtx(dir);
  W.pruneUnavailableGates(ctx, dir);
  assert.deepEqual(ctx.gates.hard.filter(h=>h.enabled).map(h=>h.id), [], "prasyarat: semua gerbang npm mati dulu");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({name:"x", scripts:{build:"node -e 0", test:"node -e 0", lint:"node -e 0"}}));
  assert.deepEqual(W.pruneUnavailableGates(ctx, dir), []);
  assert.deepEqual(ctx.gates.hard.filter(h=>h.enabled).map(h=>h.id), ["build","test","lint"], "ctx yang sama harus menghidupkan lagi gerbang yang dia matikan sendiri");
  assert.ok(!ctx.gates.hard.some(h=>h.autoOff), "penanda autoOff harus dibersihkan");
});

t("gerbang yang dimatikan manual tidak dihidupkan paksa", ()=>{
  const dir = project(Object.assign({}, quiet, { hard: W.defaultGates("agy").hard }));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({name:"x", scripts:{build:"node -e 0", test:"node -e 0", lint:"node -e 0"}}));
  const ctx = W.loadCtx(dir);
  ctx.gates.hard.find(h=>h.id === "build").enabled = false;
  assert.deepEqual(W.pruneUnavailableGates(ctx, dir), []);
  assert.equal(ctx.gates.hard.find(h=>h.id === "build").enabled, false, "keputusan manusia harus tetap dihormati");
  assert.deepEqual(ctx.gates.hard.filter(h=>h.enabled).map(h=>h.id), ["test","lint"]);
});

t("proyek statis tanpa package.json: task tetap bisa dibuktikan lewat verification", ()=>{
  const dir = project(Object.assign({}, quiet, { hard: W.defaultGates("agy").hard }));
  const ctx = W.loadCtx(dir);
  const b = W.buktiSelesai(ctx, dir, "T-001", VERIF_UJI + " — output: verifikasi uji hijau");
  assert.deepEqual(b.hard, [], "gerbang npm yang mustahil jalan tidak boleh ikut dinilai: " + JSON.stringify(b.hard));
  assert.ok(b.ver.ok, "verification harus tetap dijalankan: " + JSON.stringify(b.ver.kurang));
  assert.ok(b.ok, "task ditolak padahal bukti hijau: " + JSON.stringify(b.kurang));
});

t("IDE boleh memanggil worker dari cwd apa pun (MCP Antigravity tidak menjamin cwd)", ()=>{
  const dir = webPackage();
  const copy = path.join(dir, "worker.mjs");
  fs.copyFileSync(fileURLToPath(new URL("../worker.mjs", import.meta.url)), copy);
  const asing = makeTempDir("planforge-asing-");
  const st = spawnSync(process.execPath, [copy, "status"], { cwd: asing, encoding: "utf8", timeout: 30000 });
  assert.equal(st.status, 0, "status gagal dari cwd asing: " + st.stderr);
  assert.match(st.stdout, /T-001/);
  const mcp = spawnSync(process.execPath, [copy, "mcp"], {
    cwd: asing, encoding: "utf8", timeout: 30000,
    input: JSON.stringify({ jsonrpc:"2.0", id:1, method:"tools/list" }) + "\n"
  });
  assert.match(mcp.stdout, /next_task/, "mcp dari cwd asing: " + (mcp.stderr || mcp.stdout));
  assert.equal(path.resolve(W.resolveRoot({ dir })), path.resolve(dir), "--dir absolut harus dipakai apa adanya");
});

console.log("\n6) agen yang cuma ngomong tanpa ngerjain — runner tidak boleh ikut percaya");

const SILENT = new URL("./silent-agent.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const silentCfg = { name:"silent", cmd:NODE, args:[SILENT, "{PROMPT}"], contArgs:null, timeoutMin:1 };

t("sampul agy dengan response kosong dikenali sebagai balasan kosong", ()=>{
  const dir = project(Object.assign({}, quiet, { agent: silentCfg }));
  const ctx = W.loadCtx(dir);
  const r = W.callAgent(ctx, "kerjakan apa pun", {});
  assert.equal(r.kosong, true, "response:\"\" harus ditandai kosong: " + JSON.stringify(r));
  assert.equal(r.ok, false);
  assert.equal(r.session, "00000000-0000-0000-0000-000000000001", "conversation_id tetap kebaca");
});
t("task dengan balasan kosong ditandai gagal, bukan selesai", ()=>{
  const dir = project(Object.assign({}, quiet, { agent: silentCfg }));
  run(["run", "--dir", dir, "--max-tasks", "1"]);
  const r = read(dir);
  assert.equal(r.state.tasks["T-001"].status, "gagal", JSON.stringify(r.state.tasks["T-001"]));
  assert.match(r.state.tasks["T-001"].note, /kosong/);
  assert.equal(r.state.doneTasks, 0, "balasan kosong tidak boleh menambah hitungan selesai");
  assert.match(r.log, /BALASAN KOSONG/);
});
t("kalau tidak ada satu file pun yang berubah, task BUKAN selesai meski semua gerbang hijau", ()=>{
  const dir = project(Object.assign({}, quiet));
  spawnSync("git", ["init", "-q"], { cwd: dir, encoding:"utf8" });
  spawnSync("git", ["config", "user.email", "uji@test"], { cwd: dir, encoding:"utf8" });
  spawnSync("git", ["config", "user.name", "uji"], { cwd: dir, encoding:"utf8" });
  spawnSync("git", ["add", "-A"], { cwd: dir, encoding:"utf8" });
  spawnSync("git", ["commit", "-q", "-m", "awal"], { cwd: dir, encoding:"utf8" });
  assert.deepEqual(W.changedFiles(dir), [], "repo bersih harus []");
  fs.writeFileSync(path.join(dir, ".planforge", "catatan.txt"), "cuma catatan internal");
  run(["run", "--dir", dir, "--max-tasks", "1"]);
  const st = read(dir).state.tasks["T-001"];
  assert.equal(st.status, "gagal", JSON.stringify(st));
  assert.match(st.note, /tidak ada file yang berubah/);
  const s = JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "state.json"), "utf8"));
  s.tasks["T-001"] = { status:"belum mulai", tries:0, gate:null, note:"" }; s.consecFails = 0;
  fs.writeFileSync(path.join(dir, ".planforge", "state.json"), JSON.stringify(s));
  run(["run", "--dir", dir, "--max-tasks", "1", "--allow-noop"]);
  assert.equal(read(dir).state.tasks["T-001"].status, "selesai", "--allow-noop harus tetap bisa dipakai buat task murni verifikasi");
});
t("auto-commit menjelaskan pemulihan saat folder kerja bukan repo Git", ()=>{
  const dir = project(quiet), ctx = W.loadCtx(dir);
  W.saveCtx(ctx);
  const result = W.gitCommit(ctx, dir, { id:"T-001", title:"Task uji" }, null);
  assert.equal(result, null);
  assert.match(read(dir).log, /bukan repo Git/);
  assert.match(read(dir).log, /git init && git add \. && git commit -m "init"/);
});
t("agen yang mengkommit kerjanya sendiri tetap terbaca sebagai perubahan", ()=>{
  const dir = project(Object.assign({}, quiet));
  for(const c of [["init", "-q"], ["config", "user.email", "uji@test"], ["config", "user.name", "uji"]]) spawnSync("git", c, { cwd: dir, encoding:"utf8" });
  spawnSync("git", ["add", "-A"], { cwd: dir, encoding:"utf8" });
  spawnSync("git", ["commit", "-q", "-m", "awal"], { cwd: dir, encoding:"utf8" });
  const before = String(spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding:"utf8" }).stdout).trim();
  assert.deepEqual(W.changedFiles(dir, before), [], "tepat sesudah kommit awal belum ada perubahan");
  process.env.PF_SELF_COMMIT = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "1"]); } finally{ delete process.env.PF_SELF_COMMIT; }
  assert.ok(W.changedFiles(dir, before).includes("src/dari-agen.js"),
    "kerja yang sudah dikommit agen harus terlihat berubah, bukan dianggap nol");
  const st = read(dir).state.tasks["T-001"];
  assert.equal(st.status, "selesai", JSON.stringify(st));
});
t("verify T-001: menagih kommit HEAD yang benar, tanpa memanggil agen", ()=>{
  const dir = project(Object.assign({}, quiet));
  for(const c of [["init", "-q"], ["config", "user.email", "uji@test"], ["config", "user.name", "uji"]]) spawnSync("git", c, { cwd: dir, encoding:"utf8" });
  fs.writeFileSync(path.join(dir, "src.js"), "export const a = 1;\n");
  spawnSync("git", ["add", "-A"], { cwd: dir, encoding:"utf8" });
  spawnSync("git", ["commit", "-q", "-m", "T-001: bikin modul"], { cwd: dir, encoding:"utf8" });
  assert.equal(run(["verify", "T-001", "--dir", dir]), 0, "HEAD punya id + file nyata + gerbang hijau");
  const st = read(dir).state.tasks["T-001"];
  assert.equal(st.status, "selesai");
  assert.match(st.note, /verifikasi ulang tanpa agen/);
  assert.match(st.note, /src\.js/);
  assert.equal(read(dir).state.calls, 0, "verify tidak boleh menghabiskan budget agen");
  assert.equal(run(["verify", "T-002", "--dir", dir]), 1, "HEAD bukan milik T-002");
  assert.equal(read(dir).state.tasks["T-002"].status, "belum mulai", "verify yang menolak tidak boleh mengubah catatan");
  assert.equal(read(dir).state.doneTasks, 1, "hitung ulang tidak boleh ganda");
});
t("verify manual yang gagal tidak menandai task belum mulai sebagai gagal", ()=>{
  const dir = project({ reviews:[], hard:[badCheck], limits:{ maxCalls:20, fixRounds:0 } }, [
    { id:"T-001", title:"Belum dikerjakan", depends_on:[], verification:'node -e "process.exit(7)"', ui:false }
  ]);
  W.saveCtx(W.loadCtx(dir));
  const file = path.join(dir, ".planforge", "state.json");
  const before = fs.readFileSync(file, "utf8");
  const output = [], original = console.log;
  console.log = (...args)=>output.push(args.join(" "));
  let code;
  try{ code = W.main(["verify", "T-001", "--dir", dir]); }finally{ console.log = original; }
  assert.equal(code, 1);
  assert.match(output.join("\n"), /status ledger tidak diubah/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(read(dir).state.tasks["T-001"].status, "belum mulai");
});
t("agen menolak karena kredit habis: loop berhenti, task tidak dicatat gagal", ()=>{
  const dir = project(Object.assign({}, quiet));
  process.env.PF_CREDITS = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "5"]); } finally{ delete process.env.PF_CREDITS; }
  const r = read(dir);
  assert.match(r.log, /DITANGGUH/, "harus bilang agen menolak: " + r.log.slice(-400));
  assert.match(r.log, /credits balance/, "alasan agen harus ikut tercatat");
  assert.match(r.log, /BERHENTI/, "loop harus langsung berhenti, bukan lanjut bakar call: " + r.log.slice(-300));
  assert.equal(r.state.calls, 1, "satu call saja, bukan 5: " + r.state.calls);
  assert.equal(r.state.tasks["T-001"].status, "belum mulai", JSON.stringify(r.state.tasks["T-001"]));
  assert.equal(r.state.doneTasks, 0);
  assert.equal(r.state.consecFails, 0, "kredit habis bukan salah task, jangan menambah rem kegagalan");
});
const BELUM_LOGIN = "console.error('Authentication required. Please use /login command to sign in to your account')";
t("CLI belum login (teks polos, exit 0): loop berhenti, task tidak dicatat gagal", ()=>{
  const dir = project(Object.assign({}, quiet, { agent: { name:"x", cmd:NODE, args:["-e", BELUM_LOGIN, "{PROMPT}"], contArgs:null, timeoutMin:1 } }));
  const ctx = W.loadCtx(dir);
  const c = W.callAgent(ctx, "kerjakan", {});
  assert.equal(c.ok, false, "teks error auth bukan jawaban: " + JSON.stringify(c));
  assert.match(String(c.agenError), /Authentication required/);
  run(["run", "--dir", dir, "--max-tasks", "5"]);
  const r = read(dir);
  assert.match(r.log, /DITANGGUH/, r.log.slice(-400));
  assert.equal(r.state.tasks["T-001"].status, "belum mulai", JSON.stringify(r.state.tasks["T-001"]));
  assert.equal(r.state.consecFails, 0);
  assert.equal(r.state.calls, 1, "harus berhenti di panggilan pertama: " + r.state.calls);
});
t("preset yang minta JSON tapi dibalas teks polos = agen menolak; balasan kosong = kosong", ()=>{
  const teks = project(Object.assign({}, quiet, { agent: { name:"x", cmd:NODE, args:["-e", "console.log('halo, aku bukan JSON')", "--", "--output-format", "json", "{PROMPT}"], contArgs:null, timeoutMin:1 } }));
  const a = W.callAgent(W.loadCtx(teks), "kerjakan", {});
  assert.match(String(a.agenError), /bukan JSON/, JSON.stringify(a));
  assert.equal(a.ok, false);
  const sepi = project(Object.assign({}, quiet, { agent: { name:"x", cmd:NODE, args:["-e", "0", "{PROMPT}"], contArgs:null, timeoutMin:1 } }));
  const b = W.callAgent(W.loadCtx(sepi), "kerjakan", {});
  assert.equal(b.kosong, true, JSON.stringify(b));
  assert.equal(b.ok, false);
});
t("amplop JSON yang didahului baris log tetap terbaca sebagai balasan agen", ()=>{
  const dir = project(Object.assign({}, quiet));
  process.env.PF_CREDITS = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "1"]); } finally{ delete process.env.PF_CREDITS; }
  assert.match(read(dir).log, /DITANGGUH/, "parse per baris harus menemukan sampulnya");
});
t("reviewer yang balas JSON tapi bukan verdict tidak dihitung bersih", ()=>{
  const dir = project(Object.assign({}, quiet, { reviews:[{ id:"light", label:"Review ringan", tier:"light", enabled:true, prompt:"nilai task di atas" }] }));
  process.env.PF_NOTVERDICT = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "1"]); } finally{ delete process.env.PF_NOTVERDICT; }
  const r = read(dir);
  assert.match(r.log, /TIDAK ADA VERDICT/, r.log.slice(-400));
  assert.equal(r.state.tasks["T-001"].gate.light[0].pass, false, JSON.stringify(r.state.tasks["T-001"].gate.light));
});
t("connect <agen> nulis konfigurasi MCP + instruksi untuk agen mana pun", ()=>{
  const dir = project(Object.assign({}, quiet));
  const keluaran = [];
  const say = console.log; console.log = (s)=>keluaran.push(String(s));
  try{ assert.equal(W.main(["connect", "workbuddy", "--dir", dir]), 0); } finally{ console.log = say; }
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".mcp.json"), "utf8"));
  const p = cfg.mcpServers[W.mcpServerName(dir)];
  assert.equal(p.command, "node");
  assert.ok(p.args.includes("mcp") && p.args.includes("--dir"), "args harus: worker.mjs mcp --dir <proyek>: " + JSON.stringify(p.args));
  assert.equal(p.args[p.args.indexOf("--dir") + 1].replace(/\\/g, "/"), dir.replace(/\\/g, "/"), "folder proyek ditulis absolut");
  const aturan = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(aturan, /next_task/); assert.match(aturan, /mark_done/);
  assert.match(aturan, /tanpa bukti dianggap kegagalan/);
  assert.ok(aturan.includes(W.mcpServerName(dir)));
  assert.ok(aturan.indexOf("plan_status") < aturan.indexOf("next_task"));
  assert.match(aturan, /Kalau berbeda atau tidak jelas: STOP/);
  assert.match(keluaran.join("\n"), /WorkBuddy/);
  assert.match(keluaran.join("\n"), /BELUM bukti tersambung/);
  assert.match(keluaran.join("\n"), /Panggil plan_status/);
});
t("connect vscode memakai bentuk `servers`, connect ulang tidak menimpa server lain", ()=>{
  const dir = project(Object.assign({}, quiet));
  fs.mkdirSync(path.join(dir, ".vscode"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".vscode", "mcp.json"), JSON.stringify({ servers:{ lain:{ type:"stdio", command:"x" } }, inputs:[] }));
  const say = console.log; console.log = ()=>{};
  try{ W.main(["connect", "vscode", "--dir", dir]); W.main(["connect", "claude", "--dir", dir]); } finally{ console.log = say; }
  const v = JSON.parse(fs.readFileSync(path.join(dir, ".vscode", "mcp.json"), "utf8"));
  assert.ok(v.servers.lain, "server lain tidak boleh hilang");
  assert.equal(v.servers[W.mcpServerName(dir)].type, "stdio");
  assert.ok(fs.existsSync(path.join(dir, ".mcp.json")), "claude pakai .mcp.json");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".mcp.json"), "utf8")).mcpServers[W.mcpServerName(dir)].timeout, 600);
});
t("connect mempertahankan connector lama proyek lain, dengan nama baru yang terpisah", ()=>{
  const dir = project(quiet);
  const legacy = { command:"node", args:["D:/PROJECTS/trade-news/worker.mjs", "mcp", "--dir", "D:/PROJECTS/trade-news"] };
  fs.writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers:{ planforge:legacy } }));
  W.connectAgent(dir, "workbuddy");
  W.connectAgent(dir, "workbuddy");
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, ".mcp.json"), "utf8"));
  assert.deepEqual(cfg.mcpServers.planforge, legacy);
  assert.deepEqual(Object.keys(cfg.mcpServers), ["planforge", W.mcpServerName(dir)]);
  assert.equal(cfg.mcpServers[W.mcpServerName(dir)].args.at(-1), dir.replace(/\\/g, "/"));
});
t("nama MCP dibedakan berdasarkan path lengkap, bukan basename saja", ()=>{
  assert.notEqual(W.mcpServerName("D:/A/app"), W.mcpServerName("D:/B/app"));
  assert.equal(W.mcpServerName("D:/A/app/"), W.mcpServerName("d:\\a\\APP"));
  assert.match(W.mcpServerName("D:/PROJECTS/testing-planforge"), /^planforge-testing-planforge-[a-f0-9]{8}$/);
  assert.equal(W.mcpServerName(""), "planforge");
});
t("opencode: mcpSnippet pakai mcp.servers type local + command array, bukan mcpServers", ()=>{
  const dir = "D:/PROJECTS/uji-oc";
  const j = JSON.parse(W.mcpSnippet(dir, "opencode"));
  const nama = W.mcpServerName(dir);
  assert.ok(j.mcp && j.mcp.servers && j.mcp.servers[nama]);
  assert.ok(!j.mcpServers);
  assert.equal(j.mcp.servers[nama].type, "local");
  assert.deepEqual(j.mcp.servers[nama].command, ["node", "D:/PROJECTS/uji-oc/worker.mjs", "mcp", "--dir", "D:/PROJECTS/uji-oc"]);
  assert.equal(j.mcp.servers[nama].enabled, true);
});
t("mcpUniversal worker: satu perintah + tiga dialect, nama konsisten", ()=>{
  const dir = "D:/PROJECTS/uji-oc";
  const u = W.mcpUniversal(dir);
  const nama = W.mcpServerName(dir);
  assert.equal(u.nama, nama);
  assert.equal(u.perintah, "node D:/PROJECTS/uji-oc/worker.mjs mcp --dir D:/PROJECTS/uji-oc");
  assert.ok(JSON.parse(u.blok.mcpServers).mcpServers[nama]);
  assert.equal(JSON.parse(u.blok.servers).servers[nama].type, "stdio");
  assert.equal(JSON.parse(u.blok.mcp).mcp.servers[nama].type, "local");
});
t("connectAgent opencode menulis opencode.json dan menggabung server lain yang sudah ada", ()=>{
  const dir = project(quiet);
  fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify({ mcp:{ servers:{ lain:{ type:"local", command:["x"] } } } }));
  const say = console.log; console.log = ()=>{};
  try{ W.connectAgent(dir, "opencode"); } finally{ console.log = say; }
  const j = JSON.parse(fs.readFileSync(path.join(dir, "opencode.json"), "utf8"));
  assert.ok(j.mcp.servers.lain, "server lain tidak boleh hilang");
  assert.equal(j.mcp.servers[W.mcpServerName(dir)].type, "local");
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));
});
t("connect --list menyebut semua agen yang ada", ()=>{
  const dir = project(Object.assign({}, quiet));
  const baris = []; const say = console.log; console.log = (s)=>baris.push(String(s));
  let rc; try{ rc = W.main(["connect", "--list", "--dir", dir]); } finally{ console.log = say; }
  assert.equal(rc, 0);
  for(const k of Object.keys(W.AGENT_ADAPTERS)) assert.ok(baris.join("\n").includes(k), "daftar kurang " + k);
});
t("reviewer yang tidak mengembalikan verdict tidak dihitung bersih", ()=>{
  const dir = project(Object.assign({}, quiet, { reviews:[{ id:"light", label:"Review ringan", tier:"light", enabled:true, prompt:"nilai task di atas" }] }));
  process.env.PF_NOVERDICT = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "1"]); } finally{ delete process.env.PF_NOVERDICT; }
  const r = read(dir);
  assert.match(r.log, /TIDAK ADA VERDICT/, "reviewer tanpa verdict harus kelihatan: " + r.log.slice(-400));
  const lg = r.state.tasks["T-001"].gate.light;
  assert.equal(lg[0].pass, false, JSON.stringify(lg));
});
t("reviewer ringan yang menolak menahan kelulusan walau semua gerbang lain hijau", ()=>{
  const dir = project(Object.assign({}, quiet, { reviews:[{ id:"light", label:"Review ringan", tier:"light", enabled:true, prompt:"nilai task di atas" }] }));
  process.env.PF_LIGHT_FAIL = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "1"]); } finally{ delete process.env.PF_LIGHT_FAIL; }
  const r = read(dir), st = r.state.tasks["T-001"];
  assert.equal(st.gate.hard[0].pass, true, "gerbang keras harus tetap hijau supaya yang diuji cuma reviewer");
  assert.equal(st.gate.verify.pass, true);
  assert.equal(st.gate.light[0].pass, false);
  assert.equal(st.status, "gagal", "temuan reviewer harus menahan kelulusan: " + JSON.stringify(st));
  assert.match(st.note, /reviewer ringan menolak/, st.note);
  assert.equal(r.state.doneTasks, 0, "task yang ditolak reviewer tidak boleh dihitung selesai");
});

t("audit menangkap gerbang yang nggak akan pernah jalan — tanpa panggilan agen", ()=>{
  const mk = (o)=> Object.assign({ id:"T-00X", title:"judul", description:"", agent_hint:"", acceptance_criteria:[], verification:"", depends_on:[] }, o);
  const tasks = [
    mk({ id:"T-001", verification:"Buka browser, klik radio 60, verifikasi di console Network" }),
    mk({ id:"T-002", verification:'<input type="radio" name="window"> muncul di halaman' }),
    mk({ id:"T-003", verification:"npx lighthouse http://localhost:3000 | jq .audits" }),
    mk({ id:"T-004", title:"ambang 0,05 persen", description:"arah per window", acceptance_criteria:["Given change_pct 0.02 Then UP"], verification:'"' + NODE + '" -e "console.log(1)"' }),
    mk({ id:"T-005", verification:'"' + NODE + '" scripts/tidak-ada.py' }),
    mk({ id:"T-006", title:"header yang 期望 muncul", verification:'"' + NODE + '" -e "console.log(1)"' }),
    mk({ id:"T-007", verification:"curl -i http://localhost:8000/health; echo '---'" }),
    mk({ id:"T-008", verification:"sqlite3 trader_news.db 'PRAGMA journal_mode=WAL'" }),
    mk({ id:"T-009", verification:"python import_data.py --calendar a.csv && echo 'Import OK' || echo 'Gagal'" })
  ];
  const dir = project(quiet, tasks);
  fs.writeFileSync(path.join(dir, "trader_news.db"), "x");
  const ctx = W.loadCtx(dir);
  ctx.state.tasks["T-005"] = { status:"selesai", tries:1, gate:null, note:"sudah selesai tapi filenya hilang" };
  const a = W.auditPlan(ctx, dir);
  const msg = (id)=> a.temuan.filter(x=>x.id === id).map(x=>x.lvl + ":" + x.msg).join(" | ");
  assert.match(msg("T-001"), /error:.*bukan perintah shell/, "kalimat bukan perintah: " + msg("T-001"));
  assert.match(msg("T-002"), /error:.*bukan perintah shell/, "markup HTML bukan perintah: " + msg("T-002"));
  assert.match(msg("T-003"), /npx/, "npx harus ketahuan bisa menggantung: " + msg("T-003"));
  assert.match(msg("T-003"), /butuh server/, "butuh server hidup: " + msg("T-003"));
  assert.match(msg("T-003"), /biner "jq"/, "jq tidak ada di PATH harus ketahuan: " + msg("T-003"));
  assert.match(msg("T-004"), /tidak ada yang cocok/, "0,05 di instruksi vs 0,02 di contoh: " + msg("T-004"));
  assert.match(msg("T-005"), /error:.*tidak ada di proyek/, "task selesai tapi file-nya hilang: " + msg("T-005"));
  assert.match(msg("T-006"), /error:.*aksara Mandarin/, "teks Mandarin nyasar harus ketahuan: " + msg("T-006"));
  assert.match(msg("T-007"), /error:.*tidak bisa gagal/, "echo sesudah `;` bikin gerbang abadi hijau: " + msg("T-007"));
  assert.match(msg("T-007"), /Buang penutup itu/, "saran perbaikan harus ada: " + msg("T-007"));
  assert.match(msg("T-008"), /menulis ke "trader_news\.db"/, "gerbang yang mengutak-atik DB produksi harus ketahuan: " + msg("T-008"));
  assert.match(msg("T-008"), /dev\/null/, "sqlite3 tanpa penutup stdin bisa menggantung: " + msg("T-008"));
  assert.match(msg("T-009"), /error:.*tidak bisa gagal/, "|| echo 'Gagal' juga menelan kegagalan: " + msg("T-009"));
  assert.ok(a.error.length >= 4, "error harus banyak: " + JSON.stringify(a.temuan));
  const sehatDir = project(quiet, [mk({ id:"T-001", title:"t", acceptance_criteria:[], verification:'"' + NODE + '" -e "console.log(1)" && echo "beres"' })]);
  assert.equal(W.auditPlan(W.loadCtx(sehatDir), sehatDir).error.length, 0, "gerbang sehat tidak boleh dapat error");
});
t("audit: ';' di dalam kutip dua bukan pemisah — assert/print Python tidak dikira biner shell", ()=>{
  const mk = (o)=> Object.assign({ id:"T-00X", title:"judul", description:"", agent_hint:"", acceptance_criteria:[], verification:"", depends_on:[] }, o);
  /* perintah asli yang bikin agen opencode berhenti: satu `python -c`, bukan tiga perintah */
  const v = `python -c "h=open('index.html',encoding='utf-8').read();assert ':root' in h and 'grid' in h and '1120px' in h and '@media' in h and h.count('bento-card')>=4;print('T-001 ok')"`;
  const dir = project(quiet, [mk({ id:"T-001", title:"Buat kerangka index.html", verification:v })]);
  const msg = W.auditPlan(W.loadCtx(dir), dir).temuan.filter(x=>x.id === "T-001").map(x=>x.lvl + ":" + x.msg).join(" | ");
  assert.ok(!/biner "assert"/.test(msg), "assert itu sintaks Python, bukan biner shell: " + msg);
  assert.ok(!/biner "print"/.test(msg), "print itu sintaks Python, bukan biner shell: " + msg);
  assert.ok(!/biner "h"/.test(msg), "h itu variabel Python, bukan biner shell: " + msg);
  assert.ok(!/bukan perintah shell/.test(msg), "python -c adalah perintah shell yang sah: " + msg);
});
t("audit: node -e dengan ';' di dalam kutip bersih dari error biner palsu", ()=>{
  const mk = (o)=> Object.assign({ id:"T-00X", title:"judul", description:"", agent_hint:"", acceptance_criteria:[], verification:"", depends_on:[] }, o);
  const v = '"' + NODE + '" -e "const a=1;const b=2;console.log(a+b)"';
  const dir = project(quiet, [mk({ id:"T-001", title:"t", verification:v })]);
  assert.equal(W.auditPlan(W.loadCtx(dir), dir).error.length, 0, "satu perintah node -e tidak boleh dapat error: " + JSON.stringify(W.auditPlan(W.loadCtx(dir), dir).temuan));
});
t("audit: pemisah DI LUAR kutip tetap dipecah — biner hilang ketahuan", ()=>{
  const mk = (o)=> Object.assign({ id:"T-00X", title:"judul", description:"", agent_hint:"", acceptance_criteria:[], verification:"", depends_on:[] }, o);
  const dir = project(quiet, [mk({ id:"T-001", title:"t", verification:'"' + NODE + '" -e "console.log(1)" | jqxyz .' })]);
  const msg = W.auditPlan(W.loadCtx(dir), dir).temuan.filter(x=>x.id === "T-001").map(x=>x.msg).join(" | ");
  assert.match(msg, /biner "jqxyz"/, "pipe di luar kutip harus tetap dipecah supaya jqxyz ketahuan: " + msg);
});
t("audit exit 1 dan menulis PLAN_AUDIT.md saat ada gerbang yang rusak", ()=>{
  const dir = project(quiet, [{ id:"T-001", title:"t", description:"", agent_hint:"", acceptance_criteria:[], depends_on:[], verification:"klik tombolnya lalu lihat tampilannya" }]);
  assert.equal(run(["audit", "--dir", dir]), 1, "gerbang rusak harus bikin exit code 1");
  const lap = path.join(dir, ".planforge", "PLAN_AUDIT.md");
  assert.ok(fs.existsSync(lap), "laporan harus tertulis");
  assert.match(fs.readFileSync(lap, "utf8"), /T-001/);
});
t("audit_plan lewat MCP bisa dipanggil agen sebelum dia mulai ngarang", ()=>{
  const dir = project(quiet, [{ id:"T-001", title:"t", description:"", agent_hint:"", acceptance_criteria:[], depends_on:[], verification:"Buka browser lalu lihat" }]);
  const ctx = W.loadCtx(dir);
  const names = W.mcpHandle({ jsonrpc:"2.0", id:1, method:"tools/list" }, ctx).result.tools.map(x=>x.name);
  assert.ok(names.includes("audit_plan"), "tool harus terdaftar: " + names.join(","));
  const out = W.mcpHandle({ jsonrpc:"2.0", id:2, method:"tools/call", params:{ name:"audit_plan", arguments:{} } }, ctx).result.content[0].text;
  assert.match(out, /AUDIT 1 task/, out);
  assert.match(out, /1 error/, out);
});

t("pin menulis path interpreter absolut ke npm script — gerbang tidak boleh tergantung shell", ()=>{
  const pkg = { scripts:{
    build:'python -c "from app import app; print(\'Build OK\')"',
    test:"pytest -q tests",
    lint:"python3 -m py_compile app.py",
    lain:'node -e "console.log(\'python di dalam string tidak boleh disentuh\')"'
  } };
  const abs = "C:\\Users\\x\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";
  /* di Windows path ditulis apa adanya (cmd.exe menolak garis miring), di selainnya dimiringkan.
     Tidak ada kutip: npm sudah membungkus seluruh script dengan kutip sendiri. */
  const pin = process.platform === "win32" ? abs : abs.replace(/\\/g, "/");
  const out = W.absolutkanScript(pkg, abs);
  assert.equal(out.scripts.build, pin + ' -c "from app import app; print(\'Build OK\')"');
  assert.equal(out.scripts.test, pin + " -m pytest -q tests");
  assert.equal(out.scripts.lint, pin + " -m py_compile app.py");
  assert.equal(out.scripts.lain, pkg.scripts.lain, "kata python di dalam string bukan interpreter");
  const rangkaian = W.absolutkanScript({ scripts:{ all:"pytest -q && echo OK || echo GAGAL" } }, "/usr/bin/python3");
  assert.equal(rangkaian.scripts.all, '/usr/bin/python3 -m pytest -q && echo OK || echo GAGAL', "hanya awal tiap bagian yang diganti");
  assert.equal(W.absolutkanScript({ scripts:{ x:"python 'script with space.py'" } }, "C:\\Program Files\\py\\python.exe").scripts.x,
    '"C:\\Program Files\\py\\python.exe" \'script with space.py\'', "kalau memang masih berspasi, baru dikutip");
  assert.equal(JSON.parse(JSON.stringify(out)).scripts.test, out.scripts.test, "path-nya survived round-trip JSON");
});
t("pin mencoba interpreter satu per satu dan mengembalikan package.json kalau semuanya merah", ()=>{
  const dir = project({ reviews:[], hard:[{ id:"build", label:"Build", cmd:"npm --silent run build", enabled:true, blocking:true }], limits:{ maxCalls:9, fullEvery:99, fixRounds:1 } });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts:{ build:'python -e "console.log(1)"' } }, null, 2));
  const ctx = W.loadCtx(dir);
  const asli = fs.readFileSync(path.join(dir, "package.json"), "utf8");
  const gagal = W.pinInterpreter(ctx, dir, ["Z:/python-yang-nggak-ada.exe"]);
  assert.equal(gagal.ok, false, "interpreter palsu tidak boleh dianggap hijau");
  assert.equal(fs.readFileSync(path.join(dir, "package.json"), "utf8"), asli, "gagal pin = file kembali persis seperti semula");
  const ctx2 = W.loadCtx(dir);
  const jadi = W.pinInterpreter(ctx2, dir, ["Z:/python-yang-nggak-ada.exe", NODE]);
  assert.equal(jadi.ok, true, "calon kedua (yang beneran bisa jalan) harus kepilih");
  const isi = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).scripts.build;
  assert.match(isi, /-e "console\.log\(1\)"/, "script-nya masih perintah yang sama, cuma interpreternya dipin: " + isi);
  assert.doesNotMatch(isi, /^\s*"?'?python3?\b/, "token `python` tanpa path tidak boleh tersisa: " + isi);
  assert.equal(jadi.gate.filter(x=>x.blocking).every(x=>x.pass), true, "gerbangnya harus hijau di interpreter yang dipin");
});

t("doctor dan pin tidak buang waktu di gerbang lunak — yang jalan cuma yang blocking", ()=>{
  const keras = '"' + NODE + '" -e "console.log(\'gerbang keras hijau\')"';
  const lunak = '"' + NODE + '" -e "require(\'fs\').writeFileSync(\'TERSENTUH\',\'x\')"';
  const dir = project({ reviews:[], hard:[
    { id:"build", label:"Build", cmd:keras, enabled:true, blocking:true },
    { id:"perf", label:"Perf", cmd:lunak, enabled:true, blocking:false }
  ], limits:{ maxCalls:9, fullEvery:99, fixRounds:1 } });
  const ctx = W.loadCtx(dir);
  assert.deepEqual(W.runHardGates(ctx, dir, { hanyaBlocking: true }).map(x=>x.id), ["build"], "gerbang lunak tidak boleh ikut dijalankan");
  assert.equal(fs.existsSync(path.join(dir, "TERSENTUH")), false, "gerbang lunak harus benar-benar tidak tersentuh");
  assert.deepEqual(W.runHardGates(ctx, dir).map(x=>x.id), ["build", "perf"], "tanpa opsi itu semua gerbang tetap jalan");
  assert.equal(fs.existsSync(path.join(dir, "TERSENTUH")), true, "bukti gerbang lunak memang jalan waktu tanpa opsi");
});

t("pin menjaga gaya package.json orang — tab, CRLF dan ujung file tidak ikut berubah", ()=>{
  const asli = '{\r\n\t"scripts": {\r\n\t\t"build": "python -e \\"console.log(1)\\""\r\n\t}\r\n}';
  const dir = project({ reviews:[], hard:[{ id:"build", label:"Build", cmd:"npm --silent run build", enabled:true, blocking:true }], limits:{ maxCalls:9, fullEvery:99, fixRounds:1 } });
  fs.writeFileSync(path.join(dir, "package.json"), asli);
  const jadi = W.pinInterpreter(W.loadCtx(dir), dir, [NODE]);
  assert.equal(jadi.ok, true, jadi.kenapa || "calon yang beneran ada harus hijau");
  const isi = fs.readFileSync(path.join(dir, "package.json"), "utf8");
  assert.equal(isi.endsWith("}"), true, "tidak boleh menambah baris baru di ujung file");
  assert.match(isi, /\{\r\n\t"scripts": \{\r\n\t\t"build": "/, "tab + CRLF aslinya harus tetap dipakai");
  assert.equal(isi.replace(/\r\n/g, "").includes("\n"), false, "tidak boleh ada LF nyampur di file CRLF");
  assert.match(JSON.parse(isi).scripts.build, /-e "console\.log\(1\)"/, "isi script-nya tetap perintah yang sama");
});

t("plan.json yang diganti di disk langsung dipakai lagi — connector tidak boleh jual kartu lama", ()=>{
  const dir = project(quiet, [{ id:"T-001", title:"judul lama", description:"", agent_hint:"", acceptance_criteria:[], depends_on:[], verification:"python -m pytest" }]);
  let ctx = W.loadCtx(dir);
  assert.equal(W.syncCtx(ctx).berubah, false, "belum ada yang menyunting -> tidak perlu baca ulang");
  const pj = path.join(dir, ".planforge", "plan.json");
  const plan = JSON.parse(fs.readFileSync(pj, "utf8"));
  plan.tasks.tasks[0].title = "judul baru hasil audit";
  fs.writeFileSync(pj, JSON.stringify(plan));
  const s = W.syncCtx(ctx);
  assert.equal(s.berubah, true, "perubahan di disk harus ketahuan");
  ctx = s.ctx;
  assert.match(W.mcpHandle({ jsonrpc:"2.0", id:9, method:"tools/call", params:{ name:"next_task", arguments:{} } }, ctx).result.content[0].text, /judul baru hasil audit/);
  assert.equal(W.syncCtx(ctx).berubah, false, "setelah dibaca ulang harus tenang lagi");
});
t("kode PlanForge sendiri bebas aksara Mandarin — generator yang nyasar bikin agen nyasar", ()=>{
  for(const f of ["../worker.mjs", "../index.html"]){
    const teks = fs.readFileSync(new URL(f, import.meta.url), "utf8");
    const nyasar = teks.match(/[\u3400-\u9fff\u3040-\u30ff]/g);
    assert.ok(!nyasar, f + " mengandung " + [...new Set(nyasar)].join("") + " — teks prompt yang dilihat agen ikut Mandarin");
  }
});
t("doctor menemukan proses connector yang pakai kode lama — tanpa butuh kerja sama prosesnya", ()=>{
  const dir = project(quiet);
  const wtulis = fs.statSync(path.join(dir, ".planforge", "plan.json")).mtimeMs;
  fs.writeFileSync(path.join(dir, "worker.mjs"), "// copy worker\n");
  fs.utimesSync(path.join(dir, "worker.mjs"), new Date(), new Date(wtulis + 60000));
  const tua = { pid:4321, mulai: wtulis - 1000, cmd: '"' + NODE + '" "' + path.join(dir, "worker.mjs") + '" mcp --dir "' + dir + '"' };
  const baru = { pid:9876, mulai: wtulis + 120000, cmd: '"' + NODE + '" "' + path.join(dir, "worker.mjs") + '" mcp --dir "' + dir + '"' };
  const selain = { pid:1111, mulai: wtulis, cmd: '"' + NODE + '" worker.test.mjs' };
  const d = W.doctorMcp(dir, [tua, baru, selain]);
  assert.equal(d.proses.length, 2, "hanya proses `worker.mjs mcp` yang dihitung: " + JSON.stringify(d.proses));
  const lama = d.proses.find(p=>p.pid === 4321), fresh = d.proses.find(p=>p.pid === 9876);
  assert.equal(lama.kodeLama, true, "proses yang mulai sebelum worker.mjs ditulis ulang = kode lama");
  assert.equal(lama.kartuLama, true, "dan kartu task yang dia jual juga basi");
  assert.equal(fresh.kodeLama, false, "proses yang mulai belakangan tidak boleh dituduh");
  assert.equal(fresh.kartuLama, false);
  assert.equal(W.doctorMcp(dir, []).proses.length, 0, "tidak ada connector = tidak ada tuduhan");
});
t("doctor membedakan proyek lain tanpa menuduh kode atau kartu proyek itu basi", ()=>{
  const dir = project(quiet);
  const lain = project(quiet);
  const proses = [
    { pid:1, mulai:Date.now() - 100000, cmd:'node worker.mjs mcp --dir "' + lain + '"' },
    { pid:2, mulai:Date.now() + 1000, cmd:'node worker.mjs mcp --dir "' + dir + '"' }
  ];
  const d = W.doctorMcp(dir, proses);
  assert.equal(d.proses[0].proyek, "lain");
  assert.equal(d.proses[0].kodeLama, false);
  assert.equal(d.proses[0].kartuLama, false);
  assert.equal(d.proses[1].proyek, "sesuai");
  assert.equal(d.proses[0].cmd, proses[0].cmd, "path pembeda tidak boleh terpotong");
});
t("doctor tidak menebak cwd saat --dir hilang atau relatif", ()=>{
  const dir = project(quiet);
  const d = W.doctorMcp(dir, [
    { pid:1, mulai:Date.now(), cmd:'node "' + path.join(dir, "worker.mjs") + '" mcp' },
    { pid:2, mulai:Date.now(), cmd:'node worker.mjs mcp --dir .' }
  ]);
  assert.ok(d.proses.every(p=>p.proyek === "tidak diketahui"));
  assert.ok(d.proses.every(p=>p.root === null && !p.kodeLama && !p.kartuLama));
});
t("doctor membaca path Windows dengan spasi dan case berbeda tanpa salah proyek", ()=>{
  const root = "D:/PF Doctor Test/Example";
  const d = W.doctorMcp(root, [
    { pid:1, mulai:Date.now(), cmd:'node worker.mjs mcp --dir "d:\\pf doctor test\\EXAMPLE"' },
    { pid:2, mulai:Date.now(), cmd:'node worker.mjs mcp --dir "D:/PF Doctor Test/Example-other"' }
  ]);
  assert.equal(d.proses[0].proyek, "sesuai");
  assert.equal(d.proses[1].proyek, "lain");
});
t("doctor tanpa connector proyek ini tidak mengklaim koneksi sudah terverifikasi", ()=>{
  const dir = project(quiet);
  const baris = [], original = console.log;
  console.log = s=>baris.push(String(s));
  let code;
  try{ code = W.main(["doctor", "--dir", dir, "--no-gates"]); }finally{ console.log = original; }
  assert.equal(code, 0);
  assert.match(baris.join("\n"), /INFO: tidak ada proses `worker\.mjs mcp` yang terbaca/);
  assert.doesNotMatch(baris.join("\n"), /^ok pid/m);
});
t("refresh mematikan connector basi lalu lapor fresh kalau app melahirkannya lagi", ()=>{
  const dir = project(quiet);
  let n = 0; const dibunuh = [];
  const scan = ()=> (++n === 1
    ? { proses:[{ pid:4321, proyek:"sesuai", kodeLama:true, kartuLama:true }] }
    : { proses:[{ pid:9999, proyek:"sesuai", kodeLama:false, kartuLama:false }] });
  const r = W.refreshConnector(dir, { scan, kill:pid=>{ dibunuh.push(pid); return true; }, tidur:()=>{}, tunggu:0 });
  assert.equal(r.hasil, "fresh");
  assert.deepEqual(dibunuh, [4321], "hanya connector basi yang dibunuh");
  assert.deepEqual(r.fresh, [9999]);
  assert.match(r.pesan, /lahir lagi pakai kode baru/);
});
t("refresh jujur bilang mati kalau app tidak respawn — bukan pura-pura sukses", ()=>{
  const dir = project(quiet);
  let n = 0;
  const scan = ()=> (++n === 1
    ? { proses:[{ pid:4321, proyek:"sesuai", kodeLama:true, kartuLama:false }] }
    : { proses:[] });
  const r = W.refreshConnector(dir, { scan, kill:()=>true, tidur:()=>{}, tunggu:0 });
  assert.equal(r.hasil, "mati");
  assert.match(r.pesan, /belum menghidupkan lagi/);
  assert.match(r.pesan, /opencode service restart/);
  assert.match(r.pesan, /JANGAN ambil task/);
});
t("refresh tidak mengklaim sukses kalau connector basi gagal dibunuh", ()=>{
  const dir = project(quiet);
  const scan = ()=> ({ proses:[{ pid:4321, proyek:"sesuai", kodeLama:true, kartuLama:false }] });
  const r = W.refreshConnector(dir, { scan, kill:()=>false, tidur:()=>{}, tunggu:0 });
  assert.equal(r.hasil, "gagal-bunuh");
  assert.match(r.pesan, /masih hidup/);
  assert.match(r.pesan, /reconnect manual/i);
});
t("refresh tidak menyentuh connector yang sudah kode baru", ()=>{
  const dir = project(quiet);
  let dibunuh = 0;
  const scan = ()=> ({ proses:[{ pid:9999, proyek:"sesuai", kodeLama:false, kartuLama:false }] });
  const r = W.refreshConnector(dir, { scan, kill:()=>{ dibunuh++; return true; }, tidur:()=>{}, tunggu:0 });
  assert.equal(r.hasil, "udah-baru");
  assert.equal(dibunuh, 0, "connector segar tidak boleh dibunuh");
  assert.deepEqual(r.dibunuh, []);
});
t("refresh tanpa connector proyek ini = tidak-ada, bukan pura-pura beres", ()=>{
  const dir = project(quiet);
  const scan = ()=> ({ proses:[{ pid:7777, proyek:"lain", kodeLama:true, kartuLama:true }] });
  const r = W.refreshConnector(dir, { scan, kill:()=>true, tidur:()=>{}, tunggu:0 });
  assert.equal(r.hasil, "tidak-ada");
  assert.match(r.pesan, /BELUM TERVERIFIKASI/);
});
t("refresh --dry-run cuma preview, tidak mematikan apa pun", ()=>{
  const dir = project(quiet);
  let dibunuh = 0;
  const scan = ()=> ({ proses:[{ pid:4321, proyek:"sesuai", kodeLama:true, kartuLama:true }] });
  const r = W.refreshConnector(dir, { scan, kill:()=>{ dibunuh++; return true; }, tidur:()=>{}, tunggu:0, dryRun:true });
  assert.equal(r.hasil, "dry-run");
  assert.equal(dibunuh, 0, "dry-run tidak boleh membunuh");
  assert.match(r.pesan, /AKAN dimatikan/);
  assert.match(r.pesan, /pid 4321/);
});
t("refresh hanya menarget connector proyek ini, bukan proyek lain", ()=>{
  const dir = project(quiet);
  let n = 0; const dibunuh = [];
  const scan = ()=> (++n === 1
    ? { proses:[{ pid:4321, proyek:"sesuai", kodeLama:true, kartuLama:false }, { pid:7777, proyek:"lain", kodeLama:true, kartuLama:true }] }
    : { proses:[{ pid:9999, proyek:"sesuai", kodeLama:false, kartuLama:false }] });
  const r = W.refreshConnector(dir, { scan, kill:pid=>{ dibunuh.push(pid); return true; }, tidur:()=>{}, tunggu:0 });
  assert.deepEqual(dibunuh, [4321], "connector proyek lain tidak boleh ikut dibunuh");
  assert.equal(r.hasil, "fresh");
});
t("refresh CLI tanpa connector proyek ini keluar 1 dan tidak membunuh apa pun", ()=>{
  const dir = project(quiet);
  const baris = [], original = console.log;
  console.log = s=>baris.push(String(s));
  let code;
  try{ code = W.main(["refresh", "--dir", dir, "--dry-run", "--no-gates"]); }finally{ console.log = original; }
  assert.equal(code, 1);
  assert.match(baris.join("\n"), /BELUM TERVERIFIKASI/);
});
t("plan_status menyebut folder data aktual, bukan hanya lokasi worker", ()=>{
  const dir = project(quiet);
  const ctx = W.loadCtx(dir);
  const r = W.mcpHandle({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:"plan_status", arguments:{} } }, ctx);
  assert.ok(r.result.content[0].text.includes("folder proyek: " + dir.replace(/\\/g, "/")));
  assert.equal(ctx.state.calls, 0);
});
t("jawaban tool dari proses lama diberi banner BUILD LAMA supaya manusia tahu", ()=>{
  const dir = project(quiet);
  const ctx = W.loadCtx(dir);
  const bersih = W.mcpHandle({ jsonrpc:"2.0", id:10, method:"tools/call", params:{ name:"plan_status", arguments:{} } }, ctx).result.content[0].text;
  assert.doesNotMatch(bersih, /BUILD LAMA/, "proses yang kodenya masih sama tidak boleh menakuti");
  assert.match(bersih, /build worker yang menjawab kamu: \d+:-?\d*/, "plan_status harus menyebut stempel kodenya: " + bersih);
  const tua = W.mcpHandle({ jsonrpc:"2.0", id:11, method:"tools/call", params:{ name:"plan_status", arguments:{} } }, ctx, { tua: true }).result.content[0].text;
  assert.match(tua, /^!! BUILD LAMA/, "kartu lama harus diawali peringatan");
  assert.match(tua, /restart connector/i, "peringatan harus bilang caranya: " + tua.split("\n").slice(-2).join(" "));
  assert.match(bersih, /build worker yang menjawab kamu: (\d+:-?\d*) .* build di disk: \1$/m, "baris build harus menyebut kode proses yang jalan DAN kode di disk: " + bersih);
});

t("mark_done juga bikin kommit sendiri — jalur IDE tidak boleh tanpa titik balik", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits:{ maxCalls:9, fullEvery:99, fixRounds:1, autoCommit:true } });
  for(const c of [["init","-q"],["config","user.email","uji@test"],["config","user.name","uji"]]) spawnSync("git", c, { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","awal"], { cwd:dir, encoding:"utf8" });
  fs.writeFileSync(path.join(dir, "app.py"), "print(1)\n");
  const ctx = W.loadCtx(dir);
  const out = W.mcpHandle({ jsonrpc:"2.0", id:30, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"python -m pytest -> 3 passed in 0.4s" } } }, ctx).result.content[0].text;
  assert.match(out, /^ok, T-001 selesai/, out);
  assert.match(out, /kommit [0-9a-f]+ T-001:/, "balasan harus menyebut sha kommitnya: " + out);
  assert.match(String(spawnSync("git", ["log", "-1", "--format=%s"], { cwd:dir, encoding:"utf8" }).stdout), /^T-001:/, "HEAD harus kommit task itu");
});
t("autoCommit dimatikan -> mark_done tidak maksa kommit", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits:{ maxCalls:9, fullEvery:99, fixRounds:1, autoCommit:false } });
  for(const c of [["init","-q"],["config","user.email","uji@test"],["config","user.name","uji"]]) spawnSync("git", c, { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","awal"], { cwd:dir, encoding:"utf8" });
  fs.writeFileSync(path.join(dir, "app.py"), "print(1)\n");
  const ctx = W.loadCtx(dir);
  const out = W.mcpHandle({ jsonrpc:"2.0", id:31, method:"tools/call", params:{ name:"mark_done", arguments:{ id:"T-001", verification:"python -m pytest -> 3 passed in 0.4s" } } }, ctx).result.content[0].text;
  assert.match(out, /^ok, T-001 selesai/, out);
  assert.doesNotMatch(out, /kommit [0-9a-f]/, "tidak boleh ngaku kommit: " + out);
  assert.equal(String(spawnSync("git", ["status","--porcelain"], { cwd:dir, encoding:"utf8" }).stdout).trim().split("\n").length > 0, true, "tree harus masih kotor");
});

const panggil = (ctx, name, args)=> W.mcpHandle({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name, arguments: args || {} } }, ctx).result.content[0].text;
function repoKotor(){
  const dir = project({ reviews:[], hard:[okCheck], limits:{ maxCalls:9, fullEvery:99, fixRounds:1, autoCommit:true } });
  for(const c of [["init","-q"],["config","user.email","uji@test"],["config","user.name","uji"]]) spawnSync("git", c, { cwd:dir, encoding:"utf8" });
  fs.writeFileSync(path.join(dir, "catatan pengguna.txt"), "v1\n");
  fs.writeFileSync(path.join(dir, ".mcp.json"), "{}\n");
  fs.writeFileSync(path.join(dir, "worker.mjs"), "// lama\n");
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","awal"], { cwd:dir, encoding:"utf8" });
  /* kondisi nyata uji WorkBuddy: konfigurasi baru dipasang dan pengguna punya perubahan sendiri sebelum task */
  fs.writeFileSync(path.join(dir, ".mcp.json"), "{\"baru\":1}\n");
  fs.writeFileSync(path.join(dir, "worker.mjs"), "// baru\n");
  fs.writeFileSync(path.join(dir, "catatan pengguna.txt"), "v2 belum disimpan\n");
  fs.writeFileSync(path.join(dir, "draf.md"), "draf\n");
  spawnSync("git", ["add","draf.md"], { cwd:dir, encoding:"utf8" });
  return dir;
}
const isiKommit = (dir)=> String(spawnSync("git", ["show","--name-only","--format=","HEAD"], { cwd:dir, encoding:"utf8" }).stdout).trim().split("\n").filter(Boolean).sort();

t("kommit mark_done hanya berisi file kerja task, bukan konfigurasi atau perubahan pengguna sebelumnya", ()=>{
  const dir = repoKotor();
  const ctx = W.loadCtx(dir);
  assert.match(panggil(ctx, "next_task"), /T-001/);
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "app.js"), "console.log(1)\n");
  const out = panggil(ctx, "mark_done", { id:"T-001", verification:"node --test -> 3 passed in 0.4s" });
  assert.match(out, /kommit [0-9a-f]+ T-001:/, out);
  const isi = isiKommit(dir);
  assert.ok(isi.includes("src/app.js"), "kerja task harus ikut: " + isi);
  assert.ok(isi.includes(".planforge/state.json"), "catatan worker harus ikut: " + isi);
  for(const f of [".mcp.json", "worker.mjs", "catatan pengguna.txt", "draf.md"]) assert.ok(!isi.includes(f), f + " tidak boleh ikut kommit task: " + isi);
  assert.match(out, /tidak ikut kommit \(bukan kerja task ini\):.*catatan pengguna\.txt/, "agen harus diberi tahu apa yang ditinggal: " + out);
  const sisa = String(spawnSync("git", ["status","--porcelain"], { cwd:dir, encoding:"utf8" }).stdout);
  assert.match(sisa, /^ M \.mcp\.json$/m); assert.match(sisa, /^ M worker\.mjs$/m);
  assert.match(sisa, /^A  draf\.md$/m, "file yang sudah di-stage pengguna harus tetap di-stage, bukan dikommit: " + sisa);
  assert.equal(W.loadCtx(dir).state.tasks["T-001"].kotorAwal, undefined, "potret awal harus dibuang setelah task selesai");
});

t("next_task yang dipanggil ulang di tengah kerja tidak menganggap hasil agen sebagai bawaan", ()=>{
  const dir = repoKotor();
  const ctx = W.loadCtx(dir);
  panggil(ctx, "next_task");
  fs.writeFileSync(path.join(dir, "app.js"), "console.log(1)\n");
  panggil(ctx, "next_task");
  panggil(ctx, "mark_done", { id:"T-001", verification:"node --test -> 3 passed in 0.4s" });
  assert.ok(isiKommit(dir).includes("app.js"), "app.js dibuat agen, harus ikut: " + isiKommit(dir));
});

t("file yang sudah kotor lalu diubah lagi oleh task ikut kommit dan dilaporkan terang-terangan", ()=>{
  const dir = repoKotor();
  const ctx = W.loadCtx(dir);
  panggil(ctx, "next_task");
  fs.writeFileSync(path.join(dir, "catatan pengguna.txt"), "v3 diubah task\n");
  const out = panggil(ctx, "mark_done", { id:"T-001", verification:"node --test -> 3 passed in 0.4s" });
  assert.ok(isiKommit(dir).includes("catatan pengguna.txt"));
  assert.match(out, /sudah berubah sebelum task dimulai tapi ikut kommit karena diubah lagi: catatan pengguna\.txt/, out);
});

t("jalur runner memakai potret yang sama: perubahan bawaan tidak ikut kommit task", ()=>{
  const dir = repoKotor();
  const ctx = W.loadCtx(dir);
  const awal = W.potretKotor(dir);
  fs.writeFileSync(path.join(dir, "fitur.js"), "1\n");
  W.saveCtx(ctx);
  mute(); let g; try{ g = W.gitCommit(ctx, dir, { id:"T-001", title:"fitur" }, awal); } finally{ unmute(); }
  assert.equal(g.ok, true, JSON.stringify(g));
  const isi = isiKommit(dir);
  assert.ok(isi.includes("fitur.js"), isi);
  for(const f of [".mcp.json", "worker.mjs", "catatan pengguna.txt", "draf.md"]) assert.ok(!isi.includes(f), f + " ikut: " + isi);
});

/* Regresi commit nested-repo: folder target ada DI DALAM repo git induk (mis. opencodeee
   di dalam testing-planforge). `git status --porcelain` SELALU mengembalikan path relatif
   ROOT induk ("opencodeee/..."); kalau itu diumpankan sebagai pathspec dari cwd target, git
   mencari "opencodeee/opencodeee/..." dan commit GAGAL. potretKotor harus strip prefix root
   dan filter hanya subtree target supaya induk & tetangga tidak tersapu. */
function repoNested(){
  const induk = makeTempDir("pf-induk-");
  for(const c of [["init","-q"],["config","user.email","uji@test"],["config","user.name","uji"]]) spawnSync("git", c, { cwd:induk, encoding:"utf8" });
  const dir = path.join(induk, "opencodeee");
  fs.mkdirSync(path.join(dir, ".planforge"), { recursive:true });
  fs.writeFileSync(path.join(dir, ".planforge", "plan.json"), JSON.stringify({
    generatedAt:new Date().toISOString(), brief:PF.DEMO.clarify, prd:PF.DEMO.prd, roadmap:PF.DEMO.roadmap,
    tasks:{ tasks: tasksUji(PF.DEMO.tasks.tasks) }, issues:[]
  }));
  fs.writeFileSync(path.join(dir, ".planforge", "gates.json"), JSON.stringify({
    agent: agentCfg, reviews:[], hard:[okCheck], limits: limitsUji({ maxCalls:9, fullEvery:99, fixRounds:1, autoCommit:true })
  }));
  /* repo induk punya file sendiri + proyek tetangga, semuanya sudah di-commit */
  fs.writeFileSync(path.join(induk, "catatan-induk.txt"), "induk v1\n");
  fs.mkdirSync(path.join(induk, "vscodeee"));
  fs.writeFileSync(path.join(induk, "vscodeee", "tetangga.js"), "// tetangga v1\n");
  spawnSync("git", ["add","-A"], { cwd:induk, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","awal induk"], { cwd:induk, encoding:"utf8" });
  /* pengguna mengubah file induk & tetangga SETELAH commit — tidak boleh tersapu ke kommit task target */
  fs.writeFileSync(path.join(induk, "catatan-induk.txt"), "induk v2 belum disimpan\n");
  fs.writeFileSync(path.join(induk, "vscodeee", "tetangga.js"), "// tetangga v2\n");
  return dir;
}
/* dibaca dari ROOT induk supaya path yang dibandingkan pasti relatif-root (opencodeee/...) */
const isiKommitInduk = (induk)=> String(spawnSync("git", ["show","--name-only","--format=","HEAD"], { cwd:induk, encoding:"utf8" }).stdout).trim().split("\n").filter(Boolean).sort();

t("kommit task di folder nested (di dalam repo induk) berhasil dan hanya menyapu subtree target", ()=>{
  const dir = repoNested();
  const induk = path.dirname(dir);
  try{
    const ctx = W.loadCtx(dir);
    assert.match(panggil(ctx, "next_task"), /T-001/);
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "app.js"), "console.log(1)\n");
    const out = panggil(ctx, "mark_done", { id:"T-001", verification:"node --test -> 3 passed in 0.4s" });
    assert.match(out, /kommit [0-9a-f]+ T-001:/, "commit nested harus berhasil (regresi pathspec dobel-prefix): " + out);
    const isi = isiKommitInduk(induk);
    assert.ok(isi.includes("opencodeee/src/app.js"), "kerja task harus ikut dengan path relatif root: " + isi);
    assert.ok(isi.includes("opencodeee/.planforge/state.json"), "catatan worker harus ikut: " + isi);
    for(const f of ["catatan-induk.txt", "vscodeee/tetangga.js"]) assert.ok(!isi.includes(f), f + " (di luar target) tidak boleh tersapu: " + isi);
    const sisa = String(spawnSync("git", ["status","--porcelain"], { cwd:induk, encoding:"utf8" }).stdout);
    assert.match(sisa, /catatan-induk\.txt/, "perubahan induk harus tetap belum di-commit: " + sisa);
    assert.match(sisa, /vscodeee\/tetangga\.js/, "perubahan tetangga harus tetap belum di-commit: " + sisa);
  }finally{ fs.rmSync(induk, { recursive:true, force:true }); }
});

t("potretKotor dari folder nested mengembalikan kunci relatif-target, bukan relatif-root induk", ()=>{
  const dir = repoNested();
  const induk = path.dirname(dir);
  try{
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "app.js"), "1\n");
    const p = W.potretKotor(dir);
    assert.ok(p, "potretKotor nested tidak boleh null");
    assert.ok("src/app.js" in p, "kunci harus relatif-target (src/app.js), bukan opencodeee/src/app.js: " + Object.keys(p));
    assert.ok(!Object.keys(p).some(k=>k.startsWith("opencodeee/")), "tidak boleh ada prefix root induk: " + Object.keys(p));
    assert.ok(!Object.keys(p).some(k=>k.startsWith("vscodeee/") || k === "catatan-induk.txt"), "file di luar subtree target harus difilter: " + Object.keys(p));
  }finally{ fs.rmSync(induk, { recursive:true, force:true }); }
});

t("mark_done task biasa menyuruh agen LANJUT OTOMATIS, bukan diam setelah satu task", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits:{ maxCalls:9, fullEvery:99, fixRounds:1, autoCommit:false } });
  const ctx = W.loadCtx(dir);
  assert.match(panggil(ctx, "next_task"), /T-001/);
  const out = panggil(ctx, "mark_done", { id:"T-001", verification:"node --test -> 3 passed in 0.4s" });
  assert.match(out, /^ok, T-001 selesai/, out);
  assert.match(out, /LANJUT OTOMATIS: panggil next_task lagi/, "agen harus disuruh lanjut otomatis: " + out);
  assert.match(out, /BERHENTI/, "agen harus tahu kapan berhenti: " + out);
  assert.match(out, /tidak ada task/, "agen harus tahu tanda semua selesai: " + out);
});

t("aturan agen yang ditulis Connect menyuruh LOOP OTOMATIS sampai next_task BERHENTI", ()=>{
  const dir = project(quiet);
  W.connectAgent(dir, "workbuddy");
  const md = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(md, /LOOP OTOMATIS/, "aturan Connect harus menyuruh loop otomatis");
  assert.match(md, /panggil `next_task` lagi/, "harus menyuruh panggil next_task lagi sesudah mark_done");
  assert.match(md, /BERHENTI/, "harus menyebut tanda berhenti");
});

console.log("\n6b) giliran gerbang penuh lewat connector (aplikasi GUI)");

const ADA_A = '"' + NODE + '" -e "require(\'fs\').accessSync(\'a.js\')"';
function repoGiliran(){
  const tk = (id, m, dep, v)=>({ id, title:"task " + id, milestone_ref:m, depends_on:dep, verification:v || VERIF_UJI, ui:false, acceptance_criteria:["ada"] });
  const dir = project({ reviews:[
      { id:"audit", label:"Audit", tier:"full", enabled:true, prompt:"audit {FROM}..{TO}" },
      { id:"refactor", label:"Rapikan", tier:"full", enabled:true, prompt:"rapikan" }],
    hard:[okCheck], limits:{ maxCalls:99, fullEvery:99, fullAtMilestoneEnd:true, fixRounds:1, autoCommit:true } },
    [tk("T-001", "M-1", [], ADA_A), tk("T-002", "M-1", ["T-001"]), tk("T-003", "M-2", ["T-002"])]);
  for(const c of [["init","-q"],["config","user.email","uji@test"],["config","user.name","uji"]]) spawnSync("git", c, { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","awal"], { cwd:dir, encoding:"utf8" });
  return dir;
}
function selesaikan(ctx, dir, id, file){
  assert.match(panggil(ctx, "next_task"), new RegExp("TASK " + id));
  fs.writeFileSync(path.join(dir, file), "// " + id + "\n");
  return panggil(ctx, "mark_done", { id, verification:"node --test -> 3 passed in 0.4s" });
}
const LAPOR = "audit: {\"issues\":[]}\nrefactor: {\"changed\":[\"a.js\"]}\nnode --test -> 3 passed";

t("akhir milestone membuka GILIRAN; task baru ditahan sampai giliran diterima dan dikommit", ()=>{
  const dir = repoGiliran();
  const ctx = W.loadCtx(dir);
  assert.doesNotMatch(selesaikan(ctx, dir, "T-001", "a.js"), /GILIRAN/, "T-002 masih satu milestone");
  assert.match(selesaikan(ctx, dir, "T-002", "b.js"), /BERIKUTNYA: GILIRAN-1/);
  const kartu = panggil(ctx, "next_task");
  assert.match(kartu, /GILIRAN-1: GILIRAN GERBANG PENUH atas T-001\.\.T-002/);
  assert.match(kartu, /\[audit\] Audit: audit T-001\.\.T-002/);
  assert.doesNotMatch(kartu, /TASK T-003/);
  assert.match(panggil(ctx, "get_task", { id:"GILIRAN-1" }), /GILIRAN GERBANG PENUH/);
  assert.match(panggil(ctx, "mark_done", { id:"T-003", verification:"node --test -> 3 passed in 0.4s" }), /TOLAK T-003: GILIRAN-1/);
  assert.match(panggil(ctx, "plan_status"), /giliran terbuka: GILIRAN-1/);
  assert.match(panggil(ctx, "mark_done", { id:"GILIRAN-1", verification:"audit: {\"issues\":[]} semua beres" }), /tidak menyebut hasil langkah: refactor/);
  fs.writeFileSync(path.join(dir, "a.js"), "// dirapikan\n");
  const ok = panggil(ctx, "mark_done", { id:"GILIRAN-1", verification:LAPOR });
  assert.match(ok, /ok, GILIRAN-1 diterima.*T-001=OK, T-002=OK/, ok);
  assert.match(ok, /kommit [0-9a-f]+ GILIRAN-1:/, ok);
  assert.ok(isiKommit(dir).includes("a.js"), isiKommit(dir));
  const st = W.loadCtx(dir).state;
  assert.equal(st.giliran, undefined); assert.equal(st.lastFullMark, "T-002"); assert.equal(st.sinceFull, 0);
  assert.ok(st.history.some(h=>h.gate === "GILIRAN-1"), "giliran harus tercatat di ledger");
  assert.match(selesaikan(ctx, dir, "T-003", "c.js"), /BERIKUTNYA: GILIRAN-2.*T-002\.\.T-003/, "akhir rencana = akhir milestone terakhir");
});

t("giliran ditolak kalau verification task yang dicakup jadi merah", ()=>{
  const dir = repoGiliran();
  const ctx = W.loadCtx(dir);
  selesaikan(ctx, dir, "T-001", "a.js"); selesaikan(ctx, dir, "T-002", "b.js");
  panggil(ctx, "next_task");
  fs.unlinkSync(path.join(dir, "a.js"));
  assert.match(panggil(ctx, "mark_done", { id:"GILIRAN-1", verification:LAPOR }), /TOLAK GILIRAN-1: verification T-001 merah sesudah giliran/);
  assert.ok(W.loadCtx(dir).state.giliran, "giliran harus tetap terbuka");
  fs.writeFileSync(path.join(dir, "a.js"), "// balik\n");
  assert.match(panggil(ctx, "mark_done", { id:"GILIRAN-1", verification:LAPOR }), /ok, GILIRAN-1 diterima/);
});

t("giliran gagal mengunci next_task; hanya manusia yang membuka (--ulang / --lewati)", ()=>{
  const dir = repoGiliran();
  let ctx = W.loadCtx(dir);
  selesaikan(ctx, dir, "T-001", "a.js"); selesaikan(ctx, dir, "T-002", "b.js");
  panggil(ctx, "next_task");
  assert.match(panggil(ctx, "mark_failed", { id:"GILIRAN-1", reason:"tes merah terus" }), /BERHENTI/);
  assert.match(panggil(ctx, "next_task"), /BERHENTI — GILIRAN-1 .*tes merah terus/);
  run(["giliran", "--dir", dir, "--ulang"]);
  ctx = W.loadCtx(dir);
  assert.match(panggil(ctx, "next_task"), /GILIRAN-1: GILIRAN GERBANG PENUH/);
  panggil(ctx, "mark_failed", { id:"GILIRAN-1", reason:"tetap merah" });
  run(["giliran", "--dir", dir, "--lewati"]);
  ctx = W.loadCtx(dir);
  assert.match(panggil(ctx, "next_task"), /TASK T-003/);
  assert.ok(ctx.state.history.some(h=>h.gate === "GILIRAN-1" && /DILEWATI/.test(h.out)), "lewati harus tercatat");
  assert.equal(ctx.state.lastFullMark, undefined, "audit yang dilewati tidak boleh memajukan penanda");
});

t("state.json buatan Connect (tanpa history) tidak membuat mark_done GILIRAN crash", ()=>{
  const dir = repoGiliran();
  const tasks = {}; for(const id of ["T-001","T-002","T-003"]) tasks[id] = { status:"belum mulai", tries:0, gate:null, note:"" };
  fs.writeFileSync(path.join(dir, ".planforge", "state.json"), JSON.stringify({ runId:"2026-11-13", startedAt:new Date().toISOString(),
    calls:0, spentNotes:[], tasks, doneTasks:0, sinceFull:0, consecFails:0, lastTask:null }));
  const ctx = W.loadCtx(dir);
  selesaikan(ctx, dir, "T-001", "a.js"); selesaikan(ctx, dir, "T-002", "b.js");
  panggil(ctx, "next_task");
  const ok = panggil(ctx, "mark_done", { id:"GILIRAN-1", verification:LAPOR });
  assert.match(ok, /ok, GILIRAN-1 diterima/, ok);
  assert.ok(W.loadCtx(dir).state.history.some(h=>h.gate === "GILIRAN-1"));
});

console.log("\n7) verification task: worker yang menjalankan, bukan klaim agen");

/* verifikasi yang cuma jadi hijau kalau sebuah file benar-benar ada — dipakai menguji
   merah -> ronde perbaikan -> hijau, dan penolakan mark_done/verify tanpa file itu */
const verifAda = (nama)=> '"' + NODE + '" -e "process.exit(require(\'fs\').existsSync(\'' + nama + '\') ? 0 : 1)"';
const satuTask = (verification)=> [{ id:"T-001", title:"bikin modul kasir", description:"", agent_hint:"",
  acceptance_criteria:["modulnya ada"], depends_on:[], verification }];
const mcp = (ctx, name, args)=> W.mcpHandle({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name, arguments: args || {} } }, ctx).result.content[0].text;
function gitAwal(dir){
  for(const c of [["init","-q"],["config","user.email","uji@test"],["config","user.name","uji"]]) spawnSync("git", c, { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","awal"], { cwd:dir, encoding:"utf8" });
}

t("verification berupa kalimat manual -> gagal, dan tidak membakar ronde perbaikan", ()=>{
  const dir = project(Object.assign({}, quiet, { limits: Object.assign({}, quiet.limits, { fixRounds: 2 }) }),
    satuTask("Buka browser lalu klik tombol simpan dan lihat apakah notifikasi muncul"));
  run(["run", "--dir", dir, "--max-tasks", "1"]);
  const r = read(dir), st = r.state.tasks["T-001"];
  assert.equal(st.status, "gagal", JSON.stringify(st));
  assert.match(st.note, /bukan perintah shell/);
  assert.equal(st.gate.verify.pass, false);
  assert.equal(st.gate.verify.hasil.length, 0, "tidak ada perintah yang dijalankan, jadi tidak ada hasil yang boleh dikarang");
  assert.equal(r.state.calls, 1, "plan.json cuma bisa dibetulkan manusia — ronde perbaikan tidak boleh dibakar di sini: " + r.state.calls);
  assert.equal(st.tries || 0, 0);
  assert.equal(r.state.doneTasks, 0);
});

t("verification exit 1 -> ronde perbaikan dapat perintah + exit code asli, tetap gagal kalau belum hijau", ()=>{
  const dir = project(quiet, satuTask(verifAda("bukti.txt")));
  run(["run", "--dir", dir, "--max-tasks", "1"]);
  const r = read(dir), st = r.state.tasks["T-001"];
  assert.equal(st.status, "gagal", JSON.stringify(st));
  assert.match(st.note, /verification gagal \(exit 1\)/);
  assert.equal(st.gate.verify.hasil[0].code, 1);
  assert.equal(r.state.calls, 2, "satu panggilan task + satu ronde perbaikan: " + r.state.calls);
  assert.match(r.log, /verification gagal -> ronde perbaikan 1/);
  assert.match(r.log, /verifikasi GAGAL \(exit 1/);
});

t("verification hijau -> output asli yang masuk ledger, bukan kalimat agen", ()=>{
  const dir = project(quiet);
  run(["run", "--dir", dir, "--max-tasks", "1"]);
  const st = read(dir).state.tasks["T-001"];
  assert.equal(st.status, "selesai", JSON.stringify(st));
  assert.equal(st.gate.verify.pass, true);
  assert.equal(st.gate.verify.hasil[0].code, 0);
  assert.match(st.gate.verify.hasil[0].out, /verifikasi uji hijau/, "output perintahnya harus tersimpan: " + JSON.stringify(st.gate.verify));
  assert.match(st.note, /verifikasi \(dijalankan worker\)/);
  assert.match(st.note, /exit 0/);
  assert.doesNotMatch(st.note, /hasil sesuai kriteria/, "klaim agen tidak boleh jadi bukti: " + st.note);
});

t("verification merah lalu hijau sesudah ronde perbaikan -> selesai", ()=>{
  const dir = project(quiet, satuTask(verifAda("bukti.txt")));
  process.env.PF_FIX_VERIF = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "1"]); } finally{ delete process.env.PF_FIX_VERIF; }
  const r = read(dir), st = r.state.tasks["T-001"];
  assert.equal(st.status, "selesai", JSON.stringify(st));
  assert.equal(st.gate.verify.pass, true);
  assert.equal(st.gate.verify.hasil[0].code, 0, "verifikasi harus dijalankan ULANG sesudah perbaikan, bukan pakai hasil yang merah tadi");
  assert.equal(r.state.calls, 2);
  assert.ok(fs.existsSync(path.join(dir, "bukti.txt")), "ronde perbaikan harus benar-benar menulis bukti");
  const prompt = fs.readFileSync(path.join(dir, "prompt-perbaikan.txt"), "utf8");
  assert.match(prompt, /VERIFIKASI task ini — dijalankan worker, bukan klaim kamu/, "agen harus tahu ini bukti worker, bukan klaimnya sendiri");
  assert.match(prompt, /verification gagal \(exit 1\)/);
  assert.match(prompt, /bukti\.txt/, "perintah yang gagal harus disebut apa adanya: " + prompt.slice(0, 400));
});

t("verify T-001 menolak kalau verification task masih merah, lalu menerima sesudah hijau", ()=>{
  const dir = project(quiet, satuTask(verifAda("bukti.txt")));
  gitAwal(dir);
  const ctx = W.loadCtx(dir);
  ctx.state.tasks["T-001"].status = "sedang";
  W.saveCtx(ctx);
  fs.writeFileSync(path.join(dir, "src.js"), "export const a = 1;\n");
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","T-001: bikin modul"], { cwd:dir, encoding:"utf8" });
  assert.equal(run(["verify", "T-001", "--dir", dir]), 1, "gerbang hijau + kommit benar tetap tidak cukup kalau verification merah");
  const merah = read(dir).state.tasks["T-001"];
  assert.equal(merah.status, "gagal", "bukti yang merah harus turun ke ledger, bukan dibiarkan hilang: " + JSON.stringify(merah));
  assert.equal(merah.gate.verify.pass, false);
  assert.match(merah.note, /verifikasi ulang tanpa agen/);
  assert.match(fs.readFileSync(path.join(dir, ".planforge", "RUN_LOG.md"), "utf8"), /verifikasi GAGAL \(exit 1/);
  fs.writeFileSync(path.join(dir, "bukti.txt"), "ada\n");
  assert.equal(run(["verify", "T-001", "--dir", dir]), 0);
  const st = read(dir).state.tasks["T-001"];
  assert.equal(st.status, "selesai");
  assert.equal(st.gate.verify.pass, true);
  assert.match(st.note, /verifikasi ulang tanpa agen/);
  assert.equal(read(dir).state.calls, 0, "verify tidak boleh memanggil agen");
});

t("verify mencabut status selesai yang terbukti bohong, dan mengembalikan hitungan selesai", ()=>{
  const dir = project(quiet, satuTask(verifAda("bukti.txt")));
  gitAwal(dir);
  fs.writeFileSync(path.join(dir, "src.js"), "export const a = 1;\n");
  fs.writeFileSync(path.join(dir, "bukti.txt"), "ada\n");
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","T-001: bikin modul"], { cwd:dir, encoding:"utf8" });
  assert.equal(run(["verify", "T-001", "--dir", dir]), 0);
  assert.equal(read(dir).state.doneTasks, 1);
  /* buktinya hilang sesudah task dicap selesai — persis yang terjadi di pilot:
     test hijau, tapi file yang jadi bukti tidak pernah benar-benar dipakai */
  fs.rmSync(path.join(dir, "bukti.txt"));
  assert.equal(run(["verify", "T-001", "--dir", dir]), 1);
  const s = read(dir).state;
  assert.equal(s.tasks["T-001"].status, "gagal", "ledger tidak boleh tetap bilang selesai: " + JSON.stringify(s.tasks["T-001"]));
  assert.equal(s.tasks["T-001"].gate.verify.pass, false);
  assert.equal(s.doneTasks, 0, "hitungan selesai harus ikut turun, bukan cuma statusnya");
});

t("kode keluar CLI sampai ke shell: verify merah = exit 1, bukan 0", ()=>{
  const WORKER = fileURLToPath(new URL("../worker.mjs", import.meta.url));
  const dir = project(quiet, satuTask(verifAda("bukti.txt")));
  gitAwal(dir);
  const cli = ()=> spawnSync(NODE, [WORKER, "verify", "T-001", "--dir", dir], { cwd:dir, encoding:"utf8" });
  /* main() mengembalikan 1 tapi entry point dulu membuangnya: CI, rantai `&&`, dan agen
     yang membaca exit code melihat "sukses" untuk task yang gagal */
  assert.equal(cli().status, 1, "verify merah harus exit 1");
  fs.writeFileSync(path.join(dir, "src.js"), "export const a = 1;\n");
  fs.writeFileSync(path.join(dir, "bukti.txt"), "ada\n");
  spawnSync("git", ["add","-A"], { cwd:dir, encoding:"utf8" });
  spawnSync("git", ["commit","-q","-m","T-001: bikin modul"], { cwd:dir, encoding:"utf8" });
  assert.equal(cli().status, 0, "verify hijau harus exit 0");
});

t("mark_done lewat MCP menolak verification yang cuma kalimat", ()=>{
  const dir = project(quiet, satuTask("Buka browser lalu klik tombol simpan dan lihat apakah notifikasi muncul"));
  const ctx = W.loadCtx(dir);
  const out = mcp(ctx, "mark_done", { id:"T-001", verification:"python -m pytest -> 3 passed in 0.4s" });
  assert.match(out, /^TOLAK T-001/, out);
  assert.match(out, /bukan perintah shell/);
  const st = JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "state.json"), "utf8")).tasks["T-001"];
  assert.notEqual(st.status, "selesai", JSON.stringify(st));
  assert.equal(st.gate.verify.pass, false);
});

t("mark_done menolak verification merah meski klaim agen hijau, lalu menerima sesudah bukti ada", ()=>{
  const dir = project(quiet, satuTask(verifAda("bukti.txt")));
  const ctx = W.loadCtx(dir);
  fs.writeFileSync(path.join(dir, "app.py"), "print(1)\n");
  const tolak = mcp(ctx, "mark_done", { id:"T-001", verification:"node -e \"process.exit(0)\" -> verifikasi uji hijau, semua lulus" });
  assert.match(tolak, /^TOLAK T-001/, tolak);
  assert.match(tolak, /verification gagal \(exit 1\)/);
  assert.notEqual(ctx.state.tasks["T-001"].status, "selesai");
  fs.writeFileSync(path.join(dir, "bukti.txt"), "ada\n");
  const terima = mcp(ctx, "mark_done", { id:"T-001", verification:"node -e \"process.exit(0)\" -> verifikasi uji hijau, semua lulus" });
  assert.match(terima, /^ok, T-001 selesai/, terima);
  assert.match(terima, /udah ku jalanin sendiri dan hijau/);
  assert.equal(ctx.state.tasks["T-001"].gate.verify.hasil[0].code, 0);
});

t("--no-gates juga melewati verification task", ()=>{
  const dir = project(quiet, satuTask("Buka browser lalu klik tombol simpan dan lihat apakah notifikasi muncul"));
  run(["run", "--dir", dir, "--no-gates", "--max-tasks", "1"]);
  const st = read(dir).state.tasks["T-001"];
  assert.equal(st.status, "selesai", JSON.stringify(st));
  assert.equal(st.gate.verify.dilewati, true);
  assert.equal(st.gate.verify.pass, true);
  assert.match(st.note, /verifikasi dilewati \(--no-gates\)/);
});

t("kutip satu berisi operator cmd.exe ketahuan sebelum kredit dibakar", ()=>{
  assert.equal(W.kutipSatuBocor("grep -Eq 'no-store|Date.now' static/js/filter.js"), "'no-store|Date.now'");
  assert.equal(W.kutipSatuBocor('grep -Eq "no-store|Date.now" static/js/filter.js'), null, "kutip dua melindungi — jangan menuduh");
  assert.equal(W.kutipSatuBocor("python -c \"print('a|b')\""), null, "kutip satu di dalam kutip dua ikut terlindungi");
  assert.equal(W.kutipSatuBocor("grep -q 'fetch(' static/js/filter.js"), null, "tanpa operator cmd.exe tidak ada yang bocor");
  assert.equal(W.kutipSatuBocor("echo 'a > b'"), "'a > b'");
  assert.equal(W.kutipSatuBocor("npm test"), null);
  if(process.platform !== "win32") return;
  const dir = project(quiet, satuTask("shell: grep -Eq 'no-store|Date.now' static/js/filter.js"));
  const a = W.auditPlan(W.loadCtx(dir), dir);
  const f = a.temuan.find(x=>x.id === "T-001" && /kutip satu/.test(x.msg));
  assert.ok(f, "audit harus menangkap perintah yang tidak mungkin hijau di Windows: " + JSON.stringify(a.temuan));
  assert.equal(f.lvl, "error");
});

console.log("\n8) gerbang penuh bisu = berhenti · plafon biaya & budget sesi");

const penuhAudit = ()=> JSON.parse(JSON.stringify(W.FULL_GATES.filter(g=>g.id === "audit")));
const gatesPenuh = (limits)=>({ reviews: penuhAudit(), hard:[okCheck],
  limits: Object.assign({ maxCalls:300, maxConsecutiveFails:3, fullEvery:1, fullAtMilestoneEnd:false, fixRounds:1, autoCommit:false }, limits || {}) });

t("gerbang penuh dibalas kosong -> loop berhenti, lastFullMark tidak maju", ()=>{
  const dir = project(gatesPenuh());
  process.env.PF_FULL_SILENT = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "3"]); } finally{ delete process.env.PF_FULL_SILENT; }
  const r = read(dir);
  assert.equal(r.state.tasks["T-001"].status, "selesai", "task yang verifikasinya hijau tetap sah: " + JSON.stringify(r.state.tasks["T-001"]));
  assert.equal(r.state.doneTasks, 1);
  assert.equal(r.state.tasks["T-002"].status, "belum mulai", "task berikutnya tidak boleh diambil sesudah gerbang penuh bisu");
  assert.ok(!r.state.lastFullMark, "penanda audit tidak boleh maju: " + r.state.lastFullMark);
  assert.equal(r.state.fullHalt.upto, "T-001");
  assert.match(r.state.fullHalt.kenapa, /dibalas kosong/);
  assert.equal(r.state.calls, 2, "satu task + satu audit, bukan tiga task: " + r.state.calls);
  assert.match(r.log, /penanda lastFullMark TETAP/);
  assert.match(r.log, /gerbang penuh tidak membuktikan apa-apa/);
  assert.match(r.log, /BERHENTI/);
});

t("gerbang penuh yang balas JSON tanpa verdict -> berhenti juga", ()=>{
  const dir = project(gatesPenuh());
  process.env.PF_FULL_NOVERDICT = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "3"]); } finally{ delete process.env.PF_FULL_NOVERDICT; }
  const r = read(dir);
  assert.match(r.log, /TIDAK ADA VERDICT/);
  assert.match(r.state.fullHalt.kenapa, /tidak mengembalikan JSON verdict/);
  assert.ok(!r.state.lastFullMark);
  assert.equal(r.state.doneTasks, 1);
});

t("gerbang penuh yang semua verdictnya sah -> lastFullMark maju, tidak ada fullHalt", ()=>{
  const dir = project(gatesPenuh());
  run(["run", "--dir", dir, "--max-tasks", "2"]);
  const r = read(dir);
  assert.equal(r.state.doneTasks, 2);
  assert.equal(r.state.lastFullMark, "T-002");
  assert.ok(!r.state.fullHalt, "gerbang yang terbukti tidak boleh meninggalkan rem: " + JSON.stringify(r.state.fullHalt));
  assert.match(r.log, /gerbang penuh/);
});

t("sesudah gerbang penuh bisu, run berikutnya mengaudit ulang dari penanda yang lama", ()=>{
  const dir = project(gatesPenuh());
  process.env.PF_FULL_SILENT = "1";
  try{ run(["run", "--dir", dir, "--max-tasks", "3"]); } finally{ delete process.env.PF_FULL_SILENT; }
  assert.ok(read(dir).state.fullHalt);
  run(["run", "--dir", dir, "--max-tasks", "1"]);
  const r = read(dir);
  assert.equal(r.state.doneTasks, 2);
  assert.equal(r.state.lastFullMark, "T-002");
  assert.ok(!r.state.fullHalt, "rem harus dilepas sesudah audit yang beneran terbukti");
  assert.match(r.log, /audit T-001 sampai T-002/, "cakupan audit harus mulai dari penanda lama, bukan dari task yang sudah lewat: " + r.log.slice(-600));
});

t("plafon biaya $0 menghentikan agen berbayar sesudah panggilan pertama", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits: Object.assign({}, quiet.limits, { maxCostUsd: 0 }) });
  run(["run", "--dir", dir, "--max-tasks", "5"]);
  const r = read(dir);
  assert.equal(r.state.calls, 1, "agen bohongan melaporkan $0.0042 — panggilan kedua tidak boleh dikirim: " + r.state.calls);
  assert.match(r.log, /plafon biaya \$0/);
  assert.match(r.log, /berhenti: biaya \$0\.0042 sudah melewati maxCostUsd \$0/);
  assert.equal(r.state.tasks["T-002"].status, "belum mulai");
  assert.ok(Math.abs(r.state.costUsd - 0.0042) < 1e-9, "biaya panggilan pertama tetap tercatat: " + r.state.costUsd);
});

t("plafon biaya dinaikkan -> loop jalan terus dan biayanya terakumulasi", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits: Object.assign({}, quiet.limits, { maxCostUsd: 1 }) });
  run(["run", "--dir", dir, "--max-tasks", "3"]);
  const r = read(dir);
  assert.equal(r.state.doneTasks, 3);
  assert.equal(r.state.calls, 3);
  assert.doesNotMatch(r.log, /berhenti: biaya/);
  assert.ok(Math.abs(r.state.costUsd - 3*0.0042) < 1e-6, "biaya kumulatif harus tercatat: " + r.state.costUsd);
});

t("maxCallsPerRun memotong sesi ini, dan sesi berikutnya mulai dari nol dengan runId baru", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits: Object.assign({}, quiet.limits, { maxCallsPerRun: 2 }) });
  run(["run", "--dir", dir]);
  const a = read(dir).state;
  assert.equal(a.doneTasks, 2);
  assert.equal(a.callsThisRun, 2);
  assert.match(read(dir).log, /panggilan sesi ini 2\/2 \(maxCallsPerRun\)/);
  run(["run", "--dir", dir]);
  const b = read(dir).state;
  assert.equal(b.doneTasks, 4, "sesi baru harus boleh kerja lagi: " + b.doneTasks);
  assert.equal(b.callsThisRun, 2);
  assert.equal(b.calls, 4, "hitungan seumur proyek tetap jalan");
  assert.notEqual(b.runId, a.runId, "dua run tidak boleh berbagi id sesi");
});

t("gates.json lama tanpa key baru tetap mewarisi plafon $0 (fail-closed)", ()=>{
  const dir = project(quiet);
  const pj = path.join(dir, ".planforge", "gates.json");
  const g = JSON.parse(fs.readFileSync(pj, "utf8"));
  delete g.limits.maxCostUsd; delete g.limits.maxCallsPerRun; delete g.limits.maxTokens;
  fs.writeFileSync(pj, JSON.stringify(g));
  const ctx = W.loadCtx(dir);
  assert.equal(ctx.gates.limits.maxCostUsd, 0, "paket lama harus ikut fail-closed, bukan tanpa batas");
  assert.equal(W.sisaBudget(ctx), null, "biaya nol masih boleh jalan");
  ctx.state.costUsd = 0.01;
  assert.match(W.sisaBudget(ctx), /maxCostUsd/);
  ctx.state.costUsd = 0; ctx.gates.limits.maxCostUsd = null; ctx.state.tokens = 5000; ctx.gates.limits.maxTokens = 1000;
  assert.match(W.sisaBudget(ctx), /maxTokens/);
});
t("sisaBudget juga menutup pintu saat maxCalls total habis", ()=>{
  const dir = project(quiet);
  const ctx = W.loadCtx(dir);
  ctx.gates.limits.maxCostUsd = null; ctx.gates.limits.maxTokens = null; ctx.gates.limits.maxCallsPerRun = null;
  ctx.gates.limits.maxCalls = 3;
  ctx.state.calls = 2;
  assert.equal(W.sisaBudget(ctx), null, "belum sampai plafon harus boleh jalan");
  ctx.state.calls = 3;
  assert.match(W.sisaBudget(ctx), /maxCalls/, "plafon total harus terbaca di tengah task, bukan cuma di antar-task");
});
t("loadCtx menandai ledger milik rencana lain tanpa menghapus progres", ()=>{
  const dir = project(quiet);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "plan.json"), "utf8"));
  const fp = W.planFingerprintPlan(plan);
  fs.writeFileSync(path.join(dir, ".planforge", "state.json"), JSON.stringify({
    planFingerprint:"deadbeef", rev:3, doneTasks:2, calls:5, spentNotes:[], history:[], sinceFull:0, consecFails:0, lastTask:"T-001",
    tasks:{ "T-001":{ status:"selesai", tries:1, gate:null, note:"bukti lama" } }
  }));
  const ctx = W.loadCtx(dir);
  assert.deepEqual(ctx.planBerubah, { dari:"deadbeef", ke:fp }, "sidik jari beda harus ditandai");
  assert.equal(ctx.state.doneTasks, 2, "worker tidak boleh menghapus progres lama");
  assert.equal(ctx.state.tasks["T-001"].status, "selesai");
  assert.equal(ctx.state.rev, 3);
  const status = W.mcpHandle({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:"plan_status", arguments:{} } }, ctx).result.content[0].text;
  assert.match(status, /ledger ini dibuat untuk rencana lain/, status);
});
t("loadCtx tidak menandai apa-apa saat sidik jari ledger cocok", ()=>{
  const dir = project(quiet);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "plan.json"), "utf8"));
  const fp = W.planFingerprintPlan(plan);
  fs.writeFileSync(path.join(dir, ".planforge", "state.json"), JSON.stringify({
    planFingerprint:fp, rev:1, doneTasks:0, calls:0, spentNotes:[], history:[], sinceFull:0, consecFails:0, lastTask:null, tasks:{}
  }));
  const ctx = W.loadCtx(dir);
  assert.equal(ctx.planBerubah, null, "rencana sama = tidak ada peringatan");
  const status = W.mcpHandle({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:"plan_status", arguments:{} } }, ctx).result.content[0].text;
  assert.doesNotMatch(status, /ledger ini dibuat untuk rencana lain/);
});

t("MCP: next_task menolak sesudah budget sesi habis, mark_done tetap boleh", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits: Object.assign({}, quiet.limits, { maxCallsPerRun: 1 }) });
  const ctx = W.loadCtx(dir);
  assert.match(mcp(ctx, "next_task"), /TASK T-001/);
  const tolak = mcp(ctx, "next_task");
  assert.match(tolak, /^BERHENTI/, tolak);
  assert.match(tolak, /maxCallsPerRun/);
  assert.match(tolak, /Jangan ambil task baru dan jangan mengarang bukti/);
  fs.writeFileSync(path.join(dir, "app.py"), "print(1)\n");
  const tutup = mcp(ctx, "mark_done", { id:"T-001", verification:'node -e "console.log(1)" -> verifikasi uji hijau' });
  assert.match(tutup, /^ok, T-001 selesai/, "menutup kerja yang sudah jalan bukan kerja baru: " + tutup);
  assert.equal(ctx.state.mcpCalls, 2, "tool kerja yang ditolak tidak dihitung, yang jalan harus terhitung: " + ctx.state.mcpCalls);
  assert.match(mcp(ctx, "plan_status"), /sesi connector ini: 2 tool kerja/);
});

t("MCP: plafon biaya juga menutup pintu next_task", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits: Object.assign({}, quiet.limits, { maxCostUsd: 0 }) });
  const ctx = W.loadCtx(dir);
  ctx.state.costUsd = 0.5;
  const out = mcp(ctx, "next_task");
  assert.match(out, /^BERHENTI/, out);
  assert.match(out, /maxCostUsd/);
  assert.match(mcp(ctx, "plan_status"), /plafon \$0/);
});

t("--max-cost dan --max-calls-per-run menaikkan batas tanpa menyunting gates.json", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits: Object.assign({}, quiet.limits, { maxCostUsd: 0 }) });
  run(["run", "--dir", dir, "--max-cost", "1", "--max-tasks", "2"]);
  assert.equal(read(dir).state.doneTasks, 2, "--max-cost harus dipakai: " + read(dir).log.slice(-400));
  const lain = project({ reviews:[], hard:[okCheck], limits: Object.assign({}, quiet.limits, { maxCallsPerRun: 9 }) });
  run(["run", "--dir", lain, "--max-calls-per-run", "1"]);
  assert.equal(read(lain).state.doneTasks, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(lain, ".planforge", "gates.json"), "utf8")).limits.maxCallsPerRun, 9,
    "flag CLI tidak boleh menulis ulang gates.json");
});

console.log("\n9) --auto-budget: angka panggilan dihitung dari task yang tersisa");

t("--auto-budget menaikkan maxCalls + maxCallsPerRun tanpa menulis gates.json", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits:{ maxCalls:5, maxCallsPerRun:2, fullEvery:99, fixRounds:1, autoCommit:false } });
  run(["run", "--dir", dir, "--auto-budget"]);
  const r = read(dir);
  assert.match(r.log, /auto-budget: 9 task tersisa ≈ 12 panggilan/, r.log.slice(0, 600));
  assert.equal(r.state.doneTasks, 9, "satu sesi harus menghabiskan semua task: " + r.state.doneTasks);
  assert.equal(r.state.callsThisRun, 9);
  const g = JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "gates.json"), "utf8"));
  assert.equal(g.limits.maxCalls, 5, "flag CLI tidak boleh menulis ulang gates.json");
  assert.equal(g.limits.maxCallsPerRun, 2);
});

t("--auto-budget tidak pernah menaikkan plafon biaya — agen berbayar tetap berhenti", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits:{ maxCalls:5, maxCallsPerRun:2, maxCostUsd:0, fullEvery:99, fixRounds:1, autoCommit:false } });
  run(["run", "--dir", dir, "--auto-budget", "--max-tasks", "5"]);
  const r = read(dir);
  assert.match(r.log, /plafon biaya TIDAK diubah: \$0/);
  assert.equal(r.state.calls, 1, "budget panggilan naik bukan berarti boleh membayar: " + r.state.calls);
  assert.match(r.log, /berhenti: biaya/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".planforge", "gates.json"), "utf8")).limits.maxCostUsd, 0);
});

t("--auto-budget menghitung task yang BELUM selesai, bukan seluruh rencana", ()=>{
  const dir = project(quiet);
  run(["run", "--dir", dir, "--max-tasks", "4"]);
  assert.equal(read(dir).state.doneTasks, 4);
  run(["run", "--dir", dir, "--auto-budget"]);
  const r = read(dir);
  assert.match(r.log, /auto-budget: 5 task tersisa ≈ 7 panggilan/, r.log.slice(-900));
  assert.match(r.log, /maxCalls 11 \(4 sudah terpakai \+ 7\)/, "maxCalls itu rem seumur proyek, bukan per sesi: " + r.log.slice(-900));
  assert.equal(r.state.doneTasks, 9);
});

t("status menyebut kebutuhan panggilan dan berapa task yang muat di budget sekarang", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits:{ maxCalls:5, maxCallsPerRun:2, fullEvery:99, fixRounds:1, autoCommit:false } });
  const baris = []; const say = console.log; console.log = (s)=>baris.push(String(s));
  try{ W.main(["status", "--dir", dir]); } finally{ console.log = say; }
  const out = baris.join("\n");
  assert.match(out, /task tersisa 9 · butuh ≈ 12 panggilan/, out);
  assert.match(out, /maxCalls 5 muat ±3 task/);
  assert.match(out, /maxCallsPerRun 2 muat ±1 task/);
  assert.match(out, /belum cukup: node worker.mjs run --auto-budget/);
});

t("run memperingatkan kalau maxCallsPerRun memotong sesi sebelum task habis", ()=>{
  const dir = project({ reviews:[], hard:[okCheck], limits:{ maxCalls:200, maxCallsPerRun:2, fullEvery:99, fixRounds:1, autoCommit:false } });
  run(["run", "--dir", dir]);
  const r = read(dir);
  assert.match(r.log, /kebutuhan: 9 task tersisa ≈ 12 panggilan/);
  assert.match(r.log, /budget belum cukup untuk sekali jalan sampai habis/);
  assert.equal(r.state.doneTasks, 2, "sesi tetap dipotong oleh maxCallsPerRun");
});

t("mark_blocked: agen bisa lapor keblokir tanpa vonis gagal", ()=>{
  const dir = project(quiet, [
    { id:"T-001", title:"Scaffold proyek", description:"", agent_hint:"", acceptance_criteria:["ada"], files_or_areas:["index.html"], verification:'"' + NODE + '" -e "console.log(1)"', depends_on:[] },
    { id:"T-002", title:"Lanjut", description:"", agent_hint:"", acceptance_criteria:["ada"], verification:'"' + NODE + '" -e "console.log(1)"', depends_on:["T-001"] }
  ]);
  const ctx = W.loadCtx(dir);
  const names = W.mcpHandle({ jsonrpc:"2.0", id:1, method:"tools/list" }, ctx).result.tools.map(x=>x.name);
  assert.ok(names.includes("mark_blocked"), "tool mark_blocked harus terdaftar");
  assert.match(panggil(ctx, "mark_blocked", { id:"T-001", reason:"index.html tidak ada; membuatnya di luar cakupan task" }), /TERKENDALA/);
  const st = W.loadCtx(dir).state.tasks["T-001"];
  assert.equal(st.status, "terkendala");
  assert.notEqual(st.status, "gagal", "keblokir bukan kegagalan kerja");
  assert.match(panggil(W.loadCtx(dir), "next_task"), /BERHENTI — task terkendala: T-001/);
  assert.match(panggil(W.loadCtx(dir), "plan_status", {}), /terkendala 1/);
  assert.match(read(dir).log, /TERKENDALA lewat MCP/);
});
t("audit menolak rencana tanpa scaffold di folder yang masih kosong", ()=>{
  const dir = project(quiet, [
    { id:"T-002", title:"Definisikan token warna gelap", description:"atur warna", agent_hint:"",
      acceptance_criteria:["warna sesuai"], files_or_areas:["src/style.css","index.html","tailwind.config.js"],
      verification:"npm run build", depends_on:[] }
  ]);
  const a = W.auditPlan(W.loadCtx(dir), dir);
  assert.ok(a.error.some(x=>/folder proyek masih kosong/.test(x.msg)),
    "audit harus bilang file dasar tidak pernah dibuat: " + JSON.stringify(a.temuan));
  assert.ok(a.temuan.some(x=>x.lvl === "error" && /bukan T-001/.test(x.msg)), "penomoran T-002 tetap error struktur");
});
t("aturan agen yang ditulis Connect menyebut mark_blocked", ()=>{
  const md = PF.agentsMd(PF.DEMO, PF.defaultGates("agy"), { projectDir:"D:/PROJECTS/x", workerPath:"D:/PROJECTS/x/worker.mjs" });
  assert.match(md, /mark_blocked/, "agen IDE harus tahu tool ini ada");
  assert.match(md, /JANGAN mark_failed/);
});

console.log("\nEnvironment readiness: advisory only, proof remains strict");
const envProject = ()=>{
  const dir = project(quiet, [{id:"T-001", title:"Tambah schema", files_or_areas:["db/schema.sql"], verification:VERIF_UJI, ui:false}]);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({type:"module", scripts:{migrate:"node scripts/migrate.mjs"}, dependencies:{pg:"8.13.1"}}));
  fs.writeFileSync(path.join(dir, ".env.example"), "DATABASE_URL=postgres://example:secret@127.0.0.1:5432/appdb\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".env.local\n.env\n");
  fs.writeFileSync(path.join(dir, "docker-compose.yml"), "services: {}\n");
  return dir;
};
t("missing dependencies, env and DB are separate warnings, audit has no structural error", ()=>{
  const dir = envProject();
  const before = fs.readdirSync(dir).sort();
  const r = W.environmentReadiness(dir, {env:{}});
  for(const code of ["dependencies","env-file","database-url","database-start"]) assert.ok(r.findings.some(x=>x.code === code), code);
  assert.ok(r.findings.every(x=>x.lvl === "warn"));
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
  const a = W.auditPlan(W.loadCtx(dir), dir); assert.equal(a.error.length, 0, JSON.stringify(a.error));
});
t("setup-env creates once, preserves edits and never prints secrets", ()=>{
  const dir = envProject();
  const r = W.setupEnv(dir, {}); assert.ok(r.ok && r.created);
  assert.ok(!JSON.stringify(r).includes("secret"));
  const local = path.join(dir, ".env.local"); fs.writeFileSync(local, "DATABASE_URL=do-not-touch\n");
  assert.equal(W.setupEnv(dir, {}).created, false);
  assert.equal(fs.readFileSync(local,"utf8"), "DATABASE_URL=do-not-touch\n");
});
t("existing .env and process env must not be shadowed by setup-env", ()=>{
  const dir = envProject();
  assert.equal(W.setupEnv(dir, {DATABASE_URL:"private"}).created, false);
  fs.writeFileSync(path.join(dir, ".env"), "DATABASE_URL=keep\n");
  assert.equal(W.setupEnv(dir, {}).created, false);
  assert.ok(!fs.existsSync(path.join(dir, ".env.local")));
});
t("setup-env refuses missing template or unignored secrets", ()=>{
  const dir = envProject();
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  assert.equal(W.setupEnv(dir, {}).ok, false);
  fs.unlinkSync(path.join(dir, ".env.example"));
  assert.equal(W.setupEnv(dir, {}).ok, false);
  assert.ok(!fs.existsSync(path.join(dir, ".env.local")));
});
t("env precedence matches development local over .env and hides credentials", ()=>{
  const dir = envProject();
  fs.writeFileSync(path.join(dir, ".env"), "DATABASE_URL=invalid-secret\n");
  fs.writeFileSync(path.join(dir, ".env.development.local"), "DATABASE_URL='postgres://user:private@127.0.0.1:5432/appdb'\n");
  const r = W.environmentReadiness(dir, {env:{}});
  assert.ok(r.findings.some(x=>x.code === "database-unverified"));
  assert.ok(!JSON.stringify(r).includes("private"));
  const override = W.environmentReadiness(dir,{env:{DATABASE_URL:"invalid-sensitive"}});
  assert.ok(override.findings.some(x=>x.code === "database-url"));
  assert.ok(!JSON.stringify(override).includes("sensitive"));
});
t("doctor --environment is read-only and never runs hard gates", ()=>{
  const dir = envProject();
  fs.writeFileSync(path.join(dir,".planforge","gates.json"), JSON.stringify({hard:[{id:"bad",enabled:true,blocking:true,cmd:'node -e "require(\'fs\').writeFileSync(\'should-not-exist\',\'x\')"'}]}));
  assert.equal(run(["doctor", "--environment", "--dir", dir]), 0);
  assert.ok(!fs.existsSync(path.join(dir, "should-not-exist")));
  assert.ok(!fs.existsSync(path.join(dir, ".planforge", "state.json")));
});
t("missing binary is advisory; invalid verification and script names stay errors", ()=>{
  const dir = envProject(), ctx = W.loadCtx(dir);
  ctx.plan.tasks.tasks[0].verification = "planforge_nonexistent_tool_xyz --check";
  let a = W.auditPlan(ctx,dir);
  assert.equal(a.error.length, 0); assert.ok(a.warn.some(x=>x.msg.includes("planforge_nonexistent_tool_xyz")));
  ctx.plan.tasks.tasks[0].verification = "npm run db:migrate";
  a = W.auditPlan(ctx,dir); assert.ok(a.error.some(x=>x.msg.includes("db:migrate")));
  ctx.plan.tasks.tasks[0].verification = "Buka browser";
  assert.ok(W.auditPlan(ctx,dir).error.some(x=>x.msg.includes("bukan perintah")));
});
t("missing environment does not block task handoff but failed proof still rejects mark_done", ()=>{
  const dir = envProject(), ctx = W.loadCtx(dir);
  ctx.plan.tasks.tasks[0].verification = 'node -e "process.exit(1)"';
  const call = (name,args={})=>W.mcpHandle({jsonrpc:"2.0",id:99,method:"tools/call",params:{name,arguments:args}},ctx).result.content[0].text;
  const card = call("next_task"); assert.match(card,/T-001/); assert.match(card,/Saran lingkungan/); assert.ok(!card.startsWith("BERHENTI"));
  const result = call("mark_done",{id:"T-001",verification:"claimed complete"});
  assert.match(result,/TOLAK/); assert.notEqual(ctx.state.tasks["T-001"].status,"selesai");
});
t("setup-env fails closed on broad unignore and preserves production config", ()=>{
  const dir=envProject();
  fs.writeFileSync(path.join(dir,".gitignore"),".env.local\n!*\n");
  assert.equal(W.setupEnv(dir,{}).ok,false);
  fs.writeFileSync(path.join(dir,".gitignore"),".env.local\n");
  fs.writeFileSync(path.join(dir,".env.production"),"DATABASE_URL=production-private\n");
  assert.equal(W.setupEnv(dir,{}).created,false);
  assert.ok(!fs.existsSync(path.join(dir,".env.local")));
});
t("installed type-only packages are not reported missing", ()=>{
  const dir=envProject();
  fs.writeFileSync(path.join(dir,"package.json"),JSON.stringify({devDependencies:{"@types/example":"1.0.0"}}));
  fs.mkdirSync(path.join(dir,"node_modules/@types/example"),{recursive:true});
  fs.writeFileSync(path.join(dir,"node_modules/@types/example/package.json"),JSON.stringify({name:"@types/example",types:"index.d.ts"}));
  assert.ok(!W.environmentReadiness(dir,{env:{}}).findings.some(x=>x.code==="dependencies"));
});
t("task numbering and duplicate IDs stay hard structural errors", ()=>{
  const dir = envProject(), ctx = W.loadCtx(dir);
  ctx.plan.tasks.tasks[0].id = "T-002";
  assert.ok(W.auditPlan(ctx,dir).error.some(x=>x.msg.includes("bukan T-001")));
  ctx.plan.tasks.tasks.push({...ctx.plan.tasks.tasks[0]});
  assert.ok(W.auditPlan(ctx,dir).error.some(x=>x.msg.includes("duplikat")));
});
cleanupTempDirs();
sweepStaleTempDirs();
console.log("\n" + pass + " lulus, " + fail + " gagal\n");
process.exit(fail ? 1 : 0);
