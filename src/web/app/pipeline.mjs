/* Model transport, stage execution, full run, repair and questionnaire. */
import { el, esc, escA } from "./dom.mjs";
import { MAIN_STAGES, PROFILES, hasStage, ideaFp, persist, pushHistory, readCfg, saveDocs, seedFor, staleReasons, state, tidyPlan } from "./state.mjs";
import { draw, drawActions, hentiJam, mulaiJam, setStage, showView } from "./views.mjs";
import { DEMO } from "../core/demo.mjs";
import { extractJson } from "../core/plan-normalize.mjs";
import { applyPatches, mergeTaskChunk, taskChunks, terapkanJawabanClarify } from "../core/plan-ops.mjs";
import { validatePlan } from "../core/plan-rules.mjs";
import { STAGES } from "../core/plan-schema.mjs";
import { buildStageMessages } from "../core/prompts.mjs";

export async function tambalNow(btn){
  const cfg = readCfg();
  if(!state.docs.prd){ alert("Belum ada PRD untuk diaudit. Jalankan pipeline dulu."); return; }
  if(cfg.provider === "demo"){ alert("Mode demo tidak bisa menambal — hasilnya sudah tetap. Ganti provider ke OpenRouter dan isi API key."); return; }
  if((PROFILES[cfg.provider]||{}).needsKey && !cfg.apiKey){ el("apiKey").focus(); alert("API key belum diisi."); return; }
  if(btn){ btn.disabled = true; btn.textContent = "menambal…"; }
  el("runAll").disabled = true; el("rerunAll").disabled = true; el("stop").disabled = false;
  state.abort = new AbortController();
  setStage("audit", "run", "menambal…");
  pushHistory("sebelum tambal manual");
  const before = state.issues.length;
  try{
    state.docs.issues = state.issues;
    const patch = await runStage("audit", cfg);
    const res = applyPatches(state.docs, patch);
    state.docs.prd = res.prd; state.docs.roadmap = res.roadmap; state.docs.tasks = res.tasks;
    tidyPlan();
    state.auditNote = "Penambalan " + new Date().toLocaleTimeString("id-ID") + ": " + res.applied + " patch diterapkan"
      + (res.skipped.length ? ", " + res.skipped.length + " dilewati (" + res.skipped.slice(0,3).join("; ") + ")" : "")
      + ". Celah " + before + " → " + state.issues.length + "."
      + (state.issues.length ? " Sisanya biasanya butuh koreksi manual di tab PRD/Tasks — atau jalankan ulang tahap roadmap/tasks dengan preset yang lebih mahal." : " Sekarang bersih.");
    setStage("audit", state.issues.length ? "err" : "done", "tambal " + res.applied + ", sisa " + state.issues.length);
  }catch(e){
    if(e && e.name === "AbortError"){ setStage("audit","err","dibatalkan"); state.auditNote = "Penambalan dibatalkan. Hasil sebelum tambal tetap tersimpan."; }
    else { setStage("audit","err","gagal"); state.auditNote = "Penambalan gagal: " + String(e && e.message || e).slice(0,200); }
  }finally{
    saveDocs();
    el("runAll").disabled = false; el("rerunAll").disabled = false; el("stop").disabled = true; state.abort = null;
    draw("issues");
  }
}

export async function callModel(messages, stage, cfg, controller){
  const signal = controller && controller.signal ? controller.signal : controller;
  if(cfg.provider === "demo"){
    await new Promise(r=>setTimeout(r, 260));
    if(signal && signal.aborted){ const err = new Error("dibatalkan"); err.name = "AbortError"; throw err; }
    return {text: JSON.stringify(DEMO[stage] || {}), usage:{}};
  }
  const model = (cfg.stageModels[stage] || "").trim();
  if(!model) throw new Error("stage " + stage + ": model belum dipilih");
  const url = cfg.baseUrl.replace(/\/$/,"") + "/chat/completions";
  const body = {model, messages};
  if(cfg.temperature != null) body.temperature = cfg.temperature;
  if(cfg.maxTokens) body.max_tokens = Math.round(cfg.maxTokens);
  if(cfg.seedMode) body.seed = seedFor(cfg);
  if(cfg.jsonMode) body.response_format = {type:"json_object"};
  const headers = {"Content-Type":"application/json"};
  if(cfg.apiKey) headers.Authorization = "Bearer " + cfg.apiKey;
  if(cfg.provider === "openrouter"){ headers["HTTP-Referer"] = location.href || "http://localhost"; headers["X-Title"] = "PlanForge"; }
  /* Satu panggilan yang nggak balik jangan bikin pengguna nunggu selamanya tanpa tahu
     apakah modelnya mikir, koneksinya putus, atau kreditnya habis. */
  const BATAS_PANGGILAN_MS = 240000;
  const ctrl = new AbortController();
  let timeout = false;
  const pewaktu = setTimeout(()=>{ timeout = true; ctrl.abort(); }, BATAS_PANGGILAN_MS);
  const henti = ()=>ctrl.abort();
  if(signal) signal.addEventListener("abort", henti, { once:true });
  let res;
  try{
    res = await fetch(url, {method:"POST", headers, body:JSON.stringify(body), signal:ctrl.signal});
  }catch(e){
    if(timeout) throw new Error("model tidak menjawab dalam 240 detik — bisa karena antrean provider, model sedang sibuk, atau jaringan. Coba lagi, ganti model, atau klik Stop. Ini BUKAN tanda kredit habis (itu muncul sebagai HTTP 402).");
    throw e;
  }finally{
    clearTimeout(pewaktu);
    if(signal) signal.removeEventListener("abort", henti);
  }
  const txt = await res.text();
  if(!res.ok){
    let msg = ""; try{ msg = String(JSON.parse(txt).error.message || ""); }catch(e){ msg = txt.slice(0,200); }
    const hint = res.status === 401 ? " (key salah/kedaluwarsa — cek atau tempel ulang)"
      : res.status === 402 ? (cfg.provider === "openrouter"
        ? " (kredit habis / batas kredit key tercapai / anggaran in-flight penuh — cek menu Credits DAN batas di menu Keys OpenRouter, lalu isi kredit atau pakai model :free)"
        : " (provider aktif menolak request: periksa saldo, batas penggunaan, dan konfigurasi akun provider tersebut)")
      : res.status === 403 ? " (provider menolak request karena batas akun, workspace, atau key — cek pengaturan provider)"
      : res.status === 429 ? (cfg.provider === "openrouter"
        ? " (kena rate limit OpenRouter; tunggu sebentar lalu coba lagi, terutama model :free)"
        : " (kena rate limit provider aktif; tunggu sebentar lalu coba lagi)")
      : res.status === 404 ? " (ID model tidak ada di katalog provider)" : "";
    throw new Error("HTTP " + res.status + hint + ": " + msg.slice(0, 260));
  }
  let j; try{ j = JSON.parse(txt); }catch(e){ throw new Error("respons bukan JSON: " + txt.slice(0,200)); }
  if(j.error) throw new Error(String(j.error.message || JSON.stringify(j.error)).slice(0,320));
  const choice = (j.choices && j.choices[0]) || null;
  if(choice && choice.finish_reason === "length"){
    const err = new Error("keluaran terpotong di tahap " + stage + " — " + (cfg.maxTokens
      ? "batas maks output " + cfg.maxTokens + " token kehabisan. Kosongkan kolom “Maks output / tahap” supaya model berhenti sendiri setelah selesai."
      : "tidak ada batas dari kita, jadi modelnya sendiri yang berhenti. Pakai model dengan konteks lebih besar atau pendekkan ide/batasanmu."));
    err.terpotong = true; err.stage = stage;
    throw err;
  }
  const text = choice && choice.message ? choice.message.content : null;
  if(!text) throw new Error("respons tidak punya message.content" + (choice && choice.finish_reason ? " (finish: " + choice.finish_reason + ", kemungkinan terpotong)" : ""));
  return {text, usage:j.usage || {}};
}

export function recordUsage(stage, model, usage){
  state.cost.push({stage, model, p:usage.prompt_tokens||0, c:usage.completion_tokens||0});
  const tot = state.cost.reduce((a,x)=>a+x.p+x.c, 0);
  let money = "";
  if(state.cost.every(x=>state.price[x.model])){
    const sum = state.cost.reduce((a,x)=>a + x.p*(state.price[x.model].prompt||0) + x.c*(state.price[x.model].completion||0), 0);
    money = " ≈ $" + sum.toFixed(5);
  }
  el("costStat").textContent = state.cost.map(x=>x.stage + " " + (x.p+x.c) + "t").join(" · ") + " — total " + tot + " token" + money;
}

export async function runStage(stage, cfg, focus){
  setStage(stage, "run", focus ? (focus.label || "mikir…") : "mikir…");
  mulaiJam(stage);
  try{
  const msgs = buildStageMessages(stage, cfg, state.docs, focus);
  let out;
  try{
    out = await callModel(msgs, stage, cfg, state.abort);
  }catch(e){
    /* Model kecil kehabisan napas: ulang sekali lebih ringkas, bukan gagal mulu (task list & audit). */
    if(e && e.terpotong && cfg.provider !== "demo" && (stage === "tasks" || stage === "audit")){
      setStage(stage, "run", "terpotong — ulang lebih ringkas");
      const note = stage === "tasks"
        ? "Keluaranmu terpotong karena kepanjangan. Ulangi LEBIH RINGKAS: padatkan description jadi 1 kalimat, acceptance_criteria 1-2 butir, agent_hint satu kalimat, behavior cukup 2-3 check yang mengukur. JANGAN mengurangi jumlah task atau membuang fitur/requirement yang wajib ditutup — pendekkan tiap task, bukan potong cakupannya. Balas HANYA satu objek JSON utuh sesuai skema."
        : "Keluaranmu terpotong karena kepanjangan. Ulangi LEBIH RINGKAS: kirim patch hanya untuk celah yang paling penting dulu, tiap object secukupnya, jangan mengulang isi yang sudah benar. Balas HANYA satu objek JSON utuh sesuai skema patches.";
      msgs.push({role:"user", content:note});
      out = await callModel(msgs, stage, cfg, state.abort);
    } else throw e;
  }
  let parsed, tries = 0;
  while(true){
    try{ parsed = extractJson(out.text); break; }
    catch(e){
      if(++tries >= 2 || cfg.provider === "demo") throw e;
      setStage(stage, "run", "perbaikan JSON " + tries + "/2");
      msgs.push({role:"assistant", content:String(out.text).slice(0, 12000)});
      msgs.push({role:"user", content:"Balasanmu bukan objek JSON yang valid (" + e.message + "). Ulangi: keluarkan HANYA objek JSON sesuai skema, tanpa teks lain."});
      out = await callModel(msgs, stage, cfg, state.abort);
    }
  }
  const u = out.usage || {};
  recordUsage(stage, cfg.stageModels[stage], u);
  if(stage === "audit") return parsed;   // patch tidak disimpan sebagai dokumen; sudah diterapkan ke prd/roadmap/tasks
  if(stage === "tasks" && focus) return parsed;   // mode chunk: runAll yang mengakumulasi + menomori, jangan simpan per-chunk
  state.docs[stage] = parsed;
  saveDocs();
  return parsed;
  }finally{ hentiJam(); }
}

export const ERROR_HINTS = [
  ["401", "autentikasi provider ditolak. Periksa key, apakah sudah kedaluwarsa, dan spasi yang ikut ter-paste."],
  ["402", "provider aktif menolak request: periksa saldo, batas penggunaan, dan konfigurasi akun provider tersebut."],
  ["403", "key ini tidak boleh memanggil model itu (mis. model butuh persetujuan pemakaian). Ganti model atau aktifkan di dashboard."],
  ["404", "ID model tidak ada di provider itu. Jangan ketik manual — klik “Muat katalog model” lalu pilih dari daftar."],
  ["429", "kena rate limit. Tunggu 15–30 detik, jalankan lagi, atau pindah ke model lain untuk tahap yang berat."],
  ["502", "server provider sedang bermasalah. Coba model lain atau ulangi sebentar."],
  ["Failed to fetch", "browser tidak bisa mencapai API: periksa jaringan dan base URL, pastikan provider mengizinkan request dari browser, atau pastikan server lokal sudah berjalan."],
  ["AbortError", "run dibatalkan"],
  ["bukan JSON", "provider mengembalikan halaman HTML (sering berarti login/routing di jaringanmu memotong). Cek base URL."],
  ["terpotong", "model berhenti di batas token. Defaultnya sudah tanpa batas — kalau kamu mengisi “Maks output / tahap”, kosongkan lagi. Tahap yang sudah jadi tetap tersimpan, jadi jalankan ulang hanya melanjutkan yang belum."]
];

export function showError(e){
  const msg = String((e && e.message) || e || "kesalahan tidak dikenal");
  const cfg = readCfg();
  const kreditHint = cfg.provider === "openrouter"
    ? "kredit atau batas key OpenRouter tercapai. Periksa menu Credits dan Keys, atau pilih model gratis."
    : "provider aktif menolak request. Periksa saldo, batas penggunaan, dan status layanan provider itu.";
  const running = el("rail").querySelector(".stage.run");
  const at = running ? running.dataset.k : "?";
  if(running) setStage(at, "err", "gagal");
  const low = msg.toLowerCase();
  const hints = ERROR_HINTS.filter(h=>low.includes(h[0].toLowerCase()))
    .map(h=>"<li>" + escA(h[0] === "402" ? kreditHint : h[1]) + "</li>");
  const arahanProvider = cfg.provider === "openrouter"
    ? "<li>Untuk OpenRouter: base URL harus <code>https://openrouter.ai/api/v1</code> dan ID model memakai format <code>publisher/nama-model</code>.</li>"
      + "<li>Model gratis di OpenRouter berakhiran <code>:free</code> — centang “hanya model gratis” kalau kreditmu kosong.</li>"
    : "<li>Periksa base URL, autentikasi, saldo, dan kuota di pengaturan provider yang sedang dipilih.</li>";
  el("out").innerHTML = "<h1>Run berhenti" + (at === "?" ? "" : " di tahap <code>" + escA(at) + "</code>") + "</h1>"
    + "<pre class='bad'>" + escA(msg.slice(0, 700)) + "</pre>"
    + (hints.length ? "<h2>Kemungkinan penyebab &amp; solusinya</h2><ul>" + hints.join("") + "</ul>" : "")
    + "<h2>Cek cepat</h2><ul>"
    + "<li>Klik <b>Muat katalog model</b>. Kalau daftar model saja gagal, masalahnya ada di key atau base URL, bukan di pipeline.</li>"
    + "<li>Ganti provider ke <b>Demo offline</b> lalu jalankan — hasil contoh muncul = aplikasi sehat, jadi sisa masalahnya murni koneksi API.</li>"
    + arahanProvider + "</ul>";
}

/* Kuesioner discovery 5-slot: jeda runAll sampai user menjawab atau melewati.
   Resolve dengan [{question_id, answer}] (answer kosong = dilewati); reject AbortError
   kalau tombol Stop ditekan. Wording & opsi datang dari model (tidak tepercaya) -> di-esc. */
export function tanyaUser(clarify){
  const slot = Array.isArray(clarify && clarify.questions) ? clarify.questions : [];
  const ekstra = Array.isArray(clarify && clarify.ai_questions) ? clarify.ai_questions : [];
  const qs = slot.concat(ekstra);
  return new Promise((resolve, reject)=>{
    let selesai = false;
    const out = el("out");
    const idOf = (q,i)=>String(q && q.id || ((i < slot.length ? "Q-" : "A-") + String(i < slot.length ? i+1 : i-slot.length+1).padStart(3,"0")));
    const blok = qs.map((q,i)=>{
      const id = idOf(q,i);
      const tipe = q.type === "multi" ? "multi" : q.type === "single" ? "single" : "text";
      const opts = (Array.isArray(q.options) ? q.options : []).map(o=>String(o==null?"":o).trim()).filter(Boolean);
      let isi;
      if(tipe === "text" || !opts.length){
        isi = "<input type='text' data-role='text' data-qid='"+esc(id)+"' placeholder='tulis jawabanmu…'>";
      } else {
        const nama = "q-" + i;
        const pilih = opts.map(o=>{
          const v = esc(o);
          const kotak = tipe === "single" ? "radio" : "checkbox";
          const nm = tipe === "single" ? " name='"+nama+"'" : "";
          return "<label class='opt'><input type='"+kotak+"'"+nm+" data-role='opt' data-qid='"+esc(id)+"' value=\""+v+"\"> "+v+"</label>";
        }).join("");
        const other = "<div class='other'><label><input type='"+(tipe==="single"?"radio":"checkbox")+"'"+(tipe==="single"?" name='"+nama+"'":"")+" data-role='opt' data-qid='"+esc(id)+"' value='__other__'> Lainnya:</label>"
          + "<input type='text' data-role='other' data-qid='"+esc(id)+"' placeholder='jawaban lain…'></div>";
        isi = pilih + other;
      }
      return "<div class='q' data-q='"+i+"' data-qid='"+esc(id)+"' data-type='"+tipe+"'>"
        + "<p><span class='pill'>"+esc(i < slot.length ? (q.slot || ("Q-"+(i+1))) : "AI bingung")+"</span> <b>"+esc(q.question||"")+"</b></p>"
        + (i >= slot.length && q.why ? "<p class='hint'>Kenapa ditanya: "+esc(q.why)+"</p>" : "")
        + isi
        + "<label class='skip'><input type='checkbox' data-role='skip' data-qid='"+esc(id)+"'> Lewati pertanyaan ini</label>"
        + "</div>";
    }).join("");
    out.innerHTML = "<h1>Sebelum PRD: " + qs.length + " pertanyaan cepat</h1>"
      + "<p class='hint'>Tentang <b>"+esc(clarify.project_name||"proyekmu")+"</b>"+(clarify.one_liner?" — "+esc(clarify.one_liner):"")+". Jawabanmu jadi sumber utama PRD. Tidak wajib semua — boleh lewati, model pakai tebakannya.</p>"
      + "<p class='hint' id='qCounter'>0/"+qs.length+" terjawab</p>"
      + "<div id='qForm'>"+blok+"</div>"
      + "<div class='row' style='margin-top:12px'>"
      + "<button class='go' id='qKirim' type='button'>Kirim jawaban &amp; lanjut PRD</button>"
      + "<button id='qLewati' type='button'>Lewati semua — pakai tebakan model</button>"
      + "</div>";
    const baca = ()=>{
      const jawab = [];
      out.querySelectorAll(".q").forEach(b=>{
        const id = b.dataset.qid, tipe = b.dataset.type;
        const skip = b.querySelector("[data-role='skip']").checked;
        let ans = "";
        if(!skip){
          if(tipe === "text" || !b.querySelector("[data-role='opt']")){
            const t = b.querySelector("[data-role='text']"); ans = t ? String(t.value||"").trim() : "";
          } else {
            const dipilih = [...b.querySelectorAll("[data-role='opt']")].filter(x=>x.checked).map(x=>x.value);
            const lainEl = b.querySelector("[data-role='other']");
            const lain = lainEl ? String(lainEl.value||"").trim() : "";
            const vals = dipilih.filter(v=>v !== "__other__");
            if(dipilih.includes("__other__") && lain) vals.push(lain);
            ans = vals.join("; ");
          }
        }
        jawab.push({question_id:id, answer:ans});
      });
      return jawab;
    };
    const counter = ()=>{
      const n = baca().filter(a=>a.answer).length;
      const c = out.querySelector("#qCounter"); if(c) c.textContent = n + "/" + qs.length + " terjawab";
    };
    const bersih = ()=>{
      out.removeEventListener("input", onInput);
      out.removeEventListener("change", onChange);
      if(state.abort) state.abort.signal.removeEventListener("abort", onAbort);
    };
    const kirim = (jawab)=>{ if(selesai) return; selesai = true; bersih(); resolve(jawab); };
    const onAbort = ()=>{ if(selesai) return; selesai = true; bersih(); const e = new Error("run dibatalkan"); e.name = "AbortError"; reject(e); };
    const onInput = ()=>counter();
    const onChange = (e)=>{
      const t = e.target;
      if(t && t.dataset && t.dataset.role === "skip"){
        const b = t.closest(".q");
        if(b){ b.dataset.disabled = t.checked ? "1" : "0"; b.querySelectorAll("input:not([data-role='skip'])").forEach(x=>{ x.disabled = t.checked; }); }
      }
      counter();
    };
    out.addEventListener("input", onInput);
    out.addEventListener("change", onChange);
    out.querySelector("#qKirim").addEventListener("click", ()=>kirim(baca()));
    out.querySelector("#qLewati").addEventListener("click", ()=>kirim(qs.map((q,i)=>({question_id:idOf(q,i), answer:""}))));
    if(state.abort){
      if(state.abort.signal.aborted) onAbort();
      else state.abort.signal.addEventListener("abort", onAbort, { once:true });
    }
    counter();
  });
}

export async function runAll(force){
  const cfg = readCfg();
  if(!cfg.idea.trim()){ el("idea").focus(); alert("Tulis idenya dulu, meski singkat."); return; }
  if(cfg.provider !== "demo" && (PROFILES[cfg.provider] || {}).needsKey && !cfg.apiKey){
    el("apiKey").focus(); alert("API key belum diisi. Pilih provider 'Demo offline' untuk mencoba tanpa key."); return;
  }
  if(cfg.provider !== "demo" && !/^https?:\/\/|^http:\/\/localhost/.test(cfg.baseUrl)){ alert("Base URL tidak valid."); return; }
  persist();
  let reuse = !!cfg.reuse && !force;
  const stale = staleReasons();
  if(reuse && stale.length){
    if(!confirm("Hasil yang tersimpan mungkin tidak cocok lagi: " + stale.join(" · ") + ".\n\nOK = tetap pakai hasil yang ada, hanya lanjutkan tahap yang belum\nBatal = buang hasil lama dan ulang semua tahap")) reuse = false;
  }
  const willOverwrite = MAIN_STAGES.filter(s=>hasStage(s) && !(reuse && hasStage(s)));
  if(willOverwrite.length) pushHistory("sebelum ulang: " + willOverwrite.join(", "));
  if(willOverwrite.length){
    state.autoFixes = []; state.auditNote = null;
    for(const s of willOverwrite) delete state.docs[s];
    state.issues = []; saveDocs();
  }
  state.abort = new AbortController();
  state.cost = []; el("costStat").textContent = "";
  el("runAll").disabled = true; el("rerunAll").disabled = true; el("stop").disabled = false;
  let ran = 0, reused = 0;
  try{
    for(const s of MAIN_STAGES){
      if(reuse && hasStage(s)){ reused++; setStage(s, "done", "dipakai lagi"); continue; }
      if(s === "tasks"){
        const chunks = taskChunks(state.docs.roadmap, state.docs.prd);
        if(chunks.length){
          let acc = [];
          for(let ci=0; ci<chunks.length; ci++){
            const focus = Object.assign({}, chunks[ci], {
              existingIds: acc.map(t=>t.id),
              startId: "T-" + String(acc.length+1).padStart(3,"0"),
              label: "milestone " + (ci+1) + "/" + chunks.length
            });
            const part = await runStage("tasks", cfg, focus);
            acc = mergeTaskChunk(acc, (part && part.tasks) || []);
            state.docs.tasks = {tasks: acc}; saveDocs();
            draw(el("tabs").querySelector(".tab.on").dataset.view);
          }
        } else {
          await runStage("tasks", cfg);
        }
        ran++;
      } else {
        await runStage(s, cfg); ran++;
        if(s === "clarify"){
          const cd = state.docs.clarify || {};
          if(cfg.provider !== "demo" && cfg.clarifyInteraktif && ((Array.isArray(cd.questions) && cd.questions.length) || (Array.isArray(cd.ai_questions) && cd.ai_questions.length))){
            setStage("clarify", "run", "menunggu jawabanmu…");
            draw("clarify");
            const jawab = await tanyaUser(cd);
            terapkanJawabanClarify(cd, jawab);
            state.docs.clarify = cd; saveDocs();
          }
        }
      }
      const dd = state.docs[s] || {};
      const note = s === "clarify" ? ((dd.assumptions||[]).length + " asumsi")
        : s === "prd" ? ((dd.requirements||[]).length + " requirement")
        : s === "roadmap" ? ((dd.milestones||[]).length + " milestone")
        : ((dd.tasks||[]).length + " task");
      setStage(s, "done", note);
      draw(el("tabs").querySelector(".tab.on").dataset.view);
    }
    if(ran){ state.ideaFp = ideaFp(); state.genBy = cfg.provider; }  // rekam ide+provider hanya kalau ada tahap yang benar-benar dibuat ulang
    // rapikan dulu (gratis, deterministik) — baru validator, supaya model tidak dibayar untuk kerjaan string
    state.issues = validatePlan(state.docs.prd, state.docs.roadmap, state.docs.tasks);
    const beforeIssues = state.issues.length;
    const nz = tidyPlan();
    if(nz.fixes.length) state.auditNote = "Rapikan otomatis: " + nz.fixes.length + " koreksi bentuk (ID, nama fitur, status task) — celah " + beforeIssues + " → " + state.issues.length + ".";
    if(state.issues.length && cfg.provider !== "demo" && el("autoTambal").checked){
      setStage("audit", "run", state.issues.length + " celah");
      state.docs.issues = state.issues;
      const patch = await runStage("audit", cfg);
      const res = applyPatches(state.docs, patch);
      state.docs.prd = res.prd; state.docs.roadmap = res.roadmap; state.docs.tasks = res.tasks;
      const sisaSebelum = state.issues.length;
      tidyPlan();
      state.auditNote = (nz.fixes.length ? state.auditNote + " " : "") + "Cek rencana: " + res.applied + " patch diterapkan, celah " + sisaSebelum + " → " + state.issues.length + "."
        + (state.issues.length ? " Sisanya perlu dilihat manual di tab Cek rencana." : " Sekarang bersih.");
      setStage("audit", res.applied ? "done" : "err", "tambal " + res.applied + ", sisa " + state.issues.length);
    } else {
      setStage("audit", state.issues.length ? "err" : "done", state.issues.length
        ? state.issues.length + " celah — klik 'Minta AI tambal' di tab Runner/Cek rencana (otomatis dimatikan)"
        : (nz.fixes.length ? "rapi lewat rapikan otomatis" : "bersih"));
    }
    state.docs.issues = state.issues;
    saveDocs();
    drawActions();
    el("costStat").textContent = (reused ? reused + " tahap dipakai lagi · " : "") + ran + " tahap dijalankan";
    showView(state.issues.length ? "issues" : "tasks");   // tab ikut berpindah, tidak cuma isinya
  }catch(e){
    saveDocs();
    if(e.name === "AbortError"){
      for(const s of STAGES) setStage(s.key, hasStage(s.key) ? "done" : "", hasStage(s.key) ? "tersimpan" : "dibatalkan");
      el("out").innerHTML = "<h1>Dibatalkan di tengah</h1><p class='hint'>Tahap yang sudah jadi tetap tersimpan, jadi tombol <b>Jalankan pipeline</b> tinggal melanjutkan dari yang belum.</p>";
    } else showError(e);
  }finally{
    hentiJam();
    el("runAll").disabled = false; el("rerunAll").disabled = false; el("stop").disabled = true; state.abort = null;
  }
}
