/* Deterministic fixes and audit findings for generated task commands and browser checks. */
import { taskUi } from "../../shared/behavior-spec.mjs";

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
  const ephemeralServerName = code=>{
    let match = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*?\.\s*listen\s*\(\s*0\b/.exec(code);
    if(match) return match[1];
    match = /\b([A-Za-z_$][\w$]*)\s*\.\s*listen\s*\(\s*0\b/.exec(code);
    return match ? match[1] : null;
  };
  const stripWorkspaceCd = value=>String(value).replace(/^\s*(?:cd|pushd)\s+\/workspace(?:\/[^\s;&|]*)?\s*(?:&&|;)\s*/i, "");
  const normalize = value=>stripWorkspaceCd(escapeNewlinesInQuotes(value)).replace(/\bnode(?:\.exe)?\s+--test\s+(?:-e|--eval)\b/gi, match=>
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
  const stripDiagnosticPipes = value=>{
    let out = String(value);
    for(let guard = 0; guard < 20; guard++){
      const markers = shellMarkers(out);
      let changed = false;
      for(let mi = markers.length - 1; mi >= 0; mi--){
        const marker = markers[mi];
        if(marker.ch !== "|" || out[marker.index + 1] === "|" || out[marker.index - 1] === "|") continue;
        let end = out.length;
        for(const next of markers) if(next.index > marker.index){ end = next.index; break; }
        const newline = out.indexOf("\n", marker.index);
        if(newline >= 0 && newline < end) end = newline;
        const segment = out.slice(marker.index + 1, end).trim();
        if(!/^(?:tail|head|cat)\b/i.test(segment)) continue;
        let start = marker.index;
        while(start > 0 && /\s/.test(out[start - 1])) start--;
        out = out.slice(0, start) + out.slice(end);
        changed = true;
        break;
      }
      if(!changed) break;
    }
    return out;
  };
  const fixEphemeralPort = code=>{
    const server = ephemeralServerName(code);
    if(!server) return code;
    return code.replace(/(\bhttps?\s*\.\s*(?:request|get)\s*\(\s*)\{([^{}]*)\}/g, (all, head, body)=>{
      if(/\bport\s*:/.test(body) || !/\b(?:hostname|host)\s*:/.test(body)) return all;
      return head + "{ port: " + server + ".address().port, " + body + "}";
    });
  };
  const source = stripDiagnosticPipes(normalize(command));
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
  const fixed = repair(fixEphemeralPort(extracted.code));
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
  const filesOf = task=>Array.isArray(task && task.files_or_areas) ? task.files_or_areas.map(String)
    : (Array.isArray(task && task.files) ? task.files.map(String) : []);
  const textOf = task=>[task && task.title, task && task.description,
    ...(Array.isArray(task && task.acceptance_criteria) ? task.acceptance_criteria : [])].join(" ");
  const isUi = task=>taskUi(task) && task.ui !== false;
  const serverTemplate = task=>{
    const candidate = tasks.find(item=>item && item !== task
      && item.behavior && typeof item.behavior === "object"
      && item.behavior.server && item.behavior.server.cmd);
    return candidate ? candidate.behavior : null;
  };
  const synthesizedBehavior = task=>{
    const existing = task.behavior && typeof task.behavior === "object" && !Array.isArray(task.behavior)
      ? task.behavior : {};
    const criteria = Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria.join(" ") : "";
    const text = textOf(task) + " " + criteria + " " + filesOf(task).join(" ");
    const explicit = /(https?:\/\/[^\s"'`]+)/i.exec(text);
    const route = /\b(?:route|rute|url|path|halaman)\s*(?:adalah|is|:|=)?\s*(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)/i.exec(text);
    let url = existing.url ? String(existing.url) : "";
    if(!url && explicit) url = explicit[1];
    if(!url && route) url = "http://127.0.0.1:8080" + route[1];
    if(!url){
      const html = filesOf(task).map(file=>file.replace(/\\/g, "/")).find(file=>/\.html?$/i.test(file));
      if(html) url = "http://127.0.0.1:8080/" + html.split("/").pop();
    }
    if(!url) url = "http://127.0.0.1:8080/";
    const checks = Array.isArray(existing.checks) && existing.checks.length
      ? existing.checks
      : [{type:"visible", selector:/\b(?:table|tabel|daftar|list|baris|item|produk)\b/i.test(criteria) ? "table" : "body"}];
    const behavior = Object.assign({}, existing, {url, checks});
    const template = serverTemplate(task);
    if(existing.server && existing.server.cmd) behavior.server = existing.server;
    else if(template) behavior.server = Object.assign({}, template.server, {ready:url});
    else {
      const index = tasks.indexOf(task);
      const serverTask = tasks.slice(0, index).find(candidate=>
        filesOf(candidate).some(file=>/(?:^|\/)server\.js$/i.test(file)));
      const file = serverTask && filesOf(serverTask).find(item=>/(?:^|\/)server\.js$/i.test(item));
      if(file) behavior.server = {cmd:"node " + file.replace(/\\/g, "/"), ready:url, timeoutSec:40};
    }
    return behavior;
  };
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
    const behavior = task.behavior && typeof task.behavior === "object" && !Array.isArray(task.behavior)
      ? task.behavior : null;
    const hasServer = behavior && behavior.server && behavior.server.cmd;
    const nonUiText = [task.title, task.description, ...(Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria : [])].join(" ");
    const hasNonUiEvidence = filesOf(task).length > 0
      || /\b(?:scaffold|fixture|data|model|server|backend|api|database|db|service)\b/i.test(nonUiText);
    if(behavior && !isUi(task) && hasNonUiEvidence && !hasServer){
      delete task.behavior;
      fixes.push((task.id || "?") + ":behavior task non-UI dibuang");
    } else if(isUi(task) && (!behavior || !Array.isArray(behavior.checks) || !behavior.checks.length
      || !/^https?:\/\//i.test(String(behavior.url || "")))){
      task.behavior = synthesizedBehavior(task);
      fixes.push((task.id || "?") + ":behavior UI disintesis");
    }
    if(task.behavior) fixes.push(...sanitizeTaskBehavior(task));
  }
  return fixes;
}

export function lintPlanVerifications(docs){
  const issue = (task, code, message)=>({ stage:"audit", taskId:task.id || "?", code, message });
  const tasks = docs && docs.tasks && Array.isArray(docs.tasks.tasks) ? docs.tasks.tasks : [];
  const issues = [];
  const ephemeralServerName = code=>{
    let match = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*?\.\s*listen\s*\(\s*0\b/.exec(code);
    if(match) return match[1];
    match = /\b([A-Za-z_$][\w$]*)\s*\.\s*listen\s*\(\s*0\b/.exec(code);
    return match ? match[1] : null;
  };
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
  const escapeRe = value=>String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasIssue = (task, code)=>issues.some(item=>item.taskId === (task.id || "?") && item.code === code);
  const filesOf = task=>Array.isArray(task && task.files_or_areas) ? task.files_or_areas.map(String)
    : (Array.isArray(task && task.files) ? task.files.map(String) : []);
  const textOf = task=>[task && task.title, task && task.description,
    ...(Array.isArray(task && task.acceptance_criteria) ? task.acceptance_criteria : []), task && task.agent_hint].join(" ");
  const shellSegments = value=>{
    const out = [];
    let current = "", quote = null, escaped = false;
    for(let i = 0; i < value.length; i++){
      const ch = value[i];
      if(quote){
        current += ch;
        if(escaped) escaped = false;
        else if(ch === "\\") escaped = true;
        else if(ch === quote) quote = null;
        continue;
      }
      if(ch === "'" || ch === '"' || ch === "`"){ quote = ch; current += ch; continue; }
      if((ch === "&" && value[i+1] === "&") || (ch === "|" && value[i+1] === "|")){
        out.push(current); current = ""; i++; continue;
      }
      if(ch === ";" || ch === "\n" || ch === "|"){ out.push(current); current = ""; continue; }
      current += ch;
    }
    out.push(current);
    return out.map(item=>item.trim()).filter(Boolean);
  };
  const classifyArray = expression=>{
    const text = String(expression || "").trim();
    let match;
    if((match = /^([A-Za-z_$][\w$]*)\s*\.\s*length\s*={2,3}\s*0$/.exec(text))) return ["empty", match[1]];
    if((match = /^([A-Za-z_$][\w$]*)\s*\.\s*length\s*!==?\s*0$/.exec(text))) return ["nonempty", match[1]];
    if((match = /^([A-Za-z_$][\w$]*)\s*\.\s*length\s*>\s*0$/.exec(text))) return ["nonempty", match[1]];
    if((match = /^!\s*([A-Za-z_$][\w$]*)\s*\.\s*length$/.exec(text))) return ["empty", match[1]];
    if((match = /^([A-Za-z_$][\w$]*)\s*\[\s*0\s*\]/.exec(text))) return ["nonempty", match[1]];
    return null;
  };
  const arrayExpectations = code=>{
    const out = new Map();
    const add = (name, kind)=>{
      if(!out.has(name)) out.set(name, new Set());
      out.get(name).add(kind);
    };
    const negate = kind=>kind === "empty" ? "nonempty" : "empty";
    let match;
    const conditional = /\bif\s*\(([^()]*)\)\s*(?:\{)?\s*(process\.exit\s*\(\s*1\s*\)|throw\b|assert\.fail)/g;
    while((match = conditional.exec(code))){
      const info = classifyArray(match[1]);
      if(info) add(info[1], negate(info[0]));
    }
    const asserts = [
      [/\bassert\s*\.\s*(?:equal|strictEqual|deepEqual)\s*\(\s*([A-Za-z_$][\w$]*)\s*\.\s*length\s*,\s*0\s*\)/g, "empty"],
      [/\bassert\s*\.\s*(?:equal|strictEqual|deepEqual)\s*\(\s*([A-Za-z_$][\w$]*)\s*\.\s*length\s*,\s*[1-9]\d*\s*\)/g, "nonempty"],
      [/\bassert\s*\.\s*(?:notEqual|notStrictEqual)\s*\(\s*([A-Za-z_$][\w$]*)\s*\.\s*length\s*,\s*0\s*\)/g, "nonempty"],
      [/\bassert\s*\.\s*ok\s*\(\s*([A-Za-z_$][\w$]*)\s*\.\s*length\s*\)/g, "nonempty"],
      [/\bassert\s*\.\s*ok\s*\(\s*([A-Za-z_$][\w$]*)\s*\[\s*0\s*\]/g, "nonempty"]
    ];
    for(const [regex, kind] of asserts){
      while((match = regex.exec(code))) add(match[1], kind);
    }
    return out;
  };
  const contradictoryCommands = verification=>{
    const snippets = shellSegments(verification).map(segment=>{
      const inspection = sanitizeVerificationCommand(segment, true);
      return inspection.code || "";
    }).filter(Boolean);
    if(!snippets.length) return false;
    const expectations = snippets.map(arrayExpectations);
    for(const map of expectations)
      for(const kinds of map.values()) if(kinds.has("empty") && kinds.has("nonempty")) return true;
    for(let i = 0; i < expectations.length; i++)
      for(let j = i + 1; j < expectations.length; j++)
        for(const [name, kinds] of expectations[i]){
          const other = expectations[j].get(name);
          if(!other) continue;
          if((kinds.has("empty") && other.has("nonempty")) || (kinds.has("nonempty") && other.has("empty"))) return true;
        }
    return false;
  };
  const invalidExitArg = code=>{
    let match;
    const calls = /process\.exit\s*\(([^)]*)\)/gi;
    while((match = calls.exec(code))){
      const argument = match[1];
      if(/(['"`])/.test(argument) && !/^\s*(?:Number|parseInt|parseFloat)\s*\(/.test(argument)) return true;
    }
    return false;
  };
  const normalizedPath = value=>String(value == null ? "" : value).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
  const fileLike = /\.(?:html?|css|m?js|cjs|json|ejs|jsx|tsx?|vue|svelte|txt|csv|md|sql|ya?ml)$/i;
  const declaredPaths = new Map();
  const pathsByBase = new Map();
  for(let index = 0; index < tasks.length; index++){
    const task = tasks[index] || {};
    for(const file of filesOf(task)){
      const path = normalizedPath(file);
      if(!path) continue;
      if(!declaredPaths.has(path)) declaredPaths.set(path, {taskId:task.id || "?", index});
      const base = path.split("/").pop();
      if(!pathsByBase.has(base)) pathsByBase.set(base, new Map());
      if(!pathsByBase.get(base).has(path)) pathsByBase.get(base).set(path, {taskId:task.id || "?", index});
    }
  }
  const pathReferences = line=>{
    const refs = [];
    let match;
    const quoted = /(['"`])(\.{1,2}\/[^'"`\s]+)\1/g;
    while((match = quoted.exec(line))) if(fileLike.test(match[2])) refs.push(match[2]);
    const bare = /\b(?:node\s+--check|cat|test\s+-f)\s+(\.{1,2}\/[^\s;&|]+)/g;
    while((match = bare.exec(line))) if(fileLike.test(match[1])) refs.push(match[1]);
    return refs;
  };
  const conflictingPath = (task, raw)=>{
    if(/^\.\.\//.test(raw)) return;
    const path = normalizedPath(raw);
    if(declaredPaths.has(path)) return;
    const base = path.split("/").pop();
    const variants = pathsByBase.get(base);
    if(!variants || !variants.size) return;
    const others = [...variants.keys()].filter(item=>item !== path);
    if(!others.length) return;
    issues.push(issue(task, "conflicting-file-path", "verification merujuk '" + raw + "' tetapi task lain mendeklarasikan '" + others.join("' / '") + "' — samakan path file lintas task."));
  };
  const safeMethods = new Set(["then", "catch", "finally", "toString", "valueOf", "hasOwnProperty", "map", "filter",
    "reduce", "forEach", "push", "pop", "shift", "unshift", "slice", "splice", "join", "split", "trim",
    "toLowerCase", "toUpperCase", "replace", "includes", "indexOf", "length", "name", "default", "constructor",
    "apply", "call", "bind", "keys", "values", "entries", "json", "text", "ok", "status", "listen", "close",
    "address", "on", "once", "emit", "use", "get", "post", "put", "patch", "delete", "all", "static", "set",
    "setHeader", "write", "end", "send", "sendFile", "redirect", "render"]);
  const creatorOf = modulePath=>{
    const entry = declaredPaths.get(normalizedPath(modulePath));
    return entry ? tasks[entry.index] : null;
  };
  const moduleMethod = (task, modulePath, method, seen)=>{
    if(!method || safeMethods.has(method)) return;
    const creator = creatorOf(modulePath);
    if(!creator) return;
    const key = (task.id || "?") + "|" + method;
    if(seen.has(key)) return;
    if(new RegExp("\\b" + escapeRe(method) + "\\b", "i").test(textOf(creator) + " " + String(creator.verification || ""))) return;
    const code = sanitizeVerificationCommand(String(task.verification || ""), true).code || "";
    if(new RegExp("\\b" + escapeRe(method) + "\\s*=", "i").test(code)) return;
    if(new RegExp("\\bfunction\\s+" + escapeRe(method) + "\\b", "i").test(code)) return;
    seen.add(key);
    issues.push(issue(task, "undefined-module-method", "verification memanggil metode '" + method + "' pada modul '" + modulePath + "' tetapi task pembuat '" + (creator.id || "?") + "' tidak pernah mendefinisikan metode itu."));
  };
  const moduleMethods = task=>{
    const verification = String(task.verification || "");
    const seen = new Set();
    let match;
    const binding = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\2\s*\)/g;
    while((match = binding.exec(verification))){
      const call = new RegExp("\\b" + escapeRe(match[1]) + "\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(", "g");
      let hit;
      while((hit = call.exec(verification))) moduleMethod(task, match[3], hit[1], seen);
    }
    const destructure = /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\2\s*\)/g;
    while((match = destructure.exec(verification))){
      for(const raw of match[1].split(",")){
        const name = raw.split(":").pop().trim();
        if(!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
        if(new RegExp("\\b" + escapeRe(name) + "\\s*\\(").test(verification)) moduleMethod(task, match[3], name, seen);
      }
    }
    const direct = /\brequire\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
    while((match = direct.exec(verification))) moduleMethod(task, match[2], match[3], seen);
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
  const routeFileOf = task=>{
    const files = filesOf(task);
    const details = String(task.title || "") + " " + String(task.description || "");
    const serverEntry = files.some(file=>/(?:^|[\\/])server\.js$/i.test(file))
      || (files.some(file=>/(?:^|[\\/])app\.js$/i.test(file))
        && /\b(?:server|express|http|route|routing|rute|static|endpoint)\b/i.test(details));
    const routeModule = files.some(file=>/(?:^|[\\/])(?:routes?|api)[\\/]/i.test(file)
      && !/(?:^|[\\/])(?:public|static|assets|templates|views)[\\/]/i.test(file));
    return serverEntry || routeModule;
  };
  const createsRoute = task=>{
    const details = String(task.title || "") + " " + String(task.description || "");
    const handlerCode = /\b(?:app|router|server|fastify|express)\s*\.\s*(?:get|post|put|patch|delete|all|use|static)\s*\(/i.test(details)
      || /\b(?:express\.static|http\.createServer|createServer\s*\(|serve-static|static\s+(?:file|files|serving|server)|sajikan\s+(?:file|statis|halaman))/i.test(details);
    return routeFileOf(task) || handlerCode;
  };
  const servesBehaviorPath = (task, route)=>{
    const files = filesOf(task);
    const details = files.join(" ") + " " + String(task.title || "") + " " + String(task.description || "");
    const normalizedRoute = route.replace(/\\/g, "/").replace(/^\/+/, "");
    const routeBase = normalizedRoute.split("/").pop().toLowerCase();
    if(normalizedRoute && /\.html?$/i.test(normalizedRoute)
      && files.some(file=>String(file).replace(/\\/g, "/").split("/").pop().toLowerCase() === routeBase)) return true;
    if(routeFileOf(task)) return true;
    const staticServing = /\bexpress\.static\b|\bstatic(?:\s+file|\s+asset|\s+serving| server| files?)\b|serve\s+static/i.test(details);
    const handlerCode = /\b(?:app|router|server|fastify|express)\s*\.\s*(?:get|post|put|patch|delete|all|use|static)\s*\(/i.test(details)
      || /\b(?:http\.createServer|createServer\s*\(|serve-static|sajikan\s+(?:file|statis|halaman))/i.test(details);
    if(normalizedRoute && details.replace(/\\/g, "/").toLowerCase().includes(normalizedRoute.toLowerCase())
      && (staticServing || handlerCode)) return true;
    if(route === "/" && (createsRoute(task) || files.some(file=>/(?:^|[\\/])index\.html?$/i.test(file)))) return true;
    return false;
  };
  const missingEphemeralPort = code=>{
    if(!ephemeralServerName(code)) return false;
    const requests = /\bhttps?\s*\.\s*(?:request|get)\s*\(\s*\{([^{}]*)\}/gi;
    let match;
    while((match = requests.exec(code))){
      if(/\b(?:hostname|host)\s*:/.test(match[1]) && !/\bport\s*:/.test(match[1])) return true;
    }
    return false;
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
      const lineInspection = sanitizeVerificationCommand(line, true);
      if(isNodeEval(line) && invalidExitArg(lineInspection.code || ""))
        issues.push(issue(task, "invalid-verification-exit", "process.exit menerima literal string; Node.js melempar ERR_INVALID_ARG_TYPE dan verification selalu gagal."));
      if(/\brequire\s*\(\s*(['"])(?:\/workspace\/|\/home\/)[^'"]*\1\s*\)|\bcd\s+\/(?:tmp|workspace)(?:\/[^\s;&|]*)?(?:\s|$)/i.test(line))
        issues.push(issue(task, "hardcoded-workspace-path", "verification memakai path absolut khusus lingkungan; gunakan path relatif proyek."));
      if(contradictoryArrayCheck(lineInspection.code || "") && !hasIssue(task, "contradictory-verification"))
        issues.push(issue(task, "contradictory-verification", "verification memeriksa array yang sama sebagai kosong dan sekaligus mengakses elemen pertama."));
      if(lineInspection.code != null && missingEphemeralPort(lineInspection.code))
        issues.push(issue(task, "missing-ephemeral-port", "http.request/http.get memakai listen(0) tetapi tidak memakai port server yang dialokasikan."));
      if(/\|\s*(?:tail|head|cat|tee)\b/i.test(line) && !/\bpipefail\b/i.test(verification))
        issues.push(issue(task, "always-zero-verification", "verification mem-pipe hasil ke tail/head/cat/tee tanpa pipefail, sehingga exit code perintah tes dapat tertelan."));
      const inspection = lineInspection;
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
      for(const ref of pathReferences(line)) conflictingPath(task, ref);
    }
    if(contradictoryCommands(verification) && !hasIssue(task, "contradictory-verification"))
      issues.push(issue(task, "contradictory-verification", "verification memeriksa array yang sama sebagai kosong dan sekaligus mewajibkan elemen pertamanya."));
    moduleMethods(task);
    const criteria = [task.title, task.description, ...(Array.isArray(task.acceptance_criteria) ? task.acceptance_criteria : [])].join(" ");
    if(/\bCSV\b/i.test(criteria) && /\bJSON\b/i.test(verification) && !/\bCSV\b/i.test(verification))
      issues.push(issue(task, "verification-criteria-mismatch", "kriteria task membahas CSV tetapi verification hanya menguji JSON."));
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
