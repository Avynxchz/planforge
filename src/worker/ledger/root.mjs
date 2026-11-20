import path from "node:path";
import fs from "node:fs";
import { DIR, F_PLAN } from "./files.mjs";
import { SELF_DIR } from "../identity.mjs";

export function findRoot(start){
  let d = path.resolve(start || process.cwd());
  for(let i=0;i<10;i++){
    if(fs.existsSync(path.join(d, DIR, F_PLAN))) return d;
    const up = path.dirname(d); if(up === d) break; d = up;
  }
  return null;
}

export function resolveRoot(args){
  const want = args && args.dir && args.dir !== true ? String(args.dir) : null;
  if(want) return findRoot(want);
  return findRoot(process.cwd()) || findRoot(SELF_DIR);
}
