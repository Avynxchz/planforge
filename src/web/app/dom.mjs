/* DOM and HTML helpers shared by the UI modules. */

export const el = (id)=>document.getElementById(id);

export const escA = (s)=>esc(s);

export function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
