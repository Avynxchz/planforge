// Sinkronkan blob starter tertanam di index.html dengan folder starter/ di disk.
// Jalankan: node scripts/embed-starter.mjs   (dari root planforge)
// Aman: hanya menulis ulang blok antara PF-STARTER-BEGIN / PF-STARTER-END.
import fs from "node:fs";
import path from "node:path";
import { starterFiles, starterDeclaration } from "./lib/starter-tree.mjs";
const root = path.join(import.meta.dirname, "..");
const indexPath = path.join(root, "index.html");
const files = starterFiles(path.join(root, "starter"));
const html = fs.readFileSync(indexPath, "utf8");
const B = "/* PF-STARTER-BEGIN */", E = "/* PF-STARTER-END */";
const i = html.indexOf(B), j = html.indexOf(E);
if (i < 0 || j < 0 || j < i) { console.error("marker PF-STARTER tidak ditemukan di index.html"); process.exit(1); }
const blob = "\n" + starterDeclaration(files) + "\n";
const next = html.slice(0, i + B.length) + blob + html.slice(j);
fs.writeFileSync(indexPath, next);
console.log("starter ter-embed: " + Object.keys(files).length + " file, " + blob.length + " char blob");
