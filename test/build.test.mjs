import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { builtinModules } from "node:module";
import { StringDecoder } from "node:string_decoder";
import { ast, inventory, sourceInventory, classicBundle, statementOrder } from "../scripts/build-ast.mjs";
import { CORE_BEGIN, CORE_END, STARTER_BEGIN, STARTER_END, starterFiles, starterDeclaration } from "../scripts/build-web.mjs";
import { buildWorker, buildHtml } from "../scripts/build.mjs";
import { browserArgs } from "./browser-process.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const sha = text => createHash("sha256").update(text).digest("hex");
const run = (args, cwd) => {
  const child = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 15000 });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return child.stdout;
};

const normalizedAst = node => JSON.parse(JSON.stringify(node, (key, value) =>
  ["start", "end", "loc", "raw"].includes(key) ? undefined : value));
const astHash = node => sha(JSON.stringify(normalizedAst(node)));

function workerPreservation() {
  const baseline = JSON.parse(read("test/worker-declarations.json"));
  const contract = JSON.parse(read("test/refactor-contract.json"));
  assert.equal(baseline.baselineSha256, contract.baseline.sourceSha256["worker.mjs"]);
  const modules = new Map(), declarations = new Map(), owners = new Map(), guards = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = dir + "/" + entry.name;
      if (entry.isDirectory()) walk(file);
      else {
        assert.ok(entry.isFile() && file.endsWith(".mjs"), file);
        const code = read(file);
        assert.ok(code.trimEnd().split("\n").length <= 250, file + " exceeds module budget");
        modules.set(file, ast(code));
      }
    }
  }
  walk("src/shared"); walk("src/worker");
  for (const [file, tree] of modules) for (const wrapper of tree.body) {
    const node = wrapper.type === "ExportNamedDeclaration" ? wrapper.declaration : wrapper;
    if (!node) continue;
    if (["FunctionDeclaration", "VariableDeclaration"].includes(node.type)) {
      const names = node.id ? [node.id.name] : node.declarations.map(d => d.id.name);
      const key = names.join(",");
      assert.ok(!declarations.has(key), "duplicate declaration: " + key);
      declarations.set(key, node);
      for (const name of names) { assert.ok(!owners.has(name), name); owners.set(name, file); }
    } else if (node.type !== "ImportDeclaration") {
      assert.equal(file, "src/worker/entry.mjs", "top-level effect outside entry: " + file);
      guards.push(node);
    }
  }
  assert.equal(guards.length, 1);
  assert.equal(astHash(guards[0]), baseline.entryGuardSha256);
  const expected = [...baseline.declarations.map(d => d.names.join(",")), ...baseline.commands.map(c => c.name)].sort();
  assert.deepEqual([...declarations.keys()].sort(), expected, "missing/extra declaration");
  const commands = new Map(baseline.commands.map(c => [c.name, c]));
  for (const c of commands.values()) {
    const node = declarations.get(c.name);
    assert.equal(node.type, "FunctionDeclaration");
    assert.equal(node.async, false); assert.equal(node.generator, false);
    assert.deepEqual(normalizedAst(node.params), c.params.map(name => ({ type: "Identifier", name })));
    assert.equal(astHash(node.body), c.bodySha256, c.name + " body changed");
  }
  // Inline only the approved whole command bodies, restoring the original main AST exactly.
  const main = normalizedAst(declarations.get("main"));
  const expanded = new Set();
  function commandBody(statement, mode) {
    if (statement?.type !== "ReturnStatement" || statement.argument?.type !== "CallExpression") return null;
    const call = statement.argument, c = commands.get(call.callee.name);
    if (!c) return null;
    assert.equal(c.mode, mode);
    assert.equal(call.optional, false);
    assert.deepEqual(call.arguments, c.params.map(name => ({ type: "Identifier", name })));
    assert.ok(!expanded.has(c.name)); expanded.add(c.name);
    return normalizedAst(declarations.get(c.name).body);
  }
  main.body.body = main.body.body.flatMap(statement => {
    if (statement.type === "IfStatement") {
      const body = commandBody(statement.consequent, "branch");
      if (body) statement.consequent = body;
    }
    const tail = commandBody(statement, "tail");
    return tail ? tail.body : [statement];
  });
  assert.deepEqual([...expanded].sort(), [...commands.keys()].sort());
  for (const d of baseline.declarations) {
    const key = d.names.join(","), node = declarations.get(key);
    assert.equal(node.kind || "function", d.kind, key);
    assert.equal(astHash(key === "main" ? main : node), d.sha256, key + " AST changed");
  }
  assert.ok(declarations.get("main").body.body.length < 45, "main must remain a dispatcher");
  const graph = new Map();
  for (const [file, tree] of modules) {
    const edges = [];
    for (const node of tree.body) {
      assert.notEqual(node.type, "ExportAllDeclaration", "no wildcard service barrels");
      if (!node.source) continue;
      const target = node.source.value;
      if (target.startsWith("node:")) {
        assert.equal(node.type, "ImportDeclaration");
        assert.ok(builtinModules.includes(target.slice(5)));
      } else {
        assert.ok(target.startsWith("."), "runtime dependency: " + target);
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
        assert.ok(modules.has(resolved), "source import outside worker/shared: " + target);
        edges.push(resolved);
        for (const s of node.specifiers) {
          assert.ok(["ImportSpecifier", "ExportSpecifier"].includes(s.type), "explicit named bindings required");
          const name = (s.imported || s.local).name;
          assert.equal((s.local || s.exported).name, name);
          assert.equal(owners.get(name), resolved, "wrong binding owner: " + name);
        }
      }
      assert.ok(!node.specifiers.some(s => s.type === "ImportNamespaceSpecifier"));
    }
    graph.set(file, edges);
  }
  const visited = new Set();
  function visit(file, stack = []) {
    assert.ok(!stack.includes(file), "module cycle: " + [...stack, file].join(" -> "));
    if (visited.has(file)) return;
    for (const next of graph.get(file)) visit(next, [...stack, file]);
    visited.add(file);
  }
  visit("src/worker/entry.mjs");
  assert.equal(visited.size, modules.size, "orphan handwritten module");
}

function workerFixture(worker) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-worker-dispatch-"));
  const file = path.join(dir, "worker.mjs"), ledger = path.join(dir, ".planforge");
  fs.writeFileSync(file, worker);
  fs.mkdirSync(ledger);
  const plan = { tasks: { tasks: [{ id: "T-001", title: "Fixture contract", ui: false,
    verification: 'node -e "process.exit(7)"', depends_on: [] }] } };
  fs.writeFileSync(path.join(ledger, "plan.json"), JSON.stringify(plan));
  fs.writeFileSync(path.join(ledger, "gates.json"), JSON.stringify({ agent: { name: "none", cmd: "" },
    hard: [], reviews: [], limits: { maxCalls: 60, maxCallsPerRun: 40, maxCostUsd: 0, autoCommit: false } }));
  const invoke = (args, input) => {
    const r = spawnSync(process.execPath, [file, ...args], { cwd: dir, encoding: "utf8", input, timeout: 15000 });
    assert.ifError(r.error); assert.equal(r.signal, null);
    return r;
  };
  return { dir, file, ledger, invoke };
}

export async function buildTests(t, ta) {
  const fixture = JSON.parse(read("test/web-bindings.json"));
  const html = read("index.html"), worker = read("worker.mjs");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const parts = {
    core: script.slice(script.indexOf(CORE_BEGIN) + CORE_BEGIN.length, script.indexOf(CORE_END)),
    app: script.slice(script.indexOf(CORE_END) + CORE_END.length)
  };
  for (const name of ["core", "app"]) t("build: " + name + " retains every baseline global name, kind and arity", () => {
    assert.deepEqual(sourceInventory(path.join(root, "src/web/" + name + ".mjs")), fixture[name]);
    assert.deepEqual(inventory(parts[name], "script"), fixture[name]);
  });
  t("build: top-level statements and declaration initializers retain their order", () => {
    for (const name of ["core", "app"])
      assert.deepEqual(statementOrder(parts[name]), statementOrder(read("src/web/" + name + ".mjs")));
    assert.deepEqual(inventory(script, "script"), [...fixture.core, ...fixture.app]);
    assert.ok(!ast(script, "script").body.some(n => n.directive === "use strict"));
  });
  const sandbox = vm.createContext({ TextEncoder });
  t("build: classic runtime globals retain lexical kinds, function names and lengths", () => {
    // Isolate declarations; the existing real-browser suites exercise all UI startup effects.
    const declarations = ast(script, "script").body.filter(n => /^(Variable|Function|Class)Declaration$/.test(n.type))
      .map(n => script.slice(n.start, n.end)).join("\n");
    vm.runInContext("globalThis.window = globalThis;\n" + declarations, sandbox, { timeout: 5000 });
    for (const binding of [...fixture.core, ...fixture.app]) {
      const { name, kind, arity } = binding;
      assert.equal(vm.runInContext("Object.hasOwn(window," + JSON.stringify(name) + ")", sandbox), kind === "function" || kind === "var", name);
      if (arity !== null) {
        assert.equal(vm.runInContext(name + ".length", sandbox), arity, name);
        assert.equal(vm.runInContext(name + ".name", sandbox), name);
      }
      if (kind === "const") assert.throws(() => vm.runInContext(name + " = " + name, sandbox), /constant variable/i, name);
      if (kind === "let") vm.runInContext(name + " = " + name, sandbox);
    }
  });
  t("build: window.callModel replacement updates the classic global binding", () => {
    assert.equal(vm.runInContext(`(() => {
      const original = callModel;
      window.callModel = function replacement() { return "replaced"; };
      const updated = callModel === window.callModel && callModel() === "replaced";
      window.callModel = original;
      return updated;
    })()`, sandbox), true);
  });
  t("build: missing exports, aliases, helpers and global collisions fail closed", () => {
    const bindings = [{ name: "value", kind: "const", arity: null }];
    assert.throws(() => classicBundle("var renamed = 1; export { renamed as value };", bindings), /renamed/);
    assert.throws(() => classicBundle("var value = 1; export {};", bindings), /exports/);
    assert.throws(() => classicBundle("var helper = 0; var value = 1; export { value };", bindings), /helper/);
    assert.throws(() => classicBundle('"use strict"; var value = 1; export { value };', bindings), /strict/);
    assert.throws(() => inventory("const value = 1; const value = 2;", "script"), /declared/);
  });
  t("build: CSS and all markup outside the script/embed slots are byte-identical", () => {
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.equal(css, read("src/web/styles.css"));
    assert.equal(sha(css), fixture.stylesSha256);
    const template = html.replace(/<style>[\s\S]*?<\/style>/, "<style>{{PF_STYLES}}</style>")
      .replace(/<script>[\s\S]*?<\/script>/, "<script>{{PF_SCRIPT}}</script>")
      .replace(/<!-- PF-WORKER-BEGIN -->[\s\S]*?<!-- PF-WORKER-END -->/, "<!-- PF-WORKER-BEGIN -->{{PF_WORKER}}<!-- PF-WORKER-END -->");
    assert.equal(template, read("src/web/page.html"));
    assert.equal(sha(template), fixture.markupSha256);
    assert.equal((html.match(/<svg/g) || []).length, 2);
  });
  t("build: worker declarations and decomposed main preserve baseline AST; no handwritten starter data", () => {
    workerPreservation();
    const core = read("src/web/core.mjs");
    assert.match(core, /import \{ STARTER_FILES \} from "planforge:starter";/);
    assert.doesNotMatch(core, /(?:const|let|var) STARTER_FILES\s*=/);
  });
  t("build: emitted worker is standalone ESM and SELF_FILE resolves to the copied artifact", () => {
    assert.ok(worker.startsWith("#!/usr/bin/env node\n"));
    const tree = ast(worker);
    for (const node of tree.body.filter(n => n.type === "ImportDeclaration"))
      assert.ok(node.source.value.startsWith("node:") || builtinModules.includes(node.source.value));
    const self = tree.body.flatMap(n => n.declarations || []).find(d => d.id.name === "SELF_FILE");
    assert.equal(worker.slice(self.init.start, self.init.end), "fileURLToPath(import.meta.url)");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-build-standalone-"));
    try {
      const file = path.join(dir, "worker.mjs");
      fs.writeFileSync(file, worker);
      run(["--check", file], dir);
      const probe = `import fs from "node:fs";
        const w = await import(${JSON.stringify(pathToFileURL(file).href)});
        if (typeof w.main !== "function" || w.main.length !== 1 || w.buildLama()) throw Error("invalid copied worker");
        fs.appendFileSync(${JSON.stringify(file)}, "\\n// copied artifact probe\\n");
        if (!w.buildLama()) throw Error("SELF_FILE did not track copied worker");
        process.stdout.write("standalone-ok");`;
      assert.equal(run(["--input-type=module", "-e", probe], dir), "standalone-ok");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  t("build: worker JSON round-trips exactly with no raw less-than or template slots", () => {
    const marker = '<script type="application/json" id="pf-worker-src">';
    assert.equal(html.split(marker).length, 2);
    const payload = html.slice(html.indexOf(marker) + marker.length).split("</script>")[0];
    assert.equal(payload, JSON.stringify(worker).replace(/</g, "\\u003c"));
    assert.equal(JSON.parse(payload), worker);
    assert.ok(!payload.includes("<"));
    assert.doesNotMatch(html, /\{\{PF_[A-Z_]+\}\}/);
  });
  t("build: virtual starter exclusions match the legacy walker and JSON cannot close a script", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-build-starter-"));
    try {
      const input = { "keep.txt": "</ScRiPt><script>probe</script>", "nested/keep.txt": "keep" };
      for (const [name, text] of Object.entries({ ...input, "node_modules/no": "skip", ".git/no": "skip", ".next/no": "skip",
        "nested/node_modules/no": "skip", "nested/.git/no": "skip", "nested/.next/no": "skip",
        "package-lock.json": "skip", ".starter-smoke.log": "skip", "nested/package-lock.json": "skip", "nested/.starter-smoke.log": "skip" })) {
        const file = path.join(dir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
      }
      assert.deepEqual(starterFiles(dir), input);
      const declaration = starterDeclaration(input);
      assert.doesNotMatch(declaration, /<\/script/i);
      assert.deepEqual(new Function(declaration + ";return STARTER_FILES;")(), input);
      const unsorted = { "z.txt":"z", "2.txt":"two", "10.txt":"ten", "a.txt":"a" };
      assert.equal(starterDeclaration(unsorted), 'const STARTER_FILES = {"10.txt":"ten","2.txt":"two","a.txt":"a","z.txt":"z"};');
      const actual = parts.core.slice(parts.core.indexOf(STARTER_BEGIN) + STARTER_BEGIN.length, parts.core.indexOf(STARTER_END));
      assert.equal(actual, "\n" + starterDeclaration(starterFiles(path.join(root, "starter"))) + "\n");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  t("browser: Linux root and CI launches disable Chromium sandbox; desktop launch keeps it enabled", () => {
    const rootArgs = browserArgs("profile", { platform:"linux", uid:0, ci:false, container:false });
    assert.ok(rootArgs.includes("--no-sandbox"));
    assert.ok(rootArgs.includes("--disable-setuid-sandbox"));
    const ciArgs = browserArgs("profile", { platform:"linux", uid:1000, ci:true, container:false });
    assert.ok(ciArgs.includes("--no-sandbox"));
    assert.ok(ciArgs.includes("--disable-setuid-sandbox"));
    const desktopArgs = browserArgs("profile", { platform:"linux", uid:1000, ci:false, container:false });
    assert.ok(!desktopArgs.includes("--no-sandbox"));
    assert.ok(!desktopArgs.includes("--disable-setuid-sandbox"));
  });
  t("build: both legacy embed commands are byte-idempotent in a standalone copied project", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-build-embed-"));
    try {
      fs.writeFileSync(path.join(dir, "worker.mjs"), worker);
      fs.writeFileSync(path.join(dir, "index.html"), html);
      const files = { "scripts/embed-starter.mjs": read("scripts/embed-starter.mjs"),
        "scripts/lib/starter-tree.mjs": read("scripts/lib/starter-tree.mjs"),
        ...Object.fromEntries(Object.entries(starterFiles(path.join(root, "starter"))).map(([name, text]) => ["starter/" + name, text])) };
      for (const [name, text] of Object.entries(files)) {
        const file = path.join(dir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
      }
      for (let i = 0; i < 2; i++) {
        run([path.join(dir, "scripts/embed-starter.mjs")], dir);
        assert.equal(fs.readFileSync(path.join(dir, "index.html"), "utf8"), html);
        run([path.join(dir, "worker.mjs"), "embed"], dir);
        assert.equal(fs.readFileSync(path.join(dir, "index.html"), "utf8"), html);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  t("worker dispatch: early commands precede root/context loading and preserve exit codes", () => {
    const { dir, file, ledger, invoke } = workerFixture(worker);
    try {
      const help = invoke([]);
      assert.equal(help.status, 0);
      assert.match(help.stdout, /Penggunaan: node worker\.mjs <perintah> \[opsi\]/);
      assert.match(help.stdout, /Perintah: .*run.*verify.*init.*mcp/);
      assert.match(help.stdout, /node worker\.mjs run --dry-run/);
      assert.equal(help.stderr, "");
      const initialized = invoke(["init", "--agent", "none"]);
      assert.equal(initialized.status, 0);
      assert.ok(initialized.stdout.includes("ditulis " + path.join(dir, ".planforge", "gates.json").replace(/\\/g, "/")));
      assert.ok(!initialized.stdout.split("ditulis ")[1].split(" —")[0].includes("\\"));
      fs.rmSync(path.join(ledger, "plan.json"));
      const missing = path.join(dir, "absent");
      assert.equal(invoke(["init", "--agent", "none", "--dir", missing]).status, 0);
      const browser = invoke(["__browser", "--dir", missing], "not JSON");
      assert.equal(browser.status, 0);
      assert.equal(browser.stdout, JSON.stringify({ ok: false, kurang: ["spec perilaku tidak terbaca di stdin"], hasil: [] }) + "\n");
      assert.equal(browser.stderr, "");
      const htmlFile = path.join(dir, "index.html");
      fs.writeFileSync(htmlFile, "<!-- PF-WORKER-BEGIN --><!-- PF-WORKER-END -->");
      assert.equal(invoke(["embed", "--dir", missing]).status, 0);
      assert.ok(fs.readFileSync(htmlFile, "utf8").includes(JSON.stringify(worker).replace(/</g, "\\u003c")));
      const noRoot = invoke(["status", "--dir", missing]);
      assert.equal(noRoot.status, 1); assert.match(noRoot.stderr, /tidak ada .planforge\/plan.json/);
      fs.writeFileSync(path.join(ledger, "plan.json"), "null");
      const setup = invoke(["setup-env", "--dir", dir]);
      assert.equal(setup.status, 1); assert.match(setup.stdout, /\.env.example tidak ada/);
      const environment = invoke(["doctor", "--environment", "--dir", dir]);
      assert.equal(environment.status, 0); assert.match(environment.stdout, /package.json belum ada/);
      assert.equal(environment.stderr, "");
      const status = invoke(["status", "--dir", dir]);
      assert.notEqual(status.status, 0); assert.match(status.stderr, /plan.json tidak valid/);
      assert.equal(fs.existsSync(path.join(ledger, "state.json")), false);
      assert.equal(fs.readFileSync(file, "utf8"), worker);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  t("worker dispatch: overrides, aliases, dry-run and failing verification retain ledger semantics", () => {
    const { dir, ledger, invoke } = workerFixture(worker);
    const stateFile = path.join(ledger, "state.json");
    try {
      const initial = JSON.stringify({ calls: 7, doneTasks: 0, tasks: {}, history: [] });
      fs.writeFileSync(stateFile, initial);
      const status = invoke(["status", "--dir", dir, "--agent", "workbuddy", "--auto-budget",
        "--max-calls", "11", "--max-calls-per-run", "0", "--max-cost", "0", "--no-gates"]);
      assert.equal(status.status, 0);
      assert.match(status.stdout, /auto-budget:/); assert.match(status.stdout, /call 7\/11 · agen workbuddy/);
      assert.match(status.stdout, /maxCallsPerRun 0 muat/); assert.match(status.stdout, /plafon biaya \$0/);
      assert.equal(fs.readFileSync(stateFile, "utf8"), initial);
      const failState = JSON.parse(initial);
      failState.consecFails = 3;
      failState.tasks = { "T-001": { status: "gagal", tries: 2, note: "fixture", finishedAt: "fixture" } };
      fs.writeFileSync(stateFile, JSON.stringify(failState));
      const resetOne = invoke(["reset", "T-001", "--dir", dir]);
      assert.equal(resetOne.status, 0);
      let resetState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert.equal(resetState.consecFails, 0);
      assert.equal(resetState.tasks["T-001"].status, "belum mulai");
      fs.writeFileSync(stateFile, JSON.stringify(Object.assign(resetState, { consecFails: 3 })));
      const resetAll = invoke(["reset", "--dir", dir]);
      assert.equal(resetAll.status, 0);
      resetState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert.equal(resetState.consecFails, 0);
      assert.equal(resetState.tasks["T-001"].status, "belum mulai");
      fs.writeFileSync(stateFile, initial);
      const dry = invoke(["run", "--dir", dir, "--dry-run", "--no-gates"]);
      assert.equal(dry.status, 0); assert.match(dry.stdout, /selesai dry-run: 1 prompt/);
      assert.equal(fs.readFileSync(stateFile, "utf8"), initial);
      assert.equal(invoke(["connect", "--list", "--dir", dir]).status, 0);
      assert.equal(invoke(["connect", "absent", "--dir", dir]).status, 1);
      assert.equal(invoke(["pin", "--dir", dir]).status, 1);
      const build = invoke(["build", "--dir", dir]);
      assert.equal(build.status, 0); assert.ok(build.stdout.includes(dir.replace(/\\/g, "/") + "/worker.mjs"));
      assert.equal(invoke(["unknown", "--dir", dir]).status, 1);
      for (const alias of ["audit", "audit-plan"]) {
        const audit = invoke([alias, "--dir", dir]);
        assert.equal(audit.status, 0); assert.match(audit.stdout, /audit rencana · 1 task · 0 panggilan agen/);
        assert.ok(fs.existsSync(path.join(ledger, "PLAN_AUDIT.md")));
      }
      const taskSebelumVerify = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      taskSebelumVerify.tasks["T-001"] = { status: "sedang" };
      fs.writeFileSync(stateFile, JSON.stringify(taskSebelumVerify));
      for (const alias of ["verify", "verifikasi"]) {
        assert.equal(invoke([alias, "--dir", dir]).stderr, "pakai: node worker.mjs verify T-002\n");
        const verify = invoke([alias, "T-001", "--dir", dir]);
        assert.equal(verify.status, 1); assert.match(verify.stdout, /verification gagal \(exit 7\)/);
        const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        assert.equal(state.tasks["T-001"].status, "gagal"); assert.equal(state.calls, 7);
      }
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      state.giliran = { id: "GILIRAN-1", from: "T-001", to: "T-001", gagal: "fixture", diserahkan: "fixture" };
      state.fullHalt = { kenapa: "fixture" };
      fs.writeFileSync(stateFile, JSON.stringify(state));
      assert.equal(invoke(["giliran", "--ulang", "--dir", dir]).status, 0);
      const reopened = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert.equal(reopened.giliran.gagal, undefined); assert.equal(reopened.giliran.diserahkan, undefined);
      assert.equal(reopened.fullHalt, undefined);
      assert.equal(invoke(["giliran", "--lewati", "--dir", dir]).status, 0);
      const skipped = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert.equal(skipped.giliran, undefined); assert.equal(skipped.lastFullMark, "T-001");
      assert.equal(skipped.history.at(-1).out, "DILEWATI manusia");
      assert.equal(skipped.calls, 7);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await ta("worker stdio: fragmented UTF-8/newlines, batching and original MCP argv keep stdout protocol-only", async () => {
    const { dir, file, ledger } = workerFixture(worker);
    // A fixture-only acknowledgement forces distinct stdin data events without timing sleeps.
    const bootstrap = `import { main } from ${JSON.stringify(pathToFileURL(file).href)};
      process.argv = [process.execPath, ${JSON.stringify(file)}, "mcp", "--dir", ${JSON.stringify(dir)}, "--no-gates", "--max-calls-per-run", "0"];
      let received = 0;
      process.stdin.on("data", d => { const count = received += d.length; setImmediate(() => process.stderr.write("fixture-read:" + count + "\\n")); });
      const code = main(["mcp", "--dir", ${JSON.stringify(path.join(dir, "wrong-root"))}]);
      if (code) process.exitCode = code;
      process.stderr.write("fixture-ready\\n");`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", failure = null, closed = false, exit, signal, wake = () => {};
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", d => { stdout += d; wake(); });
    child.stderr.on("data", d => { stderr += d; wake(); });
    child.on("error", e => { failure = e; wake(); });
    child.stdin.on("error", e => { failure = e; wake(); });
    const closing = new Promise(resolve => child.on("close", (code, sig) => { closed = true; exit = code; signal = sig; wake(); resolve(); }));
    const waitFor = predicate => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { wake = () => {}; reject(new Error("MCP fixture timeout: " + stderr)); }, 10000);
      wake = () => {
        if (failure || predicate() || closed) {
          clearTimeout(timer); wake = () => {};
          if (failure) reject(failure);
          else if (predicate()) resolve();
          else reject(new Error("MCP exited before fixture response: " + stderr));
        }
      };
      wake();
    });
    const decoder = new StringDecoder("utf8");
    let characters = 0;
    const send = async bytes => {
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      characters += decoder.write(buffer).length;
      child.stdin.write(buffer);
      await waitFor(() => stderr.includes("fixture-read:" + characters + "\n"));
    };
    const request = (id, method, params) => JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
    try {
      await waitFor(() => stderr.includes("fixture-ready\n"));
      const initialize = request(1, "initialize");
      await send(initialize.slice(0, 17)); assert.equal(stdout, "");
      await send(initialize.slice(17) + "\n\nnot-json\n" + request(undefined, "notifications/initialized") + "\n");
      await waitFor(() => stdout.endsWith("\n"));
      assert.equal(stdout.trim().split("\n").length, 1);
      await send(request(2, "tools/list") + "\r\n" + request(3, "tools/call", { name: "next_task" }) + "\n");
      await waitFor(() => stdout.trim().split("\n").length === 3);
      const unicode = Buffer.from(request(4, "méthode-inconnue") + "\n");
      const split = unicode.indexOf(Buffer.from("é")) + 1;
      await send(unicode.subarray(0, split));
      assert.equal(stdout.trim().split("\n").length, 3);
      await send(unicode.subarray(split));
      await waitFor(() => stdout.trim().split("\n").length === 4);
      await send(request(5, "initialize"));
      child.stdin.end(); await waitFor(() => closed);
      assert.equal(exit, 0); assert.equal(signal, null); assert.equal(stdout.endsWith("\n"), true);
      const messages = stdout.trimEnd().split("\n").map(line => JSON.parse(line));
      assert.deepEqual(messages.map(m => m.id), [1, 2, 3, 4]);
      assert.equal(messages[0].result.protocolVersion, "2024-11-05");
      assert.deepEqual(messages[1].result.tools, JSON.parse(read("test/refactor-contract.json")).worker.MCP_TOOLS);
      assert.match(messages[2].result.content[0].text, /BERHENTI.*maxCallsPerRun 0/s);
      assert.deepEqual(messages[3].error, { code: -32601, message: "method tidak didukung: méthode-inconnue" });
      assert.match(stderr, /next_task DITOLAK/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(ledger, "state.json"), "utf8")).calls, 0);
    } finally {
      if (!closed) child.kill();
      await closing;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  await ta("build: two in-memory builds reproduce both artifacts exactly without source writes", async () => {
    for (let i = 0; i < 2; i++) {
      const emitted = await buildWorker(root);
      assert.equal(emitted, worker);
      assert.equal(await buildHtml(root, emitted), html);
    }
  });
  t("build: dependencies are pinned, dev-only and lockfile-backed", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    assert.equal(pkg.type, "module");
    assert.equal(pkg.dependencies, undefined);
    assert.deepEqual(pkg.devDependencies, { acorn: "8.19.0", esbuild: "0.28.2" });
    assert.deepEqual(lock.packages[""].devDependencies, pkg.devDependencies);
    for (const [name, meta] of Object.entries(lock.packages)) if (name) assert.equal(meta.dev, true, name);
    assert.equal(lock.packages["node_modules/acorn"].version, "8.19.0");
    assert.equal(lock.packages["node_modules/esbuild"].version, "0.28.2");
  });
}
