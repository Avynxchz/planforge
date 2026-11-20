export function extractVerdict(text){
  const t = String(text || "");
  for(let end = t.length - 1; end >= 0; end--){
    if(t[end] !== "}") continue;
    let depth = 0, start = -1;
    for(let i = end; i >= 0; i--){
      if(t[i] === "}") depth++;
      else if(t[i] === "{"){ depth--; if(depth === 0){ start = i; break; } }
    }
    if(start < 0) break;
    try{
      const v = JSON.parse(t.slice(start, end + 1));
      if(v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch(e){ /* Not a verdict; try the next candidate. */ }
    end = start;
  }
  return null;
}
