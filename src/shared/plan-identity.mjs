/* The browser fingerprint must agree, or Connect could attach the wrong ledger. */
export function crc32(buf){
  const table = (()=>{ const t=[]; for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320 ^ (c>>>1) : c>>>1; t[n]=c>>>0; } return t; })();
  let c = 0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF)>>>0;
}

export function canonPlan(v){
  if(Array.isArray(v)) return v.map(canonPlan);
  if(v && typeof v === "object"){ const o = {}; for(const k of Object.keys(v).sort()) o[k] = canonPlan(v[k]); return o; }
  return v;
}

export function planCoreFromPlan(plan){
  const ts = plan && plan.tasks && Array.isArray(plan.tasks.tasks) ? plan.tasks.tasks : (plan && Array.isArray(plan.tasks) ? plan.tasks : []);
  return { brief: plan && plan.brief != null ? plan.brief : null, prd: (plan && plan.prd) || {}, roadmap: (plan && plan.roadmap) || {},
    tasks: { tasks: ts.map(t=>{ const {status, ...rest} = t || {}; return rest; }) } };
}

export function planFingerprintPlan(plan){
  return crc32(new TextEncoder().encode(JSON.stringify(canonPlan(planCoreFromPlan(plan))))).toString(16).padStart(8, "0");
}
