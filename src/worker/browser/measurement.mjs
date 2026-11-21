import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { bunuh, hidupan, tungguHidup, tungguDevTools, cdp, sambungWs } from "./cdp.mjs";
import { short } from "../text.mjs";
import { cariBrowser } from "./discovery.mjs";
import { nilaiCheck, ekspresiCheck } from "./checks.mjs";

export async function ukurPerilaku(payload){
  const spec = payload.spec, cwd = payload.cwd || process.cwd();
  const t0 = Date.now();
  const hasil = [], kurang = [];
  const konteks = { requests: [], errors: [] };
  let server = null, browser = null, klien = null, tmp = null;
  const bersih = ()=>{
    if(klien) klien.tutup();
    bunuh(browser); bunuh(server);
    if(tmp){ try{ fs.rmSync(tmp, { recursive: true, force: true }); }catch(e){} }
  };
  try{
    if(spec.server && spec.server.cmd){
      const ready = spec.server.ready || spec.url;
      if(!(await hidupan(ready))){
        server = spawn(spec.server.cmd, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
        server.stderr.on("data", ()=>{}); server.stdout.on("data", ()=>{});
        if(!(await tungguHidup(ready, (Number(spec.server.timeoutSec) || 40) * 1000)))
          throw new Error("server `" + short(spec.server.cmd, 80) + "` tidak menjawab " + ready + " — perilaku tidak bisa diukur");
      }
    }
    const bin = cariBrowser();
    if(!bin) throw new Error("browser tidak ditemukan");
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-browser-"));
    const sandboxArgs = process.platform === "linux" &&
      (process.getuid?.() === 0 || Boolean(process.env.CI || process.env.CONTAINER || process.env.KUBERNETES_SERVICE_HOST ||
        fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv")))
      ? ["--no-sandbox", "--disable-setuid-sandbox"] : [];
    browser = spawn(bin, [...sandboxArgs, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--remote-debugging-port=0", "--remote-allow-origins=*", "--user-data-dir=" + tmp, "about:blank"],
      { stdio: ["ignore", "pipe", "pipe"] });
    browser.stdout.on("data", ()=>{});
    const wsBrowser = await tungguDevTools(browser, 20000);
    const port = new URL(wsBrowser).port;
    const rTarget = await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT", signal: AbortSignal.timeout(8000) });
    const target = await rTarget.json();
    if(!target.webSocketDebuggerUrl) throw new Error("browser tidak memberi target halaman");
    klien = cdp(await sambungWs(target.webSocketDebuggerUrl));
    klien.on((m)=>{
      if(m.method === "Network.requestWillBeSent") konteks.requests.push(String(m.params.request.url || ""));
      if(m.method === "Runtime.exceptionThrown")
        konteks.errors.push(short((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text, 160));
      if(m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
        konteks.errors.push(short((m.params.args || []).map(a=>a.value || a.description || "").join(" "), 160));
      if(m.method === "Log.entryAdded" && m.params.entry.level === "error"){
        const e = m.params.entry;
        /* A browser-requested missing favicon is not an application failure. */
        const faviconKosong = e.url && /\/favicon\.ico(?:\?|$)/i.test(String(e.url)) && /\b404\b/.test(String(e.text || ""));

        if(!faviconKosong) konteks.errors.push(short(e.text + (e.url ? " (" + e.url + ")" : ""), 200));
      }
    });
    await Promise.all([klien.kirim("Page.enable"), klien.kirim("Runtime.enable"), klien.kirim("Network.enable"), klien.kirim("Log.enable")]);
    if(spec.viewport && Number(spec.viewport.width))
      await klien.kirim("Emulation.setDeviceMetricsOverride", { width: Number(spec.viewport.width), height: Number(spec.viewport.height) || 800, deviceScaleFactor: 1, mobile: !!spec.viewport.mobile });
    await klien.kirim("Page.navigate", { url: spec.url }).then((nav)=>{
      if(nav && nav.errorText) throw new Error("halaman tidak bisa dibuka: " + nav.errorText + " — " + spec.url);
    });
    /* about:blank emits loading events too; wait for the actual document instead. */
    const akhirNav = Date.now() + 20000;
    let siap = false;
    while(Date.now() < akhirNav){
      const r = await klien.kirim("Runtime.evaluate", { expression: "({ready:document.readyState,href:location.href})", returnByValue: true });
      const v = r && r.result ? r.result.value : null;
      if(v && v.ready === "complete" && v.href !== "about:blank"){ siap = true; break; }
      await new Promise(res=>setTimeout(res, 150));
    }
    if(!siap) throw new Error("halaman tidak selesai dimuat dalam 20s: " + spec.url);
    await new Promise(r=>setTimeout(r, spec.settleMs));

    for(const c of spec.checks){
      if(c.type === "wait"){ await new Promise(r=>setTimeout(r, Math.min(10000, Math.max(0, Number(c.ms) || 300)))); hasil.push({ check: c.type, pass: true, ukur: null }); continue; }
      if(c.type === "request" || c.type === "noConsoleError"){
        const v = nilaiCheck(c, null, konteks);
        hasil.push({ check: c.type, pass: v.pass, ukur: c.type === "request" ? konteks.requests.length : konteks.errors.length, alasan: v.alasan || "" });
        if(!v.pass) kurang.push(v.alasan);
        continue;
      }
      const r = await klien.kirim("Runtime.evaluate", { expression: ekspresiCheck(c), returnByValue: true, awaitPromise: true });
      if(r.exceptionDetails) throw new Error("check " + c.type + " melempar error di halaman: " + short(r.exceptionDetails.text, 160));
      const ukur = r.result ? r.result.value : null;
      const v = nilaiCheck(c, ukur, konteks);
      hasil.push({ check: c.type + (c.selector ? " " + c.selector : ""), pass: v.pass, ukur, alasan: v.alasan || "" });
      if(!v.pass) kurang.push(v.alasan);
      if(c.type === "click") await new Promise(r=>setTimeout(r, spec.settleMs));
    }
    return { ok: !kurang.length, kurang, hasil, console: konteks.errors, requests: konteks.requests.length, ms: Date.now() - t0, url: spec.url };
  }catch(e){
    return { ok: false, kurang: ["pengukuran perilaku gagal: " + (e && e.message || e)], hasil, console: konteks.errors, requests: konteks.requests.length, ms: Date.now() - t0, url: spec.url };
  }finally{ bersih(); }
}
