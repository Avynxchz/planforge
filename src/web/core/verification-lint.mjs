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
  const fileExtensionMatch = /\b(?:json|csv|pdf|xlsx|txt)\b/i;
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
      && fileExtensionMatch.test(String(check.matches).replace(/\\/g, "")) && !check.contains){
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
  const requireOnlyExit = command=>{
    if(!/\bnode(?:\.exe)?\s+(?:-e|--eval)\b/i.test(command)
      || !/\brequire\s*\(/i.test(command)
      || !/\bprocess\.exit\s*\(\s*0\s*\)/i.test(command)
      || /\b(?:assert|if|test|it|describe|fetch)\s*(?:\.|\()/i.test(command)
      || /\bhttps?\s*\.\s*(?:request|get)\s*\(/i.test(command)
      || /(?<![=<>!])(?:===|!==|==|!=|<=|>=|<|>)/.test(command)) return false;
    const evalPart = command.replace(/^.*?(?:-e|--eval)\s*/i, "").trim();
    const quote = evalPart[0];
    const code = (quote === "'" || quote === '"' || quote === "`")
      && evalPart.lastIndexOf(quote) > 0
      ? evalPart.slice(1, evalPart.lastIndexOf(quote)) : evalPart;
    const rest = code
      .replace(/\b(?:const|let|var)\s+[\w$]+\s*(?:=\s*(?:require\s*\([^)]*\)|true|false|null|undefined|-?\d+(?:\.\d+)?|(['"`])(?:\\.|(?!\1)[^\\])*\1))?\s*;?/gi, "")
      .replace(/\brequire\s*\([^)]*\)/gi, "")
      .replace(/\bprocess\.exit\s*\(\s*0\s*\)/gi, "")
      .replace(/[;,\s()[\]{}]/g, "");
    return !/\b[\w$]+\s*\(/.test(rest) && !rest;
  };
  const mutatesSource = command=>{
    const sourceFile = /\.(?:js|mjs|ts|html|css|ejs|jsx|tsx)$/i;
    const allowedPath = value=>/(?:^|[\\/])(?:data|tmp|test)(?:[\\/]|$)/i.test(value);
    const calls = /\b(?:writeFileSync|writeFile|appendFileSync)\s*\(/gi;
    let match;
    while((match = calls.exec(command))){
      const start = calls.lastIndex;
      let end = start, depth = 0, quote = null, escaped = false;
      for(; end < command.length; end++){
        const ch = command[end];
        if(quote){
          if(escaped) escaped = false;
          else if(ch === "\\") escaped = true;
          else if(ch === quote) quote = null;
        }else if(ch === "'" || ch === '"' || ch === "`") quote = ch;
        else if(ch === "(") depth++;
        else if(ch === ")"){
          if(depth === 0) break;
          depth--;
        }else if(ch === "," && depth === 0) break;
      }
      const target = command.slice(start, end);
      const names = target.match(/['"`]([^'"`]+)['"`]/g) || [];
      const value = names.map(name=>name.slice(1, -1)).join("/");
      if(sourceFile.test(value) && !allowedPath(value)) return true;
      calls.lastIndex = end + 1;
    }
    const redirects = /(?:^|\s)(?:\d\s*)?>>?\s*["']?([^\s"'|&;]+\.(?:js|mjs|ts|html|css|ejs|jsx|tsx))["']?/gim;
    while((match = redirects.exec(command)))
      if(!allowedPath(match[1])) return true;
    return false;
  };
  const setsUpState = command=>
    /\b(?:writeFileSync|writeFile|unlinkSync|rmSync|seed|reset|truncate)\b|\b(?:DELETE\s+FROM|INSERT\s+INTO)\s+\w+|\bTRUNCATE\s+TABLE\b/i.test(command);
  const createsRoute = task=>{
    const files = Array.isArray(task.files_or_areas) ? task.files_or_areas.map(String) : [];
    const details = String(task.title || "") + " " + String(task.description || "");
    return files.some(file=>/(?:^|[\\/])(?:server|app)\.js$/i.test(file))
      || /\b(?:endpoint|route|routing|dashboard|render(?:ing)?|halaman|rute|dasbor)\b/i.test(details);
  };
  for(let taskIndex = 0; taskIndex < tasks.length; taskIndex++){
    const task = tasks[taskIndex] || {};
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
      if((/\bconsole\.log\s*\([^;\n]{0,300}\?[^;\n]{0,180}\bPASS\b[^;\n]{0,180}:[^;\n]{0,180}\bFAIL\b/i.test(line)
        && !/\bprocess\.exit\s*\(\s*1\s*\)|\bassert(?:\.|\s*\()/i.test(verification))
        || requireOnlyExit(line))
        issues.push(issue(task, "always-zero-verification", "verification tidak menjalankan assertion/kondisi yang dapat menggagalkan proses; hasil gagal bisa tetap exit 0."));
      if(mutatesSource(line))
        issues.push(issue(task, "verification-mutates-source", "verification tidak boleh menulis file sumber proyek; tulis hanya ke data/, tmp/, atau test/."));
      if(/\b(?:tidak ada (?:barang|data|item|produk)|empty|0\s+items?)\b/i.test(line) && !setsUpState(line))
        issues.push(issue(task, "state-dependent-verification", "verification memeriksa kondisi data kosong tanpa menyiapkan atau mereset state yang diperiksa pada perintah yang sama."));
    }
    const behaviorUrl = String(task.behavior && task.behavior.url || "");
    if(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i.test(behaviorUrl)){
      const dependsOn = Array.isArray(task.depends_on) ? task.depends_on.map(String) : [];
      const missing = tasks
        .map((candidate, index)=>({ candidate:candidate || {}, index }))
        .filter(({candidate, index})=>candidate.id !== task.id && createsRoute(candidate)
          && (index > taskIndex || !dependsOn.includes(String(candidate.id))));
      if(missing.length)
        issues.push(issue(task, "behavior-route-order", "behavior localhost mendahului atau tidak bergantung pada task pembuat server/route: "
          + missing.map(x=>x.candidate.id || "?").join(", ") + "."));
    }
  }
  return issues;
}
