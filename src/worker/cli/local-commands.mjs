import path from "node:path";
import fs from "node:fs";
import { DIR, F_GATES } from "../ledger/files.mjs";
import { defaultGates } from "../agents/defaults.mjs";
import { ukurPerilaku } from "../browser/measurement.mjs";
import { SELF_DIR, SELF_FILE } from "../identity.mjs";

export function commandInit(args){
  const dir = path.join(process.cwd(), DIR); fs.mkdirSync(dir, { recursive: true });
  if(!fs.existsSync(path.join(dir, F_GATES))) fs.writeFileSync(path.join(dir, F_GATES), JSON.stringify(defaultGates(args.agent || "agy"), null, 1));
  console.log("ditulis " + path.join(dir, F_GATES).replace(/\\/g, "/") + " — sunting perintah `hard[].cmd` sesuai proyekmu, lalu taruh plan.json di sebelah.");
  return 0;
}

export function commandBrowser(){
  let masuk = "";
  process.stdin.on("data", (d)=>{ masuk += d; });
  process.stdin.on("end", ()=>{
    let payload = null; try{ payload = JSON.parse(masuk); }catch(e){}
    const jatuh = (pesan)=>{ console.log(JSON.stringify({ ok: false, kurang: [pesan], hasil: [] })); process.exit(0); };
    if(!payload || !payload.spec) return jatuh("spec perilaku tidak terbaca di stdin");
    ukurPerilaku(payload).then((h)=>{ console.log(JSON.stringify(h)); process.exit(0); }, (e)=>jatuh("pengukur perilaku jatuh: " + (e && e.message || e)));
  });
  return 0;
}

export function commandEmbed(args){
  /* file:// CORS blocks fetch; embed escaped JSON so offline downloads retain the worker. */
  const htmlFile = args.html && args.html !== true ? path.resolve(String(args.html)) : path.join(SELF_DIR, "index.html");
  const sumber = fs.readFileSync(SELF_FILE, "utf8");
  let html;
  try{ html = fs.readFileSync(htmlFile, "utf8"); }
  catch(e){ console.log("index.html tidak ada di " + htmlFile.replace(/\\/g, "/") + " — embed hanya untuk folder sumber PlanForge."); return 1; }
  const awal = "<!-- PF-WORKER-BEGIN -->", akhir = "<!-- PF-WORKER-END -->";
  const i = html.indexOf(awal), j = html.indexOf(akhir);
  if(i < 0 || j < 0 || j < i){ console.log("penanda " + awal + " / " + akhir + " tidak ditemukan di index.html."); return 1; }
  const muatan = JSON.stringify(sumber).replace(/</g, "\\u003c");
  const blok = awal + "\n" + '<script type="application/json" id="pf-worker-src">' + muatan + "<" + "/script>\n" + akhir;
  const baru = html.slice(0, i) + blok + html.slice(j + akhir.length);
  /* Refuse to write an embed that cannot round-trip exactly. */
  let balik = null;
  try{ balik = JSON.parse(muatan); }catch(e){}
  if(balik !== sumber){ console.log("round-trip gagal: blok tertanam tidak sama persis dengan worker.mjs."); return 1; }
  if(baru === html){ console.log("sudah terbaru: blok tertanam == worker.mjs (" + sumber.length + " byte)."); return 0; }
  fs.writeFileSync(htmlFile, baru);
  console.log("worker.mjs ditanam ke " + htmlFile.replace(/\\/g, "/") + " (" + sumber.length + " byte).");
  return 0;
}
