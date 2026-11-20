#!/usr/bin/env node
// Usage: node scripts/check-refactor.mjs [batch-label]. Built-in Node modules only.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sweepStaleTempDirs } from "../test/temp-dirs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const label = process.argv[2] || "refactor-check";
if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(label) || process.argv.length > 3){
  console.error("Usage: node scripts/check-refactor.mjs [batch-label] (letters, digits, _ or -)");
  process.exit(1);
}
const absolute = name=>path.join(root, name);
const sha256 = file=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const fixture = JSON.parse(fs.readFileSync(absolute("test/refactor-contract.json"), "utf8"));
const definitions = [
  ["core", "test/core.test.mjs"],
  ["worker", "test/worker.test.mjs"],
  ["connect", "test/connect.test.mjs"],
  ["browser", "test/browser.test.mjs"],
  ["ui-probe", "test/ui-probe.mjs"]
];
const receipt = {
  label, startedAt:new Date().toISOString(), project:root, node:process.version,
  executionOrder:definitions.map(([name])=>name), suites:{}, checks:{}, errors:[],
  hashes:{sourceBefore:{}, source:{}, logs:{}},
  limits:{
    paidAiCalls:0, codingAgentRuns:"existing fake/silent test agents only",
    pilotAccess:false, globalSettingsChanges:false, dependencyInstalls:false,
    sourceWrites:false, projectGitOperations:false,
    gitScope:"Original suites exercise Git in disposable temporary repositories; the runner runs no Git commands.",
    networkScope:"Existing browser suites use local fixtures/CDP and mocked provider/GitHub transports; no paid AI calls are requested.",
    suiteTimeoutMs:600000, unexpectedSkipsAllowed:0
  },
  limitations:[
    "Characterization covers the captured exports, MCP schema and representative results, not every possible behavior.",
    "HTML checks cover script/style includes and CSS dependencies, not a network sandbox for all future dynamic code.",
    "No paid-model quality, real IDE connector, pilot execution, database deployment or production behavior is certified.",
    "Original suites may rewrite test/out.zip and ui-receipt.json; source files must remain unchanged during verification."
  ]
};

function check(name, fn){
  try{ fn(); receipt.checks[name] = true; }
  catch(error){ receipt.checks[name] = false; receipt.errors.push(name + ": " + error.message); }
}

// Same generated/dependency exclusions as the original core starter proof.
function sourceHashes(){
  const files = ["index.html", "worker.mjs", "package.json", "package-lock.json"];
  const skipDirs = new Set(["node_modules", ".next", ".git"]);
  const skipFiles = new Set(["package-lock.json", ".starter-smoke.log", "out.zip"]);
  function walk(dir){
    for(const entry of fs.readdirSync(absolute(dir), {withFileTypes:true})){
      if(skipDirs.has(entry.name) || skipFiles.has(entry.name)) continue;
      const name = dir + "/" + entry.name;
      if(entry.isDirectory()) walk(name);
      else if(entry.isFile()) files.push(name);
    }
  }
  for(const dir of ["starter", "test", "scripts", "src"]) walk(dir);
  return Object.fromEntries(files.sort().map(name=>[name, sha256(absolute(name))]));
}

function parseOutput(output){
  const lines = output.split(/\r?\n/);
  const summaries = lines.map(line=>/^(\d+) lulus, (\d+) gagal(?: — receipt: .+)?$/.exec(line.trim())).filter(Boolean);
  const summary = summaries.length === 1 ? summaries[0] : null;
  const skipLines = lines.filter(line=>
    /^\s*(?:#\s*)?(?:SKIP(?:PED)?|TODO)\b/i.test(line) ||
    /^\s*(?:not )?ok\s+\d+\b.*#\s*(?:SKIP|TODO)\b/i.test(line) ||
    /^\s*(?:#\s*)?(?:skipped|cancelled|todo)\s*[:=]?\s*[1-9]\d*\b/i.test(line) ||
    /^\s*(?:#\s*)?[1-9]\d*\s+(?:skipped|skips|dilewati)\b/i.test(line) ||
    /^browser tidak ditemukan.*dilewati/i.test(line)
  );
  return {
    passed:summary ? Number(summary[1]) : null,
    failed:summary ? Number(summary[2]) : null,
    loggedPassed:lines.filter(line=>/^  ok   /.test(line)).length,
    loggedFailed:lines.filter(line=>/^  FAIL /.test(line)).length,
    skipped:skipLines.reduce((total, line)=>total + Number(/\b(\d+)\b/.exec(line)?.[1] || 1), 0),
    unexpectedSkipLines:skipLines,
    suiteFailureLines:lines.filter(line=>/^\s*(?:suite failed\b|not ok\b|GAGAL menjalankan probe\b)/i.test(line)),
    summary:summary ? summary[0] : null
  };
}

check("sourceInventoryCaptured", ()=>{ receipt.hashes.sourceBefore = sourceHashes(); });
for(const [name, script] of definitions){
  sweepStaleTempDirs();
  const logName = label + "-" + name + ".suite-run.log";
  const logPath = absolute(logName);
  const started = Date.now();
  console.log("\n[" + name + "] " + process.execPath + " " + absolute(script));
  let child = {status:null, signal:null}, error = null, fd;
  try{
    fd = fs.openSync(logPath, "w");
    // Both streams go directly to one file: full output, original interleaving, no maxBuffer truncation.
    child = spawnSync(process.execPath, [absolute(script)], {
      cwd:root, stdio:["ignore", fd, fd], timeout:receipt.limits.suiteTimeoutMs, windowsHide:true
    });
    if(child.error) error = child.error.message;
  }catch(e){ error = e.message; }
  finally { if(fd !== undefined) fs.closeSync(fd); }
  if(error) fs.appendFileSync(logPath, "\nRUNNER ERROR: " + error + "\n");
  const output = fs.readFileSync(logPath, "utf8");
  const counts = parseOutput(output);
  // Preserve the original characterization floor, plus fourteen build assertions appended to core.
  const minimum = fixture.baseline.suites[name] + (name === "core" ? fixture.samples.length + 8 + 14 : 0);
  const problems = [];
  if(error) problems.push(error);
  if(child.status !== 0 || child.signal) problems.push("process exit=" + child.status + " signal=" + child.signal);
  if(counts.passed === null) problems.push("missing or ambiguous final suite summary");
  if(counts.failed !== 0 || counts.loggedFailed || counts.suiteFailureLines.length) problems.push("suite reports failure");
  if(counts.passed !== counts.loggedPassed || counts.failed !== counts.loggedFailed) problems.push("summary does not match harness assertion lines");
  if(counts.passed < minimum) problems.push("test count below baseline minimum " + minimum);
  if(counts.unexpectedSkipLines.length) problems.push("unexpected skipped tests");
  const digest = sha256(logPath);
  receipt.hashes.logs[logName] = digest;
  receipt.suites[name] = {
    script:absolute(script), log:logPath, sha256:digest, startedAt:new Date(started).toISOString(),
    durationMs:Date.now() - started, exit:child.status, signal:child.signal,
    ...counts, minimumTests:minimum, ok:problems.length === 0, problems
  };
  // Intentionally use JS for the summary tail; never a platform-specific tail command.
  console.log(output.trimEnd().split(/\r?\n/).slice(-8).join("\n"));
  console.log("[" + name + "] " + (problems.length ? "FAILED: " + problems.join("; ") : "PASS") + " | " + logPath);
  sweepStaleTempDirs();
}

check("fiveSuitesGreen", ()=>{
  assert.equal(Object.keys(receipt.suites).length, 5);
  for(const [name, suite] of Object.entries(receipt.suites)) assert.ok(suite.ok, name + ": " + suite.problems.join("; "));
});
check("workerEmbeddedExact", ()=>{
  const html = fs.readFileSync(absolute("index.html"), "utf8");
  const matches = [...html.matchAll(/<script\b[^>]*\bid=["']pf-worker-src["'][^>]*>([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(matches.length, 1, "expected exactly one pf-worker-src JSON script");
  assert.match(matches[0][0], /\btype=["']application\/json["']/i);
  assert.equal(JSON.parse(matches[0][1]), fs.readFileSync(absolute("worker.mjs"), "utf8"));
});
check("webModuleStructure", ()=>{
  // Lightweight structure proof: both browser entry points exist, every .mjs module in their
  // folders is reachable through relative imports, and no module lives outside the folder.
  function relativeImports(file){
    const specs = [];
    for(const line of fs.readFileSync(file, "utf8").split(/\r?\n/)){
      const match = /^\s*(?:import|export)\b.*?\bfrom\s+["']([^"']+)["']/.exec(line)
        || /^\s*import\s+["']([^"']+)["']/.exec(line);
      if(!match) continue;
      if(match[1].startsWith("./") || match[1].startsWith("../"))
        specs.push(path.resolve(path.dirname(file), match[1]));
    }
    return specs;
  }
  function moduleFiles(dir){
    const files = [];
    for(const entry of fs.readdirSync(dir, {withFileTypes:true})){
      const file = path.join(dir, entry.name);
      if(entry.isDirectory()) files.push(...moduleFiles(file));
      else if(entry.isFile() && entry.name.endsWith(".mjs")) files.push(file);
    }
    return files;
  }
  const summary = {};
  for(const [name, entry, dir] of [
    ["core", absolute("src/web/core.mjs"), absolute("src/web/core")],
    ["app", absolute("src/web/app.mjs"), absolute("src/web/app")]
  ]){
    assert.ok(fs.statSync(entry).isFile(), name + " entry point missing");
    assert.ok(fs.statSync(dir).isDirectory(), name + " module folder missing");
    const expected = moduleFiles(dir).sort();
    assert.ok(expected.length > 0, name + " module folder is empty");
    const reachable = new Set();
    const pending = [entry];
    while(pending.length){
      const file = pending.pop();
      if(reachable.has(file)) continue;
      assert.ok(fs.statSync(file).isFile(), name + " missing module " + file);
      reachable.add(file);
      pending.push(...relativeImports(file));
    }
    const actual = [...reachable].filter(file=>file.startsWith(dir + path.sep)).sort();
    for(const file of expected)
      assert.ok(actual.includes(file), name + " module not reachable from entry: " + file);
    for(const file of actual)
      assert.ok(expected.includes(file), name + " entry imports a module outside " + name + "/: " + file);
    summary[name] = expected.map(file=>path.relative(dir, file).split(path.sep).join("/"));
  }
  receipt.webModules = summary;
});
check("starterEmbeddedExact", ()=>{
  // Reuse the ORIGINAL core disk-vs-STARTER_FILES deepEqual proof, including its exclusions.
  const proof = "  ok   blob STARTER_FILES sinkron persis dengan folder starter/ di disk (tidak basi, tanpa node_modules/.next)";
  const suite = receipt.suites.core;
  assert.ok(suite.ok, "core suite must pass before accepting its starter proof");
  assert.ok(fs.readFileSync(suite.log, "utf8").split(/\r?\n/).includes(proof), "original core starter proof missing");
  receipt.starterProof = {suite:"core", assertion:proof.trim(), log:suite.log};
});
check("sourcesUnchangedDuringVerification", ()=>{
  receipt.hashes.source = sourceHashes();
  assert.deepEqual(receipt.hashes.source, receipt.hashes.sourceBefore);
});
check("noCJK", ()=>{
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const files = Object.keys(receipt.hashes.source);
  assert.ok(files.length > 0, "source inventory is empty");
  receipt.noCJKExceptions = [];
  const found = files.filter(name=>{
    let text = fs.readFileSync(absolute(name), "utf8");
    if(name === "test/worker.test.mjs"){
      // The untouched original audit test deliberately supplies CJK and asserts rejection.
      // Exempt only that exact input, not the file: any other CJK must still fail.
      const negativeFixture = 'title:"header yang \u671f\u671b muncul"';
      assert.equal(text.split(negativeFixture).length - 1, 1, "original CJK negative fixture changed");
      receipt.noCJKExceptions.push({
        file:name, line:text.slice(0, text.indexOf(negativeFixture)).split("\n").length,
        occurrences:1, codePoints:["U+671F", "U+671B"],
        reason:"Existing audit negative-test input; its assertion requires Mandarin text to be rejected."
      });
      text = text.replace(negativeFixture, "");
    }
    return cjk.test(text);
  });
  assert.deepEqual(found, [], "CJK found outside the original negative-test input");
  receipt.noCJKFiles = files;
});
if(label === "refactor-baseline") check("baselineApplicationSourcesUnchanged", ()=>{
  for(const name of ["index.html", "worker.mjs"])
    assert.equal(receipt.hashes.source[name], fixture.baseline.sourceSha256[name], name + " changed since capture");
});
check("uiReceiptFreshAndConsistent", ()=>{
  const file = absolute("ui-receipt.json");
  const ui = JSON.parse(fs.readFileSync(file, "utf8"));
  const suite = receipt.suites["ui-probe"];
  assert.ok(suite.ok, "UI suite failed");
  assert.ok(Date.parse(ui.waktu) >= Date.parse(suite.startedAt), "stale UI receipt");
  assert.ok(Date.parse(ui.waktu) <= Date.now(), "future UI receipt");
  assert.equal(path.resolve(ui.index), absolute("index.html"));
  assert.equal(ui.lulus, suite.passed);
  assert.equal(ui.gagal, 0);
  assert.equal(ui.hasil.length, ui.lulus);
  assert.ok(ui.hasil.every(item=>item.lulus === true));
  assert.deepEqual(ui.errors, []);
  receipt.uiReceipt = {path:file, sha256:sha256(file), passed:ui.lulus, failed:ui.gagal, writtenAt:ui.waktu};
});
check("suiteLogsStillMatchHashes", ()=>{
  for(const [name, digest] of Object.entries(receipt.hashes.logs)) assert.equal(sha256(absolute(name)), digest, name);
});
receipt.totalPassed = Object.values(receipt.suites).reduce((n, suite)=>n + (suite.passed || 0), 0);
receipt.totalFailed = Object.values(receipt.suites).reduce((n, suite)=>n + (suite.failed || 0), 0);
receipt.totalSkipped = Object.values(receipt.suites).reduce((n, suite)=>n + suite.skipped, 0);
receipt.allGreen = receipt.errors.length === 0 && Object.values(receipt.suites).every(suite=>suite.ok);
receipt.finishedAt = new Date().toISOString();
const receiptPath = absolute(label + "-receipt.json");
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
console.log("\n" + receipt.totalPassed + " passed, " + receipt.totalFailed + " failed, " + receipt.totalSkipped + " skipped; " + (receipt.allGreen ? "ALL FIVE GREEN" : "VERIFICATION FAILED"));
for(const error of receipt.errors) console.error(error);
console.log("Receipt: " + receiptPath);
process.exitCode = receipt.allGreen ? 0 : 1;
