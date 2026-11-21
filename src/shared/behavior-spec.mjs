/* Canonical UI behavior rules shared by the planning UI and the worker runner.
   Pure data and functions only: no DOM APIs and no Node built-in imports. */

export const CHECK_BROWSER = ["text", "count", "visible", "attr", "canvasNotBlank", "click", "wait",
  "request", "url", "noConsoleError", "noHorizontalOverflow"];

export const PERLU_SELECTOR = new Set(["text", "count", "visible", "attr", "canvasNotBlank", "click"]);

export const UI_FILE = /(\.html?|\.css|\.vue|\.svelte|\.jsx|\.tsx)\b|(^|\/)(templates|static|public|assets)\//i;

export const UI_KATA = /\b(browser|halaman|layar|viewport|responsif|mobile|tombol|klik|click|grafik|chart|canvas|frontend|dom)\b/i;

export function taskUi(t){
  if(!t) return false;
  const targets = (Array.isArray(t.files_or_areas) ? t.files_or_areas : []).join(" ").replace(/\\/g, "/");
  const files = (Array.isArray(t.files_or_areas) ? t.files_or_areas : [])
    .map(file=>String(file || "").replace(/\\/g, "/")).filter(Boolean);
  const backendTarget = (file)=>/(^|\/)(routes|controllers|models|lib|api)(\/|$)/i.test(file) || /(^|\/)(server|web)\.js$/i.test(file);
  const uiTarget = (file)=>UI_FILE.test(file) || /(^|\/)(public|views)\//i.test(file);
  if(files.length && files.every(backendTarget) && !files.some(uiTarget)) return false;
  if(UI_FILE.test(targets) || /(^|\/)(web|frontend|client|components|pages|views|ui)(\/|$)/i.test(targets)) return true;
  if(/(^|\/)(?:src\/)?(?:utils|data|cli|api|server|backend|worker|shared|database|db)(?:\/|(?:\.[^/]+)?$)|(^|\/)(?:bin|scripts)\//i.test(targets)) return false;
  return UI_KATA.test([t.title, t.description, ...(t.acceptance_criteria || [])].join(" "));
}

export function specBehavior(t){
  const b = t && t.behavior;
  if(!b || typeof b !== "object" || Array.isArray(b)) return null;
  return { url: String(b.url || ""), viewport: b.viewport || null, server: b.server || null,
    checks: Array.isArray(b.checks) ? b.checks : [], settleMs: Math.min(5000, Math.max(0, Number(b.settleMs) || 600)),
    timeoutSec: Math.min(600, Math.max(10, Number(b.timeoutSec) || 90)) };
}

export function masalahBehavior(t){
  const spec = specBehavior(t);
  if(!spec){
    if(!(taskUi(t) && t.ui !== false)) return [];
    const area = String((t.files_or_areas || []).join(", ") || t.title || "");
    const ringkas = area.length > 60 ? area.slice(0, 60) + "…" : area;
    return ["task UI tanpa behavior — task ini menyentuh UI (" + ringkas + ") tapi tidak punya `behavior`."
      + " Worker tidak punya cara membuktikan tampilannya, jadi task tidak boleh dicap selesai."
      + " Tambahkan behavior berisi url + checks (mis. canvasNotBlank pada selector grafik) di plan.json — itu pekerjaan manusia/audit, bukan agen."];
  }
  const bad = [];
  const angka = (v)=> v == null || (Number.isFinite(Number(v)) && Number(v) >= 0);
  const regexSah = (v)=>{ if(v == null) return true; try{ new RegExp(String(v)); return true; }catch(e){ return false; } };
  if(!/^https?:\/\/\S+/.test(spec.url)) bad.push("behavior.url harus alamat http(s) yang bisa dibuka browser, bukan kalimat");
  if(!spec.checks.length) bad.push("behavior.checks kosong — tidak ada satu pun yang diukur, jadi bukan bukti");
  const ASSERT = ["text","count","visible","attr","canvasNotBlank","request","url","noConsoleError","noHorizontalOverflow"];
  if(spec.checks.length && spec.checks.every(c=>c && CHECK_BROWSER.includes(c.type)) && !spec.checks.some(c=>c && ASSERT.includes(c.type)))
    bad.push("behavior.checks hanya berisi aksi/tunggu — tidak ada satu pun assertion yang membuktikan hasil");
  spec.checks.forEach((c, i)=>{
    const label = "behavior.checks[" + i + "]";
    if(!c || typeof c !== "object"){ bad.push(label + " bukan objek"); return; }
    if(!CHECK_BROWSER.includes(c.type)){ bad.push(label + ".type \"" + String(c.type).slice(0,30) + "\" tidak dikenal — pilih: " + CHECK_BROWSER.join(", ")); return; }
    if(PERLU_SELECTOR.has(c.type) && !String(c.selector || "").trim()) bad.push(label + " (" + c.type + ") butuh selector");
    if(c.type === "text" && !(c.contains || c.matches || c.equals)) bad.push(label + " (text) butuh contains/matches/equals");
    if(c.type === "text" && !regexSah(c.matches)) bad.push(label + " (text) matches bukan regex yang sah");
    if(c.type === "count" && c.equals == null && c.min == null && c.max == null) bad.push(label + " (count) butuh equals/min/max");
    if(c.type === "count" && (!angka(c.equals) || !angka(c.min) || !angka(c.max))) bad.push(label + " (count) equals/min/max harus angka >= 0");
    if(c.type === "attr" && !String(c.name || "").trim()) bad.push(label + " (attr) butuh name");
    if(c.type === "attr" && c.equals == null && !c.contains) bad.push(label + " (attr) butuh equals/contains — tanpa itu atribut kosong pun lolos");
    if(c.type === "canvasNotBlank" && !angka(c.minPixels)) bad.push(label + " (canvasNotBlank) minPixels harus angka >= 0");
    if(c.type === "request" && !(c.urlContains || c.urlMatches)) bad.push(label + " (request) butuh urlContains/urlMatches");
    if(c.type === "request" && !regexSah(c.urlMatches)) bad.push(label + " (request) urlMatches bukan regex yang sah");
    if(c.type === "url" && !(c.contains || c.matches || c.equals)) bad.push(label + " (url) butuh contains/matches/equals");
    if(c.type === "url" && !regexSah(c.matches)) bad.push(label + " (url) matches bukan regex yang sah");
  });
  const b = t.behavior || {};
  if(b.viewport && (!angka(b.viewport.width) || !angka(b.viewport.height) || !(Number(b.viewport.width) > 0)))
    bad.push("behavior.viewport harus angka positif — ukuran tidak sah tidak boleh dianggap bukti");
  return bad;
}
