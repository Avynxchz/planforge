/* PlanForge core: render HTML/Markdown dan prompt agen eksekutor. */
import { taskUi, behaviorBaris, CONTOH_BEHAVIOR } from "./plan-rules.mjs";
import { erDiagramSvg, sequenceDiagramSvg } from "./diagrams.mjs";

export function renderMarkdown(kind, d, ctx){
  if(!d) return "";
  ctx = ctx || {};
  const esc = (s)=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const ul = (arr)=> !arr ? "<p class='hint'>—</p>" : (typeof arr === "string" ? "<ul><li>"+esc(arr)+"</li></ul>" : (Array.isArray(arr)&&arr.length ? "<ul>" + arr.map(x=>"<li>"+esc(typeof x==="object"?JSON.stringify(x):x)+"</li>").join("") + "</ul>" : "<p class='hint'>—</p>"));
  if(kind === "clarify"){
    const jawab = {}; for(const a of (d.user_answers||[])) jawab[String(a && a.question_id || "")] = String(a && a.answer == null ? "" : a.answer);
    const tanya = (d.questions||[]).map(q=>{
      const j = jawab[String(q.id||"")];
      const status = j == null ? "<span class='hint'>belum dijawab</span>" : (j.trim() ? "<code>"+esc(j)+"</code>" : "<span class='hint'>dilewati</span>");
      return "<li><span class='pill'>"+esc(q.slot||"")+"</span> <b>"+esc(q.question)+"</b><br>"+status
        + ((q.options&&q.options.length)?"<br><span class='hint'>Pilihan: "+esc(q.options.join(" · "))+"</span>":"")+"</li>";
    }).join("");
    const tanyaAi = (d.ai_questions||[]).map(q=>{
      const j = jawab[String(q.id||"")];
      const status = j == null ? "<span class='hint'>belum dijawab</span>" : (j.trim() ? "<code>"+esc(j)+"</code>" : "<span class='hint'>dilewati</span>");
      return "<li><span class='pill'>AI bingung</span> <b>"+esc(q.question)+"</b><br><span class='hint'>Kenapa ditanya: "+esc(q.why||"")+"</span><br>"+status+"</li>";
    }).join("");
    return "<h1>"+esc(d.project_name)+"</h1><p><em>"+esc(d.one_liner)+"</em></p>"
      + "<h2>Brief</h2><p>"+esc(d.brief)+"</p>"
      + "<h2>Alur utama</h2>" + ul(d.primary_workflows)
      + (tanya ? "<h2>Pertanyaan discovery</h2><ul>"+tanya+"</ul>" : "")
      + (tanyaAi ? "<h2>Pertanyaan klarifikasi AI</h2><ul>"+tanyaAi+"</ul>" : "")
      + "<h2>Asumsi</h2><ul>" + (d.assumptions||[]).map(a=>"<li><b>"+esc(a.text)+"</b> <span class='pill'>"+esc(a.confidence)+"</span><br><span class='hint'>"+esc(a.validate)+"</span></li>").join("") + "</ul>"
      + "<h2>Default yang diambil</h2><ul>" + (d.defaults_chosen||[]).map(q=>"<li>"+esc(q.question)+" → <code>"+esc(q.decision)+"</code><br><span class='hint'>"+esc(q.reason)+"</span></li>").join("") + "</ul>"
      + "<h2>Dibuang dari MVP</h2>" + ul(d.cut_from_mvp)
      + "<h2>Sinyal berhasil</h2>" + ul(d.success_signals);
  }
  if(kind === "prd"){
    const pr = (r)=>"<h3><span class='id'>"+esc(r.id)+"</span>"+esc(r.title)
      + "<span class='pill'>"+esc(r.priority||"")+"</span><span class='pill'>"+esc(r.scope||"")+"</span></h3>"
      + "<p>"+esc(r.description)+"</p><ul>" + (r.acceptance_criteria||[]).map(a=>"<li>"+esc(a)+"</li>").join("") + "</ul>";
    const feat = (f)=>"<h3>"+esc(f.name)+" <span class='pill'>"+esc(f.priority||"")+"</span><span class='pill'>"+esc(f.phase||"")+"</span></h3>"
      + "<ul>" + (f.sub_features||[]).map(s=>"<li>"+esc(s)+"</li>").join("") + "</ul>";
    const counts = (d.features||[]).reduce((a,f)=>a+((f.sub_features||[]).length),0);
    return "<h1>PRD — "+esc(d.project_name)+"</h1><p><em>"+esc(d.one_liner)+"</em> <span class='pill'>v"+esc(d.version||"1.0")+"</span>"
      + "<span class='pill'>"+((d.features||[]).length)+" fitur</span><span class='pill'>"+counts+" sub-fitur</span></p>"
      + "<h2>1. Overview</h2><p>"+esc(d.summary || (d.overview && d.overview.summary) || "")+"</p>"
      + "<h3>Masalah</h3><p>"+esc(d.problem&&d.problem.statement)+"</p>"
      + "<p class='hint'>Siapa: "+esc(d.problem&&d.problem.who)+"</p>"
      + "<h3>Alternatif hari ini</h3>" + ul(d.problem&&d.problem.current_alternatives)
      + "<h3>Persona</h3>" + (d.personas||[]).map(p=>"<h4>"+esc(p.name)+"</h4><b>Tujuan</b>"+ul(p.goals)+"<b>Masalah</b>"+ul(p.pains)).join("")
      + "<h3>Tujuan</h3>" + ul(d.goals) + "<h3>Bukan tujuan</h3>" + ul(d.non_goals)
      + "<h2>2. Requirements</h2><h3>Fungsional</h3>" + (d.requirements||[]).map(pr).join("")
      + "<h3>Non-Fungsional</h3>" + (d.non_functional||[]).map(n=>"<p><span class='id'>"+esc(n.id||"N")+"</span><b>"+esc(n.title)+"</b> — <code>"+esc(n.target)+"</code></p>").join("")
      + "<h2>3. Core Features</h2>" + (d.features||[]).map(feat).join("")
      + "<h2>4. User Flow</h2>" + sequenceDiagramSvg(d.flows) + ((d.flows||[]).length?"<p class='hint'>Diagram urutan langkah per alur (dari prd.flows). Pelaku tidak dipisah karena skema hanya menyimpan langkah.</p>":"") + (d.flows||[]).map(f=>"<h3>"+esc(f.name)+(f.phase_ref?" <span class='pill'>"+esc(f.phase_ref)+"</span>":"")+"</h3>"+ul(f.steps)).join("")
      + "<h2>5. Architecture</h2>" + (d.tech||[]).map(t=>"<h3>"+esc(t.decision)+"</h3><p>"+esc(t.rationale)+"</p><span class='hint'>Alternatif: "+esc((t.alternatives||[]).join(", "))+"</span>").join("")
      + (d.template_note?"<p class='hint'>Kerangka awal: "+esc(d.template_note)+"</p>":"")
      + "<h2>6. Database Schema</h2>" + erDiagramSvg(d.data) + ((d.data||[]).length?"<p class='hint'>Garis biru = relasi yang DITEBAK dari nama field (itemId / *_id) atau tipe yang menyebut tabel lain (TxLine[]); bukan FK eksplisit dari model.</p>":"") + (d.data||[]).map(e=>"<h3>"+esc(e.entity)+"</h3><p class='hint'>"+esc(e.note||"")+"</p>"+ul(e.fields)).join("")
      + "<h2>7. Tech Stack</h2>" + ul((d.tech||[]).map(t=>t.decision))
      + "<h2>Risiko</h2>" + (d.risks||[]).map(r=>"<p><span class='pill'>"+esc(r.impact)+"</span> <b>"+esc(r.risk)+"</b><br><span class='hint'>"+esc(r.mitigation)+"</span></p>").join("")
      + "<h2>Metrik</h2>" + (d.metrics||[]).map(m=>"<p><b>"+esc(m.name)+"</b> — "+esc(m.target)+"</p>").join("")
      + "<h2>Pertanyaan terbuka</h2>" + ul((d.open_questions||[]).map(q=>q.question + (q.blocking?" (memblokir)":"")));
  }
  if(kind === "roadmap"){
    const tasksOf = (f)=>((ctx&&ctx.tasks&&ctx.tasks.tasks)||[]).filter(t=>String(t.feature||"").trim().toLowerCase() === String(f).trim().toLowerCase());
    const doneOf = (f)=>tasksOf(f).filter(t=>/selesai/i.test(t.status||"")).length;
    const feats = (ctx&&ctx.prd&&ctx.prd.features)||[];
    return "<h1>Roadmap" + (d.project_name ? " — " + esc(d.project_name) : "") + "</h1>"
      + (d.milestones||[]).map(m=>"<h3><span class='id'>"+esc(m.id)+"</span>"+esc(m.title)
        + "<span class='pill'>"+esc(m.effort||"")+"</span></h3><p>"+esc(m.outcome)+"</p>"
        + "<span class='hint'>Requirement: "+esc((m.requirement_refs||[]).join(", "))+"</span>"
        + (m.feature_refs&&m.feature_refs.length?"<span class='hint'> · Fitur: "+esc(m.feature_refs.join(", "))+"</span>":"")
        + ul(m.exit_criteria)).join("")
      + "<h2>Peta fitur &amp; progres</h2>"
      + (feats.length ? feats.map(f=>{ const n=tasksOf(f.name).length, dn=doneOf(f.name);
          return "<p><b>"+esc(f.name)+"</b> <span class='pill'>"+esc(f.phase||"")+"</span> — " + dn + "/" + n + " task selesai"
            + "<br><span class='hint'>"+esc((f.sub_features||[]).join(" · "))+"</span></p>"; }).join("")
        : "<p class='hint'>Belum ada lapisan fitur.</p>")
      + "<h2>Catatan urutan</h2>" + ul(d.sequencing_notes)
      + "<h2>Rencana rilis</h2>" + (d.release_plan||[]).map(r=>"<p><code>"+esc(r.milestone_ref)+"</code> → "+esc(r.what_ships)+"</p>").join("");
  }
  if(kind === "tasks"){
    const all = (d.tasks||[]);
    const byStatus = {}; for(const t of all){ const k = t.status||"belum mulai"; byStatus[k]=(byStatus[k]||0)+1; }
    const sum = Object.keys(byStatus).length? Object.entries(byStatus).map(([k,v])=>"<span class='pill'>"+esc(k)+": "+v+"</span>").join(" ") : "";
    const groups = new Map();
    for(const t of all){ const k = t.feature || "(tanpa fitur)"; if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(t); }
    const one = (t)=>"<h3><span class='id'>"+esc(t.id)+"</span>"+esc(t.title)
      + "<span class='pill stat' data-tid='"+esc(t.id)+"'>"+esc(t.status||"belum mulai")+"</span>"
      + "<span class='pill'>"+esc(t.size||"")+"</span><span class='pill'>"+esc(t.milestone_ref||"")+"</span></h3>"
      + "<p>"+esc(t.description)+"</p>"
      + "<ul>" + (t.acceptance_criteria||[]).map(a=>"<li>"+esc(a)+"</li>").join("") + "</ul>"
      + "<p class='hint'>Area: "+esc((t.files_or_areas||[]).join(", "))+" &nbsp;·&nbsp; Ref: "+esc((t.requirement_refs||[]).join(", "))
      + " &nbsp;·&nbsp; Tergantung: "+esc((t.depends_on||[]).join(", ")||"-")+"</p>"
      + "<p><b>Verifikasi:</b> <code>"+esc(t.verification||"")+"</code></p>"
      + (behaviorBaris(t).length
        ? "<p><b>Bukti perilaku</b> <span class='hint'>(worker membuka browser dan mengukur sendiri)</span></p><ul>"
          + behaviorBaris(t).map(l=>"<li><code>"+esc(l)+"</code></li>").join("") + "</ul>"
        : (taskUi(t) && t.ui !== false
          ? "<p class='hint'><b>Belum ada bukti perilaku.</b> Task ini menyentuh UI tapi behavior-nya kosong — worker akan menolak menandainya selesai.</p>"
          : ""))
      + (t.agent_hint?"<p class='hint'>Awas: "+esc(t.agent_hint)+"</p>":"")
      + "<details class='bh'><summary>Edit bukti perilaku</summary>"
      + "<textarea data-bh='"+esc(t.id)+"' style='min-height:120px'"+(t.ui===false?" disabled":"")
      + " placeholder='"+esc(JSON.stringify(CONTOH_BEHAVIOR,null,1))+"'>"+esc(t.behavior?JSON.stringify(t.behavior,null,1):"")+"</textarea>"
      + "<label class='hint'><input type='checkbox' data-bhui='"+esc(t.id)+"'"+(t.ui===false?" checked":"")+"> task ini tidak menyentuh UI — lewati bukti browser (tercatat sebagai ui:false, audit tetap menandainya)</label>"
      + "<p class='hint' data-bhmsg='"+esc(t.id)+"'></p>"
      + "<button data-bhsave='"+esc(t.id)+"'>Simpan behavior</button>"
      + "</details>";
    return "<h1>Task list</h1><p>"+all.length+" task " + sum + " <span class='hint'>— klik badge status untuk mengubah</span></p>"
      + [...groups.entries()].map(([f,list])=>"<h2>"+esc(f)+" <span class='pill'>"+list.length+" task</span></h2>"+list.map(one).join("")).join("");
  }
  if(kind === "issues"){
    const list = Array.isArray(d) ? d : [];
    const cx = ctx || {};
    const struktur = Array.isArray(cx.struktur) ? cx.struktur : [];
    const fixesBlock = (cx.fixes && cx.fixes.length ? "<h2>Rapikan otomatis yang sudah diterapkan (" + cx.fixes.length + ")</h2><details><summary>lihat daftar</summary><ul>"
          + cx.fixes.slice(0,40).map(f=>"<li>"+esc(f)+"</li>").join("") + "</ul></details>" : "")
      + (cx.warn && cx.warn.length ? "<h2>Persiapan lingkungan - tidak menahan Connect</h2><ul>" + cx.warn.map(s=>"<li>"+esc(s)+"</li>").join("") + "</ul>" : "");
    const strukturBlock = struktur.length
      ? "<h2>Masalah struktur — gerbang Connect <span class='pill'>" + struktur.length + "</span></h2>"
        + "<p class='hint'>Ini yang menahan tombol Connect/Sinkron di tab Runner, bukan celah rujukan PRD↔task. Kalau starter dipakai, task pertama memang migrasi/delta dan tidak dituntut scaffold.</p>"
        + "<ul class='issues'>" + struktur.map(s=>"<li>"+esc(s)+"</li>").join("") + "</ul>"
      : "";
    const clean = "<h1>Cek konsistensi rencana</h1><p class='ok'>Lolos cek struktur — requirement mvp dirujuk task, tidak ada rujukan rusak, target non-fungsional berupa ukuran, tidak ada siklus dependensi.</p>"
      + "<p class='hint'>Yang diperiksa adalah bentuk dan hubungan dokumen (PRD ↔ roadmap ↔ task list), <b>bukan makna lengkap atau kode</b>. Lolos di sini belum membuktikan setiap acceptance criteria punya tes yang tepat; itu tetap harus dibuktikan saat eksekusi.</p>"
      + fixesBlock;
    if(!list.length) return struktur.length
      ? "<h1>Cek konsistensi rencana</h1><p class='warn'><b>Rujukan PRD↔task bersih, tapi ada " + struktur.length + " masalah struktur yang menahan Connect.</b> Bereskan dulu supaya rencana rusak tidak sampai ke folder proyek.</p>"
        + strukturBlock + fixesBlock
      : clean;
    const GROUPS = [
      {re:/requirement_refs|merujuk requirement/, t:"Rujukan requirement rusak",
       w:"Task atau milestone menyebut ID R-### yang tidak ada di PRD, atau tidak menyebut sama sekali. Agen coding nanti akan mengerjakan task yang tidak terhubung ke spesifikasi apa pun."},
      {re:/feature|fitur/, t:"Nama fitur tidak nyambung",
       w:"Lapisan fitur (prd.features) adalah penghubung PRD → roadmap → tasks. Kalau nama di task beda ejaan/prefix, pengelompokan di TASKS.md jadi pecah dan ada fitur yang tidak tergarap."},
      {re:/belum dicakup|belum punya task/, t:"Ada scope yang tidak dikerjakan",
       w:"Requirement bertanda mvp (atau fitur yang dijanjikan) tidak ditutup task mana pun. Ini bocor di hasil akhir, bukan di kode."},
      {re:/non_functional|non-fungsional|angka terukur/, t:"Target tidak terukur",
       w:"Bagian non-fungsional masih berupa kata sifat ('cepat', 'ringan'). Tanpa angka, tidak ada yang bisa lulus/gagal saat verifikasi."},
      {re:/behavior|task UI tanpa/, t:"Tampilan tidak bisa dibuktikan",
       w:"Task ini menyentuh apa yang dilihat manusia, tapi tidak ada check yang bisa diukur browser. Build dan test hijau tidak berarti grafiknya tergambar atau judulnya ikut berubah — worker akan menolak menandainya selesai sampai behavior-nya diisi."},
      {re:/duplikat|tanpa id|acceptance_criteria kosong|verification kosong|status|siklus|depends_on|milestone_ref/, t:"Struktur task bermasalah",
       w:"ID duplikat, task tanpa verifikasi, status di luar taksonomi, atau dependensi yang memutar. Ini yang paling bikin agen coding nyangkut di tengah jalan."}
    ];
    const buckets = GROUPS.map(g=>({g, items:[]}));
    const other = {g:{t:"Lainnya", w:"Masih perlu dilihat manual."}, items:[]};
    for(const i of list){
      const b = buckets.find(b=>b.g.re.test(i));
      (b ? b.items : other.items).push(i);
    }
    const note = cx.auditNote ? "<p class='hint'>" + esc(cx.auditNote) + "</p>" : "";
    let out = "<h1>Cek konsistensi rencana</h1>"
      + "<p class='warn'><b>Belum siap dieksekusi: " + list.length + " celah integritas.</b> Ini bukan error aplikasi dan belum ada kode yang disentuh — yang diperiksa adalah konsistensi PRD ↔ roadmap ↔ task list.</p>"
      + "<p class='hint'>Model murah sering membuat ID dan nama fitur sendiri yang tidak ada di dokumen hulunya. Mulai dari <b>Rapikan ID &amp; nama fitur</b> (gratis, tanpa AI); kalau masih sisa, baru minta model menambalnya.</p>"
      + "<div class='row tight' style='margin:10px 0 4px'>"
      + "<button class='sm' data-act='tidy'>Rapikan ID &amp; nama fitur</button>"
      + "<button class='sm' data-act='tambal'>Minta model tambal sisanya</button>"
      + "<button class='sm' data-act='tasks'>Lihat task list</button></div>"
      + note + strukturBlock;
    for(const b of buckets.concat([other])){
      if(!b.items.length) continue;
      out += "<h2>" + esc(b.g.t) + " <span class='pill'>" + b.items.length + "</span></h2>"
        + "<p class='hint'>" + esc(b.g.w) + "</p><ul class='issues'>"
        + b.items.slice(0,12).map(i=>"<li>"+esc(i)+"</li>").join("")
        + (b.items.length > 12 ? "<li class='hint'>… +" + (b.items.length-12) + " lagi (klik 'Rapikan' dulu, biasanya sebagian besar hilang)</li>" : "")
        + "</ul>";
    }
    out += fixesBlock;
    return out;
  }
  if(kind === "raw"){
    return "<pre>"+esc(JSON.stringify(d, null, 1))+"</pre>";
  }
  return "<pre>"+esc(JSON.stringify(d,null,1))+"</pre>";
}

export function tasksToMd(d){
  const t = (d.tasks||[]);
  const byStatus = {}; for(const x of t){ const k = x.status||"belum mulai"; byStatus[k]=(byStatus[k]||0)+1; }
  let s = "# Task list\n\n" + t.length + " task — " + Object.entries(byStatus).map(([k,v])=>k+": "+v).join(", ") + "\n\nKerjakan berurutan. Satu task = satu commit. Jangan lanjut kalau verifikasi gagal.\n\n";
  const groups = new Map();
  for(const x of t){ const k = x.feature || "(tanpa fitur)"; if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(x); }
  for(const [f,list] of groups){
    s += "\n# " + f + " (" + list.length + ")\n\n";
    for(const x of list){
      s += "## [" + (/(selesai)/i.test(x.status||"") ? "x" : " ") + "] " + x.id + " — " + x.title + "\n";
      s += "- Status: " + (x.status||"belum mulai") + " | Prioritas: " + (x.priority||"utama") + " | Milestone: " + (x.milestone_ref||"-") + " | Size: " + (x.size||"?") + "\n";
      s += "- Cakupan requirement: " + (x.requirement_refs||[]).join(", ") + "\n";
      s += "- Tergantung pada: " + ((x.depends_on||[]).join(", ") || "tidak ada") + "\n";
      s += "- " + (x.description||"") + "\n";
      s += "  - Area: " + (x.files_or_areas||[]).join(", ") + "\n";
      s += "  - Kriteria selesai:\n" + (x.acceptance_criteria||[]).map(a=>"      - " + a).join("\n") + "\n";
      s += "  - Verifikasi: `" + (x.verification||"") + "`\n";
      const bb = behaviorBaris(x);
      if(bb.length) s += "  - Bukti perilaku (worker membuka browser dan mengukur sendiri):\n" + bb.map(l=>"      - " + l).join("\n") + "\n";
      else if(taskUi(x) && x.ui !== false) s += "  - Bukti perilaku: BELUM ADA — task UI tanpa behavior akan ditolak worker\n";
      if(x.agent_hint) s += "  - Awas: " + x.agent_hint + "\n";
      s += "\n";
    }
  }
  return s;
}
export function prdToMd(d){
  const L=[]; L.push("# PRD — "+(d.project_name||"")); L.push("");
  L.push("> "+(d.one_liner||""), "");
  L.push("## 1. Overview\n"+(d.summary || (d.overview && d.overview.summary) || ""), "");
  L.push("### Masalah\n"+((d.problem&&d.problem.statement)||""), "");
  L.push("### Siapa\n"+((d.problem&&d.problem.who)||""), "");
  if(d.problem&&d.problem.current_alternatives&&d.problem.current_alternatives.length)
    L.push("### Alternatif hari ini\n"+d.problem.current_alternatives.map(g=>"- "+g).join("\n"), "");
  if(d.goals&&d.goals.length) L.push("### Tujuan\n"+d.goals.map(g=>"- "+g).join("\n"), "");
  if(d.non_goals&&d.non_goals.length) L.push("### Bukan tujuan\n"+d.non_goals.map(g=>"- "+g).join("\n"), "");
  L.push("## 2. Requirements", "", "### Fungsional");
  for(const r of d.requirements||[]){
    L.push("", "#### "+r.id+" — "+r.title+" `"+(r.priority||"")+" / "+(r.scope||"")+"`");
    L.push(r.description||"");
    L.push((r.acceptance_criteria||[]).map(a=>"- [ ] "+a).join("\n"));
  }
  if((d.non_functional||[]).length){ L.push("", "### Non-Fungsional");
    for(const n of d.non_functional) L.push("- **"+(n.id||"N")+" "+n.title+"** — `"+(n.target||"")+"`"); }
  if((d.features||[]).length){ L.push("", "## 3. Core Features");
    for(const f of d.features){ L.push("", "### "+f.name+" `"+(f.priority||"")+" / "+(f.phase||"")+"`");
      L.push((f.sub_features||[]).map(s=>"- "+s).join("\n")); } }
  if((d.flows||[]).length){ L.push("", "## 4. User Flow");
    for(const f of d.flows){ L.push("", "### "+f.name+(f.phase_ref?" `"+f.phase_ref+"`":""));
      L.push((f.steps||[]).map((s,i)=>(i+1)+". "+s).join("\n")); } }
  if((d.tech||[]).length){ L.push("", "## 5. Architecture");
    for(const t of d.tech) L.push("- **"+t.decision+"** — "+(t.rationale||"")+(t.alternatives&&t.alternatives.length?" (alternatif: "+t.alternatives.join(", ")+")":""));
    if(d.template_note) L.push("", "Kerangka awal: "+d.template_note); }
  if((d.data||[]).length){ L.push("", "## 6. Database Schema");
    for(const e of d.data){ L.push("", "### "+e.entity+(e.note?" — "+e.note:""));
      L.push((e.fields||[]).map(f=>"- `"+f+"`").join("\n")); } }
  if((d.tech||[]).length){ L.push("", "## 7. Tech Stack");
    for(const t of d.tech) L.push("- "+t.decision); }
  if(d.risks&&d.risks.length){ L.push("", "## Risiko");
    for(const r of d.risks) L.push("- `"+(r.impact||"")+"` "+r.risk+" — "+(r.mitigation||"")); }
  if(d.metrics&&d.metrics.length){ L.push("", "## Metrik");
    for(const m of d.metrics) L.push("- "+m.name+" — "+m.target); }
  return L.join("\n")+"\n";
}
export function featuresToMd(d){
  const feats = (d.features||[]);
  let s = "# Spesifikasi fitur\n\n";
  for(const f of feats){
    s += "## " + f.name + "  (`" + (f.priority||"") + "`, " + (f.phase||"") + ")\n\n";
    for(const sub of f.sub_features||[]) s += "- " + sub + "\n";
    s += "\n";
  }
  return s;
}
export function roadmapToMd(d){
  let s = "# Roadmap\n\n";
  for(const m of d.milestones||[]){
    s += "## "+m.id+" — "+m.title+"  ("+(m.effort||"?")+")\n";
    s += (m.outcome||"") + "\n\n";
    s += "Requirement: " + (m.requirement_refs||[]).join(", ") + "\n\n";
    if((m.feature_refs||[]).length) s += "Fitur: " + m.feature_refs.join(", ") + "\n\n";
    s += (m.exit_criteria||[]).map(c=>"- [ ] "+c).join("\n") + "\n\n";
  }
  if((d.sequencing_notes||[]).length) s += "## Catatan urutan\n" + d.sequencing_notes.map(n=>"- "+n).join("\n") + "\n\n";
  if((d.release_plan||[]).length) s += "## Rencana rilis\n" + d.release_plan.map(r=>"- `"+r.milestone_ref+"` → "+r.what_ships).join("\n") + "\n";
  return s;
}
export function buildAgentPrompt(cfg, docs){
  return [
"Kamu adalah agen coding (" + (cfg.targetAgent || "umum") + ") yang mengeksekusi daftar task di file TASKS.md secara berurutan.",
"Aturan:",
"1. Kerjakan satu task sampai selesai, buat satu commit dengan nama task-nya, lalu lanjut task berikutnya.",
"2. Jangan mulai task yang depends_on-nya belum selesai.",
"3. Setiap task harus lulus langkah Verifikasi-nya sendiri sebelum dianggap selesai. Tulis hasil verifikasi di ringkasan commit.",
"4. Kalau ada task yang tidak bisa diselesaikan karena informasi hilang, berhenti, laporkan persis di task mana dan kenapa, jangan mengarang.",
"5. Jangan menambah fitur di luar requirement yang dirujuk task.",
"6. Ikuti keputusan teknis di PRD.md; kalau terpaksa menyimpang, catat penyimpangannya di akhir.",
"7. Antara dua task, jalankan gerbang kualitas dari .planforge/gates.json (build/test/lint + watchlist) —"
  + " atau suruh runner yang mengatur ritmenya: node worker.mjs run.",
"",
"Konteks produk:", (docs.clarify ? docs.clarify.one_liner : (cfg.idea||"")).slice(0,300),
"",
"Mulai dari task T-001."
  ].join("\n");
}
