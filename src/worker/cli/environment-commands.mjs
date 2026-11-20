import { setupEnv, environmentReadiness } from "../environment/readiness.mjs";
import { runHardGates } from "../verification/hard-gates.mjs";
import { short } from "../text.mjs";
import { cariBrowser } from "../browser/discovery.mjs";
import { taskList } from "../ledger/tasks.mjs";
import { specBehavior, masalahBehavior } from "../../shared/behavior-spec.mjs";
import { doctorMcp } from "../connectors/process.mjs";
import { pinInterpreter } from "../environment/interpreter.mjs";

export function commandSetupEnv(cwd){
  const r = setupEnv(cwd); console.log(r.message); return r.ok ? 0 : 1;
}

export function commandEnvironment(cwd){
  const r = environmentReadiness(cwd, { probe:true });
  console.log("== prasyarat lingkungan (baca saja, bukan gate kelulusan) ==");
  for(const x of r.findings) console.log("~ " + x.code + ": " + x.msg);
  console.log(r.checked ? "Pemeriksaan selesai; tidak menjalankan tes, install, migrasi, atau mengubah ledger." : "package.json belum ada; belum ada lingkungan Node yang dapat diperiksa.");
  return 0;
}

export function commandDoctor(ctx, root, cwd, args){
  console.log("== saran persiapan lingkungan (tidak menahan Connect; tes tetap wajib) ==");
  for(const x of environmentReadiness(cwd, { probe:true }).findings) console.log("  ~ " + x.msg);
  /* Measure gates in this worker environment, not the human terminal environment. */
  let gateMerah = [];
  if(!args["no-gates"]){
    console.log("== gerbang keras dijalankan dari lingkungan worker ini (tanpa panggilan agen) ==");
    const semua = !!args["semua-gerbang"];
    const g = runHardGates(ctx, cwd, { hanyaBlocking: !semua });
    if(!g.length) console.log("  (tidak ada gerbang keras aktif — isi dulu lewat tab Runner)");
    for(const x of g){
      if(x.blocking && !x.pass) gateMerah.push(x.id);
      console.log("  " + (x.pass ? "ok " : "!! ") + x.id + " (" + Math.round(x.ms / 1000) + "s)"
        + (x.pass ? "" : " -> " + short(String(x.out).split(/\r?\n/).filter(Boolean).slice(-2).join(" / "), 160)));
    }
    const dilewati = (ctx.gates.hard || []).filter(x=> x && x.enabled && x.cmd && x.blocking === false);
    if(!semua && dilewati.length) console.log("  (" + dilewati.length + " gerbang lunak tidak dijalankan: " + dilewati.map(x=>x.id).join(", ")
      + " — yang begitu perlu server/browser hidup. Pakai --semua-gerbang kalau memang mau dicoba.)");
    if(gateMerah.length) console.log("  merah di sini = tiap task bakal TOLAK semalam, apa pun yang agen kerjakan. Perbaiki lingkungannya, bukan agennya.");
  }
  console.log("\n== bukti perilaku (browser yang mengukur, bukan klaim agen) ==");
  const binBeh = cariBrowser();
  const daftarTask = taskList(ctx.plan);
  const perluBeh = daftarTask.filter(t=>specBehavior(t));
  const uiTanpaBeh = daftarTask.filter(t=>!specBehavior(t) && masalahBehavior(t).length);
  console.log("  " + (binBeh ? "ok  browser: " + binBeh : "!! browser tidak ditemukan — pasang Edge/Chrome atau set PLANFORGE_BROWSER"));
  console.log("  " + (typeof WebSocket === "undefined" ? "!! Node " + process.version + " tanpa WebSocket global (butuh Node 22+)" : "ok  Node " + process.version + " punya WebSocket + fetch"));
  console.log("  " + perluBeh.length + " task punya behavior · " + uiTanpaBeh.length + " task menyentuh UI tapi belum punya behavior");
  if(uiTanpaBeh.length) console.log("  !! " + uiTanpaBeh.map(t=>t.id).join(", ") + " akan DITOLAK sampai behavior-nya diisi — itu pekerjaan manusia/audit, bukan agen.");
  if(!binBeh && perluBeh.length) gateMerah.push("browser");

  const d = doctorMcp(root);
  console.log("\nworker.mjs di disk ditulis: " + new Date(d.wtulis).toLocaleString() + " · rencana ditulis: " + (d.planTulis ? new Date(d.planTulis).toLocaleString() : "-"));
  if(!d.proses.length){
    console.log("BELUM TERVERIFIKASI: tidak ada proses `worker.mjs mcp` yang terbaca. File konfigurasi saja bukan bukti tersambung.");
    return 1;
  }
  const sesuai = d.proses.filter(p=>p.proyek === "sesuai");
  let lama = 0;
  for(const p of d.proses){
    if(p.proyek !== "sesuai"){
      console.log("?? pid " + p.pid + (p.proyek === "lain" ? " — PROYEK LAIN: " + p.root : " — PROYEK BELUM DIKETAHUI: --dir absolut tidak terbaca"));
      console.log("     " + p.cmd);
      continue;
    }
    lama += p.kodeLama || p.kartuLama ? 1 : 0;
    console.log((p.kodeLama || p.kartuLama ? "!! " : "ok ") + "pid " + p.pid + " · proyek sesuai · umur " + p.umurMenit + " menit"
      + (p.kodeLama ? " — KODE LAMA: prosesnya mulai sebelum worker.mjs ditulis ulang" : "")
      + (p.kartuLama ? " — KARTU LAMA: prosesnya mulai sebelum plan.json disunting" : ""));
    console.log("     " + p.cmd);
  }
  if(!sesuai.length){
    console.log("BELUM TERVERIFIKASI: tidak ada proses connector yang terbukti melayani " + root.replace(/\\/g, "/") + ".");
    console.log("Periksa target konfigurasi MCP di aplikasi. Restart saja tidak mengubah target proyek yang salah.");
    return 1;
  }
  if(lama){
    console.log("\n" + lama + " dari " + sesuai.length + " proses connector proyek ini pakai aturan lama.");
    console.log("Muat ulang connector proyek ini di aplikasi (atau jalankan `node worker.mjs refresh`), lalu periksa plan_status sebelum mengambil task.");
    return 1;
  }
  console.log("Proses proyek ini terdeteksi. BELUM membuktikan chat memakai connector itu: cocokkan folder proyek di jawaban plan_status sebelum next_task.");
  return gateMerah.length ? 1 : 0;
}

export function commandPin(ctx, cwd){
  console.log("mencoba interpreter yang ada di PATH worker, satu per satu, sampai gerbang keras hijau:");
  const p = pinInterpreter(ctx, cwd);
  for(const c of (p.coba || [])) console.log("  " + (c.hijau ? "HIJAU" : "merah " + c.merah.join(",")) + " :: " + c.abs);
  if(p.ok){
    console.log("\npackage.json dipin ke: " + p.abs);
    console.log("Sekarang gerbang tidak peduli lagi shell mana yang manggil worker. Coba: node worker.mjs doctor");
    return 0;
  }
  console.log("\n" + (p.kenapa || "gagal"));
  return 1;
}
