export const now = ()=> new Date().toISOString().slice(11, 19);

export const short = (s, n)=>{ s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; };

export const ANSI = (s)=>String(s).replace(/\u001b\[[0-9;]*m/g, "");
