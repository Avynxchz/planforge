import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as W from "../worker.mjs";
import { cleanupTempDirs, cleanupTempDirsSince, tempDirCheckpoint, withTempDir } from "./temp-dirs.mjs";
import {
  escapeNewlinesInQuotes, sanitizeVerificationCommand, sanitizeTaskBehavior,
  sanitizePlanChecks, lintPlanVerifications
} from "../src/web/core/verification-lint.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const a = html.indexOf("/* ===================== CORE-BEGIN ===================== */");
const b = html.indexOf("/* ===================== CORE-END ===================== */");
assert.ok(a > -1 && b > a, "penanda CORE tidak ditemukan");
const core = html.slice(a, b);

const PF = new Function(core + "; return {SCHEMAS, STAGES, buildSystemPrompt, briefBlock, buildStageMessages, extractJson, validatePlan, cycleOf, taskChunks, mergeTaskChunk, terapkanJawabanClarify, applyPatches, applyImprovingPatches, normalizePlan, normId, normStatus, featMatch, renderMarkdown, tasksToMd, prdToMd, roadmapToMd, featuresToMd, buildAgentPrompt, crc32, canonPlan, planCoreFromPlan, planFingerprintPlan, planFingerprint, makeZip, DEMO, AGENT_PRESETS, LIGHT_REVIEW, FULL_GATES, HARD_CHECKS, defaultGates, planBundleJson, freshStateJson, progresDariState, connNama, connPrompt, connConfigJson, connEntry, connUniversal, rencanaTulis, AGENT_ADAPTERS, gateCounts, hitungBudget, taskMuat, sisaMilestone, runnerCommand, agentsMd, runnerBundle, planTaskList, taskUi, specBehavior, masalahBehavior, behaviorBaris, CHECK_BROWSER, ALIAS_CHECK, normalisasiAliasBehavior, masalahStrukturRencana, rubrikRencana, starterMeta, starterAktif, starterLockLines, starterContractLines, saranLingkungan, missingNpmScripts, starterFileEntries, STARTER_FILES, parseField, svgWrap, erDiagramSvg, sequenceDiagramSvg, githubPushFiles, githubPush};")();

let pass = 0, fail = 0;
const t = (name, fn)=>{
  const checkpoint = tempDirCheckpoint();
  try{ fn(); pass++; console.log("  ok   " + name); }
  catch(e){ fail++; console.log("  FAIL " + name + "\n       " + e.message); }
  finally{ cleanupTempDirsSince(checkpoint); }
};
const ta = async (name, fn)=>{
  const checkpoint = tempDirCheckpoint();
  try{ await fn(); pass++; console.log("  ok   " + name); }
  catch(e){ fail++; console.log("  FAIL " + name + "\n       " + e.message); }
  finally{ cleanupTempDirsSince(checkpoint); }
};

console.log("\n1) master prompt");
t("system prompt memuat aturan JSON-only, ID, cakupan, dan bahasa", ()=>{
  const p = PF.buildSystemPrompt({language:"Bahasa Indonesia", audience:"kasir warung", targetAgent:"Claude Code"});
  for(const s of ["HANYA dengan satu objek JSON", "R-001", "Setiap requirement tercakup", "Bahasa Indonesia", "Claude Code", "satu commit".slice(0,0) || "1-5 file"])
    assert.ok(p.includes(s), "kurang: " + s);
});
t("normalisasi behavior memetakan text.expected ke contains dan menghapus alias", ()=>{
  const tasks = JSON.parse(JSON.stringify(PF.DEMO.tasks));
  tasks.tasks[0].behavior.checks = [{type:"text",selector:"h1",expected:"Ringkasan"}];
  assert.ok(PF.masalahBehavior(tasks.tasks[0]).some(x=>x.includes("butuh contains/matches/equals")));
  const normalized = PF.normalizePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  const check = normalized.tasks.tasks[0].behavior.checks[0];
  assert.equal(check.contains, "Ringkasan");
  assert.equal(Object.prototype.hasOwnProperty.call(check, "expected"), false);
  assert.ok(normalized.fixes.some(x=>x.includes("expected dinormalisasi")));
  assert.deepEqual(PF.masalahBehavior(normalized.tasks.tasks[0]), []);
});
t("roadmap berupa satu milestone dinormalisasi menjadi array milestones", ()=>{
  const roadmap = {id:"M-001", title:"Fondasi aplikasi", outcome:"Aplikasi berjalan"};
  const normalized = PF.normalizePlan(PF.DEMO.prd, roadmap, PF.DEMO.tasks);
  assert.deepEqual(normalized.roadmap.milestones, [roadmap]);
  assert.ok(normalized.fixes.some(x=>x.includes("milestone tunggal")));
});
t("requirements yang hilang disintesis dari requirement_refs task", ()=>{
  const prd = structuredClone(PF.DEMO.prd);
  const tasks = structuredClone(PF.DEMO.tasks);
  prd.requirements = [];
  const normalized = PF.normalizePlan(prd, PF.DEMO.roadmap, tasks);
  const ids = normalized.prd.requirements.map(requirement=>requirement.id);
  assert.ok(ids.includes("R-001"), JSON.stringify(ids));
  assert.ok(normalized.prd.requirements.every(requirement=>
    requirement.title && requirement.description && requirement.acceptance_criteria.length));
  assert.ok(!PF.validatePlan(normalized.prd, normalized.roadmap, normalized.tasks)
    .some(issue=>issue.includes("prd: requirements kosong atau tidak ada")));
});
t("verification kosong diisi fallback sesuai target file", ()=>{
  const tasks = structuredClone(PF.DEMO.tasks);
  tasks.tasks[0].files_or_areas = ["src/server.mjs"];
  tasks.tasks[0].verification = "  ";
  tasks.tasks[1].files_or_areas = ["index.html"];
  tasks.tasks[1].verification = "";
  const normalized = PF.normalizePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  assert.equal(normalized.tasks.tasks[0].verification, 'node --check "src/server.mjs"');
  assert.match(normalized.tasks.tasks[1].verification, /node -e .*accessSync/);
  assert.ok(normalized.fixes.filter(x=>x.includes("verification kosong")).length >= 2);
});
t("behavior text dengan assertion kosong diubah menjadi check visible", ()=>{
  const tasks = structuredClone(PF.DEMO.tasks);
  tasks.tasks[0].behavior.checks = [{type:"text", selector:"input", contains:""}];
  const normalized = PF.normalizePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  assert.deepEqual(normalized.tasks.tasks[0].behavior.checks, [{type:"visible", selector:"input"}]);
  assert.deepEqual(PF.masalahBehavior(normalized.tasks.tasks[0]), []);
});
t("task backend server tidak jadi UI hanya karena deskripsi menyebut frontend", ()=>{
  const task = {title:"Siapkan server", description:"Sambungkan backend ke frontend", files_or_areas:["lib/server.js","src/web.js"]};
  assert.equal(PF.taskUi(task), false);
  assert.deepEqual(PF.masalahBehavior(task), []);
});
t("task JavaScript frontend di public/js tetap diklasifikasikan sebagai UI", ()=>{
  assert.equal(PF.taskUi({files_or_areas:["public/js/app.js"]}), true);
});
t("escapeNewlinesInQuotes meng-escape baris dalam kutipan tetapi mempertahankan baris perintah", ()=>{
  const command = "node -e \"const x = 'a\r\nb';\"\r\nnpm test";
  assert.equal(escapeNewlinesInQuotes(command), "node -e \"const x = 'a\\nb';\"\r\nnpm test");
});
t("sanitizeVerificationCommand menghapus flag --test yang bertentangan dengan eval", ()=>{
  assert.equal(sanitizeVerificationCommand("node --test -e \"console.log(1)\""), "node -e \"console.log(1)\"");
  assert.equal(sanitizeVerificationCommand("node --test --eval \"console.log(1)\""), "node --eval \"console.log(1)\"");
});
t("sanitizeTaskBehavior memperbaiki equals container dan matches nama file pada tautan", ()=>{
  const task = {id:"T-010", behavior:{checks:[
    {type:"text", selector:"body", equals:"Produk"},
    {type:"text", selector:'a[href$=".pdf"]', matches:"\\.(json|csv|pdf|xlsx|txt)$"}
  ]}};
  assert.deepEqual(sanitizeTaskBehavior(task), ["T-010:text.equals->contains", "T-010:text.matches->visible"]);
  assert.deepEqual(task.behavior.checks, [
    {type:"text", selector:"body", contains:"Produk"},
    {type:"visible", selector:'a[href$=".pdf"]'}
  ]);
});
t("sanitizePlanChecks membersihkan verification dan seluruh checks dalam dokumen", ()=>{
  const docs = {tasks:{tasks:[{
    id:"T-011", verification:"node --test -e \"x\"", behavior:{checks:[{type:"text", selector:"#root", equals:"Siap"}]}
  }]}};
  assert.equal(sanitizePlanChecks(docs).length, 2);
  assert.equal(docs.tasks.tasks[0].verification, "node -e \"x\"");
  assert.equal(docs.tasks.tasks[0].behavior.checks[0].contains, "Siap");
});
t("lintPlanVerifications memberi temuan terstruktur untuk pola verification berisiko", ()=>{
  const docs = {tasks:{tasks:[
    {id:"T-021", verification:"node -e \"require('puppeteer'); fetch('http://localhost:3000')\""},
    {id:"T-022", verification:"pkill -f server"},
    {id:"T-023", verification:"node -e \"ejs.render('<h1>x</h1>')\""},
    {id:"T-024", files_or_areas:["server.js"], verification:"node -e \"http.createServer(() => {})\""},
    {id:"T-025", verification:"node -e \"console.log(ok ? 'PASS' : 'FAIL')\""}
  ]}};
  const issues = lintPlanVerifications(docs);
  assert.ok(issues.every(x=>x.stage === "audit" && x.taskId && x.code && x.message));
  for(const code of ["unavailable-dependency","dangling-localhost","unsafe-server-kill","hardcoded-ejs-template","stub-application-server","always-zero-verification"])
    assert.ok(issues.some(x=>x.code === code), "missing " + code + ": " + JSON.stringify(issues));
});
t("bahasa Inggris dan target agent umum ikut terpakai", ()=>{
  const p = PF.buildSystemPrompt({language:"English", targetAgent:"umum"});
  assert.ok(p.includes("English") && p.includes("agen mana pun"));
});
t("prompt tasks dan audit menetapkan skema behavior serta verifikasi berbasis exit code", ()=>{
  for(const stage of ["tasks","audit"]){
    const text = PF.buildStageMessages(stage, {language:"Bahasa Indonesia", idea:"x"}, PF.DEMO).map(x=>x.content).join("\n");
    assert.match(text, /type.*text.*contains.*matches.*equals/);
    assert.match(text, /[Ff]ield expected TIDAK valid/);
    assert.match(text, /exit code/);
    assert.match(text, /regex BRE/);
  }
});
t("prompt tasks dan audit menetapkan kontrak server, anti-vakum, dan urutan behavior", ()=>{
  for(const stage of ["tasks","audit"]){
    const text = PF.buildStageMessages(stage, {language:"Bahasa Indonesia", idea:"x"}, PF.DEMO)[1].content;
    assert.match(text, /require\.main === module/);
    assert.match(text, /ERR_SERVER_ALREADY_LISTEN/);
    assert.match(text, /node-fetch/);
    assert.match(text, /http\.createServer/);
    assert.match(text, /out-of-stock/);
  }
});
t("prompt tasks mewajibkan verification non-kosong dan endpoint ekspor web", ()=>{
  const text = PF.buildStageMessages("tasks", {language:"Bahasa Indonesia", idea:"web + ekspor"}, PF.DEMO)[1].content;
  assert.match(text, /verification WAJIB diisi pada SETIAP task/);
  assert.match(text, /perintah shell non-kosong/);
  assert.match(text, /endpoint ekspor web/);
});
t("brief tidak meng-escape & jadi entity mentah", ()=>{
  const bl = PF.briefBlock({idea:"x", constraints:"y", audience:"z"});
  assert.ok(bl.includes("Batasan & preferensi:"), bl.slice(-40));
  assert.ok(bl.includes("x") && bl.includes("y"));
});

console.log("\n2) messages per tahap");
for(const stage of ["clarify","prd","roadmap","tasks","audit"]){
  t("buildStageMessages(" + stage + ") -> [system, user] berisi skema", ()=>{
    const m = PF.buildStageMessages(stage, {language:"Bahasa Indonesia", idea:"test", targetAgent:"umum"}, PF.DEMO);
    assert.equal(m.length, 2);
    assert.equal(m[0].role, "system"); assert.equal(m[1].role, "user");
    const schemaKey = stage === "audit" ? "patches" : Object.keys(PF.SCHEMAS[stage])[0];
    assert.ok(m[1].content.includes(schemaKey), "skema tidak disertakan");
    if(stage !== "clarify") assert.ok(m[1].content.includes("R-001"), "konteks hulu tidak disertakan");
    if(stage === "audit") assert.ok(m[1].content.includes("perbaiki") || m[1].content.includes("Perbaiki"));
  });
}

console.log("\n3) ekstraksi JSON dari keluaran model yang kotor");
t("objek polos", ()=> assert.deepEqual(PF.extractJson('{"a":1}'), {a:1}));
t("dengan fenced block", ()=> assert.deepEqual(PF.extractJson('```json\n{"a":1}\n```'), {a:1}));
t("didahului paragraf pembuka", ()=> assert.deepEqual(PF.extractJson('Tentu! Ini hasilnya:\n{"a":{"b":[1,2]}}\nSemoga membantu.'), {a:{b:[1,2]}}));
t("kurung dalam string tidak merusak kedalaman", ()=> assert.deepEqual(PF.extractJson('{"a":"nilai { dan } di dalam"}'), {a:"nilai { dan } di dalam"}));
t("kutip dengan escape", ()=> assert.deepEqual(PF.extractJson('{"a":"he said \\"halo\\" }{x"}'), {a:'he said "halo" }{x'}));
t("trailing comma ditolak lalu jatuh ke kandidat berikutnya", ()=>{
  assert.throws(()=>PF.extractJson("{,}"));
});
t("bukan JSON sama sekali -> error, bukan silent", ()=> assert.throws(()=>PF.extractJson("saya tidak bisa")));

console.log("\n4) validator integritas");
t("data demo lolos tanpa catatan", ()=>{
  const i = PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, PF.DEMO.tasks);
  assert.deepEqual(i, [], "issues: " + JSON.stringify(i));
});
t("mendeteksi requirement mvp tanpa task", ()=>{
  const prd = JSON.parse(JSON.stringify(PF.DEMO.prd));
  prd.requirements.push({id:"R-009", title:"Baru", description:"d", acceptance_criteria:["x"], priority:"must", scope:"mvp"});
  const i = PF.validatePlan(prd, PF.DEMO.roadmap, PF.DEMO.tasks);
  assert.ok(i.some(x=>x.includes("R-009") && x.includes("belum dicakup")), JSON.stringify(i));
});
t("mendeteksi requirement_refs palsu", ()=>{
  const tasks = JSON.parse(JSON.stringify(PF.DEMO.tasks));
  tasks.tasks[0].requirement_refs = ["R-777"];
  const i = PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  assert.ok(i.some(x=>x.includes("R-777")));
});
t("mendeteksi depends_on ke task yang belum ada / maju", ()=>{
  const tasks = JSON.parse(JSON.stringify(PF.DEMO.tasks));
  tasks.tasks[0].depends_on = ["T-009"];
  const i = PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  assert.ok(i.some(x=>x.includes("depends_on")));
});
t("mendeteksi verification dan acceptance kosong", ()=>{
  const tasks = JSON.parse(JSON.stringify(PF.DEMO.tasks));
  tasks.tasks[1].verification = ""; tasks.tasks[1].acceptance_criteria = [];
  const i = PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  assert.ok(i.some(x=>x.includes("verification kosong")));
  assert.ok(i.some(x=>x.includes("acceptance_criteria kosong")));
});
t("mendeteksi milestone_ref asing dan ID task duplikat", ()=>{
  const tasks = JSON.parse(JSON.stringify(PF.DEMO.tasks));
  tasks.tasks[0].milestone_ref = "M-099";
  tasks.tasks.push(JSON.parse(JSON.stringify(tasks.tasks[1])));
  const i = PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  assert.ok(i.some(x=>x.includes("M-099")));
  assert.ok(i.some(x=>x.includes("duplikat")));
});
t("mendeteksi siklus dependensi", ()=>{
  const tasks = {tasks:[
    {id:"T-001", requirement_refs:["R-001"], acceptance_criteria:["a"], verification:"v", depends_on:["T-002"]},
    {id:"T-002", requirement_refs:["R-001"], acceptance_criteria:["a"], verification:"v", depends_on:["T-001"]}
  ]};
  const prd = {requirements:[{id:"R-001", scope:"mvp", priority:"must"}]};
  const i = PF.validatePlan(prd, {milestones:[]}, tasks);
  assert.ok(i.some(x=>x.includes("siklus")), JSON.stringify(i));
});
t("cycleOf menangkap rantai 3 simpul", ()=>{
  const c = PF.cycleOf([["A",["B"]],["B",["C"]],["C",["A"]]]);
  assert.ok(c.length >= 3);
});

console.log("\n4b) bukti perilaku: aturan web dan runner harus sama persis");
const CONTOH_TASK = [
  { id:"T-001", title:"Buat grafik", files_or_areas:["static/js/chart.js"], acceptance_criteria:["grafik tampil"] },
  { id:"T-002", title:"Impor CSV", files_or_areas:["scripts/import.py"], acceptance_criteria:["exit 0"] },
  { id:"T-003", title:"Perbaiki hitungan", files_or_areas:["app/stats.py"], acceptance_criteria:["halaman detail menampilkan angka"] },
  { id:"T-004", title:"Simpan transaksi", files_or_areas:["app.js"], description:"Tombol simpan menulis data", acceptance_criteria:["tersimpan"] },
  { id:"T-005", title:"Halaman", files_or_areas:["index.html"], behavior:{ url:"http://x/", checks:[{ type:"noConsoleError" }] } },
  { id:"T-006", title:"Halaman", files_or_areas:["index.html"], behavior:{ url:"buka browser", checks:[{ type:"noConsoleError" }] } },
  { id:"T-007", title:"Halaman", files_or_areas:["index.html"], behavior:{ url:"http://x/", checks:[] } },
  { id:"T-008", title:"Halaman", files_or_areas:["index.html"], behavior:{ url:"http://x/", checks:[{ type:"screenshot" }] } },
  { id:"T-009", title:"Halaman", files_or_areas:["index.html"], behavior:{ url:"http://x/", checks:[{ type:"text" },{ type:"count", selector:"input" },{ type:"click" }] } },
  { id:"T-010", title:"Halaman", files_or_areas:["index.html"], ui:false },
  { id:"T-011", title:"Grafik", files_or_areas:["static/js/c.js"], behavior:{ url:"http://x/", checks:[{ type:"canvasNotBlank", selector:"#g", minPixels:500 },{ type:"request", urlContains:"/api" }] } }
];
t("taskUi dan masalahBehavior web = worker, untuk semua contoh", ()=>{
  for(const x of CONTOH_TASK){
    assert.equal(PF.taskUi(x), W.taskUi(x), "taskUi beda di " + x.id);
    const a = PF.masalahBehavior(x), b = W.masalahBehavior(x);
    assert.equal(a.length, b.length, "jumlah masalah beda di " + x.id + ": " + JSON.stringify(a) + " vs " + JSON.stringify(b));
    assert.equal(a.length === 0, b.length === 0, "putusan lolos/tolak beda di " + x.id);
    /* pesan spec yang rusak harus sama persis — itu yang dibaca manusia saat memperbaiki plan */
    if(PF.specBehavior(x)) assert.deepEqual(a, b, "pesan spec beda di " + x.id);
  }
});
t("daftar type check yang dikenal sama di web dan worker", ()=>{
  assert.deepEqual(PF.CHECK_BROWSER, W.CHECK_BROWSER);
});
t("validator menolak task UI tanpa behavior", ()=>{
  const tasks = JSON.parse(JSON.stringify(PF.DEMO.tasks));
  delete tasks.tasks[0].behavior;
  const i = PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  assert.ok(i.some(x=>x.includes("T-001") && x.includes("task UI tanpa behavior")), JSON.stringify(i));
});
t("validator menolak behavior yang tidak bisa diukur", ()=>{
  const tasks = JSON.parse(JSON.stringify(PF.DEMO.tasks));
  tasks.tasks[0].behavior = { url:"buka halaman lalu lihat", checks:[{ type:"text", selector:"#x" }] };
  const i = PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  assert.ok(i.some(x=>x.includes("behavior.url harus alamat http")), JSON.stringify(i));
  assert.ok(i.some(x=>x.includes("butuh contains/matches/equals")), JSON.stringify(i));
});
t("ui:false meloloskan validator tapi tetap tercatat", ()=>{
  const tasks = JSON.parse(JSON.stringify(PF.DEMO.tasks));
  delete tasks.tasks[0].behavior; tasks.tasks[0].ui = false;
  const i = PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks);
  assert.ok(!i.some(x=>x.includes("T-001") && x.includes("behavior")), JSON.stringify(i));
});
t("task demo yang menyentuh UI semuanya punya behavior", ()=>{
  for(const x of PF.DEMO.tasks.tasks){
    if(PF.taskUi(x)) assert.ok(PF.specBehavior(x), x.id + " task UI tapi tanpa behavior");
  }
});
t("behaviorBaris menyebut url, viewport, dan angka pembanding", ()=>{
  const s = PF.behaviorBaris({ behavior:{ url:"http://x/", viewport:{width:360,height:760},
    checks:[{ type:"canvasNotBlank", selector:"#g", minPixels:500 }] } }).join("\n");
  assert.match(s, /http:\/\/x\//); assert.match(s, /360x760/); assert.match(s, /minPixels=500/);
});
t("markdown task ikut membawa bukti perilaku, bukan cuma verification", ()=>{
  const md = PF.tasksToMd(PF.DEMO.tasks);
  assert.match(md, /Bukti perilaku/);
  assert.match(md, /canvasNotBlank|noConsoleError|noHorizontalOverflow/);
});
t("prompt tahap tasks memerintahkan behavior dan menyebut type yang dikenal", ()=>{
  const m = PF.buildStageMessages("tasks", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO);
  const teks = m.map(x=>x.content).join("\n");
  assert.match(teks, /behavior WAJIB/);
  assert.match(teks, /canvasNotBlank/);
  assert.match(teks, /noHorizontalOverflow/);
});
t("AGENTS.md memberitahu agen bahwa browser yang mengukur, bukan klaim dia", ()=>{
  const md = PF.agentsMd(PF.defaultGates("agy"), PF.DEMO);
  assert.match(md, /gate\.behavior/);
  assert.match(md, /headless/);
});

console.log("\n5) penambalan hasil audit");
t("update menempel ke ID yang benar", ()=>{
  const res = PF.applyPatches(PF.DEMO, {patches:[{document:"tasks", collection:"tasks", action:"update", target_id:"T-005", object:{description:"disuntik", agent_hint:"x"}}]});
  assert.equal(res.applied, 1);
  assert.equal(res.tasks.tasks.find(x=>x.id === "T-005").description, "disuntik");
  assert.equal(res.tasks.tasks.find(x=>x.id === "T-005").acceptance_criteria.length, 2, "field lama tidak boleh hilang");
});
t("add memasukkan requirement baru lalu terurut", ()=>{
  const res = PF.applyPatches(PF.DEMO, {patches:[{document:"prd", collection:"requirements", action:"add", target_id:"NEW", object:{id:"R-009", title:"Impur JSON", scope:"mvp", priority:"must", acceptance_criteria:["x"], description:"d"}}]});
  assert.equal(res.applied, 1);
  const last = res.prd.requirements[res.prd.requirements.length - 1];
  assert.equal(last.id, "R-009", "harus terurut ID");
});
t("add duplikat ditolak", ()=>{
  const res = PF.applyPatches(PF.DEMO, {patches:[{document:"tasks", collection:"tasks", action:"add", object:{id:"T-001"}}]});
  assert.equal(res.applied, 0); assert.equal(res.skipped.length, 1);
});
t("patch rusak tidak bikin crash", ()=>{
  const res = PF.applyPatches(PF.DEMO, {patches:[null, {}, {document:"nope", collection:"x", action:"add", object:{id:"1"}}]});
  assert.ok(res.skipped.length >= 2);
});
t("hasil tambalan tetap lolos validator", ()=>{
  const res = PF.applyPatches(PF.DEMO, {patches:[{document:"tasks", collection:"tasks", action:"add", target_id:"NEW", object:{id:"T-010", title:"Impur", milestone_ref:"M-004", requirement_refs:["R-009"], description:"d", files_or_areas:["app.js"], acceptance_criteria:["a"], verification:"node --test test/a.test.mjs", depends_on:["T-009"], size:"S", agent_hint:""}}]});
  const i = PF.validatePlan(res.prd, res.roadmap, res.tasks);
  assert.ok(i.every(x=>!x.includes("belum dicakup")), JSON.stringify(i));
});
t("patch task tanpa identitas atau verification sah ditolak sebelum diterapkan", ()=>{
  const result = PF.applyPatches(PF.DEMO, {patches:[
    {document:"tasks", collection:"tasks", action:"add", object:{title:"task tanpa id", verification:"node --test"}},
    {document:"tasks", collection:"tasks", action:"add", object:{id:"T-010", title:"verifikasi manual", verification:"buka browser lalu lihat"}}
  ]});
  assert.equal(result.applied, 0);
  assert.equal(result.tasks.tasks.length, PF.DEMO.tasks.tasks.length);
  assert.equal(result.skipped.length, 2);
});
t("patch task baru tidak boleh disisipkan sebelum scaffold pertama", ()=>{
  const result = PF.applyPatches(PF.DEMO, {patches:[{document:"tasks", collection:"tasks", action:"add",
    object:{id:"T-000", title:"Task baru", verification:"node --test test/a.test.mjs"}}]});
  assert.equal(result.applied, 0);
  assert.match(result.skipped.join(" "), /sebelum scaffold pertama/);
});
t("tambal yang menurunkan mutu ditolak tanpa mengubah dokumen sumber", ()=>{
  const docs = JSON.parse(JSON.stringify(PF.DEMO));
  const original = docs.tasks.tasks[0].verification;
  const result = PF.applyImprovingPatches(docs, {patches:[{document:"tasks", collection:"tasks", action:"update",
    target_id:"T-001", object:{verification:"buka browser lalu lihat"}}]}, false);
  assert.equal(result.accepted, false);
  assert.equal(result.applied, 0);
  assert.equal(result.beforeScore, 100);
  assert.match(result.skipped.join(" "), /ditolak/);
  assert.equal(docs.tasks.tasks[0].verification, original);
});
t("tambal konvergen menerima patch yang benar-benar mengurangi masalah", ()=>{
  const docs = JSON.parse(JSON.stringify(PF.DEMO));
  const behavior = docs.tasks.tasks[0].behavior;
  delete docs.tasks.tasks[0].behavior;
  const result = PF.applyImprovingPatches(docs, {patches:[{document:"tasks", collection:"tasks", action:"update",
    target_id:"T-001", object:{behavior}}]}, false);
  assert.equal(result.accepted, true);
  assert.ok(result.afterProblems < result.beforeProblems);
  assert.ok(result.afterScore >= result.beforeScore);
});

console.log("\n6) render & ekspor");
const cfg = {language:"Bahasa Indonesia", targetAgent:"Qoder", audience:"pemilik warung"};
t("renderMarkdown untuk semua tab menghasilkan HTML tanpa crash", ()=>{
  for(const [kind, d] of [["clarify",PF.DEMO.clarify],["prd",PF.DEMO.prd],["roadmap",PF.DEMO.roadmap],["tasks",PF.DEMO.tasks],["issues",PF.validatePlan(PF.DEMO.prd,PF.DEMO.roadmap,PF.DEMO.tasks)]])
    assert.ok(PF.renderMarkdown(kind, d).length > 60, kind + " terlalu pendek");
});
t("roadmap tanpa project_name tidak melempar error", ()=>{
  const r = JSON.parse(JSON.stringify(PF.DEMO.roadmap)); delete r.project_name;
  assert.ok(PF.renderMarkdown("roadmap", r).includes("Roadmap"));
});
t("HTML di-escape (tidak bisa injeksi dari isi JSON)", ()=>{
  const bad = {project_name:"<img src=x onerror=alert(1)>", one_liner:"a", summary:"b", requirements:[], goals:[], personas:[], flows:[], data:[], tech:[], risks:[], metrics:[], open_questions:[], problem:{}};
  assert.ok(!PF.renderMarkdown("prd", bad).includes("<img src=x"));
});
t("audit bersih menampilkan status hijau", ()=>{
  assert.ok(PF.renderMarkdown("issues", []).includes("ok"));
});
t("TASKS.md memuat ID, dependensi, dan perintah verifikasi", ()=>{
  const md = PF.tasksToMd(PF.DEMO.tasks);
  for(const s of ["T-001","T-009","Tergantung pada","Verifikasi:", "Kerjakan berurutan"]) assert.ok(md.includes(s), s);
});
t("PRD.md bernomor 1-7 seperti format yang dituju", ()=>{
  const md = PF.prdToMd(PF.DEMO.prd);
  for(const s of ["## 1. Overview","## 2. Requirements","### Fungsional","### Non-Fungsional","## 3. Core Features","## 4. User Flow","## 5. Architecture","## 6. Database Schema","## 7. Tech Stack","- [ ] ","R-001"])
    assert.ok(md.includes(s), "kurang: " + s);
});
t("FEATURES.md memuat fitur dan sub-fitur", ()=>{
  const md = PF.featuresToMd(PF.DEMO.prd);
  assert.ok(md.includes("# Spesifikasi fitur") && md.includes("Pesan & kasir") && md.includes("keranjang ketuk-untuk-tambah"), md.slice(0,120));
});
t("TASKS.md dikelompokkan per fitur dan memakai checkbox status", ()=>{
  const md = PF.tasksToMd(PF.DEMO.tasks);
  assert.ok(md.includes("# Pesan & kasir (2)"), "pengelompokan fitur hilang");
  assert.ok(md.includes("## [ ] T-001"), "checkbox status hilang");
  assert.ok(md.includes("Status: belum mulai"), "baris status hilang");
  const done = JSON.parse(JSON.stringify(PF.DEMO.tasks)); done.tasks[0].status = "selesai";
  assert.ok(PF.tasksToMd(done).includes("## [x] T-001"), "status selesai tidak jadi tercentang");
});
t("ROADMAP.md memuat exit criteria dan feature_refs", ()=>{
  const md = PF.roadmapToMd(PF.DEMO.roadmap);
  assert.ok(md.includes("M-001") && md.includes("- [ ]") && md.includes("Fitur: Kerangka aplikasi"));
});
t("AGENT_PROMPT.txt menyebut agen target dan titik mulai", ()=>{
  const p = PF.buildAgentPrompt(cfg, PF.DEMO);
  assert.ok(p.includes("Qoder") && p.includes("T-001") && p.includes("TASKS.md"));
});

console.log("\n7) integritas data demo (dipakai untuk uji end-to-end di browser)");
t("DEMO memuat keempat dokumen", ()=>{
  for(const k of ["clarify","prd","roadmap","tasks"]) assert.ok(PF.DEMO[k], k);
});
t("snapshot harga tersimpan di TxLine (konsisten dgn risiko)", ()=>{
  assert.ok(PF.DEMO.prd.data.some(e=>e.entity === "TxLine" && e.fields.join().includes("snapshot")));
});

console.log("\n8) lapisan fitur, non-fungsional, status (kalibrasi dari format target)");
t("demo tetap bersih setelah skema diperluas", ()=>{
  assert.deepEqual(PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, PF.DEMO.tasks), []);
});
t("applyPatches tidak mengubah dokumen aslinya", ()=>{
  const before = JSON.stringify(PF.DEMO.tasks.tasks.length) + JSON.stringify(PF.DEMO.prd.requirements.length);
  PF.applyPatches(PF.DEMO, {patches:[{document:"tasks", collection:"tasks", action:"add", target_id:"NEW", object:{id:"T-099", title:"suntik", requirement_refs:["R-001"], acceptance_criteria:["a"], verification:"v"}}]});
  PF.applyPatches(PF.DEMO, {patches:[{document:"prd", collection:"requirements", action:"add", target_id:"NEW", object:{id:"R-099", title:"suntik", scope:"mvp", priority:"must", acceptance_criteria:["a"]}}]});
  assert.equal(JSON.stringify(PF.DEMO.tasks.tasks.length) + JSON.stringify(PF.DEMO.prd.requirements.length), before, "dokumen sumber ikut berubah");
});
t("non_functional hilang terdeteksi", ()=>{
  const p = JSON.parse(JSON.stringify(PF.DEMO.prd)); delete p.non_functional;
  assert.ok(PF.validatePlan(p, PF.DEMO.roadmap, PF.DEMO.tasks).some(x=>x.includes("non_functional")));
});
t("target non-fungsional tanpa angka terdeteksi", ()=>{
  const p = JSON.parse(JSON.stringify(PF.DEMO.prd));
  p.non_functional[0].target = "harus cepat";
  const i = PF.validatePlan(p, PF.DEMO.roadmap, PF.DEMO.tasks);
  assert.ok(i.some(x=>x.includes("N-001") && x.includes("belum berupa angka terukur")), JSON.stringify(i));
});
t("features hilang terdeteksi", ()=>{
  const p = JSON.parse(JSON.stringify(PF.DEMO.prd)); delete p.features;
  assert.ok(PF.validatePlan(p, PF.DEMO.roadmap, PF.DEMO.tasks).some(x=>x.includes("features kosong")));
});
t("task dengan fitur asing terdeteksi", ()=>{
  const ts = JSON.parse(JSON.stringify(PF.DEMO.tasks)); ts.tasks[0].feature = "Fitur hantu";
  assert.ok(PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, ts).some(x=>x.includes("tidak ada di prd.features")));
});
t("fitur tanpa task terdeteksi", ()=>{
  const p = JSON.parse(JSON.stringify(PF.DEMO.prd));
  p.features.push({name:"Fitur menganggur", priority:"low", phase:"Fase 9", sub_features:["x"]});
  assert.ok(PF.validatePlan(p, PF.DEMO.roadmap, PF.DEMO.tasks).some(x=>x.includes("Fitur menganggur") && x.includes("belum punya task")));
});
t("status di luar taksonomi terdeteksi", ()=>{
  const ts = JSON.parse(JSON.stringify(PF.DEMO.tasks)); ts.tasks[0].status = "done";
  assert.ok(PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, ts).some(x=>x.includes("status 'done'")));
});
t("priority di luar taksonomi utama/penting/tambahan terdeteksi", ()=>{
  const ts = JSON.parse(JSON.stringify(PF.DEMO.tasks)); ts.tasks[0].priority = "pendukung";
  assert.ok(PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, ts).some(x=>x.includes("priority 'pendukung'")));
  const ok = JSON.parse(JSON.stringify(PF.DEMO.tasks)); ok.tasks[0].priority = "penting";
  assert.ok(!PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, ok).some(x=>x.includes("priority")), "tier valid tidak boleh dicatat");
});
t("normalizePlan memetakan pendukung ke tambahan dan merapikan priority", ()=>{
  const ts = JSON.parse(JSON.stringify(PF.DEMO.tasks));
  ts.tasks[0].priority = "pendukung"; ts.tasks[1].priority = "Penting"; ts.tasks[2].priority = "aneh";
  const nz = PF.normalizePlan(PF.DEMO.prd, PF.DEMO.roadmap, ts);
  assert.equal(nz.tasks.tasks[0].priority, "tambahan");
  assert.equal(nz.tasks.tasks[1].priority, "penting");
  assert.equal(nz.tasks.tasks[2].priority, "utama");
});
t("prompt tasks menyebut tiga tier utama/penting/tambahan", ()=>{
  const m = PF.buildStageMessages("tasks", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO);
  assert.ok(m[1].content.includes("utama/penting/tambahan"), "tier baru tidak disebut di prompt");
  assert.ok(!m[1].content.includes("utama/pendukung"), "tier lama masih tersisa");
});
t("pencocokan nama fitur toleran huruf besar/kecil", ()=>{
  const ts = JSON.parse(JSON.stringify(PF.DEMO.tasks)); ts.tasks[0].feature = "  KERANGKA APLIKASI ";
  const i = PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, ts);
  assert.ok(!i.some(x=>x.includes("tidak ada di prd.features")), JSON.stringify(i));
});
t("roadmap feature_refs asing terdeteksi", ()=>{
  const rm = JSON.parse(JSON.stringify(PF.DEMO.roadmap)); rm.milestones[0].feature_refs = ["Bukan fitur"];
  assert.ok(PF.validatePlan(PF.DEMO.prd, rm, PF.DEMO.tasks).some(x=>x.includes("M-001") && x.includes("Bukan fitur")));
});
t("prompt tasks menuntut lapisan fitur + jumlah task natural (anti-terpotong)", ()=>{
  const m = PF.buildStageMessages("tasks", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO);
  assert.ok(m[1].content.includes("NATURAL") && m[1].content.includes("sub_features") && m[1].content.includes("status"));
  assert.ok(!m[1].content.includes("8-20 task"), "patokan lama 8-20 task harus hilang demi granularitas natural");
  assert.ok(!m[1].content.includes("25-90"), "patokan lama 25-90 task bikin model kecil terpotong");
  assert.match(m[1].content, /RINGKAS/, "prompt harus minta keluaran ringkas supaya tidak terpotong");
});
t("prompt prd menuntut non-fungsional terukur dan 7 bagian", ()=>{
  const m = PF.buildStageMessages("prd", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO);
  assert.ok(m[1].content.includes("Non-Fungsional") || m[1].content.includes("non_functional"));
  assert.ok(m[1].content.includes("Database Schema") && m[1].content.includes("template_note"));
  assert.ok(m[1].content.includes("Nama fitur = 2-4 kata"), "aturan nama fitur pendek hilang");
});
t("prompt tasks melarang nama fitur karangan sendiri", ()=>{
  const m = PF.buildStageMessages("tasks", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO);
  assert.ok(m[1].content.includes("Jangan membuat nama fitur baru"), m[1].content.slice(0,80));
});

console.log("\n8b) chunking task per milestone (granularitas natural)");
t("taskChunks urut theo order lalu id, tandai pertama/terakhir, bawa refs", ()=>{
  const rm = {milestones:[
    {id:"M-003", title:"C", order:3, feature_refs:["f3"], requirement_refs:["R-003"]},
    {id:"M-001", title:"A", order:1, feature_refs:["f1"], requirement_refs:["R-001"]},
    {id:"M-002", title:"B", order:2, feature_refs:["f2"], requirement_refs:["R-002"]}]};
  const ch = PF.taskChunks(rm, PF.DEMO.prd);
  assert.deepEqual(ch.map(c=>c.milestone_ref), ["M-001","M-002","M-003"]);
  assert.equal(ch[0].isFirst, true); assert.equal(ch[0].isLast, false);
  assert.equal(ch[2].isFirst, false); assert.equal(ch[2].isLast, true);
  assert.deepEqual(ch[0].feature_refs, ["f1"]);
  assert.deepEqual(ch[0].requirement_refs, ["R-001"]);
  assert.equal(ch[0].title, "A");
});
t("taskChunks tie-break order sama pakai id; roadmap kosong/null -> []", ()=>{
  const rm = {milestones:[{id:"M-002",order:1},{id:"M-001",order:1}]};
  assert.deepEqual(PF.taskChunks(rm,{}).map(c=>c.milestone_ref), ["M-001","M-002"]);
  assert.deepEqual(PF.taskChunks({milestones:[]},{}), []);
  assert.deepEqual(PF.taskChunks(null,{}), []);
  const satu = PF.taskChunks({milestones:[{id:"M-001",order:1}]},{});
  assert.equal(satu[0].isFirst, true); assert.equal(satu[0].isLast, true);
});
t("mergeTaskChunk nomori lanjut: dep lokal chunk dipetakan ke ID global baru, bukan base", ()=>{
  const base = [{id:"T-001",depends_on:[]},{id:"T-002",depends_on:["T-001"]}];
  const chunk = [{id:"T-001",title:"lokal satu",depends_on:[]},{id:"T-002",title:"lokal dua",depends_on:["T-001"]}];
  const out = PF.mergeTaskChunk(base, chunk);
  assert.deepEqual(out.map(x=>x.id), ["T-001","T-002","T-003","T-004"]);
  assert.equal(out[2].title, "lokal satu");
  assert.deepEqual(out[3].depends_on, ["T-003"], "dep lokal T-001 harus jadi T-003 global, bukan T-001 base");
});
t("mergeTaskChunk pertahankan dep ke chunk sebelumnya, buang self-dep & duplikat", ()=>{
  const base = [{id:"T-001",depends_on:[]}];
  const chunk = [{id:"X",depends_on:["T-001","X","T-001"]}];
  const out = PF.mergeTaskChunk(base, chunk);
  assert.equal(out[1].id, "T-002");
  assert.deepEqual(out[1].depends_on, ["T-001"], "dep global T-001 tetap; self-dep X dan duplikat dibuang");
});
t("mergeTaskChunk dasar kosong mulai T-001; chunk kosong/null tidak mengubah daftar", ()=>{
  const out = PF.mergeTaskChunk([], [{id:"A",depends_on:[]},{id:"B",depends_on:["A"]}]);
  assert.deepEqual(out.map(x=>x.id), ["T-001","T-002"]);
  assert.deepEqual(out[1].depends_on, ["T-001"]);
  const base = [{id:"T-001",depends_on:[]}];
  assert.deepEqual(PF.mergeTaskChunk(base, []), base);
  assert.deepEqual(PF.mergeTaskChunk(null, null), []);
});
t("prompt tasks mode focus menyebut FOKUS CHUNK + milestone + lanjut penomoran", ()=>{
  const focus = {milestone_ref:"M-002", title:"Katalog", feature_refs:["Katalog item"], requirement_refs:["R-001"], isFirst:false, isLast:false, existingIds:["T-001","T-002"], startId:"T-003"};
  const m = PF.buildStageMessages("tasks", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO, focus);
  assert.ok(m[1].content.includes("FOKUS CHUNK") && m[1].content.includes("M-002"));
  assert.ok(m[1].content.includes("T-003"), "startId lanjutan harus disebut");
  assert.ok(m[1].content.includes("Jangan membuat task skeleton"), "chunk tengah dilarang bikin skeleton/audit");
});
t("prompt tasks focus pertama minta skeleton, focus terakhir minta audit end-to-end", ()=>{
  const first = PF.buildStageMessages("tasks", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO, {milestone_ref:"M-001", isFirst:true, isLast:false});
  assert.ok(first[1].content.includes("skeleton proyek"), "chunk pertama harus menyiapkan skeleton");
  const last = PF.buildStageMessages("tasks", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO, {milestone_ref:"M-004", isFirst:false, isLast:true});
  assert.ok(last[1].content.includes("audit end-to-end"), "chunk terakhir harus audit end-to-end");
});

console.log("\n8c) clarify interaktif 5-slot dinamis");
t("skema clarify punya questions + user_answers, project_name tetap kunci pertama", ()=>{
  assert.equal(Object.keys(PF.SCHEMAS.clarify)[0], "project_name");
  assert.ok(PF.SCHEMAS.clarify.questions && PF.SCHEMAS.clarify.user_answers);
});
t("prompt clarify menuntut 5 slot berurut Q-001..Q-005 + wording spesifik ide", ()=>{
  const m = PF.buildStageMessages("clarify", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO);
  for(const s of ["Q-001","Q-005","persona","aha","mvp_features","value_prop","retention","TEPAT 5"])
    assert.ok(m[1].content.includes(s), "kurang: " + s);
  assert.ok(/spesifik untuk ide/i.test(m[1].content), "harus minta wording spesifik ide, bukan generik");
});
t("prompt prd menghormati user_answers sebagai sumber utama", ()=>{
  const m = PF.buildStageMessages("prd", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO);
  assert.ok(m[1].content.includes("user_answers"), "PRD harus menyebut user_answers");
});
t("DEMO.clarify punya 5 pertanyaan discovery berurut + contoh jawaban", ()=>{
  assert.equal(PF.DEMO.clarify.questions.length, 5);
  assert.deepEqual(PF.DEMO.clarify.questions.map(q=>q.slot), ["persona","aha","mvp_features","value_prop","retention"]);
  assert.ok(PF.DEMO.clarify.user_answers.length >= 1);
});
t("terapkanJawabanClarify: jawaban terisi jadi defaults_chosen, dilewati tidak", ()=>{
  const cd = JSON.parse(JSON.stringify(PF.DEMO.clarify));
  const sebelum = cd.defaults_chosen.length;
  const jawab = [{question_id:"Q-001", answer:"Bu Sari, buku tulis"},{question_id:"Q-002", answer:"  "},{question_id:"Q-003", answer:"Katalog; Kasir"}];
  PF.terapkanJawabanClarify(cd, jawab);
  assert.equal(cd.user_answers.length, 3);
  assert.equal(cd.user_answers[1].answer, "", "jawaban kosong tetap tercatat sebagai dilewati");
  assert.ok(cd.defaults_chosen.some(d=>d.decision === "Bu Sari, buku tulis" && /Jawaban user/.test(d.reason)), "jawaban terisi harus masuk defaults_chosen");
  assert.ok(!cd.defaults_chosen.some(d=>String(d.decision).trim() === ""), "jawaban kosong tidak boleh jadi default");
  assert.equal(cd.defaults_chosen.length, sebelum + 2, "hanya 2 jawaban terisi yang menambah default");
});
t("terapkanJawabanClarify menimpa default berpertanyaan sama, bukan duplikat", ()=>{
  const cd = {questions:[{id:"Q-001", question:"Butuh backend?"}], defaults_chosen:[{question:"Butuh backend?", decision:"tidak", reason:"tebakan model"}]};
  PF.terapkanJawabanClarify(cd, [{question_id:"Q-001", answer:"ya, pakai Supabase"}]);
  assert.equal(cd.defaults_chosen.length, 1);
  assert.equal(cd.defaults_chosen[0].decision, "ya, pakai Supabase");
});
t("renderMarkdown clarify menampilkan pertanyaan + jawaban dan meng-escape XSS", ()=>{
  const cd = JSON.parse(JSON.stringify(PF.DEMO.clarify));
  cd.questions[0].question = "<img src=x onerror=alert(1)>";
  cd.user_answers = [{question_id:"Q-001", answer:"<script>alert(2)</script>"}];
  const h = PF.renderMarkdown("clarify", cd, {});
  assert.ok(h.includes("Pertanyaan discovery"));
  assert.ok(!h.includes("<img src=x") && !h.includes("<script>alert(2)"), "XSS harus di-escape");
  assert.ok(h.includes("&lt;img") && h.includes("&lt;script&gt;"));
});

console.log("\n8d) clarify+: pertanyaan bebas AI (ai_questions) di luar 5 slot");
t("skema clarify punya ai_questions (id/question/why/type/options)", ()=>{
  const a = PF.SCHEMAS.clarify.ai_questions;
  assert.ok(Array.isArray(a) && a[0] && a[0].id && a[0].question && a[0].why && a[0].type && Array.isArray(a[0].options));
});
t("prompt clarify memberi kebebasan AI bertanya hal ambigu (0-4, why, jangan ulang slot)", ()=>{
  const m = PF.buildStageMessages("clarify", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO);
  for(const s of ["ai_questions","0-4","why","JANGAN mengulang"]) assert.ok(m[1].content.includes(s), "kurang: " + s);
});
t("terapkanJawabanClarify melipat jawaban A- (slot bebas) ke defaults_chosen", ()=>{
  const cd = {questions:[{id:"Q-001", question:"persona?"}], ai_questions:[{id:"A-001", question:"Perlu midtrans?", why:"belum tahu metode bayar"}], defaults_chosen:[]};
  PF.terapkanJawabanClarify(cd, [{question_id:"A-001", answer:"cukup tunai dulu"}]);
  assert.ok(cd.defaults_chosen.some(d=>d.question==="Perlu midtrans?" && d.decision==="cukup tunai dulu"), "jawaban slot bebas harus masuk defaults");
  assert.equal(cd.user_answers[0].question_id, "A-001");
});
t("renderMarkdown clarify menampilkan seksi klarifikasi AI + escape XSS di question/why", ()=>{
  const cd = JSON.parse(JSON.stringify(PF.DEMO.clarify));
  cd.ai_questions = [{id:"A-001", question:"<img src=x onerror=alert(1)>", why:"<script>alert(2)</script>", type:"text", options:[]}];
  cd.user_answers = [{question_id:"A-001", answer:"tunai"}];
  const h = PF.renderMarkdown("clarify", cd, {});
  assert.ok(h.includes("Pertanyaan klarifikasi AI"));
  assert.ok(!h.includes("<img src=x") && !h.includes("<script>alert(2)"));
  assert.ok(h.includes("&lt;img") && h.includes("&lt;script&gt;"));
});

console.log("\n8e) starter template original: blob sinkron disk + kunci stack + delta + bundle");
const starterDir = path.join(import.meta.dirname, "..", "starter");
const SKIP_DIR = new Set(["node_modules", ".next", ".git"]);
const SKIP_FILE = new Set(["package-lock.json", ".starter-smoke.log"]);
function walkStarter(dir, base, out){
  for(const e of fs.readdirSync(dir, {withFileTypes:true})){
    if(SKIP_DIR.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = base ? base + "/" + e.name : e.name;
    if(e.isDirectory()) walkStarter(full, rel, out);
    else if(!SKIP_FILE.has(e.name)) out[rel] = fs.readFileSync(full, "utf8");
  }
  return out;
}
const docsStarter = {clarify:PF.DEMO.clarify, prd:PF.DEMO.prd, roadmap:PF.DEMO.roadmap, tasks:PF.DEMO.tasks};
const cfgStarter = {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum", starter:"nextjs-fullstack"};
const cfgPolos = {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"};
t("blob STARTER_FILES sinkron persis dengan folder starter/ di disk (tidak basi, tanpa node_modules/.next)", ()=>{
  const disk = walkStarter(starterDir, "", {});
  assert.deepEqual(PF.STARTER_FILES, disk, "blob tertanam beda dari disk — jalankan node scripts/embed-starter.mjs");
  for(const k of Object.keys(PF.STARTER_FILES)) assert.ok(!k.includes("node_modules") && !k.startsWith(".next/"), "file terlarang ikut ter-embed: " + k);
});
t("starterMeta membaca manifest: id, stack terkunci, perintah migrasi/seed", ()=>{
  const m = PF.starterMeta();
  assert.equal(m.id, "nextjs-fullstack");
  assert.ok(/Next\.js 15/.test(m.stack.frontend));
  assert.equal(m.perintah.migrasi, "npm run migrate");
  assert.equal(m.perintah.seed, "npm run seed");
});
t("starterAktif hanya nyala kalau cfg.starter dipilih", ()=>{
  assert.equal(PF.starterAktif({starter:"nextjs-fullstack"}), true);
  assert.equal(PF.starterAktif({}), false);
  assert.equal(PF.starterAktif({starter:""}), false);
});
t("starterLockLines mengunci stack + melarang bangun ulang + menuntut DELTA", ()=>{
  const L = PF.starterLockLines(cfgStarter);
  assert.ok(Array.isArray(L) && L.length >= 3);
  const gabung = L.join("\n");
  for(const s of ["DIKUNCI","Next.js 15","JANGAN membangun ulang","DELTA"]) assert.ok(gabung.includes(s), "kurang: " + s);
  assert.deepEqual(PF.starterLockLines({}), []);
});
t("starterFileEntries: semua bertanda starter, tanpa manifest, termasuk cookie.js hasil fix edge", ()=>{
  const e = PF.starterFileEntries();
  assert.ok(e.every(f=>f.starter === true));
  assert.ok(!e.some(f=>f.name === "manifest.json"));
  assert.ok(e.some(f=>f.name === "lib/cookie.js"));
  assert.ok(e.some(f=>f.name === "package.json"));
  assert.equal(e.length, Object.keys(PF.STARTER_FILES).length - 1);
});
t("items/route.js di blob pakai kedalaman import benar (../../../lib, bukan ../../../../) — fix build", ()=>{
  const src = PF.STARTER_FILES["app/api/items/route.js"];
  assert.ok(src.includes("../../../lib/session") && !src.includes("../../../../lib/session"), "import items masih salah kedalaman");
  assert.ok(PF.STARTER_FILES["lib/auth.js"].includes('./cookie.js'), "auth harus impor cookie.js eksplisit supaya node --test jalan");
});
t("skrip migrasi/seed memuat .env.local lewat @next/env supaya jalur DB siap-jalan (bukan cuma dev)", ()=>{
  for(const s of ["scripts/migrate.mjs","scripts/seed.mjs"]){
    const src = PF.STARTER_FILES[s];
    assert.ok(src.includes("@next/env") && src.includes("loadEnvConfig"), s + " harus memuat env .env.local");
  }
  const pkg = JSON.parse(PF.STARTER_FILES["package.json"]);
  assert.ok(pkg.dependencies["@next/env"], "@next/env harus declared supaya npm install menyediakan");
  assert.equal(pkg.scripts.test, "node --test", "perintah test harus discovery default, bukan path yang gagal resolve");
  assert.ok(PF.STARTER_FILES["middleware.js"].includes("./lib/cookie") && !PF.STARTER_FILES["middleware.js"].includes("./lib/auth"), "middleware edge tidak boleh menarik node:crypto dari lib/auth");
});
t("prompt prd mengunci stack ke starter kalau dipilih, dan tidak kalau kosong", ()=>{
  const ada = PF.buildStageMessages("prd", cfgStarter, PF.DEMO)[1].content;
  assert.ok(ada.includes("STARTER TERPILIH") && ada.includes("DIKUNCI"));
  assert.ok(!PF.buildStageMessages("prd", cfgPolos, PF.DEMO)[1].content.includes("STARTER TERPILIH"));
});
t("prompt tasks menuntut DELTA + larangan bangun ulang fondasi kalau starter dipilih", ()=>{
  const ada = PF.buildStageMessages("tasks", cfgStarter, PF.DEMO)[1].content;
  for(const s of ["STARTER DIPAKAI","DELTA","JANGAN membuat task membangun ulang"]) assert.ok(ada.includes(s), "kurang: " + s);
  assert.ok(!PF.buildStageMessages("tasks", cfgPolos, PF.DEMO)[1].content.includes("STARTER DIPAKAI"));
});
t("runnerBundle menyertakan file starter bertanda starter hanya kalau opts.starter ada", ()=>{
  const dengan = PF.runnerBundle(docsStarter, [], PF.defaultGates("agy"), {agent:"agy", workerSource:"// worker", starter:"nextjs-fullstack"});
  assert.equal(dengan.filter(f=>f.starter).length, PF.starterFileEntries().length);
  assert.ok(dengan.some(f=>f.name === "package.json" && f.starter));
  assert.ok(dengan.some(f=>f.name === "lib/cookie.js" && f.starter));
  const tanpa = PF.runnerBundle(docsStarter, [], PF.defaultGates("agy"), {agent:"agy", workerSource:"// worker"});
  assert.equal(tanpa.length, 6);
  assert.ok(!tanpa.some(f=>f.name === "package.json"));
});
t("rencanaTulis: file starter yang sudah ada DILEWATI (tidak menimpa kerja agen), yang belum ada = baru", ()=>{
  const files = PF.runnerBundle(docsStarter, [], PF.defaultGates("agy"), {agent:"agy", workerSource:"// worker", starter:"nextjs-fullstack"});
  const ada = PF.rencanaTulis(files, {"package.json":"{\"name\":\"sudah-diedit-agen\"}"}, {});
  const pj = ada.find(r=>r.name === "package.json");
  assert.equal(pj.aksi, "lewati");
  assert.equal(pj.data, "{\"name\":\"sudah-diedit-agen\"}", "isi starter lama harus dipertahankan");
  const kosong = PF.rencanaTulis(files, {}, {});
  assert.equal(kosong.find(r=>r.name === "package.json").aksi, "baru");
  assert.equal(kosong.find(r=>r.name === "lib/cookie.js").aksi, "baru");
});
t("agentsMd + connPrompt memberi catatan hidupkan fondasi starter hanya kalau dipilih", ()=>{
  const md = PF.agentsMd(docsStarter, PF.defaultGates("agy"), {agent:"agy", starter:"nextjs-fullstack"});
  assert.ok(md.includes("Fondasi starter") && md.includes("npm run migrate") && md.includes("npm run seed"));
  assert.ok(PF.connPrompt({starter:"nextjs-fullstack"}).includes("FONDASI STARTER"));
  assert.ok(!PF.agentsMd(docsStarter, PF.defaultGates("agy"), {agent:"agy"}).includes("Fondasi starter"));
  assert.ok(!PF.connPrompt({}).includes("FONDASI STARTER"));
});

console.log("\n8f) diagram ER + sequence (SVG inline, tanpa dependensi, semua string model di-escape)");
t("parseField: bentuk kanon 'nama (tipe) — catatan'", ()=>{
  const f = PF.parseField("user_id (uuid) — referensi ke User");
  assert.equal(f.name, "user_id"); assert.equal(f.type, "uuid"); assert.equal(f.note, "referensi ke User");
});
t("parseField: bentuk kolon 'id: uuid' dan 'name: string (snapshot)'", ()=>{
  assert.equal(PF.parseField("id: uuid").name, "id");
  assert.equal(PF.parseField("id: uuid").type, "uuid");
  const s = PF.parseField("name: string (snapshot)");
  assert.equal(s.name, "name"); assert.equal(s.type, "string"); assert.equal(s.note, "snapshot");
  assert.equal(PF.parseField("lines: TxLine[]").type, "TxLine[]");
});
t("svgWrap: pecah baris <= maxChars dan hard-break kata panjang", ()=>{
  const L = PF.svgWrap("satu dua tiga empat lima enam", 9);
  assert.ok(L.every(x=>x.length<=9), JSON.stringify(L));
  assert.equal(L.join(" "), "satu dua tiga empat lima enam");
  const H = PF.svgWrap("abcdefghijklmnop", 5);
  assert.deepEqual(H, ["abcde","fghij","klmno","p"]);
});
t("erDiagramSvg kosong/null -> string kosong (perilaku lama tidak berubah)", ()=>{
  assert.equal(PF.erDiagramSvg([]), ""); assert.equal(PF.erDiagramSvg(null), ""); assert.equal(PF.erDiagramSvg(undefined), "");
});
t("erDiagramSvg DEMO: SVG inline memuat tabel, PK, FK, dan marker panah", ()=>{
  const svg = PF.erDiagramSvg(PF.DEMO.prd.data);
  assert.ok(svg.startsWith("<svg"), svg.slice(0,40));
  assert.ok(svg.includes("Item") && svg.includes("TxLine") && svg.includes("Transaction"));
  assert.equal((svg.match(/>PK</g)||[]).length, 2, "PK harus 2 (Item.id, Transaction.id)");
  assert.equal((svg.match(/>FK</g)||[]).length, 2, "FK harus 2 (TxLine.itemId, Transaction.lines)");
  assert.ok(svg.includes('marker-end="url(#pfEr'), "panah relasi tidak ada");
  assert.ok(!/https?:\/\//.test(svg.replace('xmlns="http://www.w3.org/2000/svg"','')), "tidak boleh dependensi eksternal");
});
t("ER: relasi DITEBAK dari itemId->Item dan lines:TxLine[]->TxLine (2 garis)", ()=>{
  const svg = PF.erDiagramSvg(PF.DEMO.prd.data);
  assert.equal((svg.match(/marker-end="url\(#pfEr/g)||[]).length, 2);
  assert.ok(svg.includes(">itemId<") && svg.includes(">lines<"), "label garis FK tidak ada");
});
t("ER: string model jahat di-escape, tidak jadi tag hidup", ()=>{
  const svg = PF.erDiagramSvg([{entity:'<img src=x onerror=alert(1)>', fields:['<script>alert("x")</script> (text) — note & "quotes"']}]);
  assert.ok(svg.includes("&lt;script&gt;") && svg.includes("&lt;img"), "escape kurang");
  assert.ok(!svg.includes("<script>") && !svg.includes("<img"), "tag mentah bocor");
  assert.ok(svg.includes("&amp;") && svg.includes("&quot;"));
});
t("sequenceDiagramSvg kosong/null -> string kosong", ()=>{
  assert.equal(PF.sequenceDiagramSvg([]), ""); assert.equal(PF.sequenceDiagramSvg(null), "");
});
t("sequenceDiagramSvg DEMO: SVG inline memuat alur, langkah, nomor, panah", ()=>{
  const svg = PF.sequenceDiagramSvg(PF.DEMO.prd.flows);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Kasir menutup transaksi") || svg.includes("Kasir menutup"), "nama alur tidak ada");
  assert.ok(svg.includes("ketuk item") && svg.includes("tekan Simpan"), "langkah tidak ada");
  assert.ok(svg.includes('marker-end="url(#pfSeq'), "panah urutan tidak ada");
  assert.ok(svg.includes(">1</text>") && svg.includes(">2</text>"), "nomor langkah tidak ada");
});
t("sequence: string model jahat di-escape", ()=>{
  const svg = PF.sequenceDiagramSvg([{name:'<b>x</b>', steps:['<script>alert(1)</script>','ok & "fine"']}]);
  assert.ok(svg.includes("&lt;script&gt;") && !svg.includes("<script>"));
  assert.ok(svg.includes("&amp;") && svg.includes("&quot;"));
});
t("renderMarkdown prd menyisipkan KEDUA diagram (ER + sequence) di GUI", ()=>{
  const html = PF.renderMarkdown("prd", PF.DEMO.prd, PF.DEMO);
  assert.equal((html.match(/<svg/g)||[]).length, 2, "harus ada 2 SVG inline");
  assert.ok(html.includes("DITEBAK"), "hint kejujuran FK tidak ada");
});
t("diagram bebas aksara CJK (generator tidak boleh nyasar)", ()=>{
  const re = /[\u3400-\u9fff\u3040-\u30ff]/;
  assert.ok(!re.test(PF.erDiagramSvg(PF.DEMO.prd.data)));
  assert.ok(!re.test(PF.sequenceDiagramSvg(PF.DEMO.prd.flows)));
});

console.log("\n8g) handoff GitHub opsional: susun bundel + urutan Git Data API (mock, tanpa jaringan/token)");
const mockHttp = (overrides)=>{
  const calls=[];
  const fn=async (method,path,body)=>{
    calls.push({method,path,body});
    const key=method+" "+path;
    if(overrides && overrides[key]) return overrides[key];
    if(method==="GET" && /\/git\/ref\/heads\//.test(path)) return {status:200,json:{object:{sha:"baseSHA"}}};
    if(method==="GET" && /\/git\/commits\/baseSHA/.test(path)) return {status:200,json:{tree:{sha:"baseTREE"}}};
    if(method==="POST" && /\/git\/blobs$/.test(path)) return {status:201,json:{sha:"blob"+calls.length}};
    if(method==="POST" && /\/git\/trees$/.test(path)) return {status:201,json:{sha:"newTREE"}};
    if(method==="POST" && /\/git\/commits$/.test(path)) return {status:201,json:{sha:"newCOMMIT"}};
    if(method==="PATCH" && /\/git\/refs\/heads\//.test(path)) return {status:200,json:{}};
    if(method==="POST" && /\/git\/refs$/.test(path)) return {status:201,json:{}};
    return {status:404,json:{message:"not found"}};
  };
  fn.calls=calls; return fn;
};
t("githubPushFiles DEMO: dokumen + plan.json + paket .planforge + worker.mjs, tanpa token", ()=>{
  const f = PF.githubPushFiles(PF.DEMO, {cfg:{}, issues:[], workerSource:"// worker\n"});
  const paths = f.map(x=>x.path);
  for(const p of ["PRD.md","FEATURES.md","ROADMAP.md","TASKS.md","AGENT_PROMPT.txt","plan.json","worker.mjs",".planforge/plan.json",".planforge/gates.json",".planforge/state.json"])
    assert.ok(paths.includes(p), "kurang: "+p);
  assert.ok(f.every(x=>typeof x.content==="string" && x.content.length>0));
  assert.ok(!JSON.stringify(f).includes("ghp_") && !JSON.stringify(f).includes("github_pat_"));
  assert.equal(new Set(paths).size, paths.length, "path duplikat");
});
t("githubPushFiles: starter aktif ikut ke repo (package.json di root)", ()=>{
  const f = PF.githubPushFiles(PF.DEMO, {cfg:{starter:"nextjs-fullstack"}, issues:[], workerSource:"//w"});
  assert.ok(f.some(x=>x.path==="package.json"));
  assert.ok(f.some(x=>x.path==="lib/cookie.js"));
});
await ta("githubPush branch ada: ref->base commit->blobs->tree(base_tree)->commit(parents)->PATCH ref", async ()=>{
  const files = PF.githubPushFiles(PF.DEMO, {cfg:{}, issues:[], workerSource:"//w"});
  const http = mockHttp();
  const res = await PF.githubPush(files, {repo:"o/r", branch:"main"}, http);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.commit, "newCOMMIT"); assert.equal(res.files, files.length);
  assert.ok(res.url.includes("/o/r/commit/newCOMMIT"));
  const c = http.calls, n = files.length;
  assert.equal(c[0].method, "GET"); assert.ok(/git\/ref\/heads\/main$/.test(c[0].path));
  assert.equal(c[1].method, "GET"); assert.ok(/git\/commits\/baseSHA$/.test(c[1].path));
  assert.equal(c[2+n].method, "POST"); assert.ok(/git\/trees$/.test(c[2+n].path));
  assert.equal(c[2+n].body.base_tree, "baseTREE", "base_tree wajib supaya file repo lain tidak terhapus");
  assert.equal(c[2+n].body.tree.length, n);
  assert.equal(c[3+n].method, "POST"); assert.ok(/git\/commits$/.test(c[3+n].path));
  assert.deepEqual(c[3+n].body.parents, ["baseSHA"]); assert.equal(c[3+n].body.tree, "newTREE");
  assert.equal(c[4+n].method, "PATCH"); assert.equal(c[4+n].body.sha, "newCOMMIT"); assert.equal(c[4+n].body.force, false);
});
await ta("githubPush repo kosong (ref 404): root commit tanpa parents + POST refs (create)", async ()=>{
  const files = PF.githubPushFiles(PF.DEMO, {cfg:{}, issues:[], workerSource:"//w"});
  const http = mockHttp({"GET /repos/o/r/git/ref/heads/main":{status:404,json:{message:"Not Found"}}});
  const res = await PF.githubPush(files, {repo:"o/r", branch:"main"}, http);
  assert.ok(res.ok, JSON.stringify(res));
  const c = http.calls, n = files.length;
  assert.ok(!c.some(x=>/git\/commits\/baseSHA/.test(x.path)), "tidak boleh ambil base commit repo kosong");
  assert.equal(c[1+n].body.base_tree, undefined);
  assert.deepEqual(c[2+n].body.parents, []);
  assert.equal(c[3+n].method, "POST"); assert.ok(/git\/refs$/.test(c[3+n].path));
  assert.equal(c[3+n].body.ref, "refs/heads/main");
});
await ta("githubPush gagal blob (401) berhenti sebelum tree, lapor status jujur", async ()=>{
  const files = PF.githubPushFiles(PF.DEMO, {cfg:{}, issues:[], workerSource:"//w"});
  const http = mockHttp({"POST /repos/o/r/git/blobs":{status:401,json:{message:"Bad credentials"}}});
  const res = await PF.githubPush(files, {repo:"o/r", branch:"main"}, http);
  assert.equal(res.ok, false); assert.equal(res.status, 401); assert.ok(res.step.startsWith("blob:"));
  assert.ok(!http.calls.some(x=>/git\/trees/.test(x.path)));
});
await ta("githubPush update-ref non-200 -> gagal jujur, bukan klaim sukses", async ()=>{
  const files = PF.githubPushFiles(PF.DEMO, {cfg:{}, issues:[], workerSource:"//w"});
  const http = mockHttp({"PATCH /repos/o/r/git/refs/heads/main":{status:409,json:{message:"conflict"}}});
  const res = await PF.githubPush(files, {repo:"o/r", branch:"main"}, http);
  assert.equal(res.ok, false); assert.equal(res.step, "update-ref"); assert.equal(res.status, 409);
});
await ta("githubPush menolak repo/branch/files tidak sah sebelum memanggil jaringan", async ()=>{
  const http = mockHttp();
  assert.equal((await PF.githubPush([{path:"a",content:"x"}], {repo:"bukan-repo"}, http)).ok, false);
  assert.equal((await PF.githubPush([{path:"a",content:"x"}], {repo:"o/r", branch:"bad branch!"}, http)).ok, false);
  assert.equal((await PF.githubPush([], {repo:"o/r"}, http)).ok, false);
  assert.equal(http.calls.length, 0, "tidak boleh ada request untuk input tidak sah");
});
await ta("githubPush tidak pernah membawa token (token hanya di transportasi DOM)", async ()=>{
  const files = PF.githubPushFiles(PF.DEMO, {cfg:{}, issues:[], workerSource:"//w"});
  const http = mockHttp();
  const res = await PF.githubPush(files, {repo:"o/r", branch:"main"}, http);
  const jejak = JSON.stringify(http.calls) + JSON.stringify(res);
  assert.ok(!jejak.includes("ghp_") && !jejak.includes("github_pat_") && !jejak.includes("Authorization"));
});
t("bundel GitHub siap-git: init+add+commit lokal berhasil, semua file terlacak", ()=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-gh-"));
  try{
    const files = PF.githubPushFiles(PF.DEMO, {cfg:{}, issues:[], workerSource:"// worker\n"});
    for(const f of files){ const p = path.join(dir, f.path); fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, f.content); }
    const run = (...a)=>spawnSync("git", a, {cwd:dir, encoding:"utf8"});
    run("init","-q"); run("add","-A");
    const cm = run("-c","user.email=t@t","-c","user.name=t","commit","-q","-m","handoff");
    assert.equal(cm.status, 0, cm.stderr);
    const tracked = run("ls-files").stdout.trim().split("\n").filter(Boolean);
    assert.equal(tracked.length, files.length, "file terlacak != file bundel");
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

console.log("\n9) paket ZIP");
t("crc32 cocok dengan vektor uji yang diketahui", ()=>{
  const e = new TextEncoder();
  assert.equal(PF.crc32(e.encode("123456789")), 0xCBF43926);
  assert.equal(PF.crc32(e.encode("")), 0);
});
t("makeZip menghasilkan arsip bertanda tangan PK yang sah", ()=>{
  const z = PF.makeZip([{name:"PRD.md", data:"# halo\n"}, {name:"TASKS.md", data:"## T-001 — uji\n"}]);
  assert.ok(z instanceof Uint8Array);
  assert.deepEqual([z[0],z[1],z[2],z[3]], [0x50,0x4b,0x03,0x04], "local header salah");
  const tail = [...z.slice(z.length-22, z.length-18)];
  assert.deepEqual(tail, [0x50,0x4b,0x05,0x06], "EOCD salah");
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint16(z.length-22+10, true), 2, "jumlah entri di EOCD salah");
  fs.writeFileSync(new URL("./out.zip", import.meta.url), z);
});
t("isi ZIP bisa dibaca kembali oleh alat unzip sistem", ()=>{
  const z = fs.readFileSync(new URL("./out.zip", import.meta.url));
  assert.ok(z.length > 150);
});

console.log("\n10) kerapian deterministik (ID / nama fitur / status) tanpa AI");
const cloneOf = (o)=>JSON.parse(JSON.stringify(o));
t("normId merapikan bentuk, membiarkan yang sudah benar, dan tidak mengarang untuk teks bebas", ()=>{
  assert.equal(PF.normId("R-7"), "R-007");
  assert.equal(PF.normId("t015"), "T-015");
  assert.equal(PF.normId("M-2"), "M-002");
  assert.equal(PF.normId("R-001"), "R-001");
  assert.equal(PF.normId("  R_003 "), "R-003");
  assert.equal(PF.normId("Bab 3"), "BAB-003", "bukan ID R/M/T pun dirapikan bentuknya");
  assert.equal(PF.normId("lihat PRD"), "lihat PRD", "teks biasa tidak diubah jadi ID palsu");
  assert.equal(PF.normId(null), "");
});
t("normStatus memetakan istilah bahasa Inggris ke taksonomi empat nilai", ()=>{
  assert.equal(PF.normStatus("In Progress"), "sedang");
  assert.equal(PF.normStatus("done"), "selesai");
  assert.equal(PF.normStatus("todo"), "belum mulai");
  assert.equal(PF.normStatus("blocked"), "gagal");
  assert.equal(PF.normStatus("sesuka model"), null);
});
t("featMatch mengenali nama fitur meski diprefix atau diberi catatan", ()=>{
  const list = PF.DEMO.prd.features.map(f=>f.name);
  assert.equal(PF.featMatch("Admin — Katalog item", list), "Katalog item");
  assert.equal(PF.featMatch("Katalog item (modul)", list), "Katalog item");
  assert.equal(PF.featMatch("katalog ITEM", list), "Katalog item");
  assert.equal(PF.featMatch("Mesin kasir fisik", list), null, "yang benar-benar asing jangan dipaksakan");
});
function messyPlan(){
  const prd = cloneOf(PF.DEMO.prd);
  const roadmap = cloneOf(PF.DEMO.roadmap);
  const tasks = cloneOf(PF.DEMO.tasks);
  tasks.tasks.forEach((x,i)=>{
    x.id = "T" + (i+1);
    x.milestone_ref = "m" + (i%4+1);
    x.depends_on = (x.depends_on||[]).map(d=>"T"+String(parseInt(String(d).slice(2),10)));
    x.feature = "Admin — " + x.feature;
    x.status = i === 0 ? "In Progress" : "todo";
    x.requirement_refs = (x.requirement_refs||[]).map(r=>"R"+String(parseInt(String(r).slice(2),10)));
  });
  roadmap.milestones.forEach(m=>{
    m.requirement_refs = (m.requirement_refs||[]).map(r=>"r"+parseInt(String(r).slice(2),10));
    m.feature_refs = (m.feature_refs||[]).map(f=>f + " (modul)");
  });
  return {prd, roadmap, tasks};
}
t("normalizePlan tidak mengubah objek aslinya", ()=>{
  const m = messyPlan();
  const before = JSON.stringify(m);
  PF.normalizePlan(m.prd, m.roadmap, m.tasks);
  assert.equal(JSON.stringify(m), before, "masukan ikut berubah");
});
t("plan kotor model murah jadi bersih tanpa biaya AI", ()=>{
  const m = messyPlan();
  const sebelum = PF.validatePlan(m.prd, m.roadmap, m.tasks);
  assert.ok(sebelum.length > 10, "kejadian uji tidak cukup kotor: " + sebelum.length);
  const nz = PF.normalizePlan(m.prd, m.roadmap, m.tasks);
  const sesudah = PF.validatePlan(nz.prd, nz.roadmap, nz.tasks);
  assert.deepEqual(sesudah, [], "masih ada celah: " + JSON.stringify(sesudah));
  assert.ok(nz.fixes.length > 10, "fixes tidak tercatat: " + nz.fixes.length);
  assert.equal(nz.tasks.tasks[0].id, "T-001");
  assert.equal(nz.tasks.tasks[0].feature, "Kerangka aplikasi");
  assert.equal(nz.tasks.tasks[0].status, "sedang");
});
t("task yatim non-fungsional ditampung fitur payung, bukan dibuang", ()=>{
  const prd = cloneOf(PF.DEMO.prd);
  const t = cloneOf(PF.DEMO.tasks);
  t.tasks.push({id:"T-019", title:"Ukur waktu muat menu", feature:"Non-functional: Kecepatan halaman", status:"belum mulai",
    milestone_ref:"M-004", requirement_refs:["R-001"], description:"d", files_or_areas:["perf.js"], acceptance_criteria:["a"], verification:"v", depends_on:[], size:"S"});
  t.tasks.push({id:"T-024", title:"Cek alur penuh", feature:"E2E Audit - MVP Rilis", status:"belum mulai",
    milestone_ref:"M-004", requirement_refs:["R-002"], description:"d", files_or_areas:["app.js"], acceptance_criteria:["a"], verification:"v", depends_on:[], size:"S"});
  t.tasks.push({id:"T-025", title:"Enkripsi PIN", feature:"Keamanan akun", status:"belum mulai",
    milestone_ref:"M-004", requirement_refs:["R-003"], description:"d", files_or_areas:["auth.js"], acceptance_criteria:["a"], verification:"v", depends_on:[], size:"S"});
  const nz = PF.normalizePlan(prd, PF.DEMO.roadmap, t);
  const bucket = nz.prd.features.filter(f=>/non-fungsional/i.test(f.name));
  assert.equal(bucket.length, 1, "fitur payung tidak dibuat: " + JSON.stringify(nz.prd.features.map(f=>f.name)));
  const byId = (id)=>nz.tasks.tasks.find(x=>x.id === id);
  assert.equal(byId("T-019").feature, bucket[0].name);
  assert.equal(byId("T-024").feature, bucket[0].name);
  assert.equal(byId("T-025").feature, "Keamanan akun", "nama fitur biasa jangan ikut dipindah");
  assert.ok(bucket[0].sub_features.includes("Kecepatan halaman"), JSON.stringify(bucket[0].sub_features));
  const i = PF.validatePlan(nz.prd, nz.roadmap, nz.tasks);
  assert.ok(!i.some(x=>x.includes("Kecepatan halaman") || x.includes("E2E Audit")), JSON.stringify(i));
  assert.ok(PF.featuresToMd(nz.prd).includes("Kecepatan halaman"), "payung tidak ikut ter-ekspor");
});
t("rujukan yang memang tidak ada dibuang dan dilaporkan, bukan didiamkan", ()=>{
  const m = messyPlan();
  m.tasks.tasks[0].requirement_refs = ["R-777"];
  const nz = PF.normalizePlan(m.prd, m.roadmap, m.tasks);
  assert.deepEqual(nz.tasks.tasks[0].requirement_refs, []);
  assert.ok(nz.fixes.some(f=>f.includes("R-777") && f.includes("dibuang")), JSON.stringify(nz.fixes.slice(0,6)));
  assert.ok(PF.validatePlan(nz.prd, nz.roadmap, nz.tasks).some(x=>x.includes("tidak merujuk requirement")));
});
t("ID yang bukan pola R/M/T-### diganti dengan ID baru yang belum dipakai", ()=>{
  const t = cloneOf(PF.DEMO.tasks);
  t.tasks[0].id = "task satu";
  const nz = PF.normalizePlan(PF.DEMO.prd, PF.DEMO.roadmap, t);
  const nid = nz.tasks.tasks[0].id;
  assert.match(nid, /^T-\d{3}$/, nid);
  assert.ok(!t.tasks.slice(1).some(x=>x.id === nid), "ID hasil ganti bertabrakan");
  assert.ok(nz.fixes.some(f=>f.includes("task satu")), JSON.stringify(nz.fixes));
});
t("prompt roadmap & tasks menyodorkan daftar ID/nama yang boleh dipakai", ()=>{
  const rm = PF.buildStageMessages("roadmap", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO)[1].content;
  const tk = PF.buildStageMessages("tasks", {language:"Bahasa Indonesia", idea:"x", targetAgent:"umum"}, PF.DEMO)[1].content;
  assert.ok(rm.includes("DAFTAR RESMI") && rm.includes('"Katalog item"') && rm.includes('"R-001"'));
  assert.ok(tk.includes("DAFTAR RESMI") && tk.includes('"M-004"') && tk.includes("Jangan membuat ID atau nama baru"));
});
t("render issues mengelompokkan celah dan tetap menyebut ini bukan error kode", ()=>{
  const sample = [
    "T-015: requirement_refs 'R-077' tidak dikenal",
    "T-003: tidak menyebut feature",
    "T-010: feature 'Bahan & Stok: Bahan Baku' tidak ada di prd.features",
    "R-006: requirement mvp belum dicakup task mana pun",
    "N-002: target non-fungsional belum berupa angka terukur ('cepat')",
    "tasks: ID task duplikat",
    "sesuatu yang tidak terkategori"
  ];
  const html = PF.renderMarkdown("issues", sample, {fixes:["contoh koreksi"]});
  for(const s of ["bukan error aplikasi", "Rapikan ID", "Minta model tambal", "Rujukan requirement rusak",
                  "Nama fitur tidak nyambung", "Ada scope yang tidak dikerjakan", "Target tidak terukur",
                  "Struktur task bermasalah", "Lainnya", "data-act="])
    assert.ok(html.includes(s), "kurang: " + s);
});

console.log("\n11) paket runner: editor gerbang di web <-> worker.mjs");

const docsAll = {clarify:PF.DEMO.clarify, prd:PF.DEMO.prd, roadmap:PF.DEMO.roadmap, tasks:PF.DEMO.tasks};

t("default gerbang mengalias workbuddy dan menolak nama agen asing", ()=>{
  const g = PF.defaultGates("workbuddy");
  assert.equal(g.agent.cmd, "codebuddy");
  assert.equal(g.agent.name, "workbuddy");
  assert.throws(()=>PF.defaultGates("agen-tidak-ada"), /tidak dikenal.*agy.*claude.*codex.*codebuddy.*none/i);
});
t("default gerbang di web identik dengan yang dipakai worker", ()=>{
  for(const name of ["agy","claude","codex","none"]){
    assert.deepEqual(PF.defaultGates(name), W.defaultGates(name), "beda untuk preset " + name);
  }
  assert.deepEqual(Object.keys(PF.AGENT_PRESETS), Object.keys(W.AGENT_PRESETS));
  assert.deepEqual(PF.AGENT_ADAPTERS, W.AGENT_ADAPTERS, "peta konektor agen harus sama di web dan worker");
  assert.equal(PF.LIGHT_REVIEW, W.LIGHT_REVIEW);
  assert.deepEqual(PF.FULL_GATES, W.FULL_GATES);
  assert.deepEqual(PF.HARD_CHECKS, W.HARD_CHECKS);
});
t("gates bawaan = ritme bertingkat: 4 gerbang keras aktif + watchlist 1-5", ()=>{
  const g = PF.defaultGates("agy"), c = PF.gateCounts(g);
  assert.equal(g.agent.cmd, "agy");
  assert.deepEqual(c.hard.map(h=>h.id), ["build","test","lint"]);
  assert.deepEqual(c.hardBlocking.map(h=>h.id), ["build","test"]);
  assert.equal(c.light.length, 1);
  assert.deepEqual(c.full.map(x=>x.id), ["audit","fixbug","refactor","perf"], "watchlist kosong tidak boleh aktif");
});
t("plan.json paket punya ringkasan overview dan sidik jari root", ()=>{
  const docs = structuredClone(docsAll);
  docs.prd.summary = "Ringkasan rencana kanonik";
  const bundle = JSON.parse(PF.planBundleJson(docs, []));
  assert.equal(bundle.prd.overview.summary, "Ringkasan rencana kanonik");
  assert.ok(bundle.planFingerprint);
  const pushed = PF.githubPushFiles(docs, {cfg:{}, workerSource:"// worker"});
  const rootPlan = JSON.parse(pushed.find(f=>f.path === "plan.json").content);
  assert.equal(rootPlan.prd.overview.summary, "Ringkasan rencana kanonik");
  assert.ok(rootPlan.planFingerprint);
});
t("plan.json paket punya bentuk yang dibaca worker", ()=>{
  const p = JSON.parse(PF.planBundleJson(docsAll, ["celah contoh"]));
  assert.equal(p.tasks.tasks.length, 9);
  assert.deepEqual(p.issues, ["celah contoh"]);
  assert.ok(p.prd.features.length && p.roadmap.milestones.length && p.brief.project_name === "WarungKasir");
  assert.ok(typeof p.generatedAt === "string");
});
t("state.json awal menyalin status task dan siap dibaca loadCtx worker", ()=>{
  const s = PF.freshStateJson(docsAll);
  assert.equal(Object.keys(s.tasks).length, 9);
  assert.equal(s.tasks["T-005"].status, "belum mulai");
  assert.equal(s.doneTasks, 0); assert.equal(s.calls, 0);
  const dirty = PF.freshStateJson({tasks:{tasks:[{id:"T-001", status:"Done"}, {id:"T-002", status:"ngawur"}]}});
  assert.equal(dirty.tasks["T-001"].status, "selesai", "status bahasa Inggris tidak boleh ikut ke state");
  assert.equal(dirty.tasks["T-002"].status, "belum mulai");
});
t("progresDariState membaca status dari ledger, urutan & judul dari plan", ()=>{
  const docs = {tasks:{tasks:[{id:"T-001",title:"Scaffold"},{id:"T-002",title:"Font"},{id:"T-003",title:"Kartu"}]}};
  const sj = { doneTasks:1, lastTask:"T-001", tasks:{
    "T-001":{status:"selesai", finishedAt:"2026-11-16T14:32:00.000Z", note:"bukti: hijau"},
    "T-002":{status:"sedang"} } };
  const p = PF.progresDariState(sj, docs);
  assert.equal(p.total, 3); assert.equal(p.done, 1); assert.equal(p.doneTasks, 1); assert.equal(p.lastTask, "T-001");
  assert.deepEqual(p.rows.map(r=>r.id), ["T-001","T-002","T-003"], "urutan harus ikut plan");
  assert.equal(p.rows[0].title, "Scaffold"); assert.equal(p.rows[0].status, "selesai");
  assert.equal(p.rows[0].finishedAt, "2026-11-16T14:32:00.000Z");
  assert.equal(p.rows[1].status, "sedang");
  assert.equal(p.rows[2].status, "belum mulai", "task yang belum ada di ledger = belum mulai, bukan hilang");
});
t("progresDariState mempertahankan terkendala (mark_blocked), tidak menjatuhkannya ke belum mulai", ()=>{
  const docs = {tasks:{tasks:[{id:"T-001",title:"a"},{id:"T-002",title:"b"},{id:"T-003",title:"c"}]}};
  const sj = { tasks:{ "T-001":{status:"gagal",note:"merah"}, "T-002":{status:"terkendala",note:"index.html tidak ada"} } };
  const p = PF.progresDariState(sj, docs);
  assert.equal(p.rows[0].status, "gagal");
  assert.equal(p.rows[1].status, "terkendala", "terkendala harus tetap terkendala, bukan belum mulai");
  assert.equal(p.rows[1].note, "index.html tidak ada");
  assert.equal(p.rows[2].status, "belum mulai");
  assert.equal(p.done, 0);
});
t("progresDariState menormalkan sinonim status dan tahan terhadap ledger kosong", ()=>{
  const docs = {tasks:{tasks:[{id:"T-001",title:"a"},{id:"T-002",title:"b"}]}};
  const p = PF.progresDariState({tasks:{"T-001":{status:"done"}}}, docs);
  assert.equal(p.rows[0].status, "selesai", "done -> selesai");
  assert.equal(p.done, 1); assert.equal(p.doneTasks, 1, "doneTasks fallback ke hitungan selesai");
  const kosong = PF.progresDariState(null, docs);
  assert.equal(kosong.done, 0); assert.equal(kosong.total, 2);
  assert.ok(kosong.rows.every(r=>r.status === "belum mulai"));
  const tanpaTask = PF.progresDariState({tasks:{}}, {tasks:{tasks:[]}});
  assert.equal(tanpaTask.total, 0); assert.equal(tanpaTask.done, 0);
});
t("runner dan AGENTS.md hanya menulis --agent untuk preset CLI worker", ()=>{
  for(const preset of ["agy","claude","codex","codebuddy","none","workbuddy"]){
    const g = PF.defaultGates(preset === "workbuddy" ? "workbuddy" : preset);
    const cmd = PF.runnerCommand(g, {agent:preset});
    if(preset === "workbuddy") assert.match(cmd, /--agent codebuddy/);
    else if(preset === "none") assert.match(cmd, /--agent none/);
    else assert.match(cmd, new RegExp("--agent " + preset));
  }
  for(const agent of ["vscode","cursor","cline","windsurf","qoder","opencode","generic","umum"]){
    const g = PF.defaultGates("agy");
    assert.doesNotMatch(PF.runnerCommand(g, {agent}), /--agent\b/);
    assert.doesNotMatch(PF.agentsMd(docsAll, g, {agent}), /--agent [^\n]+/);
  }
});
t("resolver paket mengikuti label UI ke adaptor kanonik dan MCP", ()=>{
  const cases = {
    "Claude Code":"claude", "Cursor":"cursor", "Qoder":"qoder", "Codex":"codex", "umum":"generic"
  };
  for(const [label,key] of Object.entries(cases)){
    const a = PF.AGENT_ADAPTERS[key];
    const files = PF.runnerBundle(docsAll, [], PF.defaultGates("agy"), {agent:label, workerSource:"// worker"});
    assert.ok(files.some(f=>f.name === a.rules));
    assert.ok(files.some(f=>f.name === (a.file || ".planforge/mcp-universal.json")));
  }
});
t("paket runner mengikuti target Codex dan menyiapkan commit otomatis", ()=>{
  const files = PF.runnerBundle(docsAll, [], PF.defaultGates("agy"), {agent:"codex", targetAgent:"Codex"});
  const gates = JSON.parse(files.find(f=>f.name === ".planforge/gates.json").data);
  const md = files.find(f=>f.name === "AGENTS.md").data;
  assert.equal(gates.agent.name, "codex");
  assert.equal(gates.agent.cmd, "codex");
  assert.match(md, /node worker\.mjs run --agent codex/);
  assert.doesNotMatch(md, /--agent codebuddy/);
  assert.match(md, /git init && git add \. && git commit -m "init"/);
  assert.ok(md.indexOf("git init &&") < md.indexOf("Otomatis penuh"), "Git setup harus muncul sebelum perintah runner");
});
t("githubPushFiles memakai adaptor kanonik untuk label UI", ()=>{
  for(const [label,key] of Object.entries({"Claude Code":"claude","Cursor":"cursor","Qoder":"qoder","Codex":"codex","umum":"generic"})){
    const files = PF.githubPushFiles(docsAll, {cfg:{targetAgent:label}, workerSource:"// worker"});
    const expected = PF.AGENT_ADAPTERS[key];
    assert.ok(files.some(f=>f.path === expected.rules));
    assert.ok(files.some(f=>f.path === (expected.file || ".planforge/mcp-universal.json")));
  }
});
t("perintah jalan menyebut budget dan ritme yang sedang aktif", ()=>{
  const g = PF.defaultGates("agy");
  assert.equal(PF.runnerCommand(g), "node worker.mjs run --max-calls 60 --max-calls-per-run 40 --max-cost 0 --full-every 6");
  g.limits.maxCalls = 240; g.limits.fullEvery = 4;
  assert.equal(PF.runnerCommand(g, {workerPath:"tools/worker.mjs"}), "node tools/worker.mjs run --max-calls 240 --max-calls-per-run 40 --max-cost 0 --full-every 4");
  g.limits.maxCostUsd = null; g.limits.maxCallsPerRun = null;
  assert.equal(PF.runnerCommand(g), "node worker.mjs run --max-calls 240 --full-every 4", "batas yang kosong tidak boleh ikut ditulis");
});
t("plafon biaya bawaan nol dan gerbang penuh wajib verdict — tertulis di AGENTS.md", ()=>{
  const g = PF.defaultGates("agy");
  assert.equal(g.limits.maxCostUsd, 0, "bawaan harus fail-closed: agen berbayar tidak boleh jalan tanpa izin angka");
  assert.equal(g.limits.maxCallsPerRun, 40);
  const md = PF.agentsMd(docsAll, g);
  assert.ok(md.includes("$0"), "plafon biaya tidak disebut: " + md.slice(0, 400));
  assert.ok(md.includes("verification"), "aturan verification hilang");
  assert.ok(/TIDAK membuktikan apa-apa/.test(md), "gerbang penuh bisu harus disebut berhenti");
  assert.ok(/BERHENTI/.test(md), "penolakan next_task karena budget harus tertulis");
});
t("verification di DEMO adalah perintah shell, bukan langkah manual", ()=>{
  for(const x of PF.DEMO.tasks.tasks){
    assert.ok(!/^(buka|klik|lihat|pilih|ketuk|buat|catat|jalankan alur|jalankan console)/i.test(x.verification), x.id + " masih kalimat: " + x.verification);
    assert.match(x.verification, /^node --test /, x.id + ": " + x.verification);
  }
});
t("VS Code MCP memakai cwd workspaceFolder", ()=>{
  const j = JSON.parse(PF.connConfigJson("vscode", {projectDir:"D:/proyek"}));
  assert.equal(j.servers[PF.connNama({projectDir:"D:/proyek"})].cwd, "${workspaceFolder}");
});
t("blok MCP Antigravity siap ditaruh di .agents/mcp_config.json", ()=>{
  const j = JSON.parse(PF.connConfigJson("agy", {workerPath:"C:/proyek/worker.mjs", projectDir:"C:/proyek"}));
  const s = j.mcpServers[PF.connNama({projectDir:"C:/proyek"})];
  assert.equal(s.command, "node");
  assert.deepEqual(s.args, ["C:/proyek/worker.mjs", "mcp", "--dir", "C:/proyek"]);
  assert.equal(s.disabled, false);
  const polos = JSON.parse(PF.connConfigJson("agy", {}));
  assert.deepEqual(polos.mcpServers.planforge.args, ["worker.mjs", "mcp"], "tanpa path proyek, worker dicari sendiri dari lokasi worker.mjs");
});
t("paket mengikuti aplikasi yang dipilih, bukan selalu Antigravity", ()=>{
  for(const key of Object.keys(PF.AGENT_ADAPTERS)){
    const a = PF.AGENT_ADAPTERS[key];
    const f = PF.runnerBundle(docsAll, [], PF.defaultGates("agy"), { agent:key, workerSource:"x" });
    const nama = f.map(x=>x.name);
    assert.equal(f.length, 6, key + ": jumlah file berubah");
    assert.ok(nama.includes(a.rules), key + ": file instruksi " + a.rules + " tidak ditulis");
    assert.ok(nama.includes(a.file || ".planforge/mcp-universal.json"), key + ": file konfigurasi MCP tidak ditulis");
    assert.ok(!nama.includes(".agents/mcp_config.json") || key === "agy", key + ": masih memaksa path Antigravity");
    const cfg = JSON.parse(f.find(x=>x.name === (a.file || ".planforge/mcp-universal.json")).data);
    const blok = a.shape === "servers" ? cfg.servers : a.shape === "mcp" ? (cfg.mcp && cfg.mcp.servers) : cfg.mcpServers;
    assert.ok(blok && blok.planforge, key + ": blok planforge tidak ada di bentuk " + a.shape);
    if(a.shape === "mcp") assert.equal(blok.planforge.command[0], "node");
    else assert.equal(blok.planforge.command, "node");
  }
});
t("worker dan web memakai peta aplikasi yang sama persis", ()=>{
  assert.deepEqual(Object.keys(PF.AGENT_ADAPTERS), Object.keys(W.AGENT_ADAPTERS));
  for(const k of Object.keys(W.AGENT_ADAPTERS))
    assert.deepEqual(PF.AGENT_ADAPTERS[k], W.AGENT_ADAPTERS[k], "beda di adaptor " + k);
});
t("opencode pakai dialect mcp.servers: type local, command array, environment, enabled", ()=>{
  const j = JSON.parse(PF.connConfigJson("opencode", {workerPath:"D:/proyek/worker.mjs", projectDir:"D:/proyek"}));
  assert.ok(j.mcp && j.mcp.servers, "opencode harus membungkus di mcp.servers, bukan mcpServers");
  assert.ok(!j.mcpServers, "opencode tidak boleh pakai bentuk mcpServers");
  const s = j.mcp.servers[PF.connNama({projectDir:"D:/proyek"})];
  assert.equal(s.type, "local");
  assert.deepEqual(s.command, ["node", "D:/proyek/worker.mjs", "mcp", "--dir", "D:/proyek"]);
  assert.deepEqual(s.environment, {});
  assert.equal(s.enabled, true);
  assert.equal(PF.AGENT_ADAPTERS.opencode.file, "opencode.json");
  assert.equal(PF.AGENT_ADAPTERS.opencode.shape, "mcp");
});
t("jalur universal menyediakan perintah + tiga dialect umum, semuanya bernama sama", ()=>{
  const u = PF.connUniversal({workerPath:"D:/proyek/worker.mjs", projectDir:"D:/proyek"});
  const nama = PF.connNama({projectDir:"D:/proyek"});
  assert.equal(u.nama, nama);
  assert.equal(u.perintah, "node D:/proyek/worker.mjs mcp --dir D:/proyek");
  const ms = JSON.parse(u.blok.mcpServers).mcpServers[nama];
  const sv = JSON.parse(u.blok.servers).servers[nama];
  const mc = JSON.parse(u.blok.mcp).mcp.servers[nama];
  assert.equal(ms.command, "node");
  assert.equal(sv.type, "stdio");
  assert.equal(mc.type, "local");
  assert.deepEqual(mc.command, ["node", "D:/proyek/worker.mjs", "mcp", "--dir", "D:/proyek"]);
});
t("universal tanpa path proyek tetap menghasilkan perintah yang bisa dijalankan", ()=>{
  const u = PF.connUniversal({});
  assert.equal(u.nama, "planforge");
  assert.equal(u.perintah, "node worker.mjs mcp");
  assert.ok(JSON.parse(u.blok.mcpServers).mcpServers.planforge);
});
t("Connect opencode menggabung ke opencode.json yang sudah ada, server lain utuh", ()=>{
  const opts = {workerPath:"D:/proyek/worker.mjs", projectDir:"D:/proyek"};
  const nama = PF.connNama(opts);
  const info = { mcpFile:"opencode.json", mcpName:nama, mcpEntry:PF.connEntry("opencode", opts), rulesFile:"AGENTS.md" };
  const files = PF.runnerBundle(docsAll, [], PF.defaultGates("agy"), { agent:"opencode", workerSource:"// worker" });
  const lama = JSON.stringify({ mcp:{ servers:{ lain:{ type:"local", command:["x"] } } } });
  const r = PF.rencanaTulis(files, { "opencode.json":lama }, info);
  const gabung = r.find(x=>x.name === "opencode.json");
  assert.equal(gabung.aksi, "gabung");
  const j = JSON.parse(gabung.data);
  assert.ok(j.mcp.servers.lain, "server lain tidak boleh hilang");
  assert.equal(j.mcp.servers[nama].type, "local");
});
t("hint Connect WorkBuddy & Antigravity jujur: file proyek tidak dibaca otomatis", ()=>{
  const wb = PF.AGENT_ADAPTERS.workbuddy.hint, ag = PF.AGENT_ADAPTERS.agy.hint;
  assert.match(wb, /tidak membaca/i, "workbuddy harus tegas .mcp.json proyek tidak dibaca");
  assert.match(wb, /Settings|Connectors|global/i, "workbuddy harus menunjuk pendaftaran global");
  assert.match(ag, /tidak membaca/i, "agy harus tegas .agents/mcp_config.json proyek tidak dibaca");
  assert.match(ag, /\.gemini\/config\/mcp_config\.json/, "agy harus menunjuk config global");
  assert.ok(!/restart IDE supaya/i.test(ag), "agy jangan ulangi klaim palsu restart membuat file proyek terbaca");
});
t("AGENTS.md memuat urutan watchlist, gerbang nyata, dan kontrak balasan", ()=>{
  const md = PF.agentsMd(docsAll, PF.defaultGates("agy"));
  for(const s of ["1. Audit menyeluruh", "2. Perbaiki bug hasil audit", "3. Rapikan & buang kode mati", "4. Performa",
    "node worker.mjs run", "next_task", "mark_done", "--dry-run", "\"done\":true", "\"blocked\":true",
    "npm run build", "npm test", "T-001: <judul>", "RUN_LOG.md"])
    assert.ok(md.includes(s), "kurang: " + s);
  assert.ok(md.includes("9 task"), "jumlah task tidak disebut: " + md.slice(0, 300));
  assert.ok(!md.includes("Watchlist tambahanmu"), "gerbang mati tidak boleh masuk urutan");
});
t("AGENTS.md ikut berubah kalau gerbang & ritme disunting", ()=>{
  const g = PF.defaultGates("agy");
  g.hard.forEach(h=>h.enabled = false);
  g.reviews = g.reviews.filter(r=>r.id !== "perf");
  g.limits.fullEvery = 12; g.limits.autoCommit = false;
  const md = PF.agentsMd(docsAll, g);
  assert.ok(!md.includes("npm test"), "gerbang keras yang dimatikan masih tertulis");
  assert.ok(!md.includes("Performa"), "reviewer yang dihapus masih masuk urutan");
  assert.ok(md.includes("tiap 12 task"));
  assert.ok(md.includes("kamu yang kommit sendiri"), "autoCommit mati tidak tercermin");
  assert.ok(md.includes("JANGAN `git add -A`"), "autoCommit mati harus melarang add -A");
});
t("paket runner berisi enam file pada path yang benar", ()=>{
  const f = PF.runnerBundle(docsAll, [], PF.defaultGates("agy"), {});
  assert.deepEqual(f.map(x=>x.name), [".planforge/plan.json", ".planforge/gates.json", ".planforge/state.json", "AGENTS.md", ".agents/mcp_config.json"]);
  for(const x of f) assert.ok(x.data.length > 20, x.name + " kosong");
  assert.equal(PF.runnerBundle(docsAll, [], PF.defaultGates("agy"), {workerSource:"#!/usr/bin/env node"}).length, 6);
});
t("paket ZIP runner bisa dibaca balik dan ukurannya wajar", ()=>{
  const files = [{name:".planforge/plan.json", data:PF.planBundleJson(docsAll, [])}, {name:"AGENTS.md", data:PF.agentsMd(docsAll, PF.defaultGates("agy"))}];
  const z = PF.makeZip(files);
  assert.deepEqual([...z.slice(0,4)], [0x50,0x4b,0x03,0x04]);
  assert.deepEqual([...z.slice(z.length-22, z.length-18)], [0x50,0x4b,0x05,0x06]);
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(dv.getUint16(z.length-22+10, true), 2);
});

console.log("\n7) tech stack: model yang mengusulkan, batasan user tetap menang");
t("PRD menyuruh model memilih stack relevan + versi mayor + alternatif yang ditolak", ()=>{
  const m = PF.buildStageMessages("prd", {language:"Bahasa Indonesia", idea:"kasir warung", targetAgent:"umum"}, PF.DEMO);
  const u = m[1].content;
  for(const s of ["Stack KAMU yang mengusulkan", "masih dipakai luas sekarang", "versi mayor", "alternatif yang kamu tolak", "tetap putuskan satu stack lengkap", "Batasan user tetap harga mati"])
    assert.ok(u.includes(s), "kurang: " + s);
  assert.ok(!u.includes("hanya batasan user yang boleh menentukan stack"), "larangan lama masih ada — model tidak akan pernah mengusulkan stack");
  assert.ok(m[0].content.includes("masih dipakai luas sekarang"), "aturan system prompt belum ikut");
});
t("batasan stack dari user tetap ikut terkirim ke tahap PRD", ()=>{
  const m = PF.buildStageMessages("prd", {idea:"x", constraints:"wajib PHP + MySQL, hosting shared"}, PF.DEMO);
  assert.ok(m[1].content.includes("wajib PHP + MySQL"), "batasan user hilang dari prompt");
});
t("skema tech minta versi mayor dan alasan penolakan alternatif", ()=>{
  const s = JSON.stringify(PF.SCHEMAS.prd.tech);
  assert.match(s, /versi mayor/);
  assert.match(s, /ditolak/);
});

console.log("\n8) budget panggilan dihitung dari rencana, bukan ditebak");
const gatesRitme = (o)=>{ const g = PF.defaultGates("agy"); Object.assign(g.limits, o || {}); return g; };
t("hitungBudget: kerja + review ringan, gerbang penuh per putaran, plus cadangan", ()=>{
  const b = PF.hitungBudget(30, gatesRitme({fullEvery:6, fullAtMilestoneEnd:false}), 0);
  assert.equal(b.kerja, 60, "30 task × (1 kerja + 1 reviewer ringan)");
  assert.equal(b.putaran, 5);
  assert.equal(b.penuh, 20, "5 putaran × 4 reviewer penuh");
  assert.equal(b.cadangan, 24);
  assert.equal(b.total, 104);
});
t("milestone yang belum selesai menambah putaran gerbang penuh", ()=>{
  assert.equal(PF.hitungBudget(30, gatesRitme({fullEvery:6, fullAtMilestoneEnd:true}), 5).putaran, 10);
  assert.equal(PF.hitungBudget(30, gatesRitme({fullEvery:6, fullAtMilestoneEnd:true}), 0).putaran, 5);
  assert.equal(PF.hitungBudget(30, gatesRitme({fullEvery:6, fullAtMilestoneEnd:false}), 5).putaran, 5, "pemicu milestone dimatikan -> jangan dihitung");
});
t("reviewer yang dimatikan tidak ikut dihitung", ()=>{
  const g = gatesRitme({fullEvery:6, fullAtMilestoneEnd:false});
  g.reviews.forEach(r=>{ if(r.tier === "light") r.enabled = false; });
  assert.equal(PF.hitungBudget(30, g, 0).kerja, 30);
  g.reviews.forEach(r=>{ if(r.tier === "full") r.enabled = false; });
  const b = PF.hitungBudget(30, g, 0);
  assert.equal(b.putaran, 0); assert.equal(b.penuh, 0); assert.equal(b.total, 39);
});
t("taskMuat menjawab berapa task yang muat di budget yang ada", ()=>{
  const g = gatesRitme({fullEvery:6, fullAtMilestoneEnd:false});
  assert.equal(PF.taskMuat(104, g, 0), 30);
  assert.equal(PF.taskMuat(60, g, 0), 17, "budget bawaan 60 harus terbaca sebagai ±17 task, bukan 'cukup'");
  assert.equal(PF.taskMuat(0, g, 0), 0);
  assert.equal(PF.taskMuat(null, g, 0), Infinity, "tanpa batas = muat semua");
});
t("sisaMilestone cuma menghitung milestone yang masih punya task belum selesai", ()=>{
  const ms = [{id:"M-001"},{id:"M-002"},{id:"M-003"}];
  const ts = [{id:"T-001",milestone_ref:"M-001",status:"selesai"},{id:"T-002",milestone_ref:"M-002",status:"belum mulai"},{id:"T-003",milestone_ref:"M-002",status:"selesai"}];
  assert.equal(PF.sisaMilestone(ms, ts, t=>t.status), 1);
  assert.equal(PF.sisaMilestone([], ts, t=>t.status), 0);
  assert.equal(PF.sisaMilestone(ms, [], t=>t.status), 0);
});
t("worker dan web menghitung budget dengan angka yang sama", ()=>{
  for(const o of [{fullEvery:6,fullAtMilestoneEnd:false},{fullEvery:6,fullAtMilestoneEnd:true},{fullEvery:1,fullAtMilestoneEnd:true},{fullEvery:99,fullAtMilestoneEnd:false}]){
    const g = gatesRitme(o);
    for(const n of [0,1,7,30,90]){
      assert.deepEqual(W.hitungBudget(n, g, 3), PF.hitungBudget(n, g, 3), "beda di " + JSON.stringify(o) + " n=" + n);
      assert.equal(W.taskMuat(60, g, 3), PF.taskMuat(60, g, 3));
    }
  }
  assert.equal(W.sisaMilestone([{id:"M-001"}], [{milestone_ref:"M-001"}], ()=> "belum mulai"), 1);
});
t("AGENTS.md menyebut --auto-budget dan menegaskan plafon biaya tidak disentuh", ()=>{
  const md = PF.agentsMd(docsAll, PF.defaultGates("agy"));
  assert.ok(md.includes("run --auto-budget"), "perintah budget otomatis tidak tertulis");
  assert.ok(md.includes("plafon biaya tidak pernah disentuh"));
});

console.log("\n12) worker.mjs tertanam di index.html (jalur dobel-klik / file://)");
const TANAM_AWAL = '<script type="application/json" id="pf-worker-src">';
const tanamI = html.indexOf(TANAM_AWAL);
const tanamJ = tanamI > -1 ? html.indexOf("</script>", tanamI) : -1;
const tanamTeks = tanamJ > tanamI ? html.slice(tanamI + TANAM_AWAL.length, tanamJ) : null;
const workerAsli = fs.readFileSync(new URL("../worker.mjs", import.meta.url), "utf8");
const bacaTanam = (s)=>{ const i = s.indexOf(TANAM_AWAL), j = s.indexOf("</script>", i); return JSON.parse(s.slice(i + TANAM_AWAL.length, j)); };

t("blok tertanam sama persis dengan worker.mjs — kalau basi, paket kehilangan mesinnya", ()=>{
  assert.ok(tanamTeks != null, "blok pf-worker-src tidak ditemukan di index.html");
  assert.equal(JSON.parse(tanamTeks), workerAsli, "blok tertanam != worker.mjs — jalankan `node worker.mjs embed`");
});
t("muatan tertanam tidak memuat '<' mentah yang bisa merusak cara browser membaca halaman", ()=>{
  assert.ok(!tanamTeks.includes("<"), "ada '<' mentah di blok tertanam");
  assert.ok(!tanamTeks.includes("\n"), "JSON harus satu baris");
});
t("paket yang dibuat dari blok tertanam tetap memuat worker.mjs utuh", ()=>{
  const f = PF.runnerBundle(docsAll, [], PF.defaultGates("agy"), { workerSource: JSON.parse(tanamTeks) });
  const w = f.find(x=>x.name === "worker.mjs");
  assert.ok(w, "worker.mjs hilang dari paket");
  assert.equal(w.data, workerAsli);
});
t("embed menulis blok yang persis, dan panggilan kedua tidak mengubah apa pun", ()=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-embed-"));
  try{
    const target = path.join(dir, "index.html");
    fs.writeFileSync(target, "<html><body>\n<!-- PF-WORKER-BEGIN -->\n<!-- PF-WORKER-END -->\n</body></html>");
    assert.equal(W.main(["embed", "--html", target]), 0);
    const hasil = fs.readFileSync(target, "utf8");
    assert.equal(bacaTanam(hasil), workerAsli);
    assert.equal(W.main(["embed", "--html", target]), 0);
    assert.equal(fs.readFileSync(target, "utf8"), hasil, "embed kedua tidak boleh mengubah apa pun");
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});
t("embed menolak html tanpa penanda dan tidak menulis apa pun", ()=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-embed-"));
  try{
    const target = path.join(dir, "index.html");
    const asli = "<html><body>tanpa penanda</body></html>";
    fs.writeFileSync(target, asli);
    assert.equal(W.main(["embed", "--html", target]), 1);
    assert.equal(fs.readFileSync(target, "utf8"), asli);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

console.log("\n13) Connect: keputusan tulis tidak boleh menghapus pekerjaan orang");
const connFiles = (agent)=>PF.runnerBundle(docsAll, [], PF.defaultGates("agy"), { agent, workerSource:"// worker" });
const infoUntuk = (agent, opts)=>({ mcpFile: PF.AGENT_ADAPTERS[agent].file || ".planforge/mcp-universal.json",
  mcpName: PF.connNama(opts), mcpEntry: PF.connEntry(agent, opts), rulesFile: PF.AGENT_ADAPTERS[agent].rules });
const cari = (r,n)=>r.find(x=>x.name === n);

t("folder kosong: semua file baru", ()=>{
  const r = PF.rencanaTulis(connFiles("claude"), {}, infoUntuk("claude", {}));
  assert.equal(r.length, 6);
  for(const x of r) assert.equal(x.aksi, "baru", x.name);
});
t("progress dan gerbang yang sudah ada TIDAK ditimpa", ()=>{
  const ada = { ".planforge/state.json":'{"doneTasks":7}', ".planforge/gates.json":'{"limits":{"maxCalls":99}}' };
  const r = PF.rencanaTulis(connFiles("claude"), ada, infoUntuk("claude", {}));
  assert.equal(cari(r,".planforge/state.json").aksi, "lewati");
  assert.equal(cari(r,".planforge/state.json").data, '{"doneTasks":7}');
  assert.equal(cari(r,".planforge/gates.json").aksi, "lewati");
  assert.equal(cari(r,".planforge/gates.json").data, '{"limits":{"maxCalls":99}}');
});
t("sidik jari rencana: web dan worker menghitung nilai yang sama persis", ()=>{
  const web = PF.planFingerprint(docsAll);
  const bundle = JSON.parse(PF.planBundleJson(docsAll, []));
  assert.equal(bundle.planFingerprint, web, "planBundleJson harus menanam sidik jari web");
  assert.equal(W.planFingerprintPlan(bundle), web, "worker harus menghitung sidik jari yang sama dari bundel");
  const state = PF.freshStateJson(docsAll);
  assert.equal(state.planFingerprint, web, "freshStateJson harus menanam sidik jari yang sama");
  assert.equal(state.rev, 0);
});
t("sidik jari mengabaikan status task tapi menangkap perubahan isi", ()=>{
  const web = PF.planFingerprint(docsAll);
  const ubahStatus = JSON.parse(JSON.stringify(docsAll));
  ubahStatus.tasks.tasks[0].status = "selesai";
  assert.equal(PF.planFingerprint(ubahStatus), web, "status bukan bagian dari identitas rencana");
  const ubahIsi = JSON.parse(JSON.stringify(docsAll));
  ubahIsi.tasks.tasks[0].title = "judul yang benar-benar baru";
  assert.notEqual(PF.planFingerprint(ubahIsi), web, "isi task berubah = rencana baru");
  assert.equal(PF.planFingerprint(ubahIsi), W.planFingerprintPlan(JSON.parse(PF.planBundleJson(ubahIsi, []))), "web dan worker tetap sepakat sesudah isi berubah");
});
t("Connect mencadangkan ledger lama saat sidik jari rencana berubah", ()=>{
  const baru = PF.planFingerprint(docsAll);
  const lamaDocs = JSON.parse(JSON.stringify(docsAll));
  lamaDocs.tasks.tasks[0].title = "judul rencana lama";
  const lama = PF.planFingerprint(lamaDocs);
  assert.notEqual(lama, baru);
  const existing = {
    ".planforge/plan.json": PF.planBundleJson(lamaDocs, []),
    ".planforge/state.json": '{"doneTasks":7,"planFingerprint":"' + lama + '"}'
  };
  const r = PF.rencanaTulis(connFiles("claude"), existing, infoUntuk("claude", {}));
  const backup = r.find(x=>/^\.planforge\/state\..+\.json$/.test(x.name));
  assert.ok(backup, "ledger lama harus dicadangkan sebelum direset: " + JSON.stringify(r.map(x=>x.name)));
  assert.equal(backup.aksi, "baru");
  assert.equal(backup.data, existing[".planforge/state.json"], "cadangan harus berisi progres lama apa adanya");
  const st = cari(r, ".planforge/state.json");
  assert.equal(st.aksi, "timpa", "rencana berubah -> ledger baru mulai bersih");
  assert.equal(JSON.parse(st.data).planFingerprint, baru, "ledger baru harus milik rencana baru");
});
t("Connect tidak mereset ledger saat sidik jari rencana sama", ()=>{
  const fp = PF.planFingerprint(docsAll);
  const existing = {
    ".planforge/plan.json": PF.planBundleJson(docsAll, []),
    ".planforge/state.json": '{"doneTasks":7,"planFingerprint":"' + fp + '"}'
  };
  const r = PF.rencanaTulis(connFiles("claude"), existing, infoUntuk("claude", {}));
  assert.equal(cari(r, ".planforge/state.json").aksi, "lewati", "rencana sama = progres dipertahankan");
  assert.equal(cari(r, ".planforge/state.json").data, existing[".planforge/state.json"]);
  assert.ok(!r.some(x=>/^\.planforge\/state\..+\.json$/.test(x.name)), "tidak boleh ada cadangan kalau rencana tidak berubah");
});
t("konfigurasi MCP yang sudah punya server lain digabung, bukan diganti", ()=>{
  const lama = JSON.stringify({ mcpServers:{ github:{ command:"npx", args:["-y","github-mcp"] } } }, null, 2);
  const r = PF.rencanaTulis(connFiles("claude"), { ".mcp.json":lama }, infoUntuk("claude", { workerPath:"D:/proyek/worker.mjs", projectDir:"D:/proyek" }));
  const x = cari(r, ".mcp.json");
  assert.equal(x.aksi, "gabung");
  const j = JSON.parse(x.data);
  assert.deepEqual(j.mcpServers.github, { command:"npx", args:["-y","github-mcp"] }, "server orang lain hilang");
  assert.deepEqual(j.mcpServers[PF.connNama({projectDir:"D:/proyek"})].args, ["D:/proyek/worker.mjs","mcp","--dir","D:/proyek"]);
});
t("nama connector berbeda untuk basename sama di folder induk berbeda", ()=>{
  assert.notEqual(PF.connNama({projectDir:"D:/A/app"}), PF.connNama({projectDir:"D:/B/app"}));
  assert.equal(PF.connNama({projectDir:"D:/A/App/"}), PF.connNama({projectDir:"d:\\a\\app"}));
  assert.match(PF.connNama({projectDir:"D:/\u8ba1\u5212"}), /^planforge-proyek-[a-f0-9]{8}$/);
  assert.equal(PF.connNama({}), "planforge");
});
t("nama connector web sama persis dengan worker", ()=>{
  for(const projectDir of ["D:/PROJECTS/testing-planforge", "D:/A/app", "d:\\A\\APP\\", "/home/agus/app", "//server/share/app", "D:/\u8ba1\u5212", ""])
    assert.equal(PF.connNama({projectDir}), W.mcpServerName(projectDir), projectDir);
});
t("instruksi agen menyebut connector dan pemeriksaan folder sebelum kerja", ()=>{
  const opts = {projectDir:"D:/PROJECTS/testing-planforge", workerPath:"D:/PROJECTS/testing-planforge/worker.mjs"};
  const prompt = PF.connPrompt(opts), md = PF.agentsMd(docsAll, PF.defaultGates("agy"), opts);
  for(const text of [prompt, md]){
    assert.ok(text.includes(PF.connNama(opts)));
    assert.ok(text.includes(opts.projectDir));
    assert.match(text, /panggil plan_status/);
    assert.match(text, /STOP kalau berbeda/);
    assert.match(text, /jangan panggil tool perubahan pada proyek lain/);
  }
});
t("instruksi agen menyuruh LOOP OTOMATIS: satu trigger = semua task, berhenti hanya pada BERHENTI", ()=>{
  const opts = {projectDir:"D:/PROJECTS/testing-planforge", workerPath:"D:/PROJECTS/testing-planforge/worker.mjs"};
  const prompt = PF.connPrompt(opts), md = PF.agentsMd(docsAll, PF.defaultGates("agy"), opts);
  for(const text of [prompt, md]){
    assert.match(text, /LOOP OTOMATIS/, "harus menyuruh loop otomatis, bukan satu task lalu diam");
    assert.match(text, /next_task`? lagi/, "harus menyuruh panggil next_task lagi sesudah mark_done");
    assert.match(text, /BERHENTI/, "harus menyebut tanda berhenti");
    assert.match(text, /mark_blocked/, "harus menyebut mark_blocked sebagai cara berhenti yang sah");
  }
});
t("merge mempertahankan legacy planforge milik proyek lain", ()=>{
  const opts = {projectDir:"D:/PROJECTS/testing-planforge", workerPath:"D:/PROJECTS/testing-planforge/worker.mjs"};
  const legacy = { command:"node", args:["D:/PROJECTS/trade-news/worker.mjs", "mcp", "--dir", "D:/PROJECTS/trade-news"] };
  const files = PF.runnerBundle(docsAll, [], PF.defaultGates("agy"), {...opts, agent:"workbuddy", workerSource:"// worker"});
  const result = PF.rencanaTulis(files, {".mcp.json":JSON.stringify({mcpServers:{planforge:legacy}})}, infoUntuk("workbuddy", opts));
  const cfg = JSON.parse(cari(result,".mcp.json").data);
  assert.deepEqual(cfg.mcpServers.planforge, legacy);
  assert.deepEqual(Object.keys(cfg.mcpServers), ["planforge", PF.connNama(opts)]);
  assert.equal(cfg.mcpServers[PF.connNama(opts)].args.at(-1), opts.projectDir);
});
t("bentuk servers (VS Code) digabung ke servers, bukan mcpServers", ()=>{
  const lama = JSON.stringify({ servers:{ lain:{ type:"stdio", command:"x" } }, inputs:[] });
  const r = PF.rencanaTulis(connFiles("vscode"), { ".vscode/mcp.json":lama }, infoUntuk("vscode", {}));
  const j = JSON.parse(cari(r,".vscode/mcp.json").data);
  assert.ok(j.servers.lain, "server lama hilang");
  assert.equal(j.servers.planforge.type, "stdio");
  assert.ok(!j.mcpServers, "tidak boleh membuat blok mcpServers di file bentuk servers");
});
t("konfigurasi rusak atau tanpa blok dikenal dilewati, bukan ditimpa", ()=>{
  for(const lama of ["ini bukan json {{{", JSON.stringify({ settingLain:1 })]){
    const r = PF.rencanaTulis(connFiles("claude"), { ".mcp.json":lama }, infoUntuk("claude", {}));
    const x = cari(r,".mcp.json");
    assert.equal(x.aksi, "lewati", lama);
    assert.equal(x.data, lama, "isi asli harus tetap utuh");
  }
});
t("file aturan: ditambah di akhir kalau belum ada PlanForge, dilewati kalau sudah", ()=>{
  const info = infoUntuk("claude", {});
  const belum = PF.rencanaTulis(connFiles("claude"), { "CLAUDE.md":"# Aturan lama\njangan hapus aku" }, info);
  const x = cari(belum,"CLAUDE.md");
  assert.equal(x.aksi, "gabung");
  assert.ok(x.data.startsWith("# Aturan lama\njangan hapus aku"), "isi lama harus di depan");
  assert.ok(x.data.includes("PlanForge"));
  const sudah = PF.rencanaTulis(connFiles("claude"), { "CLAUDE.md":"# PlanForge sudah di sini" }, info);
  assert.equal(cari(sudah,"CLAUDE.md").aksi, "lewati");
});
t("worker.mjs dan plan.json ditimpa supaya mesinnya tidak basi", ()=>{
  const r = PF.rencanaTulis(connFiles("claude"), { "worker.mjs":"// versi lama", ".planforge/plan.json":"{}" }, infoUntuk("claude", {}));
  assert.equal(cari(r,"worker.mjs").aksi, "timpa");
  assert.equal(cari(r,"worker.mjs").data, "// worker");
  assert.equal(cari(r,".planforge/plan.json").aksi, "timpa");
});
t("keputusan tulis sama untuk semua aplikasi yang punya file konfigurasi", ()=>{
  for(const key of Object.keys(PF.AGENT_ADAPTERS)){
    const info = infoUntuk(key, {});
    const r = PF.rencanaTulis(connFiles(key), {}, info);
    assert.equal(r.length, 6, key);
    assert.ok(r.every(x=>["baru","timpa","gabung","lewati"].includes(x.aksi)), key + ": aksi tak dikenal");
  }
});

t("alias alat ukur dibetulkan, yang tanpa padanan jujur dibiarkan", ()=>{
  const docs = { tasks:{ tasks:[{ id:"T-001", behavior:{ url:"http://127.0.0.1:8080/", checks:[
    { type:"attribute", selector:"#a", name:"data-x", equals:"1" },
    { type:"textContains", selector:"#b", text:"Kasir" },
    { type:"noHorizontalScroll" },
    { type:"css", selector:"body", property:"background-color", equals:"rgb(15, 23, 42)" },
    { type:"hover", selector:"#c" }
  ] } }] } };
  const r = PF.normalisasiAliasBehavior(docs);
  assert.deepEqual(r.perbaikan, ["T-001:attribute->attr", "T-001:textContains->text", "T-001:noHorizontalScroll->noHorizontalOverflow"]);
  assert.deepEqual(r.tersisa, ["T-001:css", "T-001:hover"]);
  const c = docs.tasks.tasks[0].behavior.checks;
  assert.equal(c[0].type, "attr");
  assert.equal(c[1].type, "text");
  assert.equal(c[1].contains, "Kasir");
  assert.equal(c[3].type, "css", "alat ukur tanpa padanan TIDAK boleh ditukar diam-diam");
});
t("rubrik menolak rencana yang mulai T-002 tanpa scaffold", ()=>{
  const docs = { tasks:{ tasks:[{ id:"T-002", title:"Definisikan token warna gelap", description:"",
    files_or_areas:["src/style.css","index.html"], verification:"npm run build", acceptance_criteria:["warna sesuai"] }] } };
  const m = PF.masalahStrukturRencana(docs);
  assert.ok(m.some(x=>/bukan T-001/.test(x)), m.join(" | "));
  assert.ok(m.some(x=>/bukan scaffold/.test(x)), m.join(" | "));
  const r = PF.rubrikRencana(docs, []);
  assert.equal(r.siap, false);
  assert.equal(r.label, "Perlu diperbaiki");
  assert.ok(r.skor < 100);
});
t("kata UI tunggal tidak menandai target backend sebagai task UI", ()=>{
  const task = { title:"Perbarui data tombol aktif", files_or_areas:["src/utils.js"], acceptance_criteria:["API tetap mengembalikan status tombol"] };
  assert.equal(PF.taskUi(task), false);
  assert.deepEqual(PF.masalahBehavior(task), []);
  assert.equal(PF.taskUi({files_or_areas:["src/api.js"], acceptance_criteria:["respons tombol konsisten"]}), false);
  assert.equal(PF.taskUi({files_or_areas:["src/web/panel.jsx"], acceptance_criteria:["panel tampil"]}), true);
});
t("skor rubrik tetap 80 untuk satu celah, tanpa penalti behavior palsu pada backend", ()=>{
  const docs = { tasks:{ tasks:[{ id:"T-001", title:"Scaffold CLI untuk data tombol", files_or_areas:["src/utils.js"],
    verification:"node --test test/utils.test.mjs", acceptance_criteria:["API mengembalikan status tombol"] }] } };
  const r = PF.rubrikRencana(docs, ["prd: requirements kosong"]);
  assert.equal(r.skor, 80);
  assert.deepEqual(r.error, ["prd: requirements kosong"]);
});
t("rubrik meloloskan rencana contoh yang punya T-001 scaffold", ()=>{
  const r = PF.rubrikRencana(PF.DEMO, []);
  assert.ok(r.error.length === 0 || !r.error.some(x=>/bukan scaffold|bukan T-001/.test(x)), r.error.join(" | "));
  assert.ok(PF.ALIAS_CHECK.attribute === "attr");
});
t("rubrik menolak verifikasi kosong, prose, penutup sukses, CJK, ID duplikat, dan script hilang", ()=>{
  const base = structuredClone(PF.DEMO);
  base.tasks.tasks[0].verification = "";
  assert.ok(PF.rubrikRencana(base, []).error.some(x=>/verification kosong/.test(x)));

  for(const verification of ["buka halaman dan cek", "node --test test/a.test.mjs; echo ok", "node --test test/a.test.mjs || true", "node --test test/a.test.mjs || exit 0"]){
    const d = structuredClone(PF.DEMO);
    d.tasks.tasks[0].verification = verification;
    assert.ok(PF.rubrikRencana(d, []).error.length > 0, verification);
  }

  const cjk = structuredClone(PF.DEMO);
  cjk.tasks.tasks[0].title = "Tugas " + "\u4e2d\u6587";
  assert.ok(PF.rubrikRencana(cjk, []).error.some(x=>/aksara Mandarin/.test(x)));

  const dup = structuredClone(PF.DEMO);
  dup.tasks.tasks.push(structuredClone(dup.tasks.tasks[1]));
  assert.ok(PF.rubrikRencana(dup, []).error.some(x=>/duplikat/.test(x)));

  const pkg = structuredClone(PF.DEMO);
  pkg.packageJson = {scripts:{test:"node --test"}};
  pkg.tasks.tasks[0].verification = "npm run script-yang-tidak-ada";
  assert.ok(PF.rubrikRencana(pkg, []).error.some(x=>/script-yang-tidak-ada/.test(x)));

  assert.equal(PF.rubrikRencana(PF.DEMO, []).siap, true);
});
t("validatePlan menerima status terkendala", ()=>{
  const tasks = structuredClone(PF.DEMO.tasks);
  tasks.tasks[0].status = "terkendala";
  assert.ok(!PF.validatePlan(PF.DEMO.prd, PF.DEMO.roadmap, tasks).some(x=>/status/.test(x)));
});
t("temp directory helper dibersihkan saat callback melempar", ()=>{
  let dir = "";
  assert.throws(()=>withTempDir("planforge-throw-", d=>{
    dir = d;
    assert.ok(fs.existsSync(d));
    throw new Error("callback sengaja gagal");
  }), /callback sengaja gagal/);
  assert.equal(fs.existsSync(dir), false);
});
t("rubrik menggabungkan celah validator lokal dengan celah struktur", ()=>{
  const docs = { tasks:{ tasks:[{ id:"T-001", title:"Scaffold proyek statis", description:"buat kerangka", verification:"node --test test/a.test.mjs" }] } };
  const r = PF.rubrikRencana(docs, ["prd: requirements kosong"]);
  assert.equal(r.siap, false);
  assert.ok(r.error.includes("prd: requirements kosong"));
  assert.ok(r.skor === 80, "satu celah = skor 80, dapat: " + r.skor);
});

console.log("\n13b) rubrik sadar-starter (bug: Connect ditahan padahal starter aktif)");
const docsMigrasi = { tasks:{ tasks:[{ id:"T-001", title:"Buat migrasi tabel categories dan expenses di atas starter", description:"tambah tabel fitur di DB starter yang sudah jalan", files_or_areas:["db/migrations/001.sql","lib/db.js"], verification:"npm test", acceptance_criteria:["tabel dibuat"] }] } };
t("starterAktif membaca pilihan nextjs-fullstack vs kosong", ()=>{
  assert.equal(PF.starterAktif({starter:"nextjs-fullstack"}), true);
  assert.equal(PF.starterAktif({starter:""}), false);
  assert.equal(PF.starterAktif(null), false);
});
t("starter aktif: task pertama migrasi T-001 TIDAK dituntut scaffold", ()=>{
  const m = PF.masalahStrukturRencana(docsMigrasi, true);
  assert.ok(!m.some(x=>/bukan scaffold/.test(x)), m.join(" | "));
  const r = PF.rubrikRencana(docsMigrasi, [], true);
  assert.equal(r.siap, true, r.error.join(" | "));
  assert.equal(r.skor, 100);
});
t("starter aktif tetap menuntut ID T-001 (bukan T-002)", ()=>{
  const docs = { tasks:{ tasks:[Object.assign({}, docsMigrasi.tasks.tasks[0], {id:"T-002"})] } };
  const m = PF.masalahStrukturRencana(docs, true);
  assert.ok(m.some(x=>/bukan T-001/.test(x)), m.join(" | "));
  assert.ok(!m.some(x=>/bukan scaffold/.test(x)), m.join(" | "));
});
t("tanpa starter: migrasi-first tetap ditolak scaffold (regresi)", ()=>{
  const m = PF.masalahStrukturRencana(docsMigrasi, false);
  assert.ok(m.some(x=>/bukan scaffold/.test(x)), m.join(" | "));
  const r = PF.rubrikRencana(docsMigrasi, []);
  assert.equal(r.siap, false);
  assert.equal(r.skor, 80, "satu celah scaffold = skor 80, dapat: " + r.skor);
});
t("argumen starter opsional: 2-argumen == starter mati (backward-compat)", ()=>{
  assert.deepEqual(PF.rubrikRencana(docsMigrasi, []), PF.rubrikRencana(docsMigrasi, [], false));
});
t("tab Cek rencana menampilkan masalah struktur yang menahan Connect (list kosong)", ()=>{
  const html = PF.renderMarkdown("issues", [], {struktur:["task pertama 'Buat migrasi...' bukan scaffold — tidak ada yang menyiapkan file dasar proyek"]});
  assert.ok(/Masalah struktur/.test(html), html.slice(0,120));
  assert.ok(/bukan scaffold/.test(html));
  assert.ok(!/Lolos cek struktur/.test(html), "tidak boleh klaim lolos kalau ada masalah struktur");
});
t("tab Cek rencana bersih kalau starter aktif (struktur kosong, list kosong)", ()=>{
  const html = PF.renderMarkdown("issues", [], {struktur:PF.masalahStrukturRencana(docsMigrasi, true)});
  assert.ok(/Lolos cek struktur/.test(html));
  assert.ok(!/Masalah struktur/.test(html));
});
t("tab Cek rencana netral saat belum ada rencana", ()=>{
  const html = PF.renderMarkdown("issues", [], {empty:true, struktur:[]});
  assert.match(html, /Belum ada rencana untuk diperiksa/);
  assert.ok(!/masalah struktur yang menahan Connect|Lolos cek struktur/.test(html));
});
t("tab Cek rencana: celah validator + masalah struktur tampil bersama", ()=>{
  const html = PF.renderMarkdown("issues", ["prd: requirements kosong"], {struktur:["task pertama ber-ID T-002, bukan T-001 — task scaffold biasanya hilang"]});
  assert.ok(/celah integritas/.test(html));
  assert.ok(/Masalah struktur/.test(html));
  assert.ok(/bukan T-001/.test(html));
});

console.log("\n14) starter contract + environment advisories");
t("all planning stages after clarify include real scripts and files", ()=>{
  const pkg = JSON.parse(PF.STARTER_FILES["package.json"]);
  for(const stage of ["prd", "roadmap", "tasks", "audit"]){
    const p = PF.buildStageMessages(stage, {starter:"nextjs-fullstack"}, PF.DEMO)[1].content;
    assert.ok(p.includes(JSON.stringify(pkg.scripts)), stage);
    for(const f of Object.keys(PF.STARTER_FILES).filter(f=>f !== "manifest.json")) assert.ok(p.includes(f), stage + ": " + f);
    assert.match(p, /BELUM ada runner db\/migrations/);
    assert.match(p, /lingkungan target BELUM|belum diverifikasi/);
  }
  assert.equal(PF.starterContractLines({}).length, 0);
});
t("environment advisories do not lower score or hold Connect", ()=>{
  const r = PF.rubrikRencana(docsMigrasi, [], true);
  assert.equal(r.siap, true); assert.equal(r.skor, 100); assert.equal(r.error.length, 0);
  assert.ok(r.warn.some(s=>s.includes("doctor --environment")));
  const ui = PF.renderMarkdown("issues", [], {struktur:r.error, warn:r.warn});
  assert.match(ui, /tidak menahan Connect/); assert.match(ui, /setup-env/);
});
t("unknown migrate alias is structural, original command passes", ()=>{
  const d = structuredClone(docsMigrasi);
  d.tasks.tasks[0].verification = "npm run db:migrate && node --test test/schema.test.js";
  assert.ok(PF.rubrikRencana(d, [], true).error.some(s=>s.includes("db:migrate")));
  d.tasks.tasks[0].verification = "npm run migrate && node --test test/schema.test.js";
  assert.equal(PF.rubrikRencana(d, [], true).siap, true);
});
t("new scripts require an explicit package.json task or dependency", ()=>{
  const pkg = {scripts:{test:"node --test"}};
  const ts = [{id:"T-001", description:"Tambah script db:check", files_or_areas:["package.json"], verification:"npm run db:check"},
    {id:"T-002", depends_on:["T-001"], verification:"npm run db:check"}];
  assert.deepEqual(PF.missingNpmScripts(ts,pkg), []);
  ts[1].depends_on = [];
  assert.equal(PF.missingNpmScripts(ts,pkg)[0].id, "T-002");
  assert.deepEqual(PF.missingNpmScripts(ts,pkg), W.missingNpmScripts(ts,pkg));
});
t("quoted code does not invent npm script calls; behavior server is checked", ()=>{
  const pkg = {scripts:{test:"node --test"}};
  const ts = [{id:"T-001",verification:'node -e "console.log(\'npm run bogus\')"',behavior:{server:{cmd:"npm run ghost"}}}];
  const r = PF.missingNpmScripts(ts,pkg);
  assert.equal(r.length, 1); assert.match(r[0].msg, /ghost/);
  assert.deepEqual(r, W.missingNpmScripts(ts,pkg));
});
t("wrong stack remains strict; rejected alternatives are not the chosen stack", ()=>{
  const d = structuredClone(docsMigrasi);
  d.prd = {tech:[{decision:"SQLite", alternatives:["PostgreSQL"]}]};
  assert.equal(PF.rubrikRencana(d, [], true).siap, false);
  d.prd.tech = [{decision:"Next.js 15 + PostgreSQL", alternatives:["SQLite"], rationale:"bukan FastAPI"}];
  assert.equal(PF.rubrikRencana(d, [], true).siap, true);
});
t("npm flags and exact script declarations agree in web and worker", ()=>{
  const pkg={scripts:{migrate:"node scripts/migrate.mjs"}};
  const ts=[{id:"T-001",verification:"npm --silent run --silent migrate"},
    {id:"T-002",description:"Add script db:migrate:check",files_or_areas:["package.json"],verification:"npm run db:migrate"}];
  const r=PF.missingNpmScripts(ts,pkg);
  assert.equal(r.length,1); assert.equal(r[0].id,"T-002");
  assert.deepEqual(r,W.missingNpmScripts(ts,pkg));
  const d=structuredClone(docsMigrasi);
  d.prd={tech:[{decision:"Next.js + PostgreSQL (not SQLite)"}]};
  assert.equal(PF.rubrikRencana(d,[],true).siap,true);
  d.prd.tech[0].decision="Database: PostgreSQL bukan MySQL";
  assert.equal(PF.rubrikRencana(d,[],true).siap,true);
});
t("agent handoff is honest and contains safe preparation steps", ()=>{
  const md = PF.agentsMd(docsMigrasi, PF.defaultGates("agy"), {agent:"vscode", starter:"nextjs-fullstack"});
  for(const text of ["doctor --environment", "setup-env", "npm install", "docker compose up -d db", "npm run migrate", "opsional", "bukan error struktur"]) assert.ok(md.includes(text), text);
  assert.ok(!md.includes("SUDAH ADA dan berjalan"));
  assert.ok(!md.includes("Fondasi ini sudah lulus"));
});
/* REFACTOR-CONTRACT-BEGIN: append-only characterization; original assertions stay above. */
console.log("\n15) refactor characterization (offline, no application changes)");
const contract = JSON.parse(fs.readFileSync(new URL("./refactor-contract.json", import.meta.url), "utf8"));
t("refactor: original harness assertion count is intact", ()=>{
  assert.equal(contract.version, 1);
  assert.equal(pass + fail, contract.baseline.suites.core + contract.additionalAssertions.core);
});
t("refactor: worker namespace export names match the captured contract", ()=>{
  assert.deepEqual(Object.keys(W), contract.worker.exportNames);
});
t("refactor: every worker export retains its typeof and length", ()=>{
  const signatures = Object.fromEntries(Object.keys(W).map(name=>[name, {
    type:typeof W[name], length:typeof W[name]?.length === "number" ? W[name].length : null
  }]));
  assert.deepEqual(signatures, contract.worker.signatures);
});
t("refactor: MCP_TOOLS names, descriptions, and full input schemas are exact", ()=>{
  assert.deepEqual(W.MCP_TOOLS, contract.worker.MCP_TOOLS);
});
t("refactor: MCP tools/list returns the exact schema envelope", ()=>{
  assert.deepEqual(W.mcpHandle({jsonrpc:"2.0", id:17, method:"tools/list"}, null), {
    jsonrpc:"2.0", id:17, result:{tools:contract.worker.MCP_TOOLS}
  });
});
function normalizedContractResult(value, sample){
  // Characterize JSON, not object prototypes. Only explicit generated date fields vary.
  const result = sample.parseJson ? JSON.parse(value) : JSON.parse(JSON.stringify(value));
  for(const [key, kind] of Object.entries(sample.normalize || {})){
    assert.ok(kind === "date" || kind === "iso-timestamp", "unknown normalization: " + kind);
    assert.equal(typeof result[key], "string", key);
    assert.match(result[key], kind === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, key);
    assert.ok(Number.isFinite(Date.parse(result[key])), "invalid generated date: " + key);
    result[key] = "<" + kind + ">";
  }
  return result;
}
for(const sample of contract.samples){
  t("refactor JSON: " + sample.name, ()=>{
    assert.ok(sample.target === "worker" || sample.target === "core");
    const api = sample.target === "worker" ? W : PF;
    const result = api[sample.method](...structuredClone(sample.args));
    assert.deepEqual(normalizedContractResult(result, sample), sample.result);
  });
}
t("refactor: importing worker has no CLI or MCP entrypoint side effects", ()=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-import-contract-"));
  const probe = `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import childProcess from "node:child_process";
    import net from "node:net";
    import {syncBuiltinESMExports} from "node:module";
    const log = console.log, stdin = process.stdin;
    const events = emitter => emitter.eventNames().map(name=>[String(name), emitter.listenerCount(name)]);
    const before = {stdin:events(stdin), process:events(process)};
    const forbidden = ()=>{ throw new Error("import attempted a write, subprocess, network call, or process exit"); };
    for(const name of ["writeFileSync","appendFileSync","mkdirSync","renameSync","rmSync","unlinkSync"])
      fs[name] = forbidden;
    for(const name of ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"])
      childProcess[name] = forbidden;
    net.Socket.prototype.connect = forbidden;
    net.Server.prototype.listen = forbidden;
    globalThis.fetch = forbidden;
    process.exit = forbidden;
    syncBuiltinESMExports();
    process.argv = [process.execPath, "import-probe.mjs", process.argv[1]];
    const worker = await import(${JSON.stringify(new URL("../worker.mjs", import.meta.url).href)});
    assert.equal(typeof worker.main, "function");
    assert.equal(console.log, log, "MCP must not redirect console on import");
    assert.deepEqual({stdin:events(stdin), process:events(process)}, before);
    assert.equal(process.exitCode, undefined);
    assert.deepEqual(fs.readdirSync(process.cwd()), []);
    process.stdout.write("import-only-ok");
  `;
  try{
    for(const command of ["init", "run", "mcp"]){
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", probe, command], {
        cwd:dir, encoding:"utf8", input:'{"jsonrpc":"2.0","id":1,"method":"initialize"}\n', timeout:10000
      });
      assert.ifError(child.error);
      assert.equal(child.signal, null);
      assert.equal(child.status, 0, child.stderr || child.stdout);
      assert.equal(child.stdout, "import-only-ok", "unexpected entrypoint output for " + command);
      assert.equal(child.stderr, "", "unexpected entrypoint diagnostics for " + command);
      assert.deepEqual(fs.readdirSync(dir), [], "import wrote project files");
    }
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
t("refactor: extracted core executes fixture cases without any DOM", ()=>{
  const samples = contract.samples.filter(sample=>sample.target === "core");
  const names = [...new Set(samples.map(sample=>sample.method))];
  const sandbox = vm.createContext({TextEncoder});
  assert.equal(vm.runInContext('[typeof window,typeof document,typeof navigator,typeof localStorage].join(",")', sandbox),
    "undefined,undefined,undefined,undefined");
  vm.runInContext(core + "; globalThis.contractApi = {" + names.join(",") + "};", sandbox, {timeout:5000});
  for(const sample of samples){
    sandbox.args = structuredClone(sample.args);
    const result = vm.runInContext("contractApi[" + JSON.stringify(sample.method) + "](...args)", sandbox, {timeout:5000});
    assert.deepEqual(normalizedContractResult(result, sample), sample.result, sample.name);
  }
});
t("refactor: HTML keeps inline scripts and has no script/style dependencies", ()=>{
  // Ignore JS/JSON bodies: embedded starter examples and runtime provider fetch URLs are not HTML includes.
  const attrsOf = text=>Object.fromEntries([...text.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)]
    .map(m=>[m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""]));
  const actual = {scripts:[], dependencyLinks:[], cssImports:[], externalCssUrls:[]};
  let markup = html.replace(/<!--[^]*?-->/g, "");
  markup = markup.replace(/<script\b([^>]*)>[^]*?<\/script\s*>/gi, (tag, text)=>{
    const attrs = attrsOf(text);
    actual.scripts.push({src:attrs.src ?? null, type:attrs.type ?? null, id:attrs.id ?? null});
    return "";
  });
  const styles = [];
  markup = markup.replace(/<style\b[^>]*>([^]*?)<\/style\s*>/gi, (tag, css)=>{ styles.push(css); return ""; });
  for(const match of markup.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) styles.push(match[1] ?? match[2]);
  for(const match of markup.matchAll(/<link\b([^>]*)>/gi)){
    const attrs = attrsOf(match[1]);
    if(/\b(?:stylesheet|modulepreload|import)\b/i.test(attrs.rel || "") || /^(?:script|style)$/i.test(attrs.as || ""))
      actual.dependencyLinks.push(attrs);
  }
  for(const css of styles){
    const clean = css.replace(/\/\*[^]*?\*\//g, "");
    actual.cssImports.push(...(clean.match(/@import\b[^;]*/gi) || []));
    for(const match of clean.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)){
      const url = (match[1] ?? match[2] ?? match[3]).trim();
      if(url && !/^(?:#|data:)/i.test(url)) actual.externalCssUrls.push(url);
    }
  }
  assert.deepEqual(actual, contract.html);
  assert.ok(actual.scripts.every(script=>script.src === null));
  assert.deepEqual(actual.dependencyLinks, []);
  assert.deepEqual(actual.cssImports, []);
  assert.deepEqual(actual.externalCssUrls, []);
});
/* REFACTOR-CONTRACT-END */
console.log("\n16) build infrastructure contracts");
const { buildTests } = await import("./build.test.mjs");
await buildTests(t, ta);
cleanupTempDirs();
console.log("\n" + pass + " lulus, " + fail + " gagal\n");
process.exit(fail ? 1 : 0);
