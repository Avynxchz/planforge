import { spawnSync } from "node:child_process";
import { short } from "../text.mjs";

export async function hidupan(url){
  try{ await fetch(url, { signal: AbortSignal.timeout(2000), redirect: "manual" }); return true; }
  catch(e){ return false; }
}

export async function tungguHidup(url, ms){
  const akhir = Date.now() + ms;
  while(Date.now() < akhir){ if(await hidupan(url)) return true; await new Promise(r=>setTimeout(r, 400)); }
  return false;
}

export function tungguDevTools(proc, ms){
  return new Promise((res, rej)=>{
    let buf = "";
    const timer = setTimeout(()=>rej(new Error("browser tidak mencetak alamat DevTools dalam " + Math.round(ms/1000) + "s: " + short(buf, 200))), ms);
    const baca = (d)=>{ buf += String(d); const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if(m){ clearTimeout(timer); res(m[1]); } };
    proc.stderr.on("data", baca);
    proc.on("exit", (code)=>{ clearTimeout(timer); rej(new Error("browser keluar sendiri (code " + code + "): " + short(buf, 200))); });
  });
}

export function cdp(ws){
  let id = 0; const tunggu = new Map(); const pendengar = [];
  ws.onmessage = (ev)=>{
    let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
    if(m.id != null && tunggu.has(m.id)){
      const { res, rej, timer } = tunggu.get(m.id); tunggu.delete(m.id); clearTimeout(timer);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if(m.method) pendengar.forEach(f=>f(m));
  };
  return {
    kirim(method, params){
      return new Promise((res, rej)=>{
        const n = ++id;
        const timer = setTimeout(()=>{ if(tunggu.has(n)){ tunggu.delete(n); rej(new Error("CDP tidak menjawab " + method)); } }, 25000);
        tunggu.set(n, { res, rej, timer });
        ws.send(JSON.stringify({ id: n, method, params: params || {} }));
      });
    },
    on(f){ pendengar.push(f); },
    tutup(){ try{ ws.close(); }catch(e){} }
  };
}

export function sambungWs(url){
  return new Promise((res, rej)=>{
    const s = new WebSocket(url);
    const timer = setTimeout(()=>{ try{ s.close(); }catch(e){} rej(new Error("timeout menyambung ke browser")); }, 10000);
    s.onopen = ()=>{ clearTimeout(timer); res(s); };
    s.onerror = ()=>{ clearTimeout(timer); rej(new Error("WebSocket ke browser ditolak")); };
  });
}

/* Kill only processes we started, never a user-owned server. */
export function bunuh(proc){
  if(!proc || proc.exitCode != null || proc.signalCode) return;
  try{
    if(process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { encoding: "utf8", timeout: 10000 });
    else { try{ process.kill(-proc.pid, "SIGKILL"); }catch(e){ proc.kill("SIGKILL"); } }
  }catch(e){}
}
