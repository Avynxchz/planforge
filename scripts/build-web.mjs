import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { ast, inventory, sourceInventory, classicBundle, statementOrder, replaceRanges, exportedBindings } from "./build-ast.mjs";
import { starterFiles, starterDeclaration } from "./lib/starter-tree.mjs";

export { starterFiles, starterDeclaration };

export const CORE_BEGIN = "/* ===================== CORE-BEGIN ===================== */";
export const CORE_END = "/* ===================== CORE-END ===================== */";
export const STARTER_BEGIN = "/* PF-STARTER-BEGIN */";
export const STARTER_END = "/* PF-STARTER-END */";

// Browser entries may only reach their own folder and the shared modules. Node builtins and
// worker/server modules would either fail at runtime or smuggle non-browser logic into the page.
function assertBrowserImports(source, file, root) {
  const webDir = path.join(root, "src", "web") + path.sep;
  const sharedDir = path.join(root, "src", "shared") + path.sep;
  for (const node of ast(source).body) {
    if (!node.source) continue;
    const spec = node.source.value;
    if (spec === "planforge:starter") {
      assert.equal(node.type, "ImportDeclaration", "Starter blob is import-only");
      continue;
    }
    assert.ok(!spec.startsWith("node:") && !builtinModules.includes(spec), "Node module import is not valid in the browser: " + spec);
    assert.ok(spec.startsWith("."), "Browser import must be relative or planforge:starter: " + spec);
    assert.ok(spec.endsWith(".mjs"), "Browser import must target an .mjs module: " + spec);
    const target = path.resolve(path.dirname(file), spec);
    assert.ok(target.startsWith(webDir) || target.startsWith(sharedDir), "Browser import escapes src/web and src/shared: " + spec);
    assert.ok(!target.startsWith(path.join(root, "src", "worker") + path.sep), "Browser code may not import worker modules: " + spec);
  }
}

// Core modules are emitted first into the same classic-script scope, so an app-to-core import is a
// declaration of intent for readers and validators, not a runtime edge. Leaving it for esbuild
// would duplicate every core module inside the app bundle, so strip it after proving that each
// imported name really is exported by the named core module (re-export chains included).
export function stripCoreImports(source, file, root) {
  const appDir = path.join(root, "src", "web", "app") + path.sep;
  const coreDir = path.join(root, "src", "web", "core") + path.sep;
  const coreEntry = path.join(root, "src", "web", "core.mjs");
  if (!path.resolve(file).startsWith(appDir)) return source;
  const edits = [];
  for (const node of ast(source).body) {
    if (node.type !== "ImportDeclaration" || !node.source.value.startsWith(".")) continue;
    const target = path.resolve(path.dirname(file), node.source.value);
    assert.notEqual(target, coreEntry, "App modules must import a concrete core module, not the core entry: " + node.source.value);
    if (!target.startsWith(coreDir)) continue;
    assert.ok(fs.existsSync(target), "Missing core module: " + node.source.value);
    const available = exportedBindings(target);
    for (const spec of node.specifiers) {
      assert.equal(spec.type, "ImportSpecifier", "Core imports must be named: " + node.source.value);
      assert.equal(spec.local.name, spec.imported.name, "Core imports cannot alias: " + spec.imported.name);
      assert.ok(available.has(spec.imported.name), "Unknown core binding " + spec.imported.name + " in " + node.source.value);
    }
    edits.push({ start: node.start, end: node.end, text: "" });
  }
  return edits.length ? replaceRanges(source, edits) : source;
}

export async function buildWeb(root) {
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "test/web-bindings.json"), "utf8"));
  const declaration = starterDeclaration(starterFiles(path.join(root, "starter")));
  const outputs = {};
  for (const name of ["core", "app"]) {
    const entry = path.join(root, "src/web/" + name + ".mjs");
    const source = fs.readFileSync(entry, "utf8");
    const bindings = sourceInventory(entry);
    assert.deepEqual(bindings, baseline[name], name + " source globals differ from baseline");
    const result = await build({
      absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
      platform: "browser", format: "esm", target: "esnext", treeShaking: false,
      minify: false, splitting: false, keepNames: false, charset: "utf8", legalComments: "none",
      plugins: [{
        name: "classic-entry-and-starter",
        setup(builder) {
          builder.onResolve({ filter: /^planforge:starter$/ }, () => ({ path: "starter", namespace: "pf-starter" }));
          builder.onLoad({ filter: /.*/, namespace: "pf-starter" }, () => ({ contents: "export " + declaration, loader: "js" }));
          builder.onLoad({ filter: /\.mjs$/ }, args => {
            const original = fs.readFileSync(args.path, "utf8");
            assertBrowserImports(original, args.path, root);
            let contents = stripCoreImports(original, args.path, root);
            const isEntry = path.resolve(args.path) === path.resolve(entry);
            if (isEntry) contents += "\nexport { " + bindings.map(b => b.name).join(", ") + " };\n";
            return { contents, loader: "js" };
          });
        }
      }]
    });
    let code = classicBundle(result.outputFiles[0].text, bindings, source);
    assert.deepEqual(statementOrder(code), statementOrder(source), name + " top-level execution order changed");
    if (name === "core") {
      const nodes = ast(code, "script").body.filter(n => n.type === "VariableDeclaration" && n.declarations.some(d => d.id.name === "STARTER_FILES"));
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].declarations.length, 1);
      // Canonical JSON keeps the existing embed-starter tool byte-idempotent.
      code = replaceRanges(code, [{ start: nodes[0].start, end: nodes[0].end,
        text: STARTER_BEGIN + "\n" + declaration + "\n" + STARTER_END }]);
    }
    assert.doesNotMatch(code, /<\/script/i, "Raw closing script tag in browser output");
    outputs[name] = code;
  }
  // Parsing the combined classic script also rejects lexical collisions across the two bundles.
  const all = inventory(outputs.core + "\n" + outputs.app, "script");
  assert.deepEqual(all, [...baseline.core, ...baseline.app], "Core/UI/helper global collision");
  return "\n" + CORE_BEGIN + "\n" + outputs.core + CORE_END + "\n" + outputs.app;
}
