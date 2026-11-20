/* PlanForge core: skema JSON tiap tahap dan daftar stage. */

export const SCHEMAS = {
  clarify: {
    project_name:"string", one_liner:"string", audience:"string", brief:"string (<=180 kata)",
    primary_workflows:["string — alur pemakaian dari sisi user"],
    assumptions:[{text:"string", confidence:"high|medium|low", validate:"cara termurah memvalidasi"}],
    defaults_chosen:[{question:"string", decision:"string", reason:"string"}],
    cut_from_mvp:["string — yang sengaja dibuang dari MVP, dan kenapa"],
    success_signals:["string — tanda awal bahwa ini berguna"],
    questions:[{id:"Q-001", slot:"persona|aha|mvp_features|value_prop|retention",
      question:"string — pertanyaan discovery SPESIFIK untuk ide ini, bukan generik",
      type:"text|single|multi", options:["string — 3-5 pilihan konkret yang relevan dengan ide (kosong untuk type text)"]}],
    user_answers:[{question_id:"Q-001", answer:"string — jawaban user; kosong berarti dilewati"}],
    ai_questions:[{id:"A-001", question:"string — pertanyaan klarifikasi BEBAS di luar 5 slot, hanya hal yang benar-benar ambigu",
      why:"string — asumsi/keraguan spesifik kenapa ini ditanya", type:"text|single|multi",
      options:["string — pilihan konkret yang relevan (kosong untuk type text)"]}]
  },
  prd: {
    version:"1.0", project_name:"string", one_liner:"string", summary:"string (<=200 kata)",
    problem:{statement:"string", who:"string", current_alternatives:["string"]},
    personas:[{name:"string", goals:["string"], pains:["string"]}],
    goals:["string"], non_goals:["string"],
    requirements:[{id:"R-001", title:"string", description:"string",
      acceptance_criteria:["Given/When/Then"], priority:"must|should|could", scope:"mvp|v2"}],
    non_functional:[{id:"N-001", title:"string", target:"ukuran yang bisa diukur (ms, MB, %, menit)"}],
    features:[{name:"string — fitur utama", priority:"high|medium|low", phase:"Fase 1",
      sub_features:["string — pecilan yang masih bisa diuji"]}],
    flows:[{name:"string — alur berhuruf, mis. A. Pelanggan memesan", phase_ref:"Fase 1", steps:["string"]}],
    data:[{entity:"string — nama tabel", note:"string — isi tabel ini untuk apa",
      fields:["nama (tipe) — catatan"]}],
    tech:[{decision:"string — sebut versi mayor, mis. 'FastAPI 0.115 + Uvicorn'", rationale:"string — kenapa ini yang paling relevan sekarang", alternatives:["string — yang ditolak + alasannya"]}],
    template_note:"string — kerangka/template awal yang dipakai, atau 'tidak ada'",
    risks:[{risk:"string", impact:"low|medium|high", mitigation:"string"}],
    metrics:[{name:"string", target:"string"}],
    open_questions:[{question:"string", blocking:true}]
  },
  roadmap: {
    milestones:[{id:"M-001", title:"string", outcome:"string", requirement_refs:["R-001"],
      feature_refs:["nama fitur persis seperti di PRD"], exit_criteria:["string"], effort:"S|M|L", order:1}],
    sequencing_notes:["string"],
    release_plan:[{milestone_ref:"M-001", what_ships:"string"}]
  },
  tasks: {
    tasks:[{id:"T-001", title:"string — kalimat kerja, mulai kata kerja", feature:"nama fitur persis seperti di PRD",
      milestone_ref:"M-001", requirement_refs:["R-001"], status:"belum mulai",
      priority:"utama|penting|tambahan", description:"string", files_or_areas:["path atau modul"],
      acceptance_criteria:["string"], verification:"SATU perintah shell yang menghasilkan exit code (worker menjalankannya ulang sendiri). Contoh: python -m pytest -q tests/test_kasir.py — DILARANG kalimat/cek manual seperti 'buka browser lalu klik'",
      behavior:"WAJIB kalau task menyentuh UI (file .html/.css/.js frontend, templates/, static/, atau kriteria soal halaman/tombol/grafik/viewport). Bentuknya objek: {url:'http://127.0.0.1:8000/detail/1', viewport:{width:360,height:760}, server:{cmd:'perintah menyalakan server', ready:'http://127.0.0.1:8000/', timeoutSec:40}, settleMs:600, checks:[...]}. Worker membuka Edge/Chrome headless dan MENGUKUR SENDIRI checks ini — bukan percaya klaim agen. type yang dikenal: text(selector+contains/equals/matches), count(selector+equals/min/max), visible(selector), attr(selector+name+equals/contains), canvasNotBlank(selector+minPixels), click(selector), wait(ms), request(urlContains/urlMatches), url(contains/equals/matches — alamat halaman sesudah klik, untuk history.replaceState/pushState), noConsoleError, noHorizontalOverflow. Contoh checks grafik: [{type:'canvasNotBlank',selector:'#grafik',minPixels:500},{type:'noConsoleError'}]. Contoh judul ikut filter: [{type:'click',selector:\"input[value='60']\"},{type:'text',selector:'#judul',contains:'60'}]. Task backend murni boleh tanpa behavior.",
      depends_on:["T-000"], size:"XS|S|M|L", agent_hint:"string — jebakan yang harus dihindari"}]
  },
  patch: {
    patches:[{target_id:"R-001 | T-001 | NEW", action:"add|update", document:"prd|roadmap|tasks",
      collection:"requirements|tasks|milestones", object:{}}]
  }
};

export const STAGES = [
  {key:"clarify", label:"1. Clarify & asumsi", title:"Clarify"},
  {key:"prd",     label:"2. PRD", title:"PRD"},
  {key:"roadmap", label:"3. Roadmap", title:"Roadmap"},
  {key:"tasks",   label:"4. Task list", title:"Tasks"},
  {key:"audit",   label:"5. Cek konsistensi rencana", title:"Cek rencana — belum ada kode"}
];
