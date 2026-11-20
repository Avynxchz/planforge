import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parse } from "acorn";

export const ast = (code, sourceType = "module") => parse(code, { ecmaVersion: "latest", sourceType });

function names(pattern) {
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "RestElement") return names(pattern.argument);
  if (pattern.type === "AssignmentPattern") return names(pattern.left);
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(p => p ? names(p) : []);
  if (pattern.type === "ObjectPattern") return pattern.properties.flatMap(p => names(p.value || p.argument));
  throw new Error("Unsupported binding: " + pattern.type);
}

function arity(node) {
  if (!node || !/^(Function|ArrowFunction)/.test(node.type)) return null;
  const stop = node.params.findIndex(p => p.type === "AssignmentPattern" || p.type === "RestElement");
  return stop < 0 ? node.params.length : stop;
}

function declarationNames(node) {
  if (node.type === "VariableDeclaration") return node.declarations.flatMap(d => names(d.id));
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") return node.id ? [node.id.name] : [];
  return [];
}

export function inventory(code, sourceType = "module", resolveImport = null) {
  const result = [];
  for (const node of ast(code, sourceType).body) {
    if (node.type === "ImportDeclaration") {
      if (node.source.value === "planforge:starter") {
        // The starter blob replaces the original first const, not a runtime module.
        assert.equal(node.specifiers.length, 1);
        const spec = node.specifiers[0];
        assert.equal(spec.type, "ImportSpecifier");
        assert.equal(spec.imported.name, "STARTER_FILES");
        assert.equal(spec.local.name, spec.imported.name);
        result.push({ name: spec.local.name, kind: "const", arity: null });
      } else {
        assert.equal(sourceType, "module", "Classic browser scripts cannot import modules");
        assert.ok(resolveImport, "Unexpected browser source import: " + node.source.value);
        for (const spec of node.specifiers) {
          assert.equal(spec.type, "ImportSpecifier", "Only named browser imports are allowed");
          assert.equal(spec.local.name, spec.imported.name, "Browser imports cannot alias a classic global");
          const meta = resolveImport(node.source.value, spec.imported.name);
          result.push({ name: spec.local.name, kind: meta.kind, arity: meta.arity });
        }
      }
    } else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations)
        for (const name of names(decl.id)) result.push({ name, kind: node.kind, arity: arity(decl.init) });
    } else if (["FunctionDeclaration", "ClassDeclaration"].includes(node.type)) {
      result.push({ name: node.id.name, kind: node.type === "FunctionDeclaration" ? "function" : "class", arity: arity(node) });
    } else assert.ok(!node.type.startsWith("Export"), "Browser exports are generated, not handwritten");
  }
  assert.equal(new Set(result.map(b => b.name)).size, result.length, "Duplicate top-level binding");
  return result;
}

const exportsCache = new Map();

export function exportedBindings(file, stack = []) {
  const key = path.resolve(file);
  if (exportsCache.has(key)) return exportsCache.get(key);
  assert.ok(!stack.includes(key), "Cyclic browser re-export: " + [...stack, key].join(" -> "));
  const result = new Map();
  for (const node of ast(fs.readFileSync(key, "utf8")).body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    const decl = node.declaration;
    if (decl) {
      if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
        result.set(decl.id.name, { kind: decl.type === "FunctionDeclaration" ? "function" : "class", arity: arity(decl) });
      } else if (decl.type === "VariableDeclaration") {
        for (const d of decl.declarations)
          for (const name of names(d.id)) result.set(name, { kind: decl.kind, arity: arity(d.init) });
      }
      continue;
    }
    if (!node.source) continue;
    const target = path.resolve(path.dirname(key), node.source.value);
    const reexported = exportedBindings(target, [...stack, key]);
    for (const spec of node.specifiers) {
      assert.equal(spec.type, "ExportSpecifier", "Only named re-exports are allowed");
      const meta = reexported.get(spec.local.name);
      assert.ok(meta, "Missing re-exported binding " + spec.local.name + " in " + node.source.value);
      result.set(spec.exported.name, meta);
    }
  }
  exportsCache.set(key, result);
  return result;
}

// Source inventory follows relative imports so imported shared helpers keep their captured kind/arity.
export function sourceInventory(file) {
  return inventory(fs.readFileSync(file, "utf8"), "module", (spec, name) => {
    assert.ok(spec.startsWith("."), "Unexpected browser source import: " + spec);
    const target = path.resolve(path.dirname(file), spec);
    const meta = exportedBindings(target).get(name);
    assert.ok(meta, "Missing exported binding " + name + " in " + spec);
    return meta;
  });
}

export function replaceRanges(code, edits) {
  let right = code.length;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    assert.ok(end <= right && start <= end, "Overlapping AST edits");
    code = code.slice(0, start) + text + code.slice(end);
    right = start;
  }
  return code;
}

// Rebuild the bundle in source statement order: esbuild hoists imported modules, but classic
// globals must appear exactly where the handwritten declarations used to sit.
function alignBundleToSource(code, source) {
  const bundleBody = ast(code).body;
  const sourceBody = ast(source).body;
  const terminal = bundleBody.at(-1);
  assert.equal(terminal.type, "ExportNamedDeclaration", "Missing terminal exports");
  const statements = bundleBody.slice(0, -1);
  const byName = new Map();
  for (const statement of statements)
    for (const name of declarationNames(statement)) {
      assert.ok(!byName.has(name), "Duplicate bundled binding: " + name);
      byName.set(name, statement);
    }
  const claimed = new Set();
  for (const node of sourceBody) {
    if (node.type !== "ImportDeclaration") continue;
    for (const spec of node.specifiers) {
      assert.equal(spec.type, "ImportSpecifier", "Only named browser imports are allowed");
      const statement = byName.get(spec.local.name);
      assert.ok(statement, "Bundler dropped imported binding: " + spec.local.name);
      claimed.add(statement);
    }
  }
  const entryStatements = statements.filter(statement => !claimed.has(statement));
  const emitted = new Set();
  const chunks = [];
  let cursor = 0;
  for (const node of sourceBody) {
    const targets = [];
    if (node.type === "ImportDeclaration") {
      for (const spec of node.specifiers) targets.push(byName.get(spec.local.name));
    } else {
      const actual = entryStatements[cursor++];
      assert.ok(actual, "Bundler dropped a top-level statement");
      assert.equal(actual.type, node.type, "Bundled statement type changed");
      const expected = declarationNames(node);
      if (expected.length) assert.deepEqual(declarationNames(actual), expected, "Bundled declaration names changed");
      targets.push(actual);
    }
    for (const target of targets) {
      if (emitted.has(target)) continue;
      emitted.add(target);
      chunks.push(code.slice(target.start, target.end));
    }
  }
  assert.equal(cursor, entryStatements.length, "Unexpected bundled statements");
  assert.equal(emitted.size, statements.length, "Bundler helper declaration left unmapped");
  return chunks.join("\n") + "\n" + code.slice(terminal.start);
}

export function classicBundle(code, bindings, sourceCode = null) {
  if (sourceCode) code = alignBundleToSource(code, sourceCode);
  const body = ast(code).body;
  const terminal = body.at(-1);
  assert.equal(terminal.type, "ExportNamedDeclaration", "Missing terminal exports");
  assert.equal(terminal.declaration, null);
  assert.equal(terminal.source, null);
  const exported = terminal.specifiers.map(spec => {
    assert.equal(spec.local.name, spec.exported.name, "esbuild renamed a classic global");
    return spec.local.name;
  });
  assert.deepEqual(exported.sort(), bindings.map(b => b.name).sort(), "Missing/extra exports");
  const kinds = new Map(bindings.map(b => [b.name, b.kind]));
  const edits = [{ start: terminal.start, end: terminal.end, text: "" }];
  for (const node of body.slice(0, -1)) {
    assert.ok(!/^(Import|Export)/.test(node.type), "Unresolved browser module syntax");
    assert.notEqual(node.directive, "use strict", "Classic script must not become strict");
    if (node.type !== "VariableDeclaration") continue;
    const original = [...new Set(node.declarations.flatMap(d => names(d.id)).map(name => kinds.get(name)))];
    assert.equal(original.length, 1, "Bundler merged different declaration kinds");
    assert.ok(["const", "let", "var"].includes(original[0]), "Unexpected generated helper");
    edits.push({ start: node.start, end: node.start + node.kind.length, text: original[0] });
  }
  const classic = replaceRanges(code, edits);
  assert.deepEqual(inventory(classic, "script"), bindings, "Global names, kinds, arities or order changed");
  return classic;
}

// Flatten top-level statements into binding order plus non-declaration statements. Grouping is
// irrelevant once a bundle is produced, but the order of bindings and side effects must not move.
export function statementOrder(code) {
  const result = [];
  for (const node of ast(code).body) {
    if (node.type === "ImportDeclaration") {
      for (const spec of node.specifiers) result.push(["binding", spec.local.name]);
    } else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations)
        for (const name of names(decl.id)) result.push(["binding", name]);
    } else if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
      result.push(["binding", node.id.name]);
    } else if (node.type === "ExportNamedDeclaration" && !node.declaration) {
      continue;
    } else {
      result.push(["statement", node.type, node.expression?.type || null]);
    }
  }
  return result;
}
