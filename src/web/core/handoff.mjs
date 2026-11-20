/* PlanForge core: fingerprint rencana dan pembuat zip. */
import { crc32, planFingerprintPlan } from "../../shared/plan-identity.mjs";

export { crc32 } from "../../shared/plan-identity.mjs";

export function planFingerprint(docs){
  docs = docs || {};
  /* plan.json menyalin ringkasan root ke prd.overview.summary; sidik jari harus melihat
     bentuk yang sama dengan yang dibaca worker, kalau tidak ledger dianggap milik rencana lain. */
  const prd = Object.assign({}, docs.prd || {});
  if(!(prd.overview && prd.overview.summary) && prd.summary){
    const overview = prd.overview && typeof prd.overview === "object" ? prd.overview : {};
    prd.overview = Object.assign({}, overview, { summary:prd.summary });
  }
  return planFingerprintPlan({ brief: docs.clarify || null, prd, roadmap: docs.roadmap || {}, tasks: docs.tasks || { tasks: [] } });
}
export function makeZip(files){
  const enc = new TextEncoder(); const parts = [], central = []; let offset = 0;
  for(const f of files){
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);
    lh.setUint32(14,crc,true); lh.setUint32(18,data.length,true); lh.setUint32(22,data.length,true);
    lh.setUint16(26,name.length,true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    central.push({name, crc, size:data.length, offset});
    offset += 30 + name.length + data.length;
  }
  const cdStart = offset; let cdSize = 0;
  for(const c of central){
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true);
    ch.setUint32(16,c.crc,true); ch.setUint32(20,c.size,true); ch.setUint32(24,c.size,true);
    ch.setUint16(28,c.name.length,true); ch.setUint32(42,c.offset,true);
    parts.push(new Uint8Array(ch.buffer), c.name); cdSize += 46 + c.name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,central.length,true); end.setUint16(10,central.length,true);
  end.setUint32(12,cdSize,true); end.setUint32(16,cdStart,true);
  parts.push(new Uint8Array(end.buffer));
  let total = 0; for(const p of parts) total += p.length;
  const out = new Uint8Array(total); let o = 0; for(const p of parts){ out.set(p,o); o += p.length; }
  return out;
}
