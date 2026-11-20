/* PlanForge core: hitungan gerbang kualitas aktif. */

export function gateCounts(gates){
  const hard = (gates.hard||[]).filter(h=>h && h.enabled && h.cmd);
  const light = (gates.reviews||[]).filter(r=>r && r.enabled && r.tier === "light");
  const full = (gates.reviews||[]).filter(r=>r && r.enabled && r.tier === "full");
  return { hard, light, full, hardBlocking: hard.filter(h=>h.blocking !== false) };
}
