import { CHECK_BROWSER, taskUi, specBehavior, masalahBehavior } from "../../shared/behavior-spec.mjs";

export { CHECK_BROWSER, taskUi, specBehavior, masalahBehavior };

export function kartuBehavior(t){
  const spec = specBehavior(t);
  if(!spec) return "";
  const baris = spec.checks.map((c, i)=>{
    const extra = Object.keys(c).filter(k=>!["type", "selector"].includes(k)).map(k=>k + "=" + JSON.stringify(c[k])).join(" ");
    return "  " + (i + 1) + ". " + c.type + (c.selector ? " " + c.selector : "") + (extra ? " (" + extra + ")" : "");
  });
  return ["BUKTI PERILAKU (worker membuka browser sungguhan dan mengukur sendiri — bukan kamu yang menilai):",
    "  url: " + spec.url,
    spec.viewport ? "  viewport: " + spec.viewport.width + "x" + (spec.viewport.height || 800) : "",
    spec.server && spec.server.cmd ? "  server yang dinyalakan worker: " + spec.server.cmd : "",
    ...baris].filter(Boolean).join("\n");
}

export function ringkasBehavior(beh){
  if(!beh || beh.dilewati) return "perilaku: tidak ada check (task bukan UI)";
  if(!beh.jalan) return (beh.kurang || []).join(" · ");
  const angka = (beh.hasil || []).filter(h=>h.ukur && typeof h.ukur === "object" && h.ukur.pixel != null)
    .map(h=>h.check + " " + h.ukur.pixel + "/" + h.ukur.total + " pixel");
  return (beh.ok ? "perilaku hijau" : "perilaku GAGAL") + " · " + (beh.hasil || []).length + " check di browser"
    + (angka.length ? " · " + angka.join(", ") : "") + (beh.ok ? "" : " · " + (beh.kurang || []).join(" · "));
}
