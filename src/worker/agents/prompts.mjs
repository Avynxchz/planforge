import { short } from "../text.mjs";
import { kartuBehavior } from "../browser/spec.mjs";
import { specBehavior } from "../../shared/behavior-spec.mjs";
import { environmentReadiness } from "../environment/readiness.mjs";

export function taskCard(plan, t){
  const prd = plan.prd || {};
  const feat = ((prd.features)||[]).find(f=>String(f.name).toLowerCase() === String(t.feature||"").toLowerCase());
  const reqs = ((prd.requirements)||[]).filter(r=>(t.requirement_refs||[]).includes(r.id));
  return [
    "PROYEK: " + ((plan.brief && plan.brief.project_name) || prd.project_name || "(tanpa nama)"),
    "KONTEKS: " + short((plan.brief && plan.brief.brief) || (prd.overview && prd.overview.summary) || "", 600),
    "FITUR INDUK: " + (t.feature || "-") + (feat && feat.sub_features ? " · sub-fitur: " + feat.sub_features.join(", ") : ""),
    "TASK " + t.id + ": " + (t.title || ""),
    t.description || "",
    "KRITERIA SELESAI:", ...(t.acceptance_criteria||[]).map(a=>"  - " + a),
    "VERIFIKASI (perintah shell — worker menjalankannya ulang sendiri, exit code-nya yang menentukan): " + (t.verification || "-"),
    kartuBehavior(t),
    "AREA/FILE: " + ((t.files_or_areas||[]).join(", ") || "tentukan sendiri, sesuaikan struktur proyek"),
    "REF REQUIREMENT: " + (reqs.length ? reqs.map(r=>r.id + " " + r.title).join(" | ") : (t.requirement_refs||[]).join(", ")),
    "DEPENDENCY: " + ((t.depends_on||[]).join(", ") || "tidak ada"),
    t.agent_hint ? "AWAS: " + t.agent_hint : ""
  ].filter(Boolean).join("\n");
}

export function buildTaskPrompt(ctx, t){
  const adaBehavior = !!specBehavior(t);
  return [
    "Kerjakan SATU task berikut sampai selesai. Jangan mengerjakan task lain, jangan menambah fitur.",
    "", taskCard(ctx.plan, t), "",
    ...(ctx.root ? environmentReadiness(ctx.root).findings.map(x=>"Saran lingkungan (bukan penahan task): " + x.msg) : []),
    "Aturan:",
    "1. Satu task = satu commit dengan pesan \"" + t.id + ": " + short(t.title, 60) + "\" (kalau ini repo git).",
    "2. Kalau ada bagian yang tidak bisa dipenuhi karena informasi hilang, JANGAN mengarang. Balas dengan blok JSON di baris terakhir: {\"blocked\":true,\"reason\":\"...\"}",
    "3. Worker MENJALANKAN SENDIRI perintah VERIFIKASI di atas sesudah kamu selesai — exit code bukan 0 berarti task GAGAL walau kamu merasa sudah benar. Jalankan dulu perintahnya, pastikan hijau, baru balas blok JSON terakhir: {\"done\":true,\"verification\":\"<output asli yang kamu lihat>\",\"files\":[\"...\"]}",
    "4. Kode harus tetap bisa di-build dan test tetap hijau setelah kamu selesai.",
    "5. Jangan mengubah file konfigurasi CI, jangan menghapus test yang sudah ada.",
    adaBehavior ? "6. Build/test hijau BELUM cukup: worker membuka Edge/Chrome headless dan mengukur BUKTI PERILAKU di atas (jumlah pixel canvas, teks sesudah klik, request yang benar-benar terkirim, error console, overflow). Satu check gagal = task GAGAL. Pastikan library yang kamu pakai benar-benar dimuat di halaman, dan elemen yang diukur benar-benar ada. Jangan mengubah plan.json atau check-nya." : ""
  ].filter(Boolean).join("\n");
}

export function buildFixPrompt(ctx, t, why){
  return ["Perbaikan untuk task " + t.id + " (gerbang/verifikasi gagal):", "", why, "",
    "Ubah seminimal mungkin. Jangan sentuh task lain. Balas blok JSON terakhir: {\"fixed\":true} atau {\"blocked\":true,\"reason\":\"...\"}"
  ].join("\n");
}
