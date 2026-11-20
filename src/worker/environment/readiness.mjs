import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

export function envFileNames(env){
  const mode = env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
  return [".env." + mode + ".local", ...(mode === "test" ? [] : [".env.local"]), ".env." + mode, ".env"];
}

export function environmentReadiness(root, opts = {}){
  const env = opts.env || process.env, findings = [];
  const add = (code, msg)=>findings.push({ lvl:"warn", id:"ENV", code, msg });
  let pkg = null;
  try{ pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); }catch(_){}
  if(!pkg) return { findings, checked:false, database:"not-applicable" };
  const req = createRequire(path.join(root, "package.json"));
  const missing = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(name=>{
    try{ req.resolve(name); return false; }catch(_){}
    /* Type-only and exports-only packages may have no runtime entry point. */
    return !(req.resolve.paths(name) || []).some(base=>fs.existsSync(path.join(base, name, "package.json")));
  });
  if(missing.length) add("dependencies", "Dependency belum terpasang/terbaca: " + missing.join(", ") + ". Jalankan npm install di folder proyek setelah menyetujui unduhan dan install scripts; bukan alasan menolak Connect atau mengaku task selesai.");
  const files = envFileNames(env).filter(f=>fs.existsSync(path.join(root, f)));
  let url = env.DATABASE_URL;
  for(const f of files){
    if(url !== undefined) break;
    try{ const parsed = parseEnv(fs.readFileSync(path.join(root, f), "utf8")); if(Object.hasOwn(parsed, "DATABASE_URL")) url = parsed.DATABASE_URL; }catch(_){}
  }
  const hasExample = fs.existsSync(path.join(root, ".env.example"));
  if(hasExample && !files.length && !url) add("env-file", "Konfigurasi lokal belum ada. node worker.mjs setup-env menyalin .env.example ke .env.local tanpa menimpa file; periksa nilainya sebelum dipakai. Tidak ada rahasia yang dicetak.");
  const pgNeeded = !!(pkg.dependencies && pkg.dependencies.pg || pkg.devDependencies && pkg.devDependencies.pg);
  let database = pgNeeded ? "unverified" : "not-applicable";
  if(pgNeeded){
    if(!url) add("database-url", "DATABASE_URL belum tersedia. Isi PostgreSQL milikmu di .env.local / konfigurasi yang sudah ada, atau set environment variable. DB tidak dipasang otomatis.");
    else {
      let parsed;
      try{ parsed = new URL(url); if(!/^postgres(?:ql)?:$/.test(parsed.protocol) || !parsed.hostname || /\$\{?\w/.test(url)) throw new Error("invalid"); }catch(_){ add("database-url", "DATABASE_URL belum valid atau memakai ekspansi variabel yang belum diukur; nilai rahasia disembunyikan."); }
      if(parsed && /^postgres(?:ql)?:$/.test(parsed.protocol) && parsed.hostname && !/\$\{?\w/.test(url)){
        if(opts.probe){
          /* TCP only: never authenticate, run SQL, migrate, or invoke Docker. */
          const code = "const net=require('node:net');const p=JSON.parse(process.argv[1]);const s=net.connect(p);s.setTimeout(1200);s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));s.on('timeout',()=>{s.destroy();process.exit(1)});";
          const r = spawnSync(process.execPath, ["-e", code, JSON.stringify({host:parsed.hostname.replace(/^\[|\]$/g, ""), port:Number(parsed.port || 5432)})], { timeout:2200, stdio:"ignore", windowsHide:true });
          database = r.status === 0 ? "tcp-open-auth-unverified" : "unreachable";
          add("database-probe", r.status === 0 ? "Port DB dapat dihubungi (TCP saja); login, schema, dan query PostgreSQL BELUM diverifikasi. Ini bukan bukti kelulusan task." : "Port DB tidak dapat dihubungi. Hidupkan PostgreSQL pilihanmu; jangan mengganti hasil tes dengan klaim selesai.");
        } else add("database-unverified", "DATABASE_URL tersedia, koneksi DB belum diuji. node worker.mjs doctor --environment memeriksa port (bukan login/schema).");
      }
    }
    if(fs.existsSync(path.join(root, "docker-compose.yml"))) add("database-start", "Ada docker-compose.yml. Untuk starter PlanForge, jika Docker sudah terpasang dan pengguna menyetujui DB lokal: docker compose up -d db (unduh image, buat volume). Hentikan: docker compose stop db; data tetap ada. Alternatif: DATABASE_URL PostgreSQL yang sudah dimiliki. Jangan memasang Docker atau membuat DB cloud tanpa persetujuan.");
  }
  return { findings, checked:true, database };
}

export function setupEnv(root, env = process.env){
  /* Do not shadow existing production/test environment configuration. */
  const allEnvFiles = [".env", ".env.local", ...["development", "production", "test"].flatMap(mode=>[".env." + mode, ".env." + mode + ".local"])];
  const existing = allEnvFiles.find(f=>fs.existsSync(path.join(root, f)));
  if(existing || env.DATABASE_URL) return { ok:true, created:false, message:"Konfigurasi sudah ada; tidak ditimpa dan tidak ditampilkan. Periksa DATABASE_URL milikmu sendiri." };
  const example = path.join(root, ".env.example"), dest = path.join(root, ".env.local");
  if(!fs.existsSync(example)) return { ok:false, created:false, message:".env.example tidak ada; tidak menebak konfigurasi." };
  let ignore = ""; try{ ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8"); }catch(_){}
  const ignored = spawnSync("git", ["check-ignore", "--no-index", "--quiet", "--", ".env.local"], {cwd:root, encoding:"utf8", timeout:3000, windowsHide:true});
  const simpleIgnore = ignore.split(/\r?\n/).some(l=>[".env.local", "/.env.local", ".env*", ".env.*"].includes(l.trim())) && !/^\s*!/m.test(ignore);
  /* Outside a repository, only provable simple ignore rules are safe. */
  if(!(ignored.status === 0 || (ignored.status !== 1 && simpleIgnore)))
    return { ok:false, created:false, message:"Belum dapat memastikan .env.local diabaikan Git. Pastikan aturan .gitignore tidak membukanya kembali; tidak ada file yang ditulis." };
  try{ fs.copyFileSync(example, dest, fs.constants.COPYFILE_EXCL); }
  catch(e){ return { ok:false, created:false, message:".env.local tidak dibuat (" + e.code + "); tidak ada file lama yang ditimpa." }; }
  return { ok:true, created:true, message:".env.local dibuat dari contoh. Periksa DATABASE_URL sebelum migrasi; ini belum menyalakan DB atau memasang dependency. Untuk membatalkan, hapus hanya .env.local baru ini jika belum kamu sunting." };
}
