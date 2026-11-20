export function missingNpmScripts(tasks, pkg){
  const scripts = (pkg && pkg.scripts) || {};
  const byId = new Map(tasks.map(t=>[t.id, t]));
  const out = [];
  for(const t of tasks){
    const commands = [t.verification, t.behavior && t.behavior.server && t.behavior.server.cmd].filter(Boolean);
    const declared = (task, name, seen = new Set())=>{
      if(!task || seen.has(task.id)) return false;
      seen.add(task.id);
      const text = [task.description, task.agent_hint, ...(task.acceptance_criteria || [])].join(" ");
      if((task.files_or_areas || []).some(f=>/^\.?\/?package\.json$/.test(f)) && (text.match(/[\w@./:-]+/g) || []).includes(name)) return true;
      return (task.depends_on || []).some(id=>declared(byId.get(id), name, seen));
    };
    for(const command of commands){
      /* Quoted code mentioning npm scripts is not a shell invocation. */
      const shell = String(command).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
      for(const m of shell.matchAll(/(?:^|&&|\|\||;|\n|\|)\s*npm(?:\.cmd)?\s+(?:(?:--silent|--quiet|-[sq])\s+)*(?:run|run-script)\s+(?:(?:--silent|--quiet|--if-present|-[sq])\s+)*([\w:][\w:.-]*)/g)){
        if(Object.hasOwn(scripts, m[1]) || declared(t, m[1])) continue;
        out.push({ id:t.id, msg:"script npm '" + m[1] + "' tidak ada di package.json; tersedia: " + Object.keys(scripts).join(", ") + ". Pakai nama asli atau rencanakan penambahan script + package.json secara eksplisit." });
      }
    }
  }
  return out;
}
