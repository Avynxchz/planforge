/* Copy, download, export and GitHub handoff helpers. */
import { el, esc } from "./dom.mjs";
import { readCfg, state, tidyPlan } from "./state.mjs";
import { ensureWorkerSource, gates } from "./runner-config.mjs";
import { makeZip } from "../core/handoff.mjs";
import { buildAgentPrompt, featuresToMd, prdToMd, roadmapToMd, tasksToMd } from "../core/render.mjs";
import { githubPush, githubPushFiles } from "../core/runner-package.mjs";
import { starterAktif, starterFileEntries } from "../core/starter.mjs";

export function copyText(t, btn){
  navigator.clipboard.writeText(t).then(()=>{ const o=btn.textContent; btn.textContent="✓ tersalin"; setTimeout(()=>btn.textContent=o,1400); },
  ()=>{ btn.textContent="gagal salin"; });
}

export function dl(name, text, type){
  const b = new Blob([text], {type: type || "text/plain;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}

export function bundleFiles(){
  tidyPlan();
  const d = state.docs, cfg = readCfg();
  const f = [];
  f.push({name:"PRD.md", data:prdToMd(d.prd)});
  if(d.prd.features) f.push({name:"FEATURES.md", data:featuresToMd(d.prd)});
  if(d.roadmap) f.push({name:"ROADMAP.md", data:roadmapToMd(d.roadmap)});
  if(d.tasks) f.push({name:"TASKS.md", data:tasksToMd(d.tasks)});
  f.push({name:"AGENT_PROMPT.txt", data:buildAgentPrompt(cfg, d)});
  f.push({name:"plan.json", data:JSON.stringify({generatedAt:new Date().toISOString(), brief:d.clarify, prd:d.prd, roadmap:d.roadmap, tasks:d.tasks, issues:state.issues}, null, 2)});
  if(starterAktif(cfg)) for(const e of starterFileEntries()) f.push({name:"starter/"+e.name, data:e.data});
  return f;
}

export function exportBundle(){
  const d = state.docs;
  if(!d.prd){ alert("Belum ada hasil."); return; }
  const zip = makeZip(bundleFiles());
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([zip], {type:"application/zip"}));
  a.download = ((d.prd.project_name||"planforge").replace(/[^\w.-]/g,"_")) + ".zip";
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}

/* Handoff GitHub opsional. Token dibaca dari input password saat push, dipakai hanya di
   header Authorization closure ini, lalu dikosongkan lagi — tidak pernah masuk readCfg,
   localStorage, bundel, atau log. MCP/Connect tetap jalur utama. */
export function githubPanel(){
  const repo = String(state.githubRepo || "");
  const branch = String(state.githubBranch || "main");
  queueMicrotask(()=>{
    const repoInput = el("ghRepo");
    const branchInput = el("ghBranch");
    if(repoInput) repoInput.addEventListener("input", ()=>{ state.githubRepo = repoInput.value; });
    if(branchInput) branchInput.addEventListener("input", ()=>{ state.githubBranch = branchInput.value; });
  });
  return "<h2>Handoff GitHub (opsional)</h2>"
    + "<p class='hint'>Jalur tambahan: push plan + bundel (.planforge/, worker.mjs, starter bila aktif) ke repo GitHub supaya agen coding bisa fetch dari sana. <b>MCP/Connect di atas tetap jalur utama.</b> Token hanya dipakai untuk push ini dan tidak disimpan di browser.</p>"
    + "<div class='row'><div><label>Repo (owner/nama)</label><input type='text' id='ghRepo' value='"+esc(repo)+"' placeholder='agus/warung-kasir'></div>"
    + "<div style='flex:0 0 120px'><label>Branch</label><input type='text' id='ghBranch' value='"+esc(branch)+"'></div></div>"
    + "<label>Token akses GitHub (scope repo)</label><input type='password' id='ghToken' placeholder='github_pat_… / ghp_…' autocomplete='off'>"
    + "<div class='bar'><button class='sm' data-act='ghPush'>⬆ push plan + bundel ke GitHub</button></div>"
    + "<p class='hint' id='ghMsg'></p>";
}

export async function githubPushNow(){
  const msg = el("ghMsg");
  const repo = (el("ghRepo").value||"").trim();
  const branch = (el("ghBranch").value||"").trim() || "main";
  state.githubRepo = repo;
  state.githubBranch = branch;
  const token = (el("ghToken").value||"").trim();
  if(!state.docs || !state.docs.prd){ msg.textContent = "Belum ada hasil planning. Jalankan pipeline dulu."; return; }
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)){ msg.textContent = "Repo harus berbentuk owner/nama."; return; }
  if(!token){ msg.textContent = "Token belum diisi. Token tidak disimpan — isi tiap kali push."; return; }
  msg.textContent = "Menyiapkan bundel…";
  const workerSource = await ensureWorkerSource();
  const files = githubPushFiles(state.docs, {cfg:readCfg(), issues:state.issues, workerSource, gates:gates()});
  msg.textContent = "Push " + files.length + " file ke " + repo + " (" + branch + ")…";
  const http = async (method, path, body)=>{
    const headers = { "Authorization":"Bearer "+token, "Accept":"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28" };
    if(body) headers["Content-Type"] = "application/json";
    const r = await fetch("https://api.github.com"+path, { method, headers, body: body?JSON.stringify(body):undefined });
    let j = null; try{ j = await r.json(); }catch(e){}
    return { status:r.status, json:j };
  };
  const res = await githubPush(files, {repo, branch, message:"PlanForge: plan + bundel handoff"}, http);
  el("ghToken").value = "";
  if(res.ok) msg.innerHTML = "Terpush: <code>"+esc(String(res.commit).slice(0,7))+"</code> · "+res.files+" file · <a href='"+esc(res.url)+"' target='_blank' rel='noopener'>lihat commit</a>";
  else msg.textContent = "Gagal push ("+(res.step||"")+" "+(res.status||"")+"): "+(res.error||"cek repo / token / branch");
}
