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
  const inspect = arguments[1];
  const normalize = value=>escapeNewlinesInQuotes(value).replace(/\bnode(?:\.exe)?\s+--test\s+(?:-e|--eval)\b/gi, match=>
    match.replace(/\s+--test(?=\s)/i, ""));
  const vm = typeof process !== "undefined" && typeof process.getBuiltinModule === "function"
    ? process.getBuiltinModule("node:vm") : null;
  const parse = code=>{ if(vm) new vm.Script(code); else new Function(code); };
  const nodeEval = value=>{
    const match = /\bnode(?:\.exe)?\s+(?:-e|--eval)\s+/i.exec(value);
    if(!match) return null;
    let start = match.index + match[0].length;
    while(start < value.length && /\s/.test(value[start])) start++;
    const quote = value[start] === "'" || value[start] === '"' ? value[start] : null;
    const codeStart = start + (quote ? 1 : 0);
    if(!quote) return { code:value.slice(codeStart), start:codeStart, end:value.length, quote:null, closed:true };
    let escaped = false;
    for(let i=codeStart; i<value.length; i++){
      const ch = value[i];
      if(escaped){ escaped = false; continue; }
      if(ch === "\\"){ escaped = true; continue; }
      if(ch === quote)
        return { code:value.slice(codeStart, i), start:codeStart, end:i, quote, closed:true, suffixStart:i+1 };
    }
    return { code:value.slice(codeStart), start:codeStart, end:value.length, quote, closed:false };
  };
  const delimiterState = code=>{
    const stack = [];
    let quote = null, escaped = false, lineComment = false, blockComment = false, mismatch = false;
    const pairs = {")":"(", "}":"{", "]":"["};
    for(let i=0; i<code.length; i++){
      const ch = code[i], next = code[i+1];
      if(lineComment){ if(ch === "\n") lineComment = false; continue; }
      if(blockComment){ if(ch === "*" && next === "/"){ blockComment = false; i++; } continue; }
      if(quote){
        if(escaped) escaped = false;
        else if(ch === "\\") escaped = true;
        else if(ch === quote) quote = null;
        continue;
      }
      if(ch === "/" && next === "/"){ lineComment = true; i++; continue; }
      if(ch === "/" && next === "*"){ blockComment = true; i++; continue; }
      if(ch === "'" || ch === '"' || ch === "`"){ quote = ch; continue; }
      if(ch === "(" || ch === "{" || ch === "[") stack.push(ch);
      else if(pairs[ch]){
        if(stack[stack.length-1] === pairs[ch]) stack.pop();
        else mismatch = true;
      }
    }
    return { stack, quote, blockComment, mismatch };
  };
  const repair = code=>{
    let candidate = code;
    try{ parse(candidate); return candidate; }catch(e){}
    if(/\]\s*$/.test(candidate)){
      const withoutTrailingBracket = candidate.replace(/\]\s*$/, "");
      try{ parse(withoutTrailingBracket); return withoutTrailingBracket; }catch(e){}
    }
    const state = delimiterState(candidate);
    if(state.quote || state.blockComment || state.mismatch) return null;
    const closing = { "(":")", "{":"}", "[":"]" };
    candidate += state.stack.slice().reverse().map(ch=>closing[ch]).join("");
    try{ parse(candidate); return candidate; }catch(e){ return null; }
  };
  const shellMarkers = value=>{
    let quote = null, escaped = false;
    const markers = [];
    for(let i=0; i<value.length; i++){
      const ch = value[i];
      if(quote === "'"){ if(ch === "'") quote = null; continue; }
      if(escaped){ escaped = false; continue; }
      if(ch === "\\" && quote !== "'"){ escaped = true; continue; }
      if(quote){ if(ch === quote) quote = null; continue; }
      if(ch === "'" || ch === '"'){ quote = ch; continue; }
      if(ch === "&" || ch === "|") markers.push({ ch, index:i });
    }
    return markers;
  };
  const source = normalize(command);
  if(inspect){
    const extracted = nodeEval(source);
    let syntaxError = null;
    if(extracted) try{ parse(extracted.code); }catch(e){ syntaxError = e; }
    const markers = shellMarkers(source);
    const last = markers[markers.length-1];
    const fallback = markers.some((marker,index)=>{
      if(marker.ch !== "|" || source[marker.index+1] !== "|") return false;
      const next = markers.slice(index+1).find(item=>item.index > marker.index+1);
      const shellFallback = source.slice(marker.index+2, next ? next.index : source.length).trim();
      return /^(?:echo\b|true\b|:\s*(?:$|\s))/i.test(shellFallback);
    });
    return {
      code:extracted && extracted.code, syntaxError, fallback,
      background:!!last && last.ch === "&" && source[last.index+1] !== "&" && source.slice(last.index+1).trim() === ""
    };
  }
  const extracted = nodeEval(source);
  if(!extracted) return source;
  const fixed = repair(extracted.code);
  let out = fixed == null || fixed === extracted.code ? source
    : source.slice(0, extracted.start) + fixed + source.slice(extracted.end);
  let current = nodeEval(out);
  if(current && current.quote && !current.closed && fixed != null){
    out += current.quote;
    current = nodeEval(out);
  }
  if(current && current.closed && current.suffixStart != null){
    const suffix = out.slice(current.suffixStart);
    if(/^\s*(?:\]|\s*\]|\s*["']\s*\])\s*$/.test(suffix))
      out = out.slice(0, current.suffixStart) + suffix.replace(/^\s*["']?\s*\]\s*$/, "");
  }
  return out;
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
      const clean = sanitizeVerificationCommand(task.verification)
        .replace(/\brequire\s*\(\s*(['"])\/workspace\//gi, "require($1./");
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
  const isNodeEval = command=>/\bnode(?:\.exe)?\s+(?:-e|--eval)\s+/i.test(command);
  const localRequire = code=>/\brequire\s*\(\s*(['"])(?:\.{1,2}\/)/i.test(code);
  const smokeRequireOnly = code=>{
    if(!localRequire(code)) return false;
    const rest = code
      .replace(/\b(?:const|let|var)\s+(?:\{[^}]*\}|\[[^\]]*\]|[\w$]+)\s*=\s*require\s*\([^)]*\)\s*;?/gi, "")
      .replace(/\brequire\s*\([^)]*\)\s*;?/gi, "")
      .replace(/[;\s()[\]{}]/g, "");
    return rest === "";
  };
  const hasFailureMechanism = code=>
    /\bprocess\.exit\s*\(\s*(?!0\s*\))/i.test(code)
    || /\bprocess\.exitCode\s*=\s*(?!0\b)/i.test(code)
    || /\bassert(?:\.|\s*\()/i.test(code)
    || /\bthrow\b/i.test(code)
    || (/\b(?:fetch|https?\s*\.\s*(?:request|get))\s*\(/i.test(code)
      && /\.\s*(?:ok|status)\b/i.test(code)
      && /\b(?:if|assert|throw)\b/i.test(code));
  const alwaysZeroNodeEval = code=>{
    if(!isNodeEval(code)) return false;
    const inspection = sanitizeVerificationCommand(code, true);
    const source = inspection.code || "";
    const outcomesOnly = /\bconsole\.log\s*\([^;\n]{0,400}\?\s*(['"`])(?:OK|PASS)\1\s*:\s*(['"`])FAIL\2/i.test(source);
    const statusOutput = /\bconsole\.log\s*\(\s*(['"`])(?:PASS|valid|OK)\1\s*\)/i.test(source);
    const exitsZero = /\bprocess\.exit\s*\(\s*0\s*\)/i.test(source);
    if((outcomesOnly || (statusOutput && exitsZero)) && !hasFailureMechanism(source)) return true;
    if(!hasFailureMechanism(source) && !smokeRequireOnly(source)) return true;
    return false;
  };
  const contradictoryArrayCheck = code=>{
    const empty = /\b([A-Za-z_$][\w$]*)\s*\.\s*length\s*={2,3}\s*0\b/g;
    let match;
    while((match = empty.exec(code))){
      const name = match[1];
      const remainder = code.slice(empty.lastIndex);
      if(new RegExp("^\\s*&&\\s*" + name + "\\s*\\[\\s*0\\s*\\]\\s*\\.").test(remainder)) return true;
      const reverse = code.slice(0, match.index);
      if(new RegExp("\\b" + name + "\\s*\\[\\s*0\\s*\\]\\s*\\.[\\w$]+[^&]*&&\\s*$").test(reverse)) return true;
    }
    return false;
  };
  const hasLocalServerImport = line=>{
    const declarations = /\b(?:const|let|var)\s+([\w$]+)\s*=\s*require\s*\(\s*(['"])(\.{1,2}\/[^'"]*(?:server|app)[^'"]*)\2\s*\)/gi;
    let match;
    while((match = declarations.exec(line))){
      const use = new RegExp("\\bhttp\\.createServer\\s*\\(\\s*" + match[1] + "\\s*\\)", "i");
      if(use.test(line)) return true;
    }
    return false;
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
    const files = Array.isArray(task.files_or_areas) ? task.files_or_areas.map(String)
      : (Array.isArray(task.files) ? task.files.map(String) : []);
    const details = String(task.title || "") + " " + String(task.description || "");
    return files.some(file=>/(?:^|[\\/])(?:server|app)\.js$/i.test(file)
      || /(?:^|[\\/])(?:routes?|api|server)(?:[\\/]|\.|$)/i.test(file))
      || /\b(?:buat|membuat|definisikan|implement(?:asikan)?|tambahkan|add|create|build|develop)\b.{0,50}\b(?:endpoint|route|routing|rute|server|dashboard|halaman|dasbor)\b/i.test(details)
      || /\b(?:endpoint|route|routing|rute|server)\b.{0,50}\b(?:dibuat|ditambahkan|dibangun|diimplementasikan)\b/i.test(details);
  };
  const servesBehaviorPath = (task, route)=>{
    const files = Array.isArray(task.files_or_areas) ? task.files_or_areas.map(String)
      : (Array.isArray(task.files) ? task.files.map(String) : []);
    const details = files.join(" ") + " " + String(task.title || "") + " " + String(task.description || "");
    const normalizedRoute = route.replace(/\\/g, "/").replace(/^\/+/, "");
    if(normalizedRoute && details.replace(/\\/g, "/").toLowerCase().includes(normalizedRoute.toLowerCase())) return true;
    const serverFile = files.some(file=>/(?:^|[\\/])(?:server|app)\.js$/i.test(file));
    const staticServing = /\bexpress\.static\b|\bstatic(?:\s+file|\s+asset|\s+serving| server| files?)\b|serve\s+static/i.test(details);
    if(serverFile && staticServing) return true;
    return route === "/" && createsRoute(task);
  };
  const routeDependencies = (task, taskIndex, route)=>{
    if(servesBehaviorPath(task, route)) return true;
    const byId = new Map(tasks.map((candidate,index)=>[String(candidate && candidate.id || ""), { candidate:candidate || {}, index }]));
    const pending = Array.isArray(task.depends_on) ? task.depends_on.map(String) : [];
    const seen = new Set();
    while(pending.length){
      const id = pending.pop();
      if(seen.has(id)) continue;
      seen.add(id);
      const dependency = byId.get(id);
      if(!dependency || dependency.index >= taskIndex) continue;
      if(servesBehaviorPath(dependency.candidate, route)) return true;
      pending.push(...(Array.isArray(dependency.candidate.depends_on) ? dependency.candidate.depends_on.map(String) : []));
    }
    return false;
  };
  const verificationModuleRefs = line=>{
    const refs = [];
    const regex = /\brequire\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/gi;
    let match;
    while((match = regex.exec(line))) refs.push(match[2].replace(/\\/g, "/").replace(/^\.\//, ""));
    return refs;
  };
  const fieldPairs = [["nama","name"],["jumlah","quantity"],["lokasi","location"]];
  const taskList = tasks.map(task=>task || {});
  const allCriteria = taskList.flatMap(task=>
    [task.title, task.description, ...(Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria : [])]).join(" ");
  const allVerifications = taskList.map(task=>String(task.verification || "")).join("\n");
  const languageMix = fieldPairs.some(([local, english])=>
    new RegExp("\\b" + local + "\\b", "i").test(allCriteria)
    && new RegExp("\\." + english + "\\b", "i").test(allVerifications)
    || new RegExp("\\b" + english + "\\b", "i").test(allCriteria)
    && new RegExp("\\." + local + "\\b", "i").test(allVerifications));
  const serverPaths = new Set();
  for(let taskIndex = 0; taskIndex < tasks.length; taskIndex++){
    const task = tasks[taskIndex] || {};
    const verification = String(task && task.verification || "");
    const files = Array.isArray(task && task.files_or_areas) ? task.files_or_areas.map(String) : [];
    for(const match of verification.matchAll(/\brequire\s*\(\s*(['"])(\.{1,2}\/(?:src\/)?server\.js)\1\s*\)/gi))
      serverPaths.add(match[2].replace(/\\/g, "/"));
    for(const line of verification.split(/\r?\n/)){
      if(/\brequire\s*\(\s*(['"])(?:puppeteer|playwright)\1\s*\)|\bimport\s*\(\s*(['"])node-fetch\2\s*\)/i.test(line))
        issues.push(issue(task, "unavailable-dependency", "verification memakai puppeteer/playwright/node-fetch yang belum terpasang."));
      if(/\b(?:kill\s+%1|pkill\s+-f)\b/i.test(line))
        issues.push(issue(task, "unsafe-server-kill", "verification memakai pola kill %1 atau pkill -f; gunakan proses server yang dimiliki task dan tutup secara eksplisit."));
      if(/\b(?:localhost|127\.0\.0\.1):\d+\b/i.test(line) && !/\.listen\s*\(/i.test(line))
        issues.push(issue(task, "dangling-localhost", "verification mengakses localhost tanpa menyalakan server lewat .listen(...) pada perintah yang sama."));
      if(/\bejs\.render\s*\(\s*(['"`])\s*</i.test(line) && !/\bfs\.readFileSync\s*\(/i.test(line))
        issues.push(issue(task, "hardcoded-ejs-template", "verification merender template HTML literal dengan ejs.render; baca file template asli memakai fs.readFileSync."));
      if(/\bhttp\.createServer\s*\(/i.test(line) && files.some(file=>/(?:^|[\\/])(?:server\.js|app\.js|[^\\/]*route[^\\/]*)(?:$|[\\/])/i.test(file))
        && !hasLocalServerImport(line))
        issues.push(issue(task, "stub-application-server", "verification membuat stub http.createServer pada task yang menyentuh server/route aplikasi."));
      if((/\bconsole\.log\s*\([^;\n]{0,400}\?\s*(['"`])(?:OK|PASS)\1\s*:\s*(['"`])FAIL\2/i.test(line)
        && !hasFailureMechanism(verification))
        || alwaysZeroNodeEval(line))
        issues.push(issue(task, "always-zero-verification", "verification tidak menjalankan assertion/kondisi yang dapat menggagalkan proses; hasil gagal bisa tetap exit 0."));
      if(isNodeEval(line) && /\bprocess\.exit\s*\(\s*(['"])[^'"]*\1\s*\)/i.test(sanitizeVerificationCommand(line, true).code || ""))
        issues.push(issue(task, "invalid-verification-exit", "process.exit menerima literal string; Node.js melempar ERR_INVALID_ARG_TYPE dan verification selalu gagal."));
      if(/\brequire\s*\(\s*(['"])(?:\/workspace\/|\/home\/)[^'"]*\1\s*\)|\bcd\s+\/tmp(?:\/|\s|$)/i.test(line))
        issues.push(issue(task, "hardcoded-workspace-path", "verification memakai path absolut khusus lingkungan; gunakan path relatif proyek."));
      if(contradictoryArrayCheck(sanitizeVerificationCommand(line, true).code || ""))
        issues.push(issue(task, "contradictory-verification", "verification memeriksa array yang sama sebagai kosong dan sekaligus mengakses elemen pertama."));
      const inspection = sanitizeVerificationCommand(line, true);
      if(inspection.background)
        issues.push(issue(task, "unsafe-background-process", "verification menjalankan proses latar belakang dengan '&'; proses dapat lolos dari gerbang dan tetap hidup setelah pemeriksaan."));
      if(inspection.fallback)
        issues.push(issue(task, "always-zero-verification", "verification memakai fallback shell '|| echo/true/:' yang menelan kegagalan dan dapat mengembalikan exit code 0."));
      if(inspection.code != null && inspection.syntaxError)
        issues.push(issue(task, "invalid-verification-syntax", "kode JavaScript pada node -e tidak valid: " + String(inspection.syntaxError.message || inspection.syntaxError)));
      if(mutatesSource(line))
        issues.push(issue(task, "verification-mutates-source", "verification tidak boleh menulis file sumber proyek; tulis hanya ke data/, tmp/, atau test/."));
      if(/\b(?:tidak ada (?:barang|data|item|produk)|empty|0\s+items?)\b/i.test(line) && !setsUpState(line))
        issues.push(issue(task, "state-dependent-verification", "verification memeriksa kondisi data kosong tanpa menyiapkan atau mereset state yang diperiksa pada perintah yang sama."));
    }
    const behaviorUrl = String(task.behavior && task.behavior.url || "");
    if(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i.test(behaviorUrl)){
      const route = new URL(behaviorUrl).pathname || "/";
      const creators = tasks.map((candidate,index)=>({ candidate:candidate || {}, index }))
        .filter(({index,candidate})=>index !== taskIndex && createsRoute(candidate));
      if(!routeDependencies(task, taskIndex, route))
        issues.push(issue(task, "behavior-route-order", "behavior " + route + " mendahului atau tidak bergantung pada task yang secara spesifik menyajikan/mendefinisikan route tersebut: "
          + (creators.map(x=>x.candidate.id || "?").join(", ") || "task route/static tidak ditemukan") + "."));
    }
    for(const ref of verificationModuleRefs(verification)){
      const prior = taskList.slice(0, taskIndex).findIndex(candidate=>
        (Array.isArray(candidate.files_or_areas) ? candidate.files_or_areas : [])
          .some(file=>String(file).replace(/\\/g, "/").replace(/^\.\//, "") === ref));
      if(prior >= 0 && !(Array.isArray(task.depends_on) && task.depends_on.length))
        issues.push(issue(task, "missing-module-dependency", "task merujuk modul " + ref + " dari task sebelumnya tetapi tidak memiliki depends_on."));
    }
  }
  if(serverPaths.size > 1)
    issues.push(issue(taskList[taskList.length - 1] || {}, "split-server-entry-path", "verification memakai lebih dari satu path entry server dalam satu plan: " + [...serverPaths].join(", ") + "."));
  if(languageMix)
    issues.push(issue(taskList[taskList.length - 1] || {}, "mixed-model-field-language", "kriteria/task dan assertion verification mencampur nama properti model Indonesia dan Inggris."));
  return issues;
}
