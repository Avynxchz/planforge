import fs from "node:fs";
import { spawnSync } from "node:child_process";

export function browserArgs(tmp, {
  platform = process.platform,
  uid = process.getuid?.(),
  ci = Boolean(process.env.CI),
  container = Boolean(process.env.CONTAINER || process.env.KUBERNETES_SERVICE_HOST ||
    fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv"))
} = {}) {
  const args = [];
  if(platform === "linux" && (uid === 0 || ci || container))
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  return [...args, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", "--remote-allow-origins=*", "--user-data-dir="+tmp, "about:blank"];
}

export function browserSpawnOptions() {
  return { stdio:["ignore","pipe","pipe"], detached:process.platform !== "win32" };
}

export async function closeBrowser(browser) {
  if(browser.pid == null) return;
  if(process.platform === "win32"){
    const result = spawnSync("taskkill", ["/pid", String(browser.pid), "/T", "/F"], {
      encoding:"utf8", timeout:10000
    });
    if((result.error || result.status !== 0) && browser.exitCode === null && browser.signalCode === null)
      browser.kill();
    if(browser.exitCode === null && browser.signalCode === null)
      await Promise.race([
        new Promise(resolve=>browser.once("close", resolve)),
        new Promise(resolve=>setTimeout(resolve, 1000))
      ]);
    if(browser.exitCode === null && browser.signalCode === null)
      throw result.error || new Error(result.stderr || result.stdout || "Unable to stop Chromium");
    return;
  }

  const pid = -browser.pid;
  try{ process.kill(pid, "SIGTERM"); }
  catch(error){ if(error.code !== "ESRCH") throw error; }
  await new Promise(resolve=>setTimeout(resolve, 300));
  try{ process.kill(pid, "SIGKILL"); }
  catch(error){ if(error.code !== "ESRCH") throw error; }
}
