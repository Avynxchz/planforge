import fs from "node:fs";

export const DIR = ".planforge";

export const F_PLAN = "plan.json", F_GATES = "gates.json", F_STATE = "state.json", F_LOG = "RUN_LOG.md";

/* Missing or unreadable optional JSON deliberately uses the caller's fallback. */
export const readJson = (p, fb)=>{ try{ return JSON.parse(fs.readFileSync(p, "utf8")); } catch(e){ return fb; } };

/* Long-lived MCP processes must detect replacement of the bundled artifact. */
export const cetakFile = (p)=>{ try{ const st = fs.statSync(p); return st.size + ":" + Math.round(st.mtimeMs); } catch(e){ return "-"; } };
