import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { builtinModules } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { buildWeb } from "./build-web.mjs";

export async function buildWorker(root) {
  const result = await build({
    absWorkingDir: root, entryPoints: ["src/worker/entry.mjs"], outfile: "worker.mjs",
    bundle: true, write: false, platform: "node", format: "esm", target: "esnext",
    treeShaking: false, minify: false, splitting: false, keepNames: false,
    charset: "utf8", legalComments: "none", external: [...builtinModules, "node:*"], metafile: true
  });
  assert.equal(result.outputFiles.length, 1, "Worker must stay standalone");
  const worker = result.outputFiles[0].text;
  assert.ok(worker.startsWith("#!/usr/bin/env node\n"), "Worker shebang lost");
  for (const output of Object.values(result.metafile.outputs))
    for (const item of output.imports) assert.ok(item.external && (item.path.startsWith("node:") || builtinModules.includes(item.path)), "Runtime dependency: " + item.path);
  return worker;
}

export async function buildHtml(root, worker) {
  const read = name => fs.readFileSync(path.join(root, name), "utf8");
  const script = await buildWeb(root);
  const styles = read("src/web/styles.css");
  let html = read("src/web/page.html");
  const workerBlock = "\n" + '<script type="application/json" id="pf-worker-src">' +
    JSON.stringify(worker).replace(/</g, "\\u003c") + "</script>\n";
  for (const [token, value] of [["{{PF_STYLES}}", styles], ["{{PF_SCRIPT}}", script], ["{{PF_WORKER}}", workerBlock]]) {
    assert.equal(html.split(token).length, 2, "Missing or duplicate template slot: " + token);
    html = html.replace(token, () => value);
  }
  assert.doesNotMatch(html, /\{\{PF_[A-Z_]+\}\}/, "Unsubstituted template slot");
  return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const worker = await buildWorker(root);
  // Emit first: both the page and the legacy embed command read the distributed worker.
  fs.writeFileSync(path.join(root, "worker.mjs"), worker);
  const html = await buildHtml(root, fs.readFileSync(path.join(root, "worker.mjs"), "utf8"));
  fs.writeFileSync(path.join(root, "index.html"), html);
  for (const [name, text] of [["worker.mjs", worker], ["index.html", html]])
    console.log(name + " sha256 " + createHash("sha256").update(text).digest("hex"));
}
