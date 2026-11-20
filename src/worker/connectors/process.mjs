import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { DIR, F_PLAN } from "../ledger/files.mjs";
import { parseArgs } from "../cli/args.mjs";
import { findRoot } from "../ledger/root.mjs";

/* Old connectors cannot self-report; compare their start time with the artifact. */
export const EPOCH = 0;

export function jamProsesWindows(){
  const skrip = "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CreationDate } | ForEach-Object "
    + "{ \"$($_.ProcessId)|$([Math]::Round((New-TimeSpan -Start ([DateTime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc)) -End $_.CreationDate.ToUniversalTime()).TotalMilliseconds))|$($_.CommandLine)\" }";
  const r = spawnSync("powershell", ["-NoProfile", "-Command", skrip], { encoding: "utf8", timeout: 20000 });
  return String(r.stdout || "").split(/\r?\n/).filter(l=>(l.match(/\|/g) || []).length >= 2).map((l)=>{
    const bagi = l.split("|"), pid = Number(bagi[0]), mulai = Number(bagi[1]);
    return { pid, mulai, cmd: bagi.slice(2).join("|") };
  }).filter(x=>Number.isFinite(x.pid) && x.mulai > EPOCH && Number.isFinite(x.mulai));
}

export function jamProsesPosix(){
  const r = spawnSync("ps", ["-eo", "pid=,etime=,args="], { encoding: "utf8", timeout: 20000 });
  const detik = (e)=>{
    const potong = e.split(/[-:]/).map(Number);
    if(!potong.length || potong.some(isNaN)) return 0;
    const s = potong.pop(), m = potong.pop(), h = potong.pop(), d = potong.pop();
    return (d ? d * 86400 : 0) + (h ? h * 3600 : 0) + (m ? m * 60 : 0) + (s || 0);
  };
  return String(r.stdout || "").split(/\r?\n/).map(l=>l.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
    .map(m=>({ pid:Number(m[1]), cmd:m[3], mulai: Date.now() - detik(m[2]) * 1000 }))
    .filter(x=>x.mulai > 0);
}

export const prosesNode = ()=> (process.platform === "win32" ? jamProsesWindows() : jamProsesPosix());

export function doctorMcp(root, daftar){
  const file = path.join(root, "worker.mjs");
  let wtulis = 0; try{ wtulis = fs.statSync(file).mtimeMs; } catch(_){}
  const plan = path.join(root, DIR, F_PLAN);
  let ptulis = 0; try{ ptulis = fs.statSync(plan).mtimeMs; } catch(_){}
  const absolute = s=> /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(s) || path.posix.isAbsolute(s);
  const normal = s=> /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(s)
    ? path.win32.normalize(s).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
    : path.resolve(s);
  const proses = (daftar === undefined ? prosesNode() : daftar)
    .filter(p=>/worker\.mjs\b/.test(p.cmd || "") && /\bmcp\b/.test(p.cmd || ""));
  return {
    worker: file, wtulis, planTulis: ptulis,
    proses: proses.map(p=>{
      const tokens = Array.from(p.cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g), m=>m[1] ?? m[2] ?? m[3]);
      const args = parseArgs(tokens.slice(tokens.indexOf("mcp") + 1));
      const want = typeof args.dir === "string" && absolute(args.dir) ? args.dir : null;
      /* Without an absolute --dir, the process cwd and project are unknown. */
      const proyekRoot = want ? findRoot(want) || want : null;
      const proyek = !proyekRoot ? "tidak diketahui" : normal(proyekRoot) === normal(root) ? "sesuai" : "lain";
      const worker = tokens.find(s=>/(?:^|[\\/])worker\.mjs$/.test(s));
      let prosesTulis = 0;
      if(worker && absolute(worker)){ try{ prosesTulis = fs.statSync(worker).mtimeMs; }catch(_){} }
      return {
        pid: p.pid, cmd: p.cmd, root: proyekRoot, proyek,
        umurMenit: Math.max(0, Math.round((Date.now() - p.mulai) / 60000)),
        kodeLama: proyek === "sesuai" && prosesTulis > p.mulai,
        kartuLama: proyek === "sesuai" && ptulis > p.mulai
      };
    })
  };
}
