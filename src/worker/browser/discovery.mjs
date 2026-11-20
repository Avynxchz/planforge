import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

export const BROWSER_CALON = {
  win32: ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
    "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"]
};

export function cariBrowser(){
  const calon = [process.env.PLANFORGE_BROWSER, ...(BROWSER_CALON[process.platform] || BROWSER_CALON.linux)];
  if(process.env.LOCALAPPDATA) calon.push(path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"));
  for(const p of calon.filter(Boolean)){ try{ if(fs.statSync(p).isFile()) return p; }catch(e){} }
  const cari = spawnSync(process.platform === "win32" ? "where" : "which",
    [process.platform === "win32" ? "msedge" : "chromium"], { encoding: "utf8", timeout: 5000 });
  const jalur = String(cari.stdout || "").split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean)[0];
  return jalur && fs.existsSync(jalur) ? jalur : null;
}
