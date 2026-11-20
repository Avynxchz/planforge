/* Model catalog, stage model picker and cost estimate UI. */
import { el, escA } from "./dom.mjs";
import { PROFILES, STAGE_KEYS, STAGE_MODEL_DEFAULT, persist, readCfg, state } from "./state.mjs";

export const PRESETS = {
  hemat:    {clarify:"z-ai/glm-5.3-flash", prd:"z-ai/glm-5.3-flash", roadmap:"z-ai/glm-5.3-flash", tasks:"minimax/minimax-m3.1-flash", audit:"z-ai/glm-5.3-flash"},
  seimbang: {clarify:"deepseek/deepseek-v4.1-flash", prd:"deepseek/deepseek-v4.1-flash", roadmap:"deepseek/deepseek-v4.1-flash", tasks:"qwen/qwen3-coder-flash", audit:"deepseek/deepseek-v4.1-flash"},
  kualitas: {clarify:"deepseek/deepseek-v4.1-flash-1017", prd:"moonshotai/kimi-k2.6", roadmap:"deepseek/deepseek-v4.1-flash-1017", tasks:"qwen/qwen3-coder", audit:"deepseek/deepseek-v4.1-flash-1017"}
};

/* perkiraan [token masukan, token keluaran] per tahap untuk satu jalan penuh */
export const STAGE_TOKEN_GUESS = {clarify:[2400,1300], prd:[3400,3600], roadmap:[5000,2400], tasks:[6000,1800], audit:[6800,3000]};

export const IDR = 16500;

export const priceOf = (id)=>state.price[String(id||"").trim()] || null;

export const fmtMoney = (v)=>"$" + (v < 0.01 ? v.toFixed(4) : v.toFixed(3));

export const perM = (v)=>"$" + (Number(v)*1e6).toFixed(2);

export function shortName(id){ const s = String(id||"").split("/"); return s[s.length-1]; }

export function currentModels(){
  const out = {};
  for(const s of STAGE_KEYS){
    const i = document.querySelector('input[type=hidden][data-stage="' + s + '"]');
    out[s] = i ? i.value.trim() : (state.stageModels[s] || STAGE_MODEL_DEFAULT[s] || "");
  }
  return out;
}

export function renderStageModelInputs(){
  const wrap = el("stageModels"); wrap.innerHTML = "";
  const saved = state.stageModels || {};
  const isDemo = el("provider").value === "demo";
  for(const s of STAGE_KEYS){
    const id = saved[s] || STAGE_MODEL_DEFAULT[s];
    const cat = state.catalog[id] || null;
    const p = priceOf(id);
    const free = p && !p.prompt && !p.completion;
    const row = document.createElement("div");
    row.className = "srow" + (state.pickerStage === s ? " on" : "");
    row.dataset.row = s;
    row.innerHTML = '<span class="st">' + s + '</span>' +
      '<span class="nm" title="' + escA(id) + '">' + escA(shortName(id)) +
        (cat && cat.ctx ? '<span class="tag">' + Math.round(cat.ctx/1000) + 'k</span>' : '') +
        (free ? '<span class="tag free">gratis</span>' : '') + '</span>' +
      '<span class="pr">' + (isDemo ? "demo: model tak dipakai"
        : p ? perM(p.prompt) + "/" + perM(p.completion) + "/M"
        : (state.modelCatalog.length ? (state.varPrice[id] ? "harga bervariasi" : "harga tak dikenal") : "muat katalog")) + '</span>' +
      '<button class="pick sm" data-pick="' + s + '">' + (state.pickerStage === s ? "tutup" : "ganti") + '</button>';
    wrap.appendChild(row);
    const hidden = document.createElement("input");
    hidden.type = "hidden"; hidden.dataset.stage = s; hidden.value = id;
    wrap.appendChild(hidden);
  }
  const cur = currentModels();
  for(const b of el("presets").querySelectorAll("button")){
    const pr = PRESETS[b.dataset.preset] || {};
    b.classList.toggle("on", STAGE_KEYS.every(s=>cur[s] === pr[s]));
  }
  updateCostGuess();
}

export function setStageModel(stage, id, allStages){
  const targets = allStages ? STAGE_KEYS : [stage];
  for(const s of targets){
    let h = document.querySelector('input[type=hidden][data-stage="' + s + '"]');
    if(!h){ h = document.createElement("input"); h.type="hidden"; h.dataset.stage = s; el("stageModels").appendChild(h); }
    h.value = id;
    state.stageModels = Object.assign({}, state.stageModels, {[s]: id});
  }
  persist(); renderStageModelInputs();
}

export function openPicker(stage){
  state.pickerStage = state.pickerStage === stage ? null : stage;
  el("picker").hidden = !state.pickerStage;
  renderStageModelInputs();
  if(state.pickerStage){
    if(!state.modelCatalog.length && PROFILES[el("provider").value].listable){ el("modelStat").textContent = "memuat katalog…"; loadModels(); }
    renderModelList();
    el("manualModel").value = currentModels()[stage] || "";
    el("picker").scrollIntoView({block:"nearest"});
    el("modelSearch").focus();
  }
}

export function modelMatches(m, q){
  if(!q.length) return true;
  const hay = (m.id + " " + (m.name||"") + " " + (m.description||"")).toLowerCase();
  return q.every(t=>hay.includes(t));
}

export function renderModelList(){
  const q = String(el("modelSearch").value||"").toLowerCase().split(/\s+/).filter(Boolean);
  const sort = el("modelSort").value;
  const onlyFree = el("freeOnly").checked;
  const chosen = currentModels();
  const used = new Set(STAGE_KEYS.map(s=>chosen[s]));
  let list = state.modelCatalog.filter(m=>m && m.id && modelMatches(m,q));
  if(onlyFree) list = list.filter(m=>{ const p = state.price[m.id]; return p && !p.prompt && !p.completion; });
  const price = (m)=>{ const p = state.price[m.id]; return p ? p.prompt + p.completion : 9; };
  if(sort === "price") list.sort((a,b)=>price(a)-price(b) || (b.context_length||0)-(a.context_length||0));
  if(sort === "ctx") list.sort((a,b)=>(b.context_length||0)-(a.context_length||0) || price(a)-price(b));
  if(sort === "name") list.sort((a,b)=>a.id.localeCompare(b.id));
  if(onlyFree){  // model berakhiran :free duluan; nol-harga tanpa suffix (mis. generator audio) di bawah
    const f = list.filter(m=>/:free$/.test(m.id)), o = list.filter(m=>!/:free$/.test(m.id));
    list = f.concat(o);
  }
  const box = el("modelList");
  if(!state.modelCatalog.length){
    box.innerHTML = '<div class="mstat">katalog belum dimuat — klik <b>Muat katalog model</b> di atas, atau tempel ID manual di bawah.</div>';
  } else {
    box.innerHTML = list.slice(0, 80).map(m=>{
      const p = state.price[m.id];
      const free = p && !p.prompt && !p.completion;
      const stages = STAGE_KEYS.filter(s=>chosen[s] === m.id);
      return '<div class="mrow' + (stages.length ? " on" : "") + '" data-id="' + escA(m.id) + '"><div>' +
        '<div class="mn">' + escA(m.name||m.id) + (free?'<span class="tag free">gratis</span>':'') +
        (stages.length ? '<span class="tag">' + stages.join(",") + '</span>' : '') + '</div>' +
        '<div class="mi">' + escA(m.id) + '</div></div><div class="meta">' +
        (m.context_length ? Math.round(m.context_length/1000) + "k ctx" : "") +
        (p ? "<br>" + perM(p.prompt) + " / " + perM(p.completion) + " /M"
          : (state.varPrice[m.id] ? "<br>harga bervariasi" : "")) +
        '</div></div>';
    }).join("") || '<div class="mstat">tidak ada yang cocok — ubah kata kunci, atau tempel ID model manual di bawah.</div>';
  }
  el("pickerStat").textContent = state.modelCatalog.length
    ? list.length + " model cocok" + (list.length > 80 ? " (80 pertama — persempit pencariannya)" : "") +
      (state.pickerStage ? " · klik = tahap " + state.pickerStage + " · Ctrl+klik = semua tahap" : "")
    : "katalog belum dimuat";
}

export function updateCostGuess(){
  if(el("provider").value === "demo"){ el("costGuess").textContent = "Mode demo: tidak ada panggilan API, jadi tidak ada biaya."; return; }
  const m = currentModels(); let sum = 0, known = 0; const miss = [];
  const adaRoadmap = !!(state.docs.roadmap && (state.docs.roadmap.milestones||[]).length);
  const chunks = Math.max(1, adaRoadmap ? state.docs.roadmap.milestones.length : 4);
  for(const s of STAGE_KEYS){
    const p = priceOf(m[s]); const g = STAGE_TOKEN_GUESS[s];
    if(!p){ miss.push(s); continue; }
    known++; sum += (s === "tasks" ? chunks : 1) * (g[0]*p.prompt + g[1]*p.completion);
  }
  if(!known){ el("costGuess").textContent = "Muat katalog model dulu untuk perkiraan biaya."; return; }
  el("costGuess").textContent = "Perkiraan satu jalan penuh: " + fmtMoney(sum) + " ≈ Rp " +
    Math.round(sum*IDR).toLocaleString("id-ID") + " (kurs Rp" + IDR.toLocaleString("id-ID") + "/USD)" +
    (miss.length ? " — " + miss.join(", ") + " belum terhitung" : "") +
    " · ≈ " + (3 + chunks) + " panggilan AI: clarify+prd+roadmap (3) + tasks dipecah " + chunks + " milestone" +
    (adaRoadmap ? "" : " (tebakan, roadmap belum ada)") + " (+1 kalau tambal otomatis aktif). Tiap panggilan dibatasi 120 detik.";
}

/* Baca sisa kredit TANPA memanggil model: GET /api/v1/key gratis menurut dokumentasi
   OpenRouter (membaca key/usage/credits tidak dihitung sebagai request inferensi). */
export async function cekKredit(){
  const cfg = readCfg(), out = el("kreditStat");
  if(cfg.provider !== "openrouter"){ out.textContent = "khusus provider OpenRouter"; return; }
  if(!cfg.apiKey){ out.textContent = "isi API key dulu"; el("apiKey").focus(); return; }
  out.textContent = "mengecek…";
  try{
    const r = await fetch("https://openrouter.ai/api/v1/key", { headers:{ Authorization:"Bearer " + cfg.apiKey } });
    if(!r.ok){
      out.textContent = r.status === 401 ? "401: key salah/kedaluwarsa"
        : r.status === 402 ? "402: kredit habis atau batas key tercapai"
        : r.status === 429 ? "429: rate limit — coba lagi sebentar"
        : "HTTP " + r.status + " — cek openrouter.ai/credits";
      return;
    }
    const j = await r.json(), d = j.data || j;
    const sisa = d.limit_remaining == null ? "tanpa batas" : "$" + Number(d.limit_remaining).toFixed(4);
    const pakai = Number(d.usage || 0).toFixed(4);
    const harian = d.usage_daily == null ? "-" : "$" + Number(d.usage_daily).toFixed(4);
    out.textContent = "sisa " + sisa + " · terpakai $" + pakai + " · hari ini " + harian;
    state.kredit = { at:new Date().toISOString(), sisa, pakai, harian };
  }catch(e){
    out.textContent = "gagal baca (kemungkinan CORS/jaringan) — cek manual di openrouter.ai/credits";
  }
}

export async function loadModels(){
  const cfg = readCfg();
  if(cfg.provider === "demo"){ el("modelStat").textContent = "demo: katalog model tidak dipakai"; return; }
  if(!/^https?:\/\//.test(cfg.baseUrl)){ el("modelStat").textContent = "base URL tidak valid"; return; }
  el("modelStat").textContent = "mengunduh katalog…";
  el("loadModels").disabled = true;
  try{
    const res = await fetch(cfg.baseUrl.replace(/\/$/,"") + "/models",
      {headers: cfg.apiKey ? {Authorization:"Bearer " + cfg.apiKey} : {}});
    if(!res.ok) throw new Error("HTTP " + res.status + (res.status===401 ? " (key salah)" : ""));
    const j = await res.json();
    const list = (j.data || j.models || []).filter(m=>m && m.id);
    if(!list.length) throw new Error("respons tidak berisi daftar model");
    list.sort((a,b)=>a.id.localeCompare(b.id));
    state.modelCatalog = list; state.price = {}; state.varPrice = {}; state.catalog = {};
    for(const m of list){
      const p = m.pricing || {};
      const pr = parseFloat(p.prompt), pc = parseFloat(p.completion);
      if(Number.isFinite(pr) && Number.isFinite(pc) && pr >= 0 && pc >= 0){
        state.price[m.id] = {prompt:pr, completion:pc};
      } else {
        state.varPrice[m.id] = true;  // mis. openrouter/auto: harga ikut model yang terpilih
      }
      state.catalog[m.id] = {ctx: m.context_length||0, name: m.name||m.id};
    }
    const free = list.filter(m=>{ const p = state.price[m.id]; return p && !p.prompt && !p.completion; }).length;
    el("modelStat").textContent = list.length + " model tersedia" + (free ? " · " + free + " gratis" : "");
    if(state.pickerStage) renderModelList();
    renderStageModelInputs();
  }catch(e){
    el("modelStat").textContent = "gagal memuat: " + String(e.message||e).slice(0,70);
  }finally{
    el("loadModels").disabled = false;
  }
}

export function applyManual(allStages){
  const id = el("manualModel").value.trim();
  if(!id){ el("manualModel").focus(); return; }
  setStageModel(state.pickerStage || "prd", id, allStages);
  renderModelList();
}
