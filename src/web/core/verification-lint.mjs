/* Deterministic fixes and audit findings for generated task commands and browser checks. */
export function escapeNewlinesInQuotes(command){
  const source = String(command == null ? "" : command);
  let out = "", quote = null, escaped = false;
  for(let i = 0; i < source.length; i++){
    const ch = source[i];
    if((ch === "\n" || ch === "\r") && quote){
      if(ch === "\r" && source[i+1] === "\n") i++;
      out += "\\n";
      escaped = false;
      continue;
    }
    out += ch;
    if(escaped){ escaped = false; continue; }
    if(ch === "\\"){ escaped = true; continue; }
    if(quote){
      if(ch === quote) quote = null;
    }else if(ch === "'" || ch === '"') quote = ch;
  }
  return out;
}

export function sanitizeVerificationCommand(command){
  return escapeNewlinesInQuotes(command).replace(/\bnode(?:\.exe)?\s+--test\s+(?:-e|--eval)\b/gi, match=>
    match.replace(/\s+--test(?=\s)/i, ""));
}

export function sanitizeTaskBehavior(task){
  const largeTextSelectors = /^(?:body|html|main|#app|#root|\.container)$/i;
  const fileExtensionMatch = /\\?\.\\?\(\??(?:[^)]*(?:json|csv|pdf|xlsx|txt))/i;
  const isFileLinkSelector = selector=>/^a(?:\[[^\]]*href[^\]]*\])/i.test(String(selector || "").trim());
  const checks = task && task.behavior && Array.isArray(task.behavior.checks) ? task.behavior.checks : [];
  const fixes = [];
  for(const check of checks){
    if(!check || typeof check !== "object") continue;
    const selector = String(check.selector || "").trim();
    if(check.type === "text" && check.equals != null && largeTextSelectors.test(selector)){
      check.contains = check.equals;
      delete check.equals;
      fixes.push((task.id || "?") + ":text.equals->contains");
    }
    if(check.type === "text" && isFileLinkSelector(selector) && check.matches != null
      && fileExtensionMatch.test(String(check.matches)) && !check.contains){
      delete check.matches;
      delete check.equals;
      check.type = "visible";
      fixes.push((task.id || "?") + ":text.matches->visible");
    }
  }
  return fixes;
}

export function sanitizePlanChecks(docs){
  const tasks = docs && docs.tasks && Array.isArray(docs.tasks.tasks) ? docs.tasks.tasks : [];
  const fixes = [];
  for(const task of tasks){
    if(!task || typeof task !== "object") continue;
    if(task.verification != null){
      const clean = sanitizeVerificationCommand(task.verification);
      if(clean !== task.verification){
        task.verification = clean;
        fixes.push((task.id || "?") + ":verification disanitasi");
      }
    }
    fixes.push(...sanitizeTaskBehavior(task));
  }
  return fixes;
}

export function lintPlanVerifications(docs){
  const issue = (task, code, message)=>({ stage:"audit", taskId:task.id || "?", code, message });
  const tasks = docs && docs.tasks && Array.isArray(docs.tasks.tasks) ? docs.tasks.tasks : [];
  const issues = [];
  for(const task of tasks){
    const verification = String(task && task.verification || "");
    const files = Array.isArray(task && task.files_or_areas) ? task.files_or_areas.map(String) : [];
    for(const line of verification.split(/\r?\n/)){
      if(/\brequire\s*\(\s*(['"])(?:puppeteer|playwright)\1\s*\)|\bimport\s*\(\s*(['"])node-fetch\2\s*\)/i.test(line))
        issues.push(issue(task, "unavailable-dependency", "verification memakai puppeteer/playwright/node-fetch yang belum terpasang."));
      if(/\b(?:kill\s+%1|pkill\s+-f)\b/i.test(line))
        issues.push(issue(task, "unsafe-server-kill", "verification memakai pola kill %1 atau pkill -f; gunakan proses server yang dimiliki task dan tutup secara eksplisit."));
      if(/\b(?:localhost|127\.0\.0\.1):\d+\b/i.test(line) && !/\.listen\s*\(/i.test(line))
        issues.push(issue(task, "dangling-localhost", "verification mengakses localhost tanpa menyalakan server lewat .listen(...) pada perintah yang sama."));
      if(/\bejs\.render\s*\(\s*(['"`])\s*</i.test(line) && !/\bfs\.readFileSync\s*\(/i.test(line))
        issues.push(issue(task, "hardcoded-ejs-template", "verification merender template HTML literal dengan ejs.render; baca file template asli memakai fs.readFileSync."));
      if(/\bhttp\.createServer\s*\(/i.test(line) && files.some(file=>/(?:^|[\\/])(?:server\.js|app\.js|[^\\/]*route[^\\/]*)(?:$|[\\/])/i.test(file)))
        issues.push(issue(task, "stub-application-server", "verification membuat stub http.createServer pada task yang menyentuh server/route aplikasi."));
      if(/\bconsole\.log\s*\([^;\n]{0,300}\?[^;\n]{0,180}\bPASS\b[^;\n]{0,180}:[^;\n]{0,180}\bFAIL\b/i.test(line)
        && !/\bprocess\.exit\s*\(\s*1\s*\)|\bassert(?:\.|\s*\()/i.test(verification))
        issues.push(issue(task, "always-zero-verification", "verification hanya mencetak PASS/FAIL tanpa process.exit(1) atau assert, sehingga hasil gagal tetap bisa exit 0."));
    }
  }
  return issues;
}
