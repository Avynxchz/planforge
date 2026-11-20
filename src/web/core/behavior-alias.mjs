/* PlanForge core: normalisasi alias tipe behavior yang dikenal worker. */
import { CHECK_BROWSER } from "./plan-rules.mjs";

/* ---------- gerbang kualitas rencana: dijalankan SEBELUM Connect ----------
   Model murah sering mengarang tipe behavior.checks atau melewatkan task scaffold.
   Dua-duanya bikin agen IDE berhenti di folder kosong. Yang dicek di sini murni isi
   rencana (tidak butuh akses folder), jadi hasilnya bisa dipakai web maupun diuji Node. */
export const ALIAS_CHECK = {
  attribute:"attr", textContains:"text", noHorizontalScroll:"noHorizontalOverflow",
  horizontalOverflow:"noHorizontalOverflow", consoleError:"noConsoleError", noErrorConsole:"noConsoleError"
};
/* css / style / file / hover / focus sengaja TIDAK punya padanan: menukarnya diam-diam
   berarti mengganti alat bukti, bukan memperbaiki rencana. Itu keputusan manusia. */
export function normalisasiAliasBehavior(docs){
  const tasks = docs && docs.tasks && Array.isArray(docs.tasks.tasks) ? docs.tasks.tasks : [];
  const perbaikan = [], tersisa = [];
  for(const t of tasks){
    const spec = t && t.behavior;
    if(!spec || !Array.isArray(spec.checks)) continue;
    for(const c of spec.checks){
      if(!c || typeof c !== "object") continue;
      if(CHECK_BROWSER.includes(c.type)) continue;
      const baru = ALIAS_CHECK[c.type];
      if(!baru){ tersisa.push((t.id || "?") + ":" + String(c.type)); continue; }
      const lama = c.type;
      c.type = baru;
      if(baru === "text" && c.contains == null && c.text != null) c.contains = c.text;
      if(baru === "attr" && c.name == null && c.property != null) c.name = c.property;
      perbaikan.push((t.id || "?") + ":" + lama + "->" + baru);
    }
  }
  return { perbaikan, tersisa };
}
