import fs from "node:fs";
import path from "node:path";

export const STARTER_SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);
export const STARTER_SKIP_FILES = new Set(["package-lock.json", ".starter-smoke.log"]);

// One walker for every consumer: traversal order and exclusions are part of the blob contract.
export function starterFiles(dir) {
  const files = {};
  function walk(folder, base) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (STARTER_SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(folder, entry.name);
      const rel = base ? base + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (!STARTER_SKIP_FILES.has(entry.name)) files[rel] = fs.readFileSync(full, "utf8");
    }
  }
  walk(dir, "");
  return files;
}

export function starterDeclaration(files) {
  const json = "{" + Object.keys(files).sort().map(key =>
    JSON.stringify(key) + ":" + JSON.stringify(files[key])
  ).join(",") + "}";
  const safeJson = json.replace(/<\/script/gi, match => "\\u003c" + match.slice(1));
  return "const STARTER_FILES = " + safeJson + ";";
}
