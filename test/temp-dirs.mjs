import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const created = new Set();
const removeOptions = { recursive:true, force:true, maxRetries:5, retryDelay:100 };
const staleAfterMs = 30 * 60 * 1000;

function matchingTempDirs(){
  const dirs = new Set();
  try{
    for(const entry of fs.readdirSync(os.tmpdir(), {withFileTypes:true})){
      if(entry.isDirectory() && /^(?:pf-browser-|pf-induk-|planforge-)/.test(entry.name))
        dirs.add(path.join(os.tmpdir(), entry.name));
    }
  }catch{}
  return dirs;
}

export function sweepStaleTempDirs(){
  try{
    const now = Date.now();
    for(const dir of matchingTempDirs()){
      try{
        if(now - fs.statSync(dir).mtimeMs > staleAfterMs) fs.rmSync(dir, removeOptions);
      }catch{}
    }
  }catch{}
}

export function makeTempDir(prefix){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.add(dir);
  return dir;
}

export function tempDirCheckpoint(){
  return { created:new Set(created), existing:matchingTempDirs() };
}

export function cleanupTempDirsSince(checkpoint){
  const pending = new Set([...created].filter(dir=>!checkpoint.created.has(dir)));
  for(const dir of matchingTempDirs()) if(!checkpoint.existing.has(dir)) pending.add(dir);
  for(const dir of pending){
    try{ fs.rmSync(dir, removeOptions); }catch{}
    created.delete(dir);
  }
  sweepStaleTempDirs();
}

export function cleanupTempDirs(){
  cleanupTempDirsSince(startupCheckpoint);
}

export function withTempDir(prefix, callback){
  const checkpoint = tempDirCheckpoint();
  const dir = makeTempDir(prefix);
  try{
    return callback(dir);
  }finally{
    cleanupTempDirsSince(checkpoint);
  }
}

sweepStaleTempDirs();
const startupCheckpoint = tempDirCheckpoint();
