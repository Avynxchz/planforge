/* PlanForge core: audit struktur rencana dan rubrik kesiapan. */
import { STARTER_FILES } from "planforge:starter";
import { missingNpmScripts } from "../../shared/npm-contract.mjs";
import { normId } from "./plan-normalize.mjs";
import { planTaskList } from "./plan-workspace.mjs";
import { saranLingkungan } from "./starter.mjs";

export const KATA_SCAFFOLD = /scaffold|kerangka|skeleton|setup|inisial|struktur dasar|bootstrap|bangun dasar/i;
export const potongTeks = (s, n)=>{ const x = String(s == null ? "" : s); return x.length > n ? x.slice(0, n) + "..." : x; };
export function masalahStrukturRencana(docs, starter){
  const out = [];
  const list = planTaskList(docs) || [];
  if(!list.length) return ["rencana belum punya task — jalankan pipeline dulu"];
  /* Pure shell-shape checks mirrored from worker.auditPlan, plus the explicit exit 0 form.
     No filesystem, PATH, or process probing here: Connect must reject the same plan text the
     worker will reject later. */
  const AWAL_PERINTAH = /^\s*(shell|bash|perintah|command|cmd)\s*:?\s*/i;
  const BUKAN_PERINTAH = /^(buka|lihat|cek|pastikan|verifikasi|bandingkan|amati|klik|scroll|coba|screenshot|manual|uji\s+manual|test\s+manual)/i;
  const cumaSukses = (s)=> /^(?:echo|printf|true|:)(?:\s|$)/.test(s) || /^exit\s+0$/i.test(s);
  const tokenAwal = (s)=> (s.match(/^["'`]?([^\s"'`|&]+)/) || [, ""])[1];
  const segmen = (v)=>{
    const s = String(v), hasil = [];
    let cur = "", q = null;
    for(let i=0;i<s.length;i++){
      const ch = s[i];
      if(q){ cur += ch; if(ch === q) q = null; continue; }
      if(ch === '"' || ch === "'" || ch === "`"){ q = ch; cur += ch; continue; }
      if((ch === "&" && s[i+1] === "&") || (ch === "|" && s[i+1] === "|")){ hasil.push(cur); cur = ""; i++; continue; }
      if(ch === ";" || ch === "\n" || ch === "|"){ hasil.push(cur); cur = ""; continue; }
      cur += ch;
    }
    hasil.push(cur);
    return hasil.map(x=>x.trim()).filter(Boolean);
  };
  const bukanPerintah = (v)=>{
    const awal = segmen(v)[0] || "";
    if(!awal) return "kosong";
    const tok0 = tokenAwal(awal);
    const pathish = /[\/\\]/.test(tok0) || /^[A-Za-z]:/.test(tok0) || /\.exe$/i.test(tok0);
    if(BUKAN_PERINTAH.test(awal) || /^[^a-zA-Z~._\/-]/.test(tok0) || (!pathish && /^[A-Z]/.test(tok0))) return awal;
    return null;
  };
  const bacaPkg = (p)=>{
    let v = p;
    if(typeof v === "string"){ try{ v = JSON.parse(v); }catch(e){ return null; } }
    return v && typeof v === "object" && v.scripts && typeof v.scripts === "object" ? v : null;
  };
  const pertama = list[0];
  const judul = String(pertama.title || "") + " " + String(pertama.description || "");
  if(normId(pertama.id) !== "T-001")
    out.push("task pertama ber-ID " + (pertama.id || "-") + ", bukan T-001 — task scaffold biasanya hilang");
  const idUnik = new Set(list.map(t=>normId(t.id)));
  if(idUnik.size !== list.length) out.push("ID task duplikat — struktur rencana harus diperbaiki.");
  /* package.json metadata is only available from the plan or the selected starter. Host
     dependency/PATH/DB checks stay warnings in the worker, so they never block Connect here. */
  let pkg = bacaPkg(docs.packageJson) || bacaPkg(docs.package);
  if(!pkg && starter) pkg = bacaPkg(STARTER_FILES["package.json"]);
  if(pkg) for(const x of missingNpmScripts(list, pkg)) out.push(x.id + ": " + x.msg);
  if(starter){
    const keputusan = ((docs.prd && docs.prd.tech) || []).map(t=>String(t.decision || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b(?:bukan|tanpa|not|no|instead of|rather than|alih-alih|dibandingkan|dibanding|versus|vs)\b[\s\S]*$/i, "")).join("; ");
    if(/\b(sqlite|mysql|mariadb|mongodb|fastapi|django|flask|laravel|vite|vue|svelte|angular)\b/i.test(keputusan))
      out.push("stack bertentangan dengan starter Next.js + PostgreSQL yang dipilih — ubah keputusan rencana atau matikan starter, bukan mengabaikan fondasinya");
  }
  /* starter aktif: fondasi sudah ada di bundel, task pertama = migrasi/delta bukan scaffold (samakan dgn worker.auditPlan) */
  if(!starter && !KATA_SCAFFOLD.test(judul))
    out.push("task pertama '" + potongTeks(pertama.title, 48) + "' bukan scaffold — tidak ada yang menyiapkan file dasar proyek");
  for(const t of list){
    const id = t.id || "task";
    const raw = String(t.verification || "").trim();
    if(!raw){
      out.push(id + ": verification kosong — tidak ada satu pun yang bisa membuktikan task ini");
    } else {
      const v = raw.replace(AWAL_PERINTAH, "");
      const bukan = bukanPerintah(v);
      if(bukan)
        out.push(id + ": verification bukan perintah shell: \"" + potongTeks(bukan, 80) + "\" — gerbang ini lolos kosong, agen tinggal klaim");
      /* An always-successful suffix hides a failed verification command. */
      for(const baris of v.split(/[\n\r]+/)){
        const ekor = baris.split(";").pop().trim();
        const tutup = ekor.split(" || ").pop().trim();
        let penutup = cumaSukses(ekor) ? ekor : (cumaSukses(tutup) && tutup !== ekor ? tutup : "");
        const suffixExplicit = /(?:;\s*echo(?:\s+ok)?|\|\|\s*(?:true|exit\s+0))\s*$/.exec(baris);
        if(!penutup) penutup = suffixExplicit ? suffixExplicit[0].trim() : "";
        if(penutup)
          out.push(id + ": gerbang ini tidak bisa gagal: barisnya ditutup \"" + potongTeks(penutup, 40)
            + "\" — echo/true/exit 0 selalu mengembalikan 0, jadi perintah di depannya boleh gagal total dan task tetap lulus."
            + " Buang penutup itu, atau rangkai pakai `&&`.");
      }
    }
    /* Unexpected CJK in generated task text can leak into agent-written code. */
    const kriteria = Array.isArray(t.acceptance_criteria) ? t.acceptance_criteria.join(" ") : String(t.acceptance_criteria || "");
    const nyasar = [t.title, t.description, t.agent_hint, kriteria, t.verification].join(" ").match(/[\u3400-\u9fff\u3040-\u30ff]/g);
    if(nyasar) out.push(id + ": ada aksara Mandarin nyasar di teks task (\"" + nyasar.slice(0, 4).join("") + "\") — teks ini yang dibaca agen, betulkan sebelum dikerjakan");
  }
  return out;
}
export function rubrikRencana(docs, issues, starter){
  const error = (Array.isArray(issues) ? issues : []).map(x=>x && typeof x === "object" ? String(x.message || JSON.stringify(x)) : String(x))
    .concat(masalahStrukturRencana(docs, starter));
  const skor = Math.max(0, 100 - error.length * 20);
  return { siap: error.length === 0, skor, error, warn:saranLingkungan(starter), label: error.length ? "Perlu diperbaiki" : "Siap dikirim (lingkungan belum diverifikasi)" };
}
