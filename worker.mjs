#!/usr/bin/env node

// src/worker/cli/args.mjs
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith("--")) {
      const k = x.slice(2);
      const nx = argv[i + 1];
      if (nx === void 0 || nx.startsWith("--")) a[k] = true;
      else {
        a[k] = nx;
        i++;
      }
    } else a._.push(x);
  }
  return a;
}

// src/worker/ledger/files.mjs
import fs from "node:fs";
var DIR = ".planforge";
var F_PLAN = "plan.json", F_GATES = "gates.json", F_STATE = "state.json", F_LOG = "RUN_LOG.md";
var readJson = (p, fb) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return fb;
  }
};
var cetakFile = (p) => {
  try {
    const st = fs.statSync(p);
    return st.size + ":" + Math.round(st.mtimeMs);
  } catch (e) {
    return "-";
  }
};

// src/shared/agent-contracts.mjs
var AGENT_PRESETS = {
  agy: {
    label: "Antigravity CLI",
    cmd: "agy",
    args: ["-p", "{PROMPT}", "--output-format", "json"],
    contArgs: ["--conversation", "{SESSION}", "-p", "{PROMPT}", "--output-format", "json"]
  },
  claude: {
    label: "Claude Code",
    cmd: "claude",
    args: ["-p", "{PROMPT}", "--output-format", "json", "--dangerously-skip-permissions"],
    contArgs: ["--resume", "{SESSION}", "-p", "{PROMPT}", "--output-format", "json", "--dangerously-skip-permissions"]
  },
  cursor: {
    label: "Cursor CLI",
    cmd: "cursor-agent",
    args: ["-p", "{PROMPT}", "--output-format", "json"],
    contArgs: null
  },
  gemini: {
    label: "Gemini CLI",
    cmd: "gemini",
    args: ["-p", "{PROMPT}", "--output-format", "json"],
    contArgs: null
  },
  codex: {
    label: "Codex CLI",
    cmd: "codex",
    args: ["exec", "{PROMPT}"],
    contArgs: null
  },
  codebuddy: {
    label: "WorkBuddy / CodeBuddy CLI",
    cmd: "codebuddy",
    args: ["-p", "{PROMPT}", "--output-format", "json", "--dangerously-skip-permissions"],
    contArgs: ["--resume", "{SESSION}", "-p", "{PROMPT}", "--output-format", "json", "--dangerously-skip-permissions"]
  },
  none: { label: "tidak ada agen (dry-run)", cmd: "", args: ["{PROMPT}"], contArgs: null }
};
var AGENT_ADAPTERS = {
  workbuddy: {
    label: "WorkBuddy / CodeBuddy",
    file: ".mcp.json",
    shape: "mcpServers",
    rules: "AGENTS.md",
    globalPath: "%USERPROFILE%\\.workbuddy-ai\\mcp.json",
    hint: "WorkBuddy tidak membaca .mcp.json dari folder proyek. Connector WAJIB didaftarkan manual: Settings > Connectors / MCP > Add Server (stdio), salin blok dari .mcp.json yang ditulis Connect. Restart saja tidak memunculkan connector."
  },
  agy: {
    label: "Antigravity IDE",
    file: ".agents/mcp_config.json",
    shape: "mcpServers",
    rules: "AGENTS.md",
    globalPath: "~/.gemini/config/mcp_config.json",
    hint: "Antigravity tidak membaca .agents/mcp_config.json dari folder proyek — restart IDE tidak membantu. Salin blok itu ke ~/.gemini/config/mcp_config.json (global) tanpa menghapus server lain, lalu restart IDE."
  },
  claude: {
    label: "Claude Code",
    file: ".mcp.json",
    shape: "mcpServers",
    rules: "CLAUDE.md",
    hint: "bisa juga: claude mcp add <nama-server> -- node worker.mjs mcp"
  },
  cursor: {
    label: "Cursor",
    file: ".cursor/mcp.json",
    shape: "mcpServers",
    rules: ".cursorrules",
    hint: "Cursor > Settings > MCP, tombol Add"
  },
  vscode: {
    label: "VS Code + Copilot",
    file: ".vscode/mcp.json",
    shape: "servers",
    rules: ".github/copilot-instructions.md",
    hint: "Copilot Chat > agent mode > Tools > MCP Servers > Reload"
  },
  cline: {
    label: "Cline",
    file: ".cline/cline_mcp_settings.json",
    shape: "mcpServers",
    rules: ".clinerules",
    globalPath: "~/.cline/data/settings/cline_mcp_settings.json",
    hint: "Cline cuma baca file global: salin isinya ke ~/.cline/data/settings/cline_mcp_settings.json"
  },
  windsurf: {
    label: "Windsurf",
    file: ".windsurf/mcp_config.json",
    shape: "mcpServers",
    rules: ".windsurfrules",
    hint: "Windsurf > MCP Config > Add Server"
  },
  qoder: {
    label: "Qoder",
    file: null,
    shape: "mcpServers",
    rules: "AGENTS.md",
    hint: "App settings > MCP > Add server, tempel blok di bawah"
  },
  codex: {
    label: "Codex CLI",
    file: null,
    shape: "mcpServers",
    rules: "AGENTS.md",
    hint: "codex mcp add <nama-server> -- node <path>/worker.mjs mcp --dir <path>"
  },
  opencode: {
    label: "opencode",
    file: "opencode.json",
    shape: "mcp",
    rules: "AGENTS.md",
    hint: "opencode membaca opencode.json di folder proyek (atau global ~/.config/opencode/opencode.json). Connect menulis blok mcp.servers ke opencode.json proyek otomatis. Kalau kamu pakai config global, salin blok itu ke sana tanpa menghapus server lain, lalu tutup-buka lagi opencode."
  },
  generic: {
    label: "Agen lain yang paham MCP",
    file: ".planforge/mcp-universal.json",
    shape: "mcpServers",
    rules: "AGENTS.md",
    hint: "yang penting agent-nya bisa nulis file & jalanin perintah"
  }
};

// src/shared/gate-policy.mjs
var LIGHT_REVIEW = [
  "Kamu reviewer, bukan penulis. Nilai HANYA task di atas, jangan yang lain.",
  "Cek: (1) semua acceptance criteria terpenuhi, (2) verification bisa dijalankan dan benar-benar dijalankan,",
  "(3) tidak ada file/fungsi mati atau duplikasi yang baru saja kamu tambah, (4) tidak ada fitur di luar task,",
  "(5) tidak ada TODO sementara yang tertinggal.",
  'Balas HANYA JSON: {"pass": true|false, "issues": ["<temuan singkat + file:line>"], "fix": "<kalau pass=false: apa yang harus dibetulkan>"}'
].join("\n");
var FULL_GATES = [
  {
    id: "audit",
    label: "Audit menyeluruh",
    tier: "full",
    enabled: true,
    prompt: 'Audit kualitas kode dari task {FROM} sampai {TO} tanpa menambah fitur. Cari: bug batas (empty/null/0/negatif), state yang tidak konsisten, error yang ditelan diam-diam, akses data tanpa validasi, celah keamanan dasar. Jangan perbaiki dulu. Balas HANYA JSON: {"issues":[{"file":"","line":0,"severity":"high|med|low","what":"","why":""}]}'
  },
  {
    id: "fixbug",
    label: "Perbaiki bug hasil audit",
    tier: "full",
    enabled: true,
    prompt: 'Perbaiki HANYA temuan severity high dan med dari audit barusan, satu per satu, tanpa mengubah perilaku tampilan dan tanpa menambah fitur. Setelah selesai balas HANYA JSON: {"fixed":["..."],"skipped":["..."],"reason_skipped":"..."}'
  },
  {
    id: "refactor",
    label: "Rapikan & buang kode mati",
    tier: "full",
    enabled: true,
    prompt: 'Refactor tanpa mengubah perilaku: hapus kode mati/unused export/duplikasi, kecilkan fungsi yang lebih dari 40 baris, beri nama yang jelas. Tampilan dan hasil verifikasi WAJIB sama. Jangan naikkan versi dependency. Balas HANYA JSON: {"changed":["..."],"removed":["..."]}'
  },
  {
    id: "perf",
    label: "Performa (target HP kentang)",
    tier: "full",
    enabled: true,
    prompt: `Optimalkan performa untuk HP rendah dan jaringan lambat: kurangi render ulang, tunda muat aset besar, hindari loop sinkron berat di thread utama, kecilkan bundle. Tidak boleh mengubah fitur. Ukur sebelum/sesudah kalau ada alatnya. Balas HANYA JSON: {"changes":["..."],"measured":"<angka atau 'tidak terukur'>"}`
  },
  { id: "watch", label: "Watchlist tambahanmu", tier: "full", enabled: false, prompt: "" }
];
var HARD_CHECKS = [
  { id: "build", label: "Build + type-check", cmd: "npm run build", enabled: true, blocking: true, tier: "hard" },
  { id: "tsc", label: "Type-check saja", cmd: "npx tsc --noEmit", enabled: false, blocking: true, tier: "hard" },
  { id: "test", label: "Test otomatis", cmd: "npm test", enabled: true, blocking: true, tier: "hard" },
  { id: "lint", label: "Lint & kode mati", cmd: "npm run lint", enabled: true, blocking: false, tier: "hard" },
  {
    id: "perf",
    label: "Lighthouse (HP lambat)",
    cmd: 'npx lighthouse http://localhost:3000 --output=json --only-categories=performance --quiet --chrome-flags="--headless"',
    enabled: false,
    blocking: false,
    tier: "hard",
    metrics: { firstContentfulPaint_ms: 1500, interactive_ms: 3500, totalByteWeight_kb: 600 }
  }
];

// src/worker/agents/defaults.mjs
var AGENT_ALIAS = { workbuddy: "codebuddy" };
function presetAgen(nama) {
  return AGENT_PRESETS[AGENT_ALIAS[nama] || nama] || null;
}
function defaultGates(agentName) {
  const nama = agentName || "agy";
  const a = presetAgen(nama);
  if (!a) throw new Error('agen "' + nama + '" tidak dikenal — pilih: ' + Object.keys(AGENT_PRESETS).join(", "));
  return {
    v: 1,
    agent: { name: nama, label: a.label, cmd: a.cmd, args: a.args, contArgs: a.contArgs, timeoutMin: 20 },
    /* A zero cost ceiling fails closed; only the user may authorize paid work. */
    limits: {
      maxCalls: 60,
      maxCallsPerRun: 40,
      maxCostUsd: 0,
      maxTokens: null,
      maxConsecutiveFails: 3,
      fullEvery: 6,
      fullAtMilestoneEnd: true,
      fixRounds: 2,
      autoCommit: true
    },
    hard: JSON.parse(JSON.stringify(HARD_CHECKS)),
    reviews: [
      { id: "light", label: "Review ringan tiap task", tier: "light", enabled: true, prompt: LIGHT_REVIEW },
      ...JSON.parse(JSON.stringify(FULL_GATES))
    ]
  };
}

// src/worker/text.mjs
var now = () => (/* @__PURE__ */ new Date()).toISOString().slice(11, 19);
var short = (s, n) => {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) + "…" : s;
};
var ANSI = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, "");

// src/worker/browser/cdp.mjs
import { spawnSync } from "node:child_process";
async function hidupan(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2e3), redirect: "manual" });
    return true;
  } catch (e) {
    return false;
  }
}
async function tungguHidup(url, ms) {
  const akhir = Date.now() + ms;
  while (Date.now() < akhir) {
    if (await hidupan(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
function tungguDevTools(proc, ms) {
  return new Promise((res, rej) => {
    let buf = "";
    const timer = setTimeout(() => rej(new Error("browser tidak mencetak alamat DevTools dalam " + Math.round(ms / 1e3) + "s: " + short(buf, 200))), ms);
    const baca = (d) => {
      buf += String(d);
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        res(m[1]);
      }
    };
    proc.stderr.on("data", baca);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      rej(new Error("browser keluar sendiri (code " + code + "): " + short(buf, 200)));
    });
  });
}
function cdp(ws) {
  let id = 0;
  const tunggu = /* @__PURE__ */ new Map();
  const pendengar = [];
  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    if (m.id != null && tunggu.has(m.id)) {
      const { res, rej, timer } = tunggu.get(m.id);
      tunggu.delete(m.id);
      clearTimeout(timer);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method) pendengar.forEach((f) => f(m));
  };
  return {
    kirim(method, params) {
      return new Promise((res, rej) => {
        const n = ++id;
        const timer = setTimeout(() => {
          if (tunggu.has(n)) {
            tunggu.delete(n);
            rej(new Error("CDP tidak menjawab " + method));
          }
        }, 25e3);
        tunggu.set(n, { res, rej, timer });
        ws.send(JSON.stringify({ id: n, method, params: params || {} }));
      });
    },
    on(f) {
      pendengar.push(f);
    },
    tutup() {
      try {
        ws.close();
      } catch (e) {
      }
    }
  };
}
function sambungWs(url) {
  return new Promise((res, rej) => {
    const s = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        s.close();
      } catch (e) {
      }
      rej(new Error("timeout menyambung ke browser"));
    }, 1e4);
    s.onopen = () => {
      clearTimeout(timer);
      res(s);
    };
    s.onerror = () => {
      clearTimeout(timer);
      rej(new Error("WebSocket ke browser ditolak"));
    };
  });
}
function bunuh(proc) {
  if (!proc || proc.exitCode != null || proc.signalCode) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { encoding: "utf8", timeout: 1e4 });
    else {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch (e) {
        proc.kill("SIGKILL");
      }
    }
  } catch (e) {
  }
}

// src/worker/browser/discovery.mjs
import path from "node:path";
import fs2 from "node:fs";
import { spawnSync as spawnSync2 } from "node:child_process";
var BROWSER_CALON = {
  win32: [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge"
  ]
};
function cariBrowser() {
  const calon = [process.env.PLANFORGE_BROWSER, ...BROWSER_CALON[process.platform] || BROWSER_CALON.linux];
  if (process.env.LOCALAPPDATA) calon.push(path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"));
  for (const p of calon.filter(Boolean)) {
    try {
      if (fs2.statSync(p).isFile()) return p;
    } catch (e) {
    }
  }
  const cari = spawnSync2(
    process.platform === "win32" ? "where" : "which",
    [process.platform === "win32" ? "msedge" : "chromium"],
    { encoding: "utf8", timeout: 5e3 }
  );
  const jalur = String(cari.stdout || "").split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean)[0];
  return jalur && fs2.existsSync(jalur) ? jalur : null;
}

// src/worker/browser/checks.mjs
var SEL = (s) => JSON.stringify(String(s));
var AMBIL = (s) => "document.querySelector(" + SEL(s) + ")";
function ekspresiCheck(c) {
  switch (c.type) {
    case "text":
      return "(()=>{const e=" + AMBIL(c.selector) + ";return e?{ada:true,teks:(e.textContent||'').trim()}:{ada:false};})()";
    case "count":
      return "document.querySelectorAll(" + SEL(c.selector) + ").length";
    case "visible":
      return "(()=>{const e=" + AMBIL(c.selector) + ";if(!e)return{ada:false};const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{ada:true,lebar:r.width,tinggi:r.height,display:s.display,visibility:s.visibility};})()";
    case "attr":
      return "(()=>{const e=" + AMBIL(c.selector) + ";return e?{ada:true,nilai:e.getAttribute(" + SEL(c.name) + ")}:{ada:false};})()";
    case "canvasNotBlank":
      return "(()=>{const c=" + AMBIL(c.selector) + ";if(!c)return{ada:false};if(String(c.tagName).toLowerCase()!=='canvas')return{ada:true,canvas:false};const x=c.getContext('2d');if(!x)return{ada:true,canvas:true,pixel:null};const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]!==0)n++;return{ada:true,canvas:true,pixel:n,total:c.width*c.height};})()";
    case "click":
      return "(()=>{const e=" + AMBIL(c.selector) + ";if(!e)return{ada:false};e.scrollIntoView({block:'center'});e.click();return{ada:true};})()";
    case "noHorizontalOverflow":
      return "({scroll:document.documentElement.scrollWidth,inner:window.innerWidth})";
    case "url":
      return "({href:location.href})";
    default:
      return "null";
  }
}
function nilaiCheck(c, ukur, konteks) {
  const gagal = (alasan) => ({ pass: false, alasan });
  switch (c.type) {
    case "text": {
      if (!ukur || !ukur.ada) return gagal("selector " + c.selector + " tidak ada di halaman");
      const teks = String(ukur.teks || "");
      if (c.equals != null && teks !== String(c.equals)) return gagal('teks "' + short(teks, 80) + '" ≠ "' + short(c.equals, 60) + '"');
      if (c.contains && !teks.includes(String(c.contains))) return gagal('teks "' + short(teks, 80) + '" tidak memuat "' + short(c.contains, 60) + '"');
      if (c.matches && !new RegExp(c.matches).test(teks)) return gagal('teks "' + short(teks, 80) + '" tidak cocok /' + short(c.matches, 60) + "/");
      return { pass: true };
    }
    case "count": {
      const n = Number(ukur);
      if (c.equals != null && n !== Number(c.equals)) return gagal("jumlah " + n + " ≠ " + c.equals);
      if (c.min != null && n < Number(c.min)) return gagal("jumlah " + n + " < minimum " + c.min);
      if (c.max != null && n > Number(c.max)) return gagal("jumlah " + n + " > maksimum " + c.max);
      return { pass: true };
    }
    case "visible": {
      if (!ukur || !ukur.ada) return gagal("selector " + c.selector + " tidak ada di halaman");
      if (ukur.display === "none" || ukur.visibility === "hidden") return gagal("elemen ada tapi tidak terlihat (display " + ukur.display + ", visibility " + ukur.visibility + ")");
      if (!(ukur.lebar > 0 && ukur.tinggi > 0)) return gagal("ukuran elemen " + ukur.lebar + "×" + ukur.tinggi + " — nol, jadi tidak kelihatan");
      return { pass: true };
    }
    case "attr": {
      if (!ukur || !ukur.ada) return gagal("selector " + c.selector + " tidak ada di halaman");
      const nilai = ukur.nilai;
      if (c.equals != null && nilai !== String(c.equals)) return gagal("atribut " + c.name + ' = "' + short(nilai, 60) + '" ≠ "' + short(c.equals, 60) + '"');
      if (c.contains && !String(nilai || "").includes(String(c.contains))) return gagal("atribut " + c.name + ' tidak memuat "' + short(c.contains, 60) + '"');
      return { pass: true };
    }
    case "canvasNotBlank": {
      if (!ukur || !ukur.ada) return gagal("selector " + c.selector + " tidak ada di halaman");
      if (ukur.canvas === false) return gagal(c.selector + " bukan elemen <canvas>");
      if (ukur.pixel == null) return gagal("canvas tidak bisa diukur (konteks 2d tidak tersedia) — worker tidak mau menebak");
      const min = c.minPixels == null ? 1 : Number(c.minPixels);
      if (ukur.pixel < min) return gagal("canvas " + c.selector + " hanya " + ukur.pixel + " pixel terisi dari " + ukur.total + " (minimum " + min + ") — kosong, tidak menggambar apa pun");
      return { pass: true };
    }
    case "click":
      return ukur && ukur.ada ? { pass: true } : gagal("selector " + c.selector + " tidak ada, jadi tidak bisa diklik");
    case "request": {
      const cocok = konteks.requests.filter((u) => c.urlContains ? u.includes(String(c.urlContains)) : new RegExp(c.urlMatches).test(u));
      return cocok.length ? { pass: true } : gagal('tidak ada request yang memuat "' + short(c.urlContains || c.urlMatches, 70) + '" — fetch-nya tidak pernah jalan');
    }
    case "url": {
      const href = String(ukur && ukur.href || "");
      if (c.equals != null && href !== String(c.equals)) return gagal('alamat halaman "' + short(href, 90) + '" ≠ "' + short(c.equals, 60) + '"');
      if (c.contains && !href.includes(String(c.contains))) return gagal('alamat halaman "' + short(href, 90) + '" tidak memuat "' + short(c.contains, 60) + '" — URL tidak diperbarui');
      if (c.matches && !new RegExp(c.matches).test(href)) return gagal('alamat halaman "' + short(href, 90) + '" tidak cocok /' + short(c.matches, 60) + "/");
      return { pass: true };
    }
    case "noConsoleError":
      return konteks.errors.length ? gagal(konteks.errors.length + " error console: " + short(konteks.errors.join(" | "), 300)) : { pass: true };
    case "noHorizontalOverflow":
      return ukur && ukur.scroll > ukur.inner + 1 ? gagal("lebar konten " + ukur.scroll + "px > viewport " + ukur.inner + "px — ada overflow horizontal") : { pass: true };
    case "wait":
      return { pass: true };
    default:
      return gagal("type tidak dikenal");
  }
}

// src/worker/browser/measurement.mjs
import fs3 from "node:fs";
import { spawn } from "node:child_process";
import path2 from "node:path";
import os from "node:os";
async function ukurPerilaku(payload) {
  const spec = payload.spec, cwd = payload.cwd || process.cwd();
  const t0 = Date.now();
  const hasil = [], kurang = [];
  const konteks = { requests: [], errors: [] };
  let server = null, browser = null, klien = null, tmp = null;
  const bersih = () => {
    if (klien) klien.tutup();
    bunuh(browser);
    bunuh(server);
    if (tmp) {
      try {
        fs3.rmSync(tmp, { recursive: true, force: true });
      } catch (e) {
      }
    }
  };
  try {
    if (spec.server && spec.server.cmd) {
      const ready = spec.server.ready || spec.url;
      if (!await hidupan(ready)) {
        server = spawn(spec.server.cmd, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
        server.stderr.on("data", () => {
        });
        server.stdout.on("data", () => {
        });
        if (!await tungguHidup(ready, (Number(spec.server.timeoutSec) || 40) * 1e3))
          throw new Error("server `" + short(spec.server.cmd, 80) + "` tidak menjawab " + ready + " — perilaku tidak bisa diukur");
      }
    }
    const bin = cariBrowser();
    if (!bin) throw new Error("browser tidak ditemukan");
    tmp = fs3.mkdtempSync(path2.join(os.tmpdir(), "pf-browser-"));
    const sandboxArgs = process.platform === "linux" && (process.getuid?.() === 0 || Boolean(process.env.CI || process.env.CONTAINER || process.env.KUBERNETES_SERVICE_HOST || fs3.existsSync("/.dockerenv") || fs3.existsSync("/run/.containerenv"))) ? ["--no-sandbox", "--disable-setuid-sandbox"] : [];
    browser = spawn(
      bin,
      [
        ...sandboxArgs,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-debugging-port=0",
        "--remote-allow-origins=*",
        "--user-data-dir=" + tmp,
        "about:blank"
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    browser.stdout.on("data", () => {
    });
    const wsBrowser = await tungguDevTools(browser, 2e4);
    const port = new URL(wsBrowser).port;
    const rTarget = await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT", signal: AbortSignal.timeout(8e3) });
    const target = await rTarget.json();
    if (!target.webSocketDebuggerUrl) throw new Error("browser tidak memberi target halaman");
    klien = cdp(await sambungWs(target.webSocketDebuggerUrl));
    klien.on((m) => {
      if (m.method === "Network.requestWillBeSent") konteks.requests.push(String(m.params.request.url || ""));
      if (m.method === "Runtime.exceptionThrown")
        konteks.errors.push(short(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text, 160));
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
        konteks.errors.push(short((m.params.args || []).map((a) => a.value || a.description || "").join(" "), 160));
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
        const e = m.params.entry;
        const faviconKosong = e.url && /\/favicon\.ico(?:\?|$)/i.test(String(e.url)) && /\b404\b/.test(String(e.text || ""));
        if (!faviconKosong) konteks.errors.push(short(e.text + (e.url ? " (" + e.url + ")" : ""), 200));
      }
    });
    await Promise.all([klien.kirim("Page.enable"), klien.kirim("Runtime.enable"), klien.kirim("Network.enable"), klien.kirim("Log.enable")]);
    if (spec.viewport && Number(spec.viewport.width))
      await klien.kirim("Emulation.setDeviceMetricsOverride", { width: Number(spec.viewport.width), height: Number(spec.viewport.height) || 800, deviceScaleFactor: 1, mobile: !!spec.viewport.mobile });
    await klien.kirim("Page.navigate", { url: spec.url }).then((nav) => {
      if (nav && nav.errorText) throw new Error("halaman tidak bisa dibuka: " + nav.errorText + " — " + spec.url);
    });
    const akhirNav = Date.now() + 2e4;
    let siap = false;
    while (Date.now() < akhirNav) {
      const r = await klien.kirim("Runtime.evaluate", { expression: "({ready:document.readyState,href:location.href})", returnByValue: true });
      const v = r && r.result ? r.result.value : null;
      if (v && v.ready === "complete" && v.href !== "about:blank") {
        siap = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 150));
    }
    if (!siap) throw new Error("halaman tidak selesai dimuat dalam 20s: " + spec.url);
    await new Promise((r) => setTimeout(r, spec.settleMs));
    for (const c of spec.checks) {
      if (c.type === "wait") {
        await new Promise((r2) => setTimeout(r2, Math.min(1e4, Math.max(0, Number(c.ms) || 300))));
        hasil.push({ check: c.type, pass: true, ukur: null });
        continue;
      }
      if (c.type === "request" || c.type === "noConsoleError") {
        const v2 = nilaiCheck(c, null, konteks);
        hasil.push({ check: c.type, pass: v2.pass, ukur: c.type === "request" ? konteks.requests.length : konteks.errors.length, alasan: v2.alasan || "" });
        if (!v2.pass) kurang.push(v2.alasan);
        continue;
      }
      const r = await klien.kirim("Runtime.evaluate", { expression: ekspresiCheck(c), returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error("check " + c.type + " melempar error di halaman: " + short(r.exceptionDetails.text, 160));
      const ukur = r.result ? r.result.value : null;
      const v = nilaiCheck(c, ukur, konteks);
      hasil.push({ check: c.type + (c.selector ? " " + c.selector : ""), pass: v.pass, ukur, alasan: v.alasan || "" });
      if (!v.pass) kurang.push(v.alasan);
      if (c.type === "click") await new Promise((r2) => setTimeout(r2, spec.settleMs));
    }
    return { ok: !kurang.length, kurang, hasil, console: konteks.errors, requests: konteks.requests.length, ms: Date.now() - t0, url: spec.url };
  } catch (e) {
    return { ok: false, kurang: ["pengukuran perilaku gagal: " + (e && e.message || e)], hasil, console: konteks.errors, requests: konteks.requests.length, ms: Date.now() - t0, url: spec.url };
  } finally {
    bersih();
  }
}

// src/worker/identity.mjs
import path3 from "node:path";
import { fileURLToPath } from "node:url";
var SELF_DIR = path3.dirname(fileURLToPath(import.meta.url));
var SELF_FILE = fileURLToPath(import.meta.url);
var BUILD_AWAL = cetakFile(SELF_FILE);
var buildLama = () => cetakFile(SELF_FILE) !== BUILD_AWAL;
function bannerBuildLama() {
  return [
    "!! BUILD LAMA: worker.mjs di disk sudah diganti, tapi proses MCP yang menjawab ini masih jalan dari kode lama.",
    "   build jalan : " + BUILD_AWAL + "   ·   build di disk : " + cetakFile(SELF_FILE),
    "   Artinya aturan baru (kommit per task, audit_plan, gerbang yang dibetulkan) BELUM berlaku di sesi ini.",
    "   Berhenti: jangan ambil task berikutnya, jangan mark_done. Laporkan baris ini apa adanya ke manusia —",
    "   dia perlu me-restart connector PlanForge atau membuka sesi baru sebelum lanjut."
  ].join("\n");
}

// src/worker/cli/local-commands.mjs
import path4 from "node:path";
import fs4 from "node:fs";
function commandInit(args) {
  const dir = path4.join(process.cwd(), DIR);
  fs4.mkdirSync(dir, { recursive: true });
  if (!fs4.existsSync(path4.join(dir, F_GATES))) fs4.writeFileSync(path4.join(dir, F_GATES), JSON.stringify(defaultGates(args.agent || "agy"), null, 1));
  console.log("ditulis " + path4.join(dir, F_GATES).replace(/\\/g, "/") + " — sunting perintah `hard[].cmd` sesuai proyekmu, lalu taruh plan.json di sebelah.");
  return 0;
}
function commandBrowser() {
  let masuk = "";
  process.stdin.on("data", (d) => {
    masuk += d;
  });
  process.stdin.on("end", () => {
    let payload = null;
    try {
      payload = JSON.parse(masuk);
    } catch (e) {
    }
    const jatuh = (pesan) => {
      console.log(JSON.stringify({ ok: false, kurang: [pesan], hasil: [] }));
      process.exit(0);
    };
    if (!payload || !payload.spec) return jatuh("spec perilaku tidak terbaca di stdin");
    ukurPerilaku(payload).then((h) => {
      console.log(JSON.stringify(h));
      process.exit(0);
    }, (e) => jatuh("pengukur perilaku jatuh: " + (e && e.message || e)));
  });
  return 0;
}
function commandEmbed(args) {
  const htmlFile = args.html && args.html !== true ? path4.resolve(String(args.html)) : path4.join(SELF_DIR, "index.html");
  const sumber = fs4.readFileSync(SELF_FILE, "utf8");
  let html;
  try {
    html = fs4.readFileSync(htmlFile, "utf8");
  } catch (e) {
    console.log("index.html tidak ada di " + htmlFile.replace(/\\/g, "/") + " — embed hanya untuk folder sumber PlanForge.");
    return 1;
  }
  const awal = "<!-- PF-WORKER-BEGIN -->", akhir = "<!-- PF-WORKER-END -->";
  const i = html.indexOf(awal), j = html.indexOf(akhir);
  if (i < 0 || j < 0 || j < i) {
    console.log("penanda " + awal + " / " + akhir + " tidak ditemukan di index.html.");
    return 1;
  }
  const muatan = JSON.stringify(sumber).replace(/</g, "\\u003c");
  const blok = awal + '\n<script type="application/json" id="pf-worker-src">' + muatan + "</script>\n" + akhir;
  const baru = html.slice(0, i) + blok + html.slice(j + akhir.length);
  let balik = null;
  try {
    balik = JSON.parse(muatan);
  } catch (e) {
  }
  if (balik !== sumber) {
    console.log("round-trip gagal: blok tertanam tidak sama persis dengan worker.mjs.");
    return 1;
  }
  if (baru === html) {
    console.log("sudah terbaru: blok tertanam == worker.mjs (" + sumber.length + " byte).");
    return 0;
  }
  fs4.writeFileSync(htmlFile, baru);
  console.log("worker.mjs ditanam ke " + htmlFile.replace(/\\/g, "/") + " (" + sumber.length + " byte).");
  return 0;
}

// src/worker/ledger/root.mjs
import path5 from "node:path";
import fs5 from "node:fs";
function findRoot(start) {
  let d = path5.resolve(start || process.cwd());
  for (let i = 0; i < 10; i++) {
    if (fs5.existsSync(path5.join(d, DIR, F_PLAN))) return d;
    const up = path5.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
function resolveRoot(args) {
  const want = args && args.dir && args.dir !== true ? String(args.dir) : null;
  if (want) return findRoot(want);
  return findRoot(process.cwd()) || findRoot(SELF_DIR);
}

// src/shared/plan-identity.mjs
function crc32(buf) {
  const table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c2 = n;
      for (let k = 0; k < 8; k++) c2 = c2 & 1 ? 3988292384 ^ c2 >>> 1 : c2 >>> 1;
      t[n] = c2 >>> 0;
    }
    return t;
  })();
  let c = 4294967295;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function canonPlan(v) {
  if (Array.isArray(v)) return v.map(canonPlan);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonPlan(v[k]);
    return o;
  }
  return v;
}
function planCoreFromPlan(plan) {
  const ts = plan && plan.tasks && Array.isArray(plan.tasks.tasks) ? plan.tasks.tasks : plan && Array.isArray(plan.tasks) ? plan.tasks : [];
  return {
    brief: plan && plan.brief != null ? plan.brief : null,
    prd: plan && plan.prd || {},
    roadmap: plan && plan.roadmap || {},
    tasks: { tasks: ts.map((t) => {
      const { status, ...rest } = t || {};
      return rest;
    }) }
  };
}
function planFingerprintPlan(plan) {
  return crc32(new TextEncoder().encode(JSON.stringify(canonPlan(planCoreFromPlan(plan))))).toString(16).padStart(8, "0");
}

// src/worker/ledger/state.mjs
import path6 from "node:path";
import fs6 from "node:fs";
function loadCtx(root) {
  const dir = path6.join(root, DIR);
  const plan = readJson(path6.join(dir, F_PLAN), null);
  if (!plan || !plan.tasks || !Array.isArray(plan.tasks.tasks)) throw new Error("plan.json tidak valid / tidak ada di " + dir);
  const dariDisk = readJson(path6.join(dir, F_GATES), {});
  const gates = Object.assign(defaultGates("agy"), dariDisk);
  gates.limits = Object.assign(defaultGates("agy").limits, dariDisk.limits || {});
  const state = readJson(path6.join(dir, F_STATE), null) || {
    runId: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    calls: 0,
    spentNotes: [],
    tasks: {},
    history: [],
    doneTasks: 0,
    sinceFull: 0,
    consecFails: 0,
    lastTask: null
  };
  for (const [k, v] of [["spentNotes", []], ["tasks", {}], ["history", []], ["calls", 0], ["doneTasks", 0], ["sinceFull", 0], ["consecFails", 0]])
    if (state[k] == null) state[k] = v;
  for (const t of plan.tasks.tasks) if (!state.tasks[t.id]) state.tasks[t.id] = { status: t.status || "belum mulai", tries: 0, gate: null, note: "" };
  const fp = planFingerprintPlan(plan);
  if (state.planFingerprint == null) state.planFingerprint = fp;
  if (state.rev == null) state.rev = 0;
  const planBerubah = state.planFingerprint !== fp ? { dari: state.planFingerprint, ke: fp } : null;
  if (planBerubah) {
    state.consecFails = 0;
    state.planFingerprint = fp;
    fs6.mkdirSync(dir, { recursive: true });
    const stateFile = path6.join(dir, F_STATE);
    const tmp = stateFile + ".tmp-" + process.pid + "-" + Date.now();
    fs6.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs6.renameSync(tmp, stateFile);
  }
  return stamp({ root, dir, plan, gates, state, planFingerprint: fp, planBerubah });
}
var cetakIsi = (ctx) => [F_PLAN, F_GATES, F_STATE].map((f) => cetakFile(path6.join(ctx.dir, f))).join("|");
function stamp(ctx) {
  ctx.__print = cetakIsi(ctx);
  return ctx;
}
function syncCtx(ctx) {
  const sekarang = cetakIsi(ctx);
  if (sekarang === ctx.__print) return { ctx, berubah: false };
  const baru = loadCtx(ctx.root);
  return { ctx: baru, berubah: true, dari: ctx.__print, ke: baru.__print };
}
function saveCtx(ctx) {
  fs6.mkdirSync(ctx.dir, { recursive: true });
  ctx.state.rev = (ctx.state.rev || 0) + 1;
  const tujuan = path6.join(ctx.dir, F_STATE);
  const tmp = tujuan + ".tmp-" + process.pid + "-" + Date.now();
  fs6.writeFileSync(tmp, JSON.stringify(ctx.state, null, 1));
  fs6.renameSync(tmp, tujuan);
  ctx.__print = cetakIsi(ctx);
}

// src/worker/workflow/session.mjs
function mulaiSesi(ctx) {
  ctx.state.runId = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/[:T]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);
  ctx.state.runStartedAt = (/* @__PURE__ */ new Date()).toISOString();
  ctx.state.callsThisRun = 0;
  ctx.state.costThisRun = 0;
  saveCtx(ctx);
  return ctx.state.runId;
}

// src/worker/mcp/schema.mjs
var MCP_TOOLS = [
  { name: "plan_status", description: "Ringkasan progress: task selesai/gagal/tersisa dan posisi sekarang.", inputSchema: { type: "object", properties: {} } },
  { name: "next_task", description: "Ambil task berikutnya yang siap dikerjakan (dependensinya sudah selesai). Tidak mengubah apa pun. Menolak menyerahkan task baru kalau budget sesi ini atau plafon biaya sudah habis. Tiap beberapa task (dan di akhir milestone) yang diserahkan adalah GILIRAN-n: audit, perbaikan, refactor, performa — wajib ditutup lewat mark_done sebelum task baru keluar.", inputSchema: { type: "object", properties: {} } },
  { name: "get_task", description: "Kartu tugas lengkap (judul, deskripsi, acceptance criteria, verifikasi, ref).", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "mark_done", description: "Tandai task selesai. Worker menjalankan gerbang keras DAN perintah verification task itu SENDIRI, lalu menolak kalau masih merah / verification-nya cuma kalimat / nggak ada file yang berubah — jadi tulis perintah yang beneran kamu jalankan plus output aslinya, bukan kata 'selesai'.", inputSchema: { type: "object", properties: { id: { type: "string" }, verification: { type: "string", description: "contoh: `npm test` -> 25 passed in 0.96s" } }, required: ["id", "verification"] } },
  { name: "mark_failed", description: "Tandai task gagal beserta alasan supaya runner tidak memutar di situ.", inputSchema: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] } },
  { name: "mark_blocked", description: "Laporkan task TERKENDALA (bukan gagal): kartu task butuh file/data yang tidak ada, dan membuatnya di luar cakupan task. Tercatat di ledger, tidak dihitung gagal, dan task tidak diserahkan lagi sampai manusia memperbaiki syaratnya. Jangan pakai ini untuk gerbang merah (itu mark_failed).", inputSchema: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id", "reason"] } },
  { name: "gate_list", description: "Daftar gerbang kualitas aktif (watchlist 1-5) dan ritmenya.", inputSchema: { type: "object", properties: {} } },
  { name: "audit_plan", description: "Periksa apakah verification tiap task benar-benar bisa dijalankan di mesin ini (perintah shell? biner ada? file ada? angkanya nabrak?). Panggil ini SEBELUM mulai mengerjakan task mana pun.", inputSchema: { type: "object", properties: {} } }
];

// src/worker/ledger/tasks.mjs
var STATUS = (s) => (s || "belum mulai").toLowerCase();
var isDone = (x) => ["selesai", "done", "selesai "].includes(STATUS(x && x.status));
var isFail = (x) => STATUS(x && x.status) === "gagal";
var isBlocked = (x) => STATUS(x && x.status) === "terkendala";
var taskList = (plan) => {
  if (!plan) return [];
  if (Array.isArray(plan.tasks)) return plan.tasks;
  return plan.tasks && Array.isArray(plan.tasks.tasks) ? plan.tasks.tasks : [];
};
function nextTask(plan, state) {
  const list = taskList(plan);
  const done = (id) => isDone(state && state.tasks[id] || list.find((x) => x.id === id));
  const ready = list.filter((t) => {
    const st = state && state.tasks[t.id] || { status: t.status };
    if (isDone(st) || isFail(st) || isBlocked(st)) return false;
    return (t.depends_on || []).every((d) => done(d));
  });
  if (ready.length) return ready[0];
  const blocked = list.filter((t) => !isDone(state.tasks[t.id]) && !isFail(state.tasks[t.id]) && !isBlocked(state.tasks[t.id]));
  return blocked.length ? { id: blocked[0].id, __blocked: true, needs: (blocked[0].depends_on || []).filter((d) => !done(d)) } : null;
}
function hasUnmetDeps(plan, state, t) {
  return (t.depends_on || []).filter((d) => !isDone(state.tasks[d] || taskList(plan).find((x) => x.id === d)));
}

// src/shared/budget.mjs
function hitungBudget(n, gates, milestoneSisa) {
  const rv = gates && gates.reviews || [];
  const light = rv.filter((r) => r && r.enabled && r.tier === "light").length;
  const full = rv.filter((r) => r && r.enabled && r.tier === "full").length;
  const L = gates && gates.limits || {};
  const task = Math.max(0, Math.round(Number(n) || 0));
  const every = Math.max(1, Number(L.fullEvery) || 6);
  const kerja = task * (1 + light);
  const putaran = full ? Math.ceil(task / every) + (L.fullAtMilestoneEnd ? Math.max(0, Number(milestoneSisa) || 0) : 0) : 0;
  const penuh = putaran * full;
  const cadangan = Math.ceil((kerja + penuh) * 0.3);
  return { task, kerja, putaran, penuh, cadangan, total: kerja + penuh + cadangan };
}
function taskMuat(budget, gates, milestoneSisa) {
  if (budget == null) return Infinity;
  const b = Number(budget);
  if (!Number.isFinite(b)) return Infinity;
  let n = 0;
  while (n < 2e3 && hitungBudget(n + 1, gates, milestoneSisa).total <= b) n++;
  return n;
}
function sisaMilestone(milestones, tasks, statusOf) {
  return (milestones || []).filter((m) => (tasks || []).some((t) => t.milestone_ref === m.id && statusOf(t) !== "selesai")).length;
}

// src/worker/workflow/budget.mjs
function budgetRencana(ctx) {
  const ts = taskList(ctx.plan);
  const st = (t) => ctx.state.tasks[t.id] || {};
  const m = sisaMilestone(ctx.plan.roadmap && ctx.plan.roadmap.milestones || [], ts, (t) => isDone(st(t)) ? "selesai" : "belum mulai");
  const b = hitungBudget(ts.filter((t) => !isDone(st(t))).length, ctx.gates, m);
  b.milestoneSisa = m;
  return b;
}
function sisaBudget(ctx) {
  const lim = ctx.gates && ctx.gates.limits || {};
  const biaya = Number(ctx.state.costUsd || 0);
  if (lim.maxCostUsd != null && biaya > Number(lim.maxCostUsd))
    return "biaya $" + biaya + " sudah melewati maxCostUsd $" + lim.maxCostUsd;
  const tok = Number(ctx.state.tokens || 0);
  if (lim.maxTokens != null && tok > Number(lim.maxTokens))
    return "token " + tok + " sudah melewati maxTokens " + lim.maxTokens;
  const total = Number(ctx.state.calls || 0);
  if (lim.maxCalls != null && total >= Number(lim.maxCalls))
    return "panggilan " + total + "/" + lim.maxCalls + " (maxCalls)";
  const sesi = Number(ctx.state.callsThisRun || 0);
  if (lim.maxCallsPerRun != null && sesi >= Number(lim.maxCallsPerRun))
    return "panggilan sesi ini " + sesi + "/" + lim.maxCallsPerRun + " (maxCallsPerRun)";
  return null;
}

// src/worker/ledger/log.mjs
import fs7 from "node:fs";
import path7 from "node:path";
function log(ctx, line) {
  const s = "[" + now() + "] " + line;
  console.log(s);
  fs7.mkdirSync(ctx.dir, { recursive: true });
  if (!fs7.existsSync(path7.join(ctx.dir, F_LOG))) fs7.writeFileSync(path7.join(ctx.dir, F_LOG), "# Log kerja PlanForge\n\n");
  fs7.appendFileSync(path7.join(ctx.dir, F_LOG), "- " + s + "\n");
}

// src/worker/ledger/snapshots.mjs
import { spawnSync as spawnSync3 } from "node:child_process";
import crypto from "node:crypto";
import fs8 from "node:fs";
import path8 from "node:path";
function changedFiles(cwd, since) {
  const r = spawnSync3("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  if (r.status !== 0) return null;
  const files = /* @__PURE__ */ new Set();
  for (const l of String(r.stdout || "").split("\n")) {
    const f = l.slice(3).trim().split(" -> ").pop();
    if (f) files.add(f);
  }
  if (since) {
    const d = spawnSync3("git", ["diff", "--name-only", since + "..HEAD"], { cwd, encoding: "utf8" });
    if (d.status === 0) {
      for (const f of String(d.stdout || "").split("\n")) if (f.trim()) files.add(f.trim());
    }
  }
  return [...files].filter((f) => !bukanKerja(f));
}
var bukanKerja = (f) => /^\.planforge(\/|$)/.test(f) || /^\.agents(\/|$)/.test(f) || /^(\.mcp\.json|worker\.mjs|AGENTS\.md|CLAUDE\.md)$/.test(f);
var CATATAN_WORKER = /^\.planforge\/(state\.json|RUN_LOG\.md)$/;
function potretKotor(cwd) {
  const r = spawnSync3("git", ["status", "--porcelain", "-z", "-uall"], { cwd, encoding: "utf8" });
  if (r.status !== 0) return null;
  const pf = spawnSync3("git", ["rev-parse", "--show-prefix"], { cwd, encoding: "utf8" });
  const prefix = pf.status === 0 ? String(pf.stdout || "").trim() : "";
  const rel = (p) => prefix ? p.startsWith(prefix) ? p.slice(prefix.length) : null : p;
  const out = {};
  const e = String(r.stdout || "").split("\0");
  for (let i = 0; i < e.length; i++) {
    if (!e[i]) continue;
    const xy = e[i].slice(0, 2), f = e[i].slice(3);
    if (xy[0] === "R" || xy[0] === "C") {
      i++;
      if (e[i]) {
        const o = rel(e[i]);
        if (o !== null) out[o] = "-";
      }
    }
    const t = rel(f);
    if (t === null) continue;
    let isi;
    try {
      isi = crypto.createHash("sha1").update(fs8.readFileSync(path8.join(cwd, t))).digest("hex");
    } catch {
      isi = "-";
    }
    out[t] = isi;
  }
  return out;
}
function headSha(cwd) {
  const r = spawnSync3("git", ["rev-parse", "--verify", "HEAD"], { cwd, encoding: "utf8" });
  return r.status === 0 ? String(r.stdout || "").trim() : null;
}
function snapshotControlFiles(cwd) {
  const out = {};
  for (const f of [".planforge/plan.json", ".planforge/gates.json"])
    try {
      const text = fs8.readFileSync(path8.join(cwd, f), "utf8");
      out[f] = { text, hash: crypto.createHash("sha256").update(text).digest("hex") };
    } catch {
      out[f] = { text: null, hash: null };
    }
  return out;
}
function restoreControlFiles(ctx, cwd, snapshot) {
  const dir = path8.join(cwd, ".planforge");
  let restored = false;
  const warnings = [];
  for (const f of [".planforge/plan.json", ".planforge/gates.json"]) {
    const file = path8.join(cwd, f);
    let hash = null;
    try {
      hash = crypto.createHash("sha256").update(fs8.readFileSync(file)).digest("hex");
    } catch {
    }
    if (hash !== snapshot[f].hash) {
      try {
        fs8.mkdirSync(dir, { recursive: true });
        if (snapshot[f].text == null) fs8.rmSync(file, { force: true });
        else fs8.writeFileSync(file, snapshot[f].text);
        restored = true;
        warnings.push(f);
      } catch {
      }
    }
  }
  return { restored, warnings };
}

// src/worker/agents/cost.mjs
function catatBiaya(ctx, j, tag) {
  if (!j || typeof j !== "object") return;
  const usd = Number(j.total_cost_usd != null ? j.total_cost_usd : j.cost_usd);
  const u = j.usage || {};
  const tok = Number(u.input_tokens || u.prompt_tokens || 0) + Number(u.output_tokens || u.completion_tokens || 0);
  if (!Number.isFinite(usd) && !tok) return;
  if (Number.isFinite(usd)) {
    ctx.state.costUsd = Math.round(((ctx.state.costUsd || 0) + usd) * 1e5) / 1e5;
    ctx.state.costThisRun = Math.round(((ctx.state.costThisRun || 0) + usd) * 1e5) / 1e5;
  }
  if (tok) ctx.state.tokens = (ctx.state.tokens || 0) + tok;
  ctx.state.spentNotes.push({ at: now(), tag, usd: Number.isFinite(usd) ? usd : null, tokens: tok || null });
  if (Number.isFinite(usd)) log(ctx, "  biaya " + tag + ": $" + usd + " (akumulasi $" + ctx.state.costUsd + ")");
  const lewat = sisaBudget(ctx);
  if (lewat) log(ctx, "  !! " + lewat + " — panggilan berikutnya tidak akan dikirim");
}

// src/worker/agents/process.mjs
import { spawnSync as spawnSync4 } from "node:child_process";
function callAgent(ctx, promptText, opts) {
  opts = opts || {};
  if (ctx.dryRun || !ctx.gates.agent.cmd) {
    log(ctx, "  [dry-run] prompt " + promptText.split("\n").length + " baris dikirim ke agen (" + (opts.tag || "task") + ")");
    if (ctx.dryRun) console.log("\n----- prompt yang akan dikirim ke agen (" + (opts.tag || "task") + ") -----\n" + promptText + "\n----- akhir prompt -----\n");
    return { ok: true, text: JSON.stringify({ done: true, dryRun: true }), session: null, dry: true };
  }
  const lewat = sisaBudget(ctx);
  if (lewat) {
    log(ctx, "  panggilan TIDAK dikirim: " + lewat);
    return { ok: false, text: "", session: null, budget: lewat };
  }
  const A = ctx.gates.agent, session = opts.session || null;
  if (!Array.isArray(A.args) || !A.args.length) throw new Error("agent.args kosong — jalankan `node worker.mjs init --agent agy` atau sunting gates.json");
  const useCont = !!(session && Array.isArray(A.contArgs) && A.contArgs.length);
  let args = (useCont ? A.contArgs : A.args).slice();
  args = args.map((a) => String(a).replace("{PROMPT}", promptText).replace("{SESSION}", session || ""));
  let r = null, out = "";
  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    r = spawnSync4(A.cmd, args, { cwd: ctx.root, encoding: "utf8", timeout: (A.timeoutMin || 20) * 6e4, maxBuffer: 40 * 1024 * 1024 });
    ctx.state.calls++;
    ctx.state.callsThisRun = (ctx.state.callsThisRun || 0) + 1;
    out = ANSI(String(r.stdout || "") + String(r.stderr || ""));
    if (!detectRateLimit(out) || attempts >= 2) break;
    log(ctx, "  rate limit HTTP 429 terdeteksi; jeda backoff singkat sebelum retry otomatis");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  }
  if (r.error && /ENOENT/.test(String(r.error))) {
    throw new Error("perintah agen '" + A.cmd + "' tidak ditemukan di PATH. Ganti agent.name di gates.json, atau pakai: " + Object.keys(AGENT_PRESETS).filter((k) => k !== "none").join(", "));
  }
  let sess = null, text = out, kosong = false, agenError = null;
  const rateLimit = detectRateLimit(out);
  if (rateLimit) agenError = "HTTP 429 / rate limit: " + short(rateLimit, 260);
  const j = jsonObj(out);
  if (j) {
    sess = j.session_id || j.conversationId || j.conversation_id || j.response && j.response.session_id || null;
    agenError = typeof j.error === "string" && j.error.trim() && j.error || typeof j.status === "string" && !/^success/i.test(j.status) && j.status || null;
    const cand = [j.result, j.text, j.response, j.message && j.message.content, j.response && j.response.text];
    const pick = cand.find((x) => typeof x === "string" && x.trim());
    if (pick == null) kosong = true;
    else text = pick;
    catatBiaya(ctx, j, opts.tag || "-");
  } else {
    const polos = out.trim();
    const mintaJson = (useCont ? A.contArgs : A.args).some((x) => /^json$|^--output-format=json$/i.test(String(x)));
    if (!polos) kosong = true;
    else if (mintaJson || polos.length < 600 && TOLAK_AGEN.test(polos)) agenError = short(polos.replace(/\s+/g, " "), 300);
    else if (r.status !== 0) kosong = true;
  }
  if (r.status !== 0) log(ctx, "  agen keluar dengan code " + r.status + ": " + short(out, 240));
  return { ok: r.status === 0 && !kosong && !agenError, text: String(text), session: sess || (useCont ? session : null), code: r.status, kosong, agenError, rateLimit: !!rateLimit };
}
var TOLAK_AGEN = /authentication required|please (use \/)?log ?in|not logged in|unauthori[sz]ed|invalid api key|api key (is )?(missing|invalid)|insufficient (credits|quota|balance)|quota (exceeded|habis)|need at least \d+ ai credits/i;
function detectRateLimit(out) {
  const text = String(out || "");
  return /\b429\b|too many requests|rate.?limit/i.test(text) ? text.replace(/\s+/g, " ").trim().slice(0, 300) : "";
}
function jsonObj(out) {
  const s = String(out || "").trim();
  if (!s) return null;
  const punya = (o) => o && typeof o === "object" && ("result" in o || "response" in o || "text" in o || "status" in o || "message" in o || "error" in o || "session_id" in o);
  try {
    const one = JSON.parse(s.slice(s.indexOf("{")));
    if (punya(one)) return one;
  } catch (e) {
  }
  for (const line of s.split("\n")) {
    const i = line.indexOf("{");
    if (i < 0) continue;
    try {
      const o = JSON.parse(line.slice(i));
      if (punya(o)) return o;
    } catch (e) {
    }
  }
  return null;
}

// src/worker/agents/verdict.mjs
function extractVerdict(text) {
  const t = String(text || "");
  for (let end = t.length - 1; end >= 0; end--) {
    if (t[end] !== "}") continue;
    let depth = 0, start = -1;
    for (let i = end; i >= 0; i--) {
      if (t[i] === "}") depth++;
      else if (t[i] === "{") {
        depth--;
        if (depth === 0) {
          start = i;
          break;
        }
      }
    }
    if (start < 0) break;
    try {
      const v = JSON.parse(t.slice(start, end + 1));
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch (e) {
    }
    end = start;
  }
  return null;
}

// src/worker/workflow/full-review.mjs
function shouldRunFull(ctx, t) {
  const lim = ctx.gates.limits, full = ctx.gates.reviews.filter((r) => r.enabled && r.tier === "full");
  if (!full.length) return false;
  if (ctx.state.sinceFull >= (lim.fullEvery || 6)) return true;
  if (lim.fullAtMilestoneEnd) {
    const nx = nextTask(ctx.plan, ctx.state);
    if (!nx && ctx.state.sinceFull > 0) return true;
    if (nx && !nx.__blocked && nx.milestone_ref && nx.milestone_ref !== t.milestone_ref) return true;
  }
  return false;
}
function runFullGates(ctx, cwd, upto) {
  const list = taskList(ctx.plan);
  const from = ctx.state.lastFullMark || list[0] && list[0].id || "T-001";
  const done = Object.keys(ctx.state.tasks).filter((k) => isDone(ctx.state.tasks[k]));
  const scope = "task selesai: " + done.slice(-12).join(", ");
  log(ctx, "gerbang penuh (audit -> fix -> refactor -> performa) atas " + from + ".." + upto.id + " · " + done.length + " task");
  let kenapa = null, terbukti = 0;
  for (const g of ctx.gates.reviews.filter((r) => r.enabled && r.tier === "full")) {
    const p = String(g.prompt || "").replace("{FROM}", from).replace("{TO}", upto.id) + "\n\n" + scope + "\nProyek: " + ctx.root;
    const r = callAgent(ctx, g.label + ":\n" + p, { tag: g.id });
    if (r.session) ctx.state.session = r.session;
    const vRaw = extractVerdict(String(r.text));
    const v = vRaw && Object.keys(vRaw).length ? vRaw : null;
    log(ctx, "  " + g.id + " " + from + " sampai " + upto.id + ": " + (r.budget ? "BUDGET HABIS (" + r.budget + ") — gerbang ini tidak membuktikan apa-apa" : r.agenError ? "AGEN MENOLAK BEKERJA (" + short(r.agenError, 100) + ") — gerbang ini tidak membuktikan apa-apa" : r.kosong ? r.rateLimit ? "rate limit HTTP 429 — jeda lalu coba lagi; gerbang ini tidak membuktikan apa-apa" : "agen balas KOSONG — gerbang ini tidak membuktikan apa-apa" : v ? short(JSON.stringify(v).replace(/\s+/g, " "), 200) : "TIDAK ADA VERDICT — gerbang ini tidak membuktikan apa-apa"));
    ctx.state.history.push({ at: (/* @__PURE__ */ new Date()).toISOString(), gate: g.id, out: short(r.agenError ? String(r.agenError) : r.text, 3e3) });
    if (r.budget) {
      kenapa = r.budget;
      break;
    }
    if (r.agenError) {
      kenapa = "agen menolak bekerja di gerbang " + g.id + ": " + short(r.agenError, 140);
      break;
    }
    if (r.kosong) {
      kenapa = r.rateLimit ? "gerbang " + g.id + " terkena rate limit HTTP 429; tunggu jeda backoff lalu coba lagi" : "gerbang " + g.id + " dibalas kosong (semua tool agen di-deny) — tambah --dangerously-skip-permissions di args agen, atau kerjakan lewat chat IDE";
      break;
    }
    if (!v) {
      kenapa = "gerbang " + g.id + " tidak mengembalikan JSON verdict — tidak ada yang bisa dinilai dari jawabannya";
      break;
    }
    terbukti++;
  }
  if (kenapa) {
    ctx.state.fullHalt = { at: (/* @__PURE__ */ new Date()).toISOString(), upto: upto.id, kenapa };
    log(ctx, "  gerbang penuh dihentikan setelah " + terbukti + " gerbang terbukti: " + kenapa);
    log(ctx, "  penanda lastFullMark TETAP di " + from + " — audit atas " + from + ".." + upto.id + " belum pernah terjadi, jangan dianggap sudah.");
    saveCtx(ctx);
    return { ok: false, kenapa, terbukti };
  }
  ctx.state.lastFullMark = upto.id;
  delete ctx.state.fullHalt;
  saveCtx(ctx);
  return { ok: true, terbukti };
}

// src/worker/environment/shell.mjs
import path9 from "node:path";
import fs9 from "node:fs";
var AWAL_PERINTAH = /^\s*(shell|bash|perintah|command|cmd)\s*:?\s*/i;
var BUKAN_PERINTAH = /^(buka|lihat|cek|pastikan|verifikasi|bandingkan|amati|klik|scroll|coba|screenshot|manual|uji\s+manual|test\s+manual)/i;
var BUILTIN = /* @__PURE__ */ new Set(["echo", "cd", "time", "export", "set", "source", "true", "test", "if", "then", "do", "done", "for", "while"]);
var BERISIKO = { npx: "bisa minta izin install lalu menggantung selamanya", docker: "butuh daemon yang jalan", code: "buka GUI, tidak pernah balas di terminal" };
var TOKEN_FILE = /([\w.@\/-]+\.(?:py|csv|json|db|html|js|mjs|sh|md|sql|toml|ini|ya?ml))\b/g;
function hasBin(name) {
  const dirs = String(process.env.PATH || "").split(path9.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const d of dirs) for (const e of exts) {
    try {
      if (fs9.statSync(path9.join(d, name + e)).isFile()) return true;
    } catch (_) {
    }
  }
  return false;
}
var segmen = (v) => {
  const s = String(v), out = [];
  let cur = "", q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === "&" && s[i + 1] === "&" || ch === "|" && s[i + 1] === "|") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === ";" || ch === "\n" || ch === "|") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
};
var tokenAwal = (s) => (s.match(/^["'`]?([^\s"'`|&]+)/) || [, ""])[1];
var desimal = (s) => new Set([...String(s || "").matchAll(/\d+[.,]\d+/g)].map((m) => m[0].replace(",", ".")));
function bukanPerintah(v) {
  const awal = segmen(v)[0] || "";
  if (!awal) return "kosong";
  const tok0 = tokenAwal(awal);
  const pathish = /[\/\\]/.test(tok0) || /^[A-Za-z]:/.test(tok0) || /\.exe$/i.test(tok0);
  if (BUKAN_PERINTAH.test(awal) || /^[^a-zA-Z~._\/-]/.test(tok0) || !pathish && /^[A-Z]/.test(tok0)) return awal;
  return null;
}
function kutipSatuBocor(v) {
  const luar = String(v || "").replace(/"[^"]*"/g, '""');
  const m = [...luar.matchAll(/'([^']*)'/g)].find((x) => /[|&<>]/.test(x[1]));
  return m ? m[0] : null;
}

// src/worker/verification/commands.mjs
import { spawnSync as spawnSync5 } from "node:child_process";
function runCmd(cmd, cwd, timeoutMs) {
  const r = spawnSync5(cmd, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs || 3e5, maxBuffer: 20 * 1024 * 1024 });
  const out = String(r.stdout || "") + String(r.stderr || "");
  return { code: r.status === null ? -1 : r.status, out: out.replace(/\u001b\[[0-9;]*m/g, ""), timeout: r.status === null && /ETIMEDOUT|killed/i.test(String(r.error || "")) };
}
function perintahVerifikasi(t) {
  const raw = String(t && t.verification || "").trim();
  const bersih = raw.replace(AWAL_PERINTAH, "");
  return { raw, bersih, baris: bersih.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean) };
}
var VERIF_DILEWATI = { ok: true, jalan: false, dilewati: true, kurang: [], hasil: [], raw: "" };
function runVerification(ctx, cwd, t, opsi) {
  const { raw, bersih, baris } = perintahVerifikasi(t);
  const hasil = [], kurang = [];
  if (!baris.length)
    return { ok: false, jalan: false, kurang: ["verification kosong — tidak ada perintah yang bisa membuktikan task ini"], hasil, raw };
  const bukan = bukanPerintah(bersih);
  if (bukan)
    return { ok: false, jalan: false, kurang: ['verification bukan perintah shell ("' + short(bukan, 80) + '") — worker tidak bisa menjalankannya, jadi tidak ada bukti. Tulis ulang sebagai perintah yang menghasilkan exit code, atau kerjakan task ini lewat jalur manual dan jangan tandai selesai lewat worker.'], hasil, raw };
  for (const cmd of baris) {
    const t0 = Date.now();
    const r = runCmd(cmd, cwd, opsi && opsi.timeoutMs || 3e5);
    const pass = r.code === 0;
    hasil.push({ cmd, code: r.code, pass, ms: Date.now() - t0, out: short(r.out, 2e3) });
    log(ctx, "  verifikasi " + (pass ? "OK" : "GAGAL") + " (exit " + r.code + ", " + Math.round((Date.now() - t0) / 1e3) + "s): " + short(cmd, 110));
    if (!pass) {
      kurang.push("verification gagal (exit " + r.code + "): " + short(cmd, 90) + " -> " + short(String(r.out).replace(/\s+/g, " ").trim(), 300));
      if (/localhost:|127\.0\.0\.1:/.test(cmd))
        kurang.push("perintah ini butuh server yang hidup — nyalakan dulu, jangan tukar buktinya dengan yang lain");
      break;
    }
  }
  return { ok: !kurang.length, jalan: true, kurang, hasil, raw };
}
function ringkasVerifikasi(ver) {
  if (!ver || ver.dilewati) return "verifikasi dilewati (--no-gates)";
  if (!ver.jalan) return ver.kurang.join(" · ");
  const ekor = ver.hasil.length ? String(ver.hasil[ver.hasil.length - 1].out).replace(/\s+/g, " ").trim() : "";
  return ver.hasil.map((h) => h.cmd + " -> exit " + h.code).join(" · ") + (ekor ? " · " + short(ekor, 160) : "");
}

// src/worker/verification/hard-gates.mjs
import path10 from "node:path";
function parseLighthouse(text) {
  try {
    const j = JSON.parse(text.slice(text.indexOf("{")));
    const a = j.audits || {};
    const num = (k) => a[k] ? Math.round(a[k].numericValue) : null;
    return {
      fcp: num("first-contentful-paint"),
      tti: num("interactive"),
      si: num("largest-contentful-paint"),
      score: a["performance"] ? Math.round((a["performance"].score || 0) * 100) : null,
      bytes: Object.values(a).reduce((s2, x) => s2 + (x.details && x.details.totalByteWeight || 0), 0) / 1024
    };
  } catch (e) {
    return null;
  }
}
function metricProblems(res, budgets) {
  const bad = [];
  if (!budgets) return bad;
  const lh = parseLighthouse(res.out);
  if (!lh) {
    bad.push("lighthouse tidak mengembalikan JSON yang bisa dibaca");
    return bad;
  }
  if (budgets.firstContentfulPaint_ms != null && lh.fcp != null && lh.fcp > budgets.firstContentfulPaint_ms) bad.push("FCP " + lh.fcp + "ms > " + budgets.firstContentfulPaint_ms + "ms");
  if (budgets.interactive_ms != null && lh.tti != null && lh.tti > budgets.interactive_ms) bad.push("TTI " + lh.tti + "ms > " + budgets.interactive_ms + "ms");
  if (budgets.totalByteWeight_kb != null && lh.bytes && lh.bytes > budgets.totalByteWeight_kb) bad.push("bundle " + Math.round(lh.bytes) + "kB > " + budgets.totalByteWeight_kb + "kB");
  return bad;
}
function runHardGates(ctx, cwd, opsi) {
  const res = [];
  pruneUnavailableGates(ctx, cwd);
  const hanyaBlocking = opsi && opsi.hanyaBlocking;
  for (const c of (ctx.gates.hard || []).filter((x) => x && x.enabled && x.cmd && !(hanyaBlocking && x.blocking === false))) {
    const t0 = Date.now();
    const r = runCmd(c.cmd, cwd, 9e5);
    const bad = c.metrics ? metricProblems(r, c.metrics) : [];
    const pass = r.code === 0 && !bad.length;
    res.push({ id: c.id, label: c.label, pass, code: r.code, blocking: c.blocking !== false, ms: Date.now() - t0, out: short(r.out, 4e3), metrics: bad });
    log(ctx, "  gerbang " + c.id + ": " + (pass ? "OK" : "GAGAL") + " (" + Math.round((Date.now() - t0) / 1e3) + "s)" + (bad.length ? " — " + bad.join(", ") : ""));
  }
  return res;
}
function npmScriptNama(cmd) {
  const m = /^\s*(?:npm|yarn|pnpm|bun)\b([\s\S]*)$/.exec(String(cmd || ""));
  if (!m) return null;
  const kata = m[1].trim().split(/\s+/).filter((t) => t && !t.startsWith("-") && t !== "run");
  const nama = kata[0];
  if (!nama || !/^[\w:.\-]+$/.test(nama) || nama === "install" || nama === "ci") return null;
  return nama;
}
function pruneUnavailableGates(ctx, cwd) {
  const pj = readJson(path10.join(cwd, "package.json"), null);
  const scripts = pj && pj.scripts || {};
  const off = [];
  for (const h of ctx.gates.hard || []) {
    if (!h || !h.cmd) continue;
    const nama = npmScriptNama(h.cmd);
    if (!nama) continue;
    if (Object.prototype.hasOwnProperty.call(scripts, nama)) {
      if (h.autoOff) {
        h.enabled = true;
        delete h.autoOff;
        log(ctx, "  gerbang " + h.id + ' dihidupkan lagi: package.json sekarang punya script "' + nama + '"');
      }
      continue;
    }
    if (!h.enabled) continue;
    h.enabled = false;
    h.autoOff = true;
    off.push({ id: h.id, script: nama });
    log(ctx, "  gerbang " + h.id + " dimatikan: " + (pj ? 'package.json tidak punya script "' + nama + '"' : "tidak ada package.json di proyek ini") + " — sunting di tab Runner kalau perlu");
  }
  return off;
}

// src/shared/behavior-spec.mjs
var CHECK_BROWSER = [
  "text",
  "count",
  "visible",
  "attr",
  "canvasNotBlank",
  "click",
  "wait",
  "request",
  "url",
  "noConsoleError",
  "noHorizontalOverflow"
];
var PERLU_SELECTOR = /* @__PURE__ */ new Set(["text", "count", "visible", "attr", "canvasNotBlank", "click"]);
var UI_FILE = /(\.html?|\.css|\.vue|\.svelte|\.jsx|\.tsx)\b|(^|\/)(templates|static|public|assets)\//i;
var UI_KATA = /\b(browser|halaman|layar|viewport|responsif|mobile|tombol|klik|click|grafik|chart|canvas|frontend|dom)\b/i;
function taskUi(t) {
  if (!t) return false;
  const targets = (Array.isArray(t.files_or_areas) ? t.files_or_areas : []).join(" ").replace(/\\/g, "/");
  const files = (Array.isArray(t.files_or_areas) ? t.files_or_areas : []).map((file) => String(file || "").replace(/\\/g, "/")).filter(Boolean);
  const backendTarget = (file) => /(^|\/)(routes|controllers|models|lib|api)(\/|$)/i.test(file) || /(^|\/)(server|web)\.js$/i.test(file);
  const uiTarget = (file) => UI_FILE.test(file) || /(^|\/)(public|views)\//i.test(file);
  if (files.length && files.every(backendTarget) && !files.some(uiTarget)) return false;
  if (UI_FILE.test(targets) || /(^|\/)(web|frontend|client|components|pages|views|ui)(\/|$)/i.test(targets)) return true;
  if (/(^|\/)(?:src\/)?(?:utils|data|cli|api|server|backend|worker|shared|database|db)(?:\/|(?:\.[^/]+)?$)|(^|\/)(?:bin|scripts)\//i.test(targets)) return false;
  return UI_KATA.test([t.title, t.description, ...t.acceptance_criteria || []].join(" "));
}
function specBehavior(t) {
  const b = t && t.behavior;
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  return {
    url: String(b.url || ""),
    viewport: b.viewport || null,
    server: b.server || null,
    checks: Array.isArray(b.checks) ? b.checks : [],
    settleMs: Math.min(5e3, Math.max(0, Number(b.settleMs) || 600)),
    timeoutSec: Math.min(600, Math.max(10, Number(b.timeoutSec) || 90))
  };
}
function masalahBehavior(t) {
  const spec = specBehavior(t);
  if (!spec) {
    if (!(taskUi(t) && t.ui !== false)) return [];
    const area = String((t.files_or_areas || []).join(", ") || t.title || "");
    const ringkas = area.length > 60 ? area.slice(0, 60) + "…" : area;
    return ["task UI tanpa behavior — task ini menyentuh UI (" + ringkas + ") tapi tidak punya `behavior`. Worker tidak punya cara membuktikan tampilannya, jadi task tidak boleh dicap selesai. Tambahkan behavior berisi url + checks (mis. canvasNotBlank pada selector grafik) di plan.json — itu pekerjaan manusia/audit, bukan agen."];
  }
  const bad = [];
  const angka = (v) => v == null || Number.isFinite(Number(v)) && Number(v) >= 0;
  const regexSah = (v) => {
    if (v == null) return true;
    try {
      new RegExp(String(v));
      return true;
    } catch (e) {
      return false;
    }
  };
  if (!/^https?:\/\/\S+/.test(spec.url)) bad.push("behavior.url harus alamat http(s) yang bisa dibuka browser, bukan kalimat");
  if (!spec.checks.length) bad.push("behavior.checks kosong — tidak ada satu pun yang diukur, jadi bukan bukti");
  const ASSERT = ["text", "count", "visible", "attr", "canvasNotBlank", "request", "url", "noConsoleError", "noHorizontalOverflow"];
  if (spec.checks.length && spec.checks.every((c) => c && CHECK_BROWSER.includes(c.type)) && !spec.checks.some((c) => c && ASSERT.includes(c.type)))
    bad.push("behavior.checks hanya berisi aksi/tunggu — tidak ada satu pun assertion yang membuktikan hasil");
  spec.checks.forEach((c, i) => {
    const label = "behavior.checks[" + i + "]";
    if (!c || typeof c !== "object") {
      bad.push(label + " bukan objek");
      return;
    }
    if (!CHECK_BROWSER.includes(c.type)) {
      bad.push(label + '.type "' + String(c.type).slice(0, 30) + '" tidak dikenal — pilih: ' + CHECK_BROWSER.join(", "));
      return;
    }
    if (PERLU_SELECTOR.has(c.type) && !String(c.selector || "").trim()) bad.push(label + " (" + c.type + ") butuh selector");
    if (c.type === "text" && !(c.contains || c.matches || c.equals)) bad.push(label + " (text) butuh contains/matches/equals");
    if (c.type === "text" && !regexSah(c.matches)) bad.push(label + " (text) matches bukan regex yang sah");
    if (c.type === "count" && c.equals == null && c.min == null && c.max == null) bad.push(label + " (count) butuh equals/min/max");
    if (c.type === "count" && (!angka(c.equals) || !angka(c.min) || !angka(c.max))) bad.push(label + " (count) equals/min/max harus angka >= 0");
    if (c.type === "attr" && !String(c.name || "").trim()) bad.push(label + " (attr) butuh name");
    if (c.type === "attr" && c.equals == null && !c.contains) bad.push(label + " (attr) butuh equals/contains — tanpa itu atribut kosong pun lolos");
    if (c.type === "canvasNotBlank" && !angka(c.minPixels)) bad.push(label + " (canvasNotBlank) minPixels harus angka >= 0");
    if (c.type === "request" && !(c.urlContains || c.urlMatches)) bad.push(label + " (request) butuh urlContains/urlMatches");
    if (c.type === "request" && !regexSah(c.urlMatches)) bad.push(label + " (request) urlMatches bukan regex yang sah");
    if (c.type === "url" && !(c.contains || c.matches || c.equals)) bad.push(label + " (url) butuh contains/matches/equals");
    if (c.type === "url" && !regexSah(c.matches)) bad.push(label + " (url) matches bukan regex yang sah");
  });
  const b = t.behavior || {};
  if (b.viewport && (!angka(b.viewport.width) || !angka(b.viewport.height) || !(Number(b.viewport.width) > 0)))
    bad.push("behavior.viewport harus angka positif — ukuran tidak sah tidak boleh dianggap bukti");
  return bad;
}

// src/worker/browser/run.mjs
import { spawnSync as spawnSync6 } from "node:child_process";
var BEH_DILEWATI = { ok: true, jalan: false, dilewati: true, wajib: false, kurang: [], hasil: [] };
function runBehavior(ctx, cwd, t, opsi) {
  const spec = specBehavior(t);
  const wajib = taskUi(t);
  if (!spec) {
    const kurang = masalahBehavior(t);
    return kurang.length ? { ok: false, jalan: false, planRusak: true, wajib, kurang, hasil: [] } : { ok: true, jalan: false, dilewati: true, wajib, kurang: [], hasil: [] };
  }
  const rusak = masalahBehavior(t);
  if (rusak.length) return { ok: false, jalan: false, planRusak: true, wajib, kurang: rusak, hasil: [] };
  if (typeof WebSocket === "undefined")
    return { ok: false, jalan: false, lingkungan: true, wajib, kurang: ["Node " + process.version + " tidak punya WebSocket global — gerbang perilaku butuh Node 22+. Perilaku tidak dibuktikan, jadi task tidak boleh dicap selesai."], hasil: [] };
  const bin = cariBrowser();
  if (!bin)
    return { ok: false, jalan: false, lingkungan: true, wajib, kurang: ["browser tidak ditemukan di mesin ini. Pasang Microsoft Edge / Google Chrome, atau set PLANFORGE_BROWSER ke path binary-nya. Tanpa browser, worker tidak bisa membuktikan tampilan — dan tidak akan pura-pura hijau."], hasil: [] };
  const t0 = Date.now();
  const r = spawnSync6(process.execPath, [SELF_FILE, "__browser"], {
    cwd,
    input: JSON.stringify({ spec, cwd }),
    encoding: "utf8",
    timeout: (spec.timeoutSec + 40) * 1e3,
    maxBuffer: 16 * 1024 * 1024
  });
  const out = String(r.stdout || "").trim();
  let j = null;
  try {
    j = JSON.parse(out.slice(out.indexOf("{")));
  } catch (e) {
  }
  if (!j) {
    const kenapa = r.error ? String(r.error.message) : "keluar tanpa JSON (code " + r.status + ")";
    return { ok: false, jalan: true, wajib, kurang: ["pengukur perilaku tidak menjawab: " + short(kenapa, 120) + " · " + short(String(r.stderr || "").replace(/\s+/g, " "), 240)], hasil: [], ms: Date.now() - t0 };
  }
  j.wajib = wajib;
  j.jalan = true;
  log(ctx, "  perilaku " + (j.ok ? "OK" : "GAGAL") + " (" + Math.round((j.ms || Date.now() - t0) / 1e3) + "s, " + (j.hasil || []).length + " check, " + (j.requests || 0) + " request" + ((j.console || []).length ? ", " + j.console.length + " error console" : "") + "): " + short(spec.url, 80) + (j.ok ? "" : " — " + short((j.kurang || []).join(" · "), 220)));
  return j;
}

// src/worker/workflow/giliran.mjs
import fs10 from "node:fs";
import os2 from "node:os";
import path11 from "node:path";
function giliranJatuh(ctx, t) {
  if (ctx.state.giliran || !shouldRunFull(ctx, t)) return null;
  const list = taskList(ctx.plan);
  const ke = (ctx.state.giliranKe || 0) + 1;
  const g = {
    id: "GILIRAN-" + ke,
    from: ctx.state.lastFullMark || list[0] && list[0].id || t.id,
    to: t.id,
    langkah: ctx.gates.reviews.filter((r) => r.enabled && r.tier === "full").map((r) => r.id),
    dibuka: (/* @__PURE__ */ new Date()).toISOString(),
    tries: 0
  };
  ctx.state.giliran = g;
  ctx.state.giliranKe = ke;
  log(ctx, g.id + " dibuka: gerbang penuh atas " + g.from + ".." + g.to + " (" + g.langkah.join(" -> ") + ") — diserahkan next_task sebelum task baru");
  return g;
}
function cakupanGiliran(ctx, g) {
  const list = taskList(ctx.plan);
  const i = list.findIndex((x) => x.id === g.from), j = list.findIndex((x) => x.id === g.to);
  return list.slice(Math.max(0, i), j + 1).filter((x) => isDone(ctx.state.tasks[x.id]));
}
function kartuGiliran(ctx, g) {
  const full = ctx.gates.reviews.filter((r) => r.enabled && r.tier === "full" && g.langkah.includes(r.id));
  const cakup = cakupanGiliran(ctx, g).map((x) => x.id).join(", ") || "-";
  const keras = ctx.gates.hard.filter((h) => h.enabled).map((h) => h.cmd);
  return [
    g.id + ": GILIRAN GERBANG PENUH atas " + g.from + ".." + g.to + " — ini BUKAN task baru, jangan menambah fitur.",
    "Kerjakan langkah ini berurutan di folder proyek:",
    ...full.map((r, k) => k + 1 + ". [" + r.id + "] " + r.label + ": " + String(r.prompt || "").replace("{FROM}", g.from).replace("{TO}", g.to)),
    "",
    "ATURAN:",
    "- Perilaku dan tampilan task yang sudah selesai (" + cakup + ") WAJIB tetap sama. Jangan sunting .planforge/.",
    keras.length ? "- Jalankan sendiri sampai hijau: " + keras.join(" · ") : "- Tidak ada gerbang keras aktif; tetap jalankan tes proyek sendiri.",
    '- Semua langkah selesai: panggil mark_done dengan id "' + g.id + '". Di verification tulis hasil tiap langkah, satu baris per langkah diawali id-nya (' + full.map((r) => r.id + ": {...}").join(", ") + "), lalu perintah tes yang kamu jalankan beserta output aslinya.",
    "- Worker menjalankan ulang sendiri gerbang keras DAN verification + perilaku browser " + cakup + ". Satu saja merah = giliran ditolak.",
    '- Tidak sanggup setelah 2 ronde perbaikan: mark_failed id "' + g.id + '" beserta alasannya, lalu BERHENTI dan laporkan ke manusia.'
  ].join("\n");
}
function statusFiles(root) {
  const dirs = [], files = [], allDirs = [];
  const walk = (dir, relative) => {
    for (const entry of fs10.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".planforge" || entry.name === ".git") continue;
      const rel = relative ? path11.join(relative, entry.name) : entry.name;
      const full = path11.join(dir, entry.name);
      if (entry.isDirectory()) {
        allDirs.push(rel);
        if (/^(?:data|db|storage)$/i.test(entry.name)) {
          dirs.push(rel);
          continue;
        }
        walk(full, rel);
      } else if (entry.isFile() && /\.(?:json|csv|db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(entry.name)) {
        files.push(rel);
      }
    }
  };
  walk(root, "");
  return { dirs, files, allDirs };
}
function snapshotApplicationState(root, backup) {
  const entries = statusFiles(root);
  for (const relative of entries.dirs) {
    const target = path11.join(backup, relative);
    fs10.mkdirSync(path11.dirname(target), { recursive: true });
    fs10.cpSync(path11.join(root, relative), target, { recursive: true });
  }
  for (const relative of entries.files) {
    const target = path11.join(backup, relative);
    fs10.mkdirSync(path11.dirname(target), { recursive: true });
    fs10.copyFileSync(path11.join(root, relative), target);
  }
  return entries;
}
function restoreApplicationState(root, backup, before) {
  const current = statusFiles(root);
  for (const relative of current.dirs) fs10.rmSync(path11.join(root, relative), { recursive: true, force: true });
  for (const relative of current.files) fs10.rmSync(path11.join(root, relative), { force: true });
  for (const relative of before.dirs) {
    const source = path11.join(backup, relative);
    const target = path11.join(root, relative);
    fs10.mkdirSync(path11.dirname(target), { recursive: true });
    fs10.cpSync(source, target, { recursive: true });
  }
  for (const relative of before.files) {
    const source = path11.join(backup, relative);
    const target = path11.join(root, relative);
    fs10.mkdirSync(path11.dirname(target), { recursive: true });
    fs10.copyFileSync(source, target);
  }
  const existing = new Set(before.allDirs);
  const after = statusFiles(root).allDirs.sort((a, b) => b.length - a.length);
  for (const relative of after) {
    if (existing.has(relative)) continue;
    const target = path11.join(root, relative);
    if (fs10.readdirSync(target).length === 0) fs10.rmdirSync(target);
  }
}
function runIsolatedState(root, callback) {
  const backup = fs10.mkdtempSync(path11.join(os2.tmpdir(), "planforge-giliran-"));
  try {
    const before = snapshotApplicationState(root, backup);
    try {
      return callback();
    } finally {
      restoreApplicationState(root, backup, before);
    }
  } finally {
    fs10.rmSync(backup, { recursive: true, force: true });
  }
}
function buktiGiliran(ctx, root, verification) {
  const g = ctx.state.giliran;
  const v = String(verification || "").trim();
  const kurang = [];
  if (v.length < 12) kurang.push("verification terlalu pendek (" + v.length + " karakter) — tulis hasil tiap langkah + perintah tes dan outputnya");
  const absen = g.langkah.filter((id) => !new RegExp("(^|[^\\w-])" + id + "\\s*[:=]", "i").test(v));
  if (absen.length) kurang.push("laporan tidak menyebut hasil langkah: " + absen.join(", ") + " — satu baris per langkah, diawali id-nya");
  const hard = runIsolatedState(root, () => runHardGates(ctx, root));
  const blok = hard.filter((h) => !h.pass && h.blocking);
  if (blok.length) kurang.push("gerbang keras merah: " + blok.map((b) => b.id + " -> " + short(String(b.out).replace(/\s+/g, " "), 300)).join(" | "));
  const cek = [];
  if (!ctx.lewatiVerifikasi) for (const t of cakupanGiliran(ctx, g)) {
    const { ver, beh } = runIsolatedState(root, () => {
      const ver2 = runVerification(ctx, root, t);
      const beh2 = runBehavior(ctx, root, t);
      return { ver: ver2, beh: beh2 };
    });
    if (!ver.ok) kurang.push("verification " + t.id + " merah sesudah giliran: " + short(ver.kurang.join(" · "), 300));
    if (!beh.ok) kurang.push("perilaku " + t.id + " merah sesudah giliran: " + short((beh.kurang || []).join(" · "), 300));
    cek.push(t.id + (ver.ok && beh.ok ? "=OK" : "=merah"));
  }
  return { ok: !kurang.length, kurang, hard, cek };
}

// src/worker/browser/spec.mjs
function kartuBehavior(t) {
  const spec = specBehavior(t);
  if (!spec) return "";
  const baris = spec.checks.map((c, i) => {
    const extra = Object.keys(c).filter((k) => !["type", "selector"].includes(k)).map((k) => k + "=" + JSON.stringify(c[k])).join(" ");
    return "  " + (i + 1) + ". " + c.type + (c.selector ? " " + c.selector : "") + (extra ? " (" + extra + ")" : "");
  });
  return [
    "BUKTI PERILAKU (worker membuka browser sungguhan dan mengukur sendiri — bukan kamu yang menilai):",
    "  url: " + spec.url,
    spec.viewport ? "  viewport: " + spec.viewport.width + "x" + (spec.viewport.height || 800) : "",
    spec.server && spec.server.cmd ? "  server yang dinyalakan worker: " + spec.server.cmd : "",
    ...baris
  ].filter(Boolean).join("\n");
}
function ringkasBehavior(beh) {
  if (!beh || beh.dilewati) return "perilaku: tidak ada check (task bukan UI)";
  if (!beh.jalan) return (beh.kurang || []).join(" · ");
  const angka = (beh.hasil || []).filter((h) => h.ukur && typeof h.ukur === "object" && h.ukur.pixel != null).map((h) => h.check + " " + h.ukur.pixel + "/" + h.ukur.total + " pixel");
  return (beh.ok ? "perilaku hijau" : "perilaku GAGAL") + " · " + (beh.hasil || []).length + " check di browser" + (angka.length ? " · " + angka.join(", ") : "") + (beh.ok ? "" : " · " + (beh.kurang || []).join(" · "));
}

// src/worker/environment/readiness.mjs
import fs11 from "node:fs";
import path12 from "node:path";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { spawnSync as spawnSync7 } from "node:child_process";
function envFileNames(env) {
  const mode = env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development";
  return [".env." + mode + ".local", ...mode === "test" ? [] : [".env.local"], ".env." + mode, ".env"];
}
function environmentReadiness(root, opts = {}) {
  const env = opts.env || process.env, findings = [];
  const add = (code, msg) => findings.push({ lvl: "warn", id: "ENV", code, msg });
  let pkg = null;
  try {
    pkg = JSON.parse(fs11.readFileSync(path12.join(root, "package.json"), "utf8"));
  } catch (_) {
  }
  if (!pkg) return { findings, checked: false, database: "not-applicable" };
  const req = createRequire(path12.join(root, "package.json"));
  const missing = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => {
    try {
      req.resolve(name);
      return false;
    } catch (_) {
    }
    return !(req.resolve.paths(name) || []).some((base) => fs11.existsSync(path12.join(base, name, "package.json")));
  });
  if (missing.length) add("dependencies", "Dependency belum terpasang/terbaca: " + missing.join(", ") + ". Jalankan npm install di folder proyek setelah menyetujui unduhan dan install scripts; bukan alasan menolak Connect atau mengaku task selesai.");
  const files = envFileNames(env).filter((f) => fs11.existsSync(path12.join(root, f)));
  let url = env.DATABASE_URL;
  for (const f of files) {
    if (url !== void 0) break;
    try {
      const parsed = parseEnv(fs11.readFileSync(path12.join(root, f), "utf8"));
      if (Object.hasOwn(parsed, "DATABASE_URL")) url = parsed.DATABASE_URL;
    } catch (_) {
    }
  }
  const hasExample = fs11.existsSync(path12.join(root, ".env.example"));
  if (hasExample && !files.length && !url) add("env-file", "Konfigurasi lokal belum ada. node worker.mjs setup-env menyalin .env.example ke .env.local tanpa menimpa file; periksa nilainya sebelum dipakai. Tidak ada rahasia yang dicetak.");
  const pgNeeded = !!(pkg.dependencies && pkg.dependencies.pg || pkg.devDependencies && pkg.devDependencies.pg);
  let database = pgNeeded ? "unverified" : "not-applicable";
  if (pgNeeded) {
    if (!url) add("database-url", "DATABASE_URL belum tersedia. Isi PostgreSQL milikmu di .env.local / konfigurasi yang sudah ada, atau set environment variable. DB tidak dipasang otomatis.");
    else {
      let parsed;
      try {
        parsed = new URL(url);
        if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !parsed.hostname || /\$\{?\w/.test(url)) throw new Error("invalid");
      } catch (_) {
        add("database-url", "DATABASE_URL belum valid atau memakai ekspansi variabel yang belum diukur; nilai rahasia disembunyikan.");
      }
      if (parsed && /^postgres(?:ql)?:$/.test(parsed.protocol) && parsed.hostname && !/\$\{?\w/.test(url)) {
        if (opts.probe) {
          const code = "const net=require('node:net');const p=JSON.parse(process.argv[1]);const s=net.connect(p);s.setTimeout(1200);s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));s.on('timeout',()=>{s.destroy();process.exit(1)});";
          const r = spawnSync7(process.execPath, ["-e", code, JSON.stringify({ host: parsed.hostname.replace(/^\[|\]$/g, ""), port: Number(parsed.port || 5432) })], { timeout: 2200, stdio: "ignore", windowsHide: true });
          database = r.status === 0 ? "tcp-open-auth-unverified" : "unreachable";
          add("database-probe", r.status === 0 ? "Port DB dapat dihubungi (TCP saja); login, schema, dan query PostgreSQL BELUM diverifikasi. Ini bukan bukti kelulusan task." : "Port DB tidak dapat dihubungi. Hidupkan PostgreSQL pilihanmu; jangan mengganti hasil tes dengan klaim selesai.");
        } else add("database-unverified", "DATABASE_URL tersedia, koneksi DB belum diuji. node worker.mjs doctor --environment memeriksa port (bukan login/schema).");
      }
    }
    if (fs11.existsSync(path12.join(root, "docker-compose.yml"))) add("database-start", "Ada docker-compose.yml. Untuk starter PlanForge, jika Docker sudah terpasang dan pengguna menyetujui DB lokal: docker compose up -d db (unduh image, buat volume). Hentikan: docker compose stop db; data tetap ada. Alternatif: DATABASE_URL PostgreSQL yang sudah dimiliki. Jangan memasang Docker atau membuat DB cloud tanpa persetujuan.");
  }
  return { findings, checked: true, database };
}
function setupEnv(root, env = process.env) {
  const allEnvFiles = [".env", ".env.local", ...["development", "production", "test"].flatMap((mode) => [".env." + mode, ".env." + mode + ".local"])];
  const existing = allEnvFiles.find((f) => fs11.existsSync(path12.join(root, f)));
  if (existing || env.DATABASE_URL) return { ok: true, created: false, message: "Konfigurasi sudah ada; tidak ditimpa dan tidak ditampilkan. Periksa DATABASE_URL milikmu sendiri." };
  const example = path12.join(root, ".env.example"), dest = path12.join(root, ".env.local");
  if (!fs11.existsSync(example)) return { ok: false, created: false, message: ".env.example tidak ada; tidak menebak konfigurasi." };
  let ignore = "";
  try {
    ignore = fs11.readFileSync(path12.join(root, ".gitignore"), "utf8");
  } catch (_) {
  }
  const ignored = spawnSync7("git", ["check-ignore", "--no-index", "--quiet", "--", ".env.local"], { cwd: root, encoding: "utf8", timeout: 3e3, windowsHide: true });
  const simpleIgnore = ignore.split(/\r?\n/).some((l) => [".env.local", "/.env.local", ".env*", ".env.*"].includes(l.trim())) && !/^\s*!/m.test(ignore);
  if (!(ignored.status === 0 || ignored.status !== 1 && simpleIgnore))
    return { ok: false, created: false, message: "Belum dapat memastikan .env.local diabaikan Git. Pastikan aturan .gitignore tidak membukanya kembali; tidak ada file yang ditulis." };
  try {
    fs11.copyFileSync(example, dest, fs11.constants.COPYFILE_EXCL);
  } catch (e) {
    return { ok: false, created: false, message: ".env.local tidak dibuat (" + e.code + "); tidak ada file lama yang ditimpa." };
  }
  return { ok: true, created: true, message: ".env.local dibuat dari contoh. Periksa DATABASE_URL sebelum migrasi; ini belum menyalakan DB atau memasang dependency. Untuk membatalkan, hapus hanya .env.local baru ini jika belum kamu sunting." };
}

// src/worker/agents/prompts.mjs
function taskCard(plan, t) {
  const prd = plan.prd || {};
  const feat = (prd.features || []).find((f) => String(f.name).toLowerCase() === String(t.feature || "").toLowerCase());
  const reqs = (prd.requirements || []).filter((r) => (t.requirement_refs || []).includes(r.id));
  return [
    "PROYEK: " + (plan.brief && plan.brief.project_name || prd.project_name || "(tanpa nama)"),
    "KONTEKS: " + short(plan.brief && plan.brief.brief || prd.overview && prd.overview.summary || "", 600),
    "FITUR INDUK: " + (t.feature || "-") + (feat && feat.sub_features ? " · sub-fitur: " + feat.sub_features.join(", ") : ""),
    "TASK " + t.id + ": " + (t.title || ""),
    t.description || "",
    "KRITERIA SELESAI:",
    ...(t.acceptance_criteria || []).map((a) => "  - " + a),
    "VERIFIKASI (perintah shell — worker menjalankannya ulang sendiri, exit code-nya yang menentukan): " + (t.verification || "-"),
    kartuBehavior(t),
    "AREA/FILE: " + ((t.files_or_areas || []).join(", ") || "tentukan sendiri, sesuaikan struktur proyek"),
    "REF REQUIREMENT: " + (reqs.length ? reqs.map((r) => r.id + " " + r.title).join(" | ") : (t.requirement_refs || []).join(", ")),
    "DEPENDENCY: " + ((t.depends_on || []).join(", ") || "tidak ada"),
    t.agent_hint ? "AWAS: " + t.agent_hint : ""
  ].filter(Boolean).join("\n");
}
function buildTaskPrompt(ctx, t) {
  const adaBehavior = !!specBehavior(t);
  return [
    "Kerjakan SATU task berikut sampai selesai. Jangan mengerjakan task lain, jangan menambah fitur.",
    "",
    taskCard(ctx.plan, t),
    "",
    ...ctx.root ? environmentReadiness(ctx.root).findings.map((x) => "Saran lingkungan (bukan penahan task): " + x.msg) : [],
    "Aturan:",
    '1. Satu task = satu commit dengan pesan "' + t.id + ": " + short(t.title, 60) + '" (kalau ini repo git).',
    '2. Kalau ada bagian yang tidak bisa dipenuhi karena informasi hilang, JANGAN mengarang. Balas dengan blok JSON di baris terakhir: {"blocked":true,"reason":"..."}',
    '3. Worker MENJALANKAN SENDIRI perintah VERIFIKASI di atas sesudah kamu selesai — exit code bukan 0 berarti task GAGAL walau kamu merasa sudah benar. Jalankan dulu perintahnya, pastikan hijau, baru balas blok JSON terakhir: {"done":true,"verification":"<output asli yang kamu lihat>","files":["..."]}',
    "4. Kode harus tetap bisa di-build dan test tetap hijau setelah kamu selesai.",
    "5. Jangan mengubah file konfigurasi CI, jangan menghapus test yang sudah ada.",
    adaBehavior ? "6. Build/test hijau BELUM cukup: worker membuka Edge/Chrome headless dan mengukur BUKTI PERILAKU di atas (jumlah pixel canvas, teks sesudah klik, request yang benar-benar terkirim, error console, overflow). Satu check gagal = task GAGAL. Pastikan library yang kamu pakai benar-benar dimuat di halaman, dan elemen yang diukur benar-benar ada. Jangan mengubah plan.json atau check-nya." : ""
  ].filter(Boolean).join("\n");
}
function buildFixPrompt(ctx, t, why) {
  return [
    "Perbaikan untuk task " + t.id + " (gerbang/verifikasi gagal):",
    "",
    why,
    "",
    'Ubah seminimal mungkin. Jangan sentuh task lain. Balas blok JSON terakhir: {"fixed":true} atau {"blocked":true,"reason":"..."}'
  ].join("\n");
}

// src/worker/ledger/commit.mjs
import { spawnSync as spawnSync8 } from "node:child_process";
function gitCommit(ctx, cwd, t, awal) {
  const st = spawnSync8("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  if (st.status !== 0) {
    log(ctx, "  commit " + t.id + ' dilewati: folder kerja bukan repo Git. Untuk mengaktifkan auto-commit, jalankan `git init && git add . && git commit -m "init"` dari folder proyek.');
    return null;
  }
  const kini = potretKotor(cwd);
  if (!kini) return null;
  const ikut = [], bawaan = [], ditinggal = [];
  for (const f of Object.keys(kini)) {
    if (CATATAN_WORKER.test(f)) {
      ikut.push(f);
      continue;
    }
    if (bukanKerja(f) || awal && awal[f] === kini[f]) {
      ditinggal.push(f);
      continue;
    }
    if (awal && f in awal) bawaan.push(f);
    ikut.push(f);
  }
  const hasil = { ikut, bawaan, ditinggal, ok: false };
  if (!ikut.length) {
    log(ctx, "  commit " + t.id + ": tidak ada file untuk dikommit");
    return hasil;
  }
  const daftar = { cwd, encoding: "utf8", input: ikut.join("\0") + "\0" };
  const pilih = ["--pathspec-from-file=-", "--pathspec-file-nul"];
  spawnSync8("git", ["--literal-pathspecs", "add", "-A", ...pilih], daftar);
  const c = spawnSync8("git", ["--literal-pathspecs", "commit", "-m", t.id + ": " + short(t.title, 60), ...pilih], daftar);
  hasil.ok = c.status === 0;
  if (hasil.ok) log(ctx, "  commit " + t.id + ": " + short(String(c.stdout).split("\n")[0], 70) + " · " + ikut.length + " file" + (ditinggal.length ? " · tidak ikut: " + short(ditinggal.join(", "), 160) : ""));
  else {
    const detail = String(c.stderr || c.stdout);
    if (/author identity unknown|unable to auto-detect email address|empty ident name|please tell me who you are/i.test(detail))
      log(ctx, '  peringatan: auto-commit gagal karena identitas Git belum dikonfigurasi. Jalankan `git config user.name "Nama Anda"` dan `git config user.email "email@anda"` di repo proyek. Tambahkan `--global` hanya jika ingin pengaturan berlaku untuk semua repo.');
    log(ctx, "  commit gagal: " + short(detail, 120));
  }
  return hasil;
}

// src/worker/verification/evidence.mjs
import { spawnSync as spawnSync9 } from "node:child_process";
function buktiSelesai(ctx, root, id, verification) {
  const v = String(verification || "").trim();
  const kurang = [];
  if (v.length < 12) kurang.push("verification terlalu pendek (" + v.length + " karakter) — tulis perintah yang kamu jalankan + output aslinya");
  else if (/^(selesai|done|ok|lulus|bersih|kelar|sudah|aman)\b/i.test(v) && v.length < 40) kurang.push("verification cuma klaim ('" + short(v, 40) + "'), bukan bukti");
  pruneUnavailableGates(ctx, root);
  const hard = runHardGates(ctx, root);
  const blok = hard.filter((h) => !h.pass && h.blocking);
  if (blok.length) kurang.push("gerbang keras masih merah: " + blok.map((b) => b.id + " -> " + short(String(b.out).replace(/\s+/g, " "), 300)).join(" | "));
  const task = taskList(ctx.plan).find((x) => x.id === id);
  if (task) {
    const belum = hasUnmetDeps(ctx.plan, ctx.state, task);
    if (belum.length) kurang.push("dependensi belum selesai: " + belum.join(", ") + " — kerjakan itu dulu lewat next_task");
  }
  const ver = ctx.lewatiVerifikasi ? Object.assign({}, VERIF_DILEWATI) : task ? runVerification(ctx, root, task) : { ok: false, jalan: false, kurang: ["task " + id + " tidak ada di plan.json — tidak ada verification yang bisa dijalankan"], hasil: [], raw: "" };
  if (!ver.ok) kurang.push(ver.kurang.join(" · "));
  const beh = ctx.lewatiVerifikasi ? Object.assign({}, BEH_DILEWATI) : task ? runBehavior(ctx, root, task) : { ok: false, jalan: false, kurang: ["task " + id + " tidak ada di plan.json — tidak ada perilaku yang bisa diukur"], hasil: [] };
  if (!beh.ok) kurang.push((beh.kurang || []).join(" · "));
  const head = String(spawnSync9("git", ["log", "-1", "--format=%h %s"], { cwd: root, encoding: "utf8" }).stdout || "").trim();
  const files = changedFiles(root);
  if (files && !files.length && !head.includes(id)) kurang.push("tidak ada file yang berubah (working tree bersih, HEAD pun bukan kommit " + id + ")");
  return { ok: !kurang.length, hard, ver, beh, kurang, files: files || [], head };
}

// src/shared/npm-contract.mjs
function missingNpmScripts(tasks, pkg) {
  const scripts = pkg && pkg.scripts || {};
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = [];
  for (const t of tasks) {
    const commands = [t.verification, t.behavior && t.behavior.server && t.behavior.server.cmd].filter(Boolean);
    const declared = (task, name, seen = /* @__PURE__ */ new Set()) => {
      if (!task || seen.has(task.id)) return false;
      seen.add(task.id);
      const text = [task.description, task.agent_hint, ...task.acceptance_criteria || []].join(" ");
      if ((task.files_or_areas || []).some((f) => /^\.?\/?package\.json$/.test(f)) && (text.match(/[\w@./:-]+/g) || []).includes(name)) return true;
      return (task.depends_on || []).some((id) => declared(byId.get(id), name, seen));
    };
    for (const command of commands) {
      const shell = String(command).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
      for (const m of shell.matchAll(/(?:^|&&|\|\||;|\n|\|)\s*npm(?:\.cmd)?\s+(?:(?:--silent|--quiet|-[sq])\s+)*(?:run|run-script)\s+(?:(?:--silent|--quiet|--if-present|-[sq])\s+)*([\w:][\w:.-]*)/g)) {
        if (Object.hasOwn(scripts, m[1]) || declared(t, m[1])) continue;
        out.push({ id: t.id, msg: "script npm '" + m[1] + "' tidak ada di package.json; tersedia: " + Object.keys(scripts).join(", ") + ". Pakai nama asli atau rencanakan penambahan script + package.json secara eksplisit." });
      }
    }
  }
  return out;
}

// src/worker/environment/audit.mjs
import fs12 from "node:fs";
import path13 from "node:path";
function auditPlan(ctx, cwd) {
  const temuan = [], st = ctx.state, tasks = taskList(ctx.plan);
  const add = (lvl, id, msg) => temuan.push({ lvl, id, msg });
  temuan.push(...environmentReadiness(cwd).findings);
  let pkg;
  try {
    pkg = JSON.parse(fs12.readFileSync(path13.join(cwd, "package.json"), "utf8"));
  } catch (_) {
  }
  if (pkg) for (const x of missingNpmScripts(tasks, pkg)) add("error", x.id, x.msg);
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length) add("error", "PLAN", "ID task duplikat — struktur rencana harus diperbaiki.");
  const binBrowser = cariBrowser();
  const adaBehavior = tasks.some((t) => specBehavior(t));
  if (adaBehavior && !binBrowser)
    add("warn", "ENV", "ada task dengan bukti perilaku tapi tidak ada Edge/Chrome di mesin ini — worker tidak bisa mengukur, jadi tidak akan menandai selesai. Pasang browser atau set PLANFORGE_BROWSER.");
  if (adaBehavior && typeof WebSocket === "undefined")
    add("warn", "ENV", "Node " + process.version + " tidak punya WebSocket global — gerbang perilaku butuh Node 22+.");
  const pertama = tasks[0];
  if (pertama) {
    const judul = String(pertama.title || "") + " " + String(pertama.description || "");
    const scaffold = /scaffold|kerangka|skeleton|setup|inisial|struktur dasar|bootstrap|bangun dasar/i.test(judul);
    const butuhBuild = /\bnpm run\b|\byarn\b|\bpnpm\b|\bvite\b|next build|\btsc\b/i.test(String(pertama.verification || ""));
    const disebut = (pertama.files_or_areas || []).map((f) => String(f)).filter((f) => !/^(test\/|\.planforge\/)/.test(f));
    const hilang = disebut.filter((f) => !fs12.existsSync(path13.join(ctx.root, f)));
    const berkasInti = ["index.html", "package.json", "src", "app.js", "main.py", "pyproject.toml", "Cargo.toml", "go.mod"];
    const adaProyek = berkasInti.some((f) => fs12.existsSync(path13.join(ctx.root, f)));
    if (!adaProyek && !scaffold && butuhBuild && hilang.length)
      add("error", pertama.id, "folder proyek masih kosong tapi task pertama ini bukan scaffold dan butuh build; file yang disebut tidak ada: " + short(hilang.join(", "), 180) + ". Tidak ada task yang membuatnya. Tambahkan task T-001 scaffold ke rencana, atau pulihkan file aplikasi — jangan mengarang proyek dasar di luar task.");
    else if (!adaProyek && !scaffold && hilang.length)
      add("warn", pertama.id, "folder proyek masih kosong dan file yang disebut belum ada: " + short(hilang.join(", "), 160) + " — pastikan task scaffold ada sebelum task ini.");
    if (String(pertama.id || "").toUpperCase() !== "T-001")
      add("error", "PLAN", "task pertama ber-ID " + pertama.id + ", bukan T-001 — periksa apakah task scaffold hilang.");
  }
  const cwdPrefixes = /* @__PURE__ */ new Map();
  for (const t of tasks) {
    const raw = String(t.verification || "").trim();
    let prefix = ".";
    for (const baris of raw.split(/[\r\n]+/)) {
      const cd = /^\s*(?:cd|pushd)\s+(?:\/d\s+)?["']?([^"&|]+?)["']?\s*(?:&&|&|$)/i.exec(baris);
      if (cd) {
        prefix = cd[1].trim().replace(/[\/\\]+$/, "") || ".";
        break;
      }
    }
    if (!cwdPrefixes.has(prefix)) cwdPrefixes.set(prefix, []);
    cwdPrefixes.get(prefix).push(t.id);
  }
  if (cwdPrefixes.size > 1) {
    const rincian = [...cwdPrefixes].map(([p, ids]) => `"${p}" dipakai ${ids.join(", ")}`).join("; ");
    add("error", "PLAN", "verification antar-task memakai asumsi cwd/prefix direktori yang tidak konsisten: " + rincian + ". Samakan kerja di root proyek atau tulis cd/prefix yang sama supaya tidak ada MODULE_NOT_FOUND.");
  }
  for (const t of tasks) {
    const rusakBeh = masalahBehavior(t);
    if (rusakBeh.length) add("error", t.id, rusakBeh.join(" · "));
    const specBeh = specBehavior(t);
    if (specBeh) {
      if (/localhost:|127\.0\.0\.1:/.test(specBeh.url) && !(specBeh.server && specBeh.server.cmd))
        add("warn", t.id, "behavior.url menunjuk server lokal tapi behavior.server.cmd kosong — kalau servernya mati, pengukuran gagal. Isi server.cmd supaya worker menyalakannya sendiri lalu mematikannya lagi.");
      if (!binBrowser) add("warn", t.id, "prasyarat lingkungan: browser tidak ada; siapkan sebelum verifikasi, bukan hapus behavior atau klaim lulus");
    } else if (t.ui === false && taskUi(t))
      add("warn", t.id, "ditandai ui:false padahal menyentuh " + short((t.files_or_areas || []).join(", ") || t.title, 60) + " — bukti perilaku dilewati atas keputusan manusia, bukan karena terukur hijau");
    const raw = String(t.verification || "").trim();
    if (!raw) {
      add("error", t.id, "verification kosong — tidak ada satu pun yang bisa membuktikan task ini");
      continue;
    }
    const v = raw.replace(AWAL_PERINTAH, "");
    const segs = segmen(v);
    const bukan = bukanPerintah(v);
    if (bukan)
      add("error", t.id, 'verification bukan perintah shell: "' + short(bukan, 80) + '" — gerbang ini lolos kosong, agen tinggal klaim');
    for (const s of segs) {
      const tk = tokenAwal(s);
      if (!tk || BUILTIN.has(tk) || /[\/\\]/.test(tk)) continue;
      if (BERISIKO[tk]) add("warn", t.id, "memakai " + tk + " — " + BERISIKO[tk]);
      else if (/^[a-z][\w-]*$/.test(tk) && !hasBin(tk))
        add("warn", t.id, 'biner "' + tk + '" tidak ada di PATH — prasyarat lingkungan, siapkan sebelum menjalankan verifikasi; bukan penahan Connect/next_task dan bukan izin melewati tes');
    }
    for (const baris of v.split(/[\n\r]+/)) {
      const ekor = baris.split(/;/).pop().trim();
      const tutup = ekor.split(/ \|\| /).pop().trim();
      const cumaSukses = (s) => /^(?:echo|printf|true|:)(?:\s|$)/.test(s);
      const penutup = cumaSukses(ekor) ? ekor : cumaSukses(tutup) && tutup !== ekor ? tutup : "";
      if (penutup)
        add("error", t.id, 'gerbang ini tidak bisa gagal: barisnya ditutup "' + short(penutup, 40) + '" — echo/true selalu mengembalikan 0, jadi perintah di depannya boleh gagal total dan task tetap lulus. Buang penutup itu, atau rangkai pakai `&&`.');
    }
    if (process.platform === "win32") {
      const bocor = kutipSatuBocor(v);
      if (bocor)
        add("error", t.id, "kutip satu tidak melindungi apa pun di cmd.exe: " + short(bocor, 50) + " dipecah jadi perintah lain (| & < > tetap operator). Bungkus argumen itu dengan kutip dua atau buang metakarakternya — di mesin ini perintah tersebut tidak akan pernah hijau.");
    }
    if (/\bsqlite3\b/.test(v) && !/<\s*\/dev\/null/.test(v))
      add("warn", t.id, "memakai sqlite3 tanpa menutup stdin — kalau dia shim Python, perintahnya menunggu selamanya. Tambahkan ` < /dev/null`.");
    for (const s of segs) {
      const db = (s.match(/[\w.@\/-]*\.db\b/i) || [])[0];
      if (db && /pragma|insert|update|delete|create|drop|alter|vacuum/i.test(s) && fs12.existsSync(path13.resolve(cwd, db.replace(/^\.\//, ""))))
        add("warn", t.id, 'menulis ke "' + db + '" yang ada di disk (DB produksi proyek) — salin dulu ke DB sementara, jangan ubah file/PRAGMA milik data live demi gerbang hijau.');
    }
    for (const f of new Set([...v.matchAll(TOKEN_FILE)].map((m) => m[1]))) {
      if (/:\/\//.test(f)) continue;
      const ada = fs12.existsSync(path13.resolve(cwd, f.replace(/^\.\//, "")));
      if (ada) continue;
      if (isDone(st.tasks[t.id] || {})) add("error", t.id, 'sudah ditandai selesai tapi "' + f + '" tidak ada di proyek');
      else add("warn", t.id, '"' + f + '" belum ada — harusnya file ini yang dibuat task-nya');
    }
    if (/localhost:|127\.0\.0\.1:/.test(v))
      add("warn", t.id, "butuh server yang hidup (curl) — nyalakan dulu, jangan ganti pakai bukti setara");
    const ket = desimal([t.title, t.description, t.agent_hint].join(" "));
    const contoh = desimal((t.acceptance_criteria || []).join(" "));
    if (ket.size && contoh.size && [...contoh].every((n) => !ket.has(n)))
      add("warn", t.id, "angka di instruksi (" + [...ket].join(", ") + ") tidak ada yang cocok dengan contoh kriteria (" + [...contoh].join(", ") + ") — putuskan manual, jangan biarkan agen nebak");
    const nyasar = [t.title, t.description, t.agent_hint, (t.acceptance_criteria || []).join(" "), t.verification].join(" ").match(/[\u3400-\u9fff\u3040-\u30ff]/g);
    if (nyasar) add("error", t.id, 'ada aksara Mandarin nyasar di teks task ("' + nyasar.slice(0, 4).join("") + '") — teks ini yang dibaca agen, betulkan sebelum dikerjakan');
  }
  return { temuan, tasks: tasks.length, error: temuan.filter((x) => x.lvl === "error"), warn: temuan.filter((x) => x.lvl === "warn") };
}

// src/worker/mcp/handler.mjs
import { spawnSync as spawnSync10 } from "node:child_process";
function mcpHandle(msg, ctx, opsi) {
  const P = msg.params || {};
  const tua = opsi && opsi.tua || buildLama();
  const txt = (s) => ({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: (tua ? bannerBuildLama() + "\n\n" : "") + s }] } });
  try {
    if (msg.method === "initialize") return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "planforge-worker", version: "1.0" } } };
    if (msg.method === "notifications/initialized") return null;
    if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: MCP_TOOLS } };
    if (msg.method !== "tools/call") return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method tidak didukung: " + msg.method } };
    const t = P.name, a = P.arguments || {};
    if (!ctx.sesi) ctx.sesi = { mulai: (/* @__PURE__ */ new Date()).toISOString(), kerja: 0 };
    const kerja = (n) => {
      ctx.sesi.kerja += n || 1;
      ctx.state.mcpCalls = (ctx.state.mcpCalls || 0) + (n || 1);
    };
    const remSesi = () => {
      const lim = ctx.gates.limits || {};
      if (lim.maxCallsPerRun != null && ctx.sesi.kerja >= Number(lim.maxCallsPerRun))
        return "sesi connector ini sudah menyerahkan/menutup " + ctx.sesi.kerja + " task (batas maxCallsPerRun " + lim.maxCallsPerRun + ")";
      return sisaBudget(ctx);
    };
    if (t === "plan_status") {
      const done = Object.keys(ctx.state.tasks).filter((k) => isDone(ctx.state.tasks[k])).length;
      const fail = Object.keys(ctx.state.tasks).filter((k) => isFail(ctx.state.tasks[k])).length;
      const blok = Object.keys(ctx.state.tasks).filter((k) => isBlocked(ctx.state.tasks[k]));
      const lim = ctx.gates.limits || {};
      return txt("folder proyek: " + ctx.root.replace(/\\/g, "/") + "\ntotal " + ctx.plan.tasks.tasks.length + " · selesai " + done + " · gagal " + fail + " · terkendala " + blok.length + " · task terakhir " + (ctx.state.lastTask || "-") + " · panggilan " + ctx.state.calls + (blok.length ? "\nTERKENDALA: " + blok.join(", ") + " — butuh tindakan manusia (lihat RUN_LOG.md); task ini tidak diserahkan lagi." : "") + "\nsesi connector ini: " + ctx.sesi.kerja + " tool kerja · mulai " + ctx.sesi.mulai + " · biaya tercatat $" + (ctx.state.costUsd || 0) + " (plafon " + (lim.maxCostUsd == null ? "tanpa batas" : "$" + lim.maxCostUsd) + ")" + (ctx.state.fullHalt ? "\n!! gerbang penuh berhenti: " + ctx.state.fullHalt.kenapa : "") + (ctx.planBerubah ? "\n!! ledger ini dibuat untuk rencana lain (sidik jari " + ctx.planBerubah.dari + " → " + ctx.planBerubah.ke + "). Progres bisa tidak cocok dengan plan.json sekarang — Connect ulang supaya ledger lama dicadangkan, atau periksa plan.json sebelum lanjut." : "") + (ctx.state.giliran ? "\ngiliran terbuka: " + ctx.state.giliran.id + " (gerbang penuh " + ctx.state.giliran.from + ".." + ctx.state.giliran.to + ")" + (ctx.state.giliran.gagal ? " · GAGAL: " + ctx.state.giliran.gagal : " · ambil lewat next_task") : "") + "\nbuild worker yang menjawab kamu: " + BUILD_AWAL + " (" + SELF_FILE.replace(/\\/g, "/") + ") · build di disk: " + cetakFile(SELF_FILE));
    }
    if (t === "next_task") {
      const kena = Object.keys(ctx.state.tasks).filter((k) => isBlocked(ctx.state.tasks[k]));
      if (kena.length) return txt("BERHENTI — task terkendala: " + kena.join(", ") + ". Ini BUKAN kegagalan kerja: " + (ctx.state.tasks[kena[0]].note || "syarat task tidak tersedia") + ". Jangan mengarang file/data di luar task. Laporkan ke manusia; sesudah syaratnya dipulihkan, panggil mark_done tetap bisa dipakai.");
      const rem = remSesi();
      if (rem) {
        log(ctx, "next_task DITOLAK: " + rem);
        return txt("BERHENTI — " + rem + ".\nJangan ambil task baru dan jangan mengarang bukti. Laporkan baris ini ke manusia apa adanya: dia yang memutuskan menaikkan limits.maxCallsPerRun / maxCostUsd di .planforge/gates.json, lalu me-restart connector PlanForge.");
      }
      const gl = ctx.state.giliran;
      if (gl && gl.gagal) {
        return txt("BERHENTI — " + gl.id + " (gerbang penuh " + gl.from + ".." + gl.to + ") ditandai gagal: " + gl.gagal + "\nJangan ambil task baru. Laporkan baris ini ke manusia; dia yang memutuskan lewat terminal proyek: `node worker.mjs giliran --ulang` (coba lagi) atau `node worker.mjs giliran --lewati` (dilewati, tercatat di ledger).");
      }
      if (gl) {
        if (!gl.diserahkan) {
          kerja(1);
          gl.diserahkan = (/* @__PURE__ */ new Date()).toISOString();
          const p = potretKotor(ctx.root);
          if (p) gl.kotorAwal = p;
          saveCtx(ctx);
        }
        return txt(kartuGiliran(ctx, gl));
      }
      const n = nextTask(ctx.plan, ctx.state);
      if (n && !n.__blocked) {
        kerja(1);
        const s = ctx.state.tasks[n.id];
        if (s && !s.kotorAwal) {
          const p = potretKotor(ctx.root);
          if (p) {
            s.kotorAwal = p;
            saveCtx(ctx);
          }
        }
      }
      return txt(!n ? "tidak ada task" : n.__blocked ? "mentok di " + n.id + ", menunggu " + (n.needs || []).join(", ") : taskCard(ctx.plan, n) + environmentReadiness(ctx.root).findings.map((x) => "\nSaran lingkungan (bukan error struktur): " + x.msg).join(""));
    }
    if (t === "get_task") {
      const gl = ctx.state.giliran;
      if (gl && a.id === gl.id) return txt(kartuGiliran(ctx, gl));
      const x = ctx.plan.tasks.tasks.find((y) => y.id === a.id);
      return txt(x ? taskCard(ctx.plan, x) : "task " + a.id + " tidak ada");
    }
    if (t === "mark_done" && ctx.state.giliran) {
      const gl = ctx.state.giliran;
      if (a.id !== gl.id) return txt("TOLAK " + a.id + ": " + gl.id + " (gerbang penuh " + gl.from + ".." + gl.to + ") belum ditutup. Ambil lewat next_task dan kerjakan dulu.");
      kerja(1);
      const b = buktiGiliran(ctx, ctx.root, a.verification);
      if (!b.ok) {
        gl.tries = (gl.tries || 0) + 1;
        gl.note = "ditolak worker: " + short(b.kurang.join(" · "), 600);
        saveCtx(ctx);
        log(ctx, gl.id + " mark_done lewat MCP: DITOLAK — " + b.kurang.join(" · "));
        return txt("TOLAK " + gl.id + ": " + b.kurang.join(" · ") + "\nBetulkan dulu, baru panggil mark_done lagi.");
      }
      ctx.state.lastFullMark = gl.to;
      ctx.state.sinceFull = 0;
      delete ctx.state.fullHalt;
      ctx.state.history.push({ at: (/* @__PURE__ */ new Date()).toISOString(), gate: gl.id, from: gl.from, to: gl.to, cek: b.cek, out: short(a.verification, 3e3) });
      const awal = gl.kotorAwal || null;
      delete ctx.state.giliran;
      saveCtx(ctx);
      let kommit = "";
      if (ctx.gates.limits.autoCommit !== false) {
        const g = gitCommit(ctx, ctx.root, { id: gl.id, title: "audit/fix/refactor/performa " + gl.from + ".." + gl.to }, awal);
        const h = String(spawnSync10("git", ["log", "-1", "--format=%h %s"], { cwd: ctx.root, encoding: "utf8" }).stdout || "").trim();
        if (h.includes(gl.id)) kommit = " · kommit " + h;
        if (g && g.ditinggal.length) kommit += " · tidak ikut kommit (bukan kerja giliran ini): " + short(g.ditinggal.join(", "), 200);
      }
      log(ctx, gl.id + " mark_done lewat MCP: DITERIMA · cek ulang " + b.cek.join(","));
      return txt("ok, " + gl.id + " diterima — gerbang keras hijau, verification + perilaku dicek ulang worker: " + (b.cek.join(", ") || "-") + kommit + "\nLanjut: panggil next_task.");
    }
    if (t === "mark_done") {
      kerja(1);
      const s = ctx.state.tasks[a.id] || (ctx.state.tasks[a.id] = {});
      const sudah = isDone(s);
      const task = ctx.plan.tasks.tasks.find((x) => x.id === a.id);
      if (!task) return txt("task " + a.id + " tidak ada di plan — tidak kunyatali apa pun");
      const b = buktiSelesai(ctx, ctx.root, a.id, a.verification);
      const gateVerify = { pass: b.ver.ok, dilewati: !!b.ver.dilewati, hasil: b.ver.hasil, kurang: b.ver.kurang };
      const gateBehavior = {
        pass: b.beh.ok,
        dilewati: !!b.beh.dilewati,
        wajib: !!b.beh.wajib,
        hasil: b.beh.hasil || [],
        kurang: b.beh.kurang || [],
        console: b.beh.console || [],
        requests: b.beh.requests || 0,
        ms: b.beh.ms || 0
      };
      if (!b.ok) {
        s.note = "ditolak worker: " + b.kurang.join(" · ");
        s.gate = { hard: b.hard.map((h) => ({ id: h.id, pass: h.pass, blocking: h.blocking, metrics: h.metrics })), verify: gateVerify, behavior: gateBehavior, at: (/* @__PURE__ */ new Date()).toISOString() };
        saveCtx(ctx);
        log(ctx, a.id + " mark_done lewat MCP: DITOLAK — " + b.kurang.join(" · "));
        return txt("TOLAK " + a.id + ": " + b.kurang.join(" · ") + "\nKerjakan dulu beneran, baru panggil mark_done lagi.");
      }
      s.status = "selesai";
      s.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      s.note = "bukti: " + short(a.verification, 200) + " · gerbang " + b.hard.filter((h) => h.enabled !== false).map((h) => h.id + (h.pass ? "=OK" : "=gagal")).join(",") + " · verifikasi worker: " + short(ringkasVerifikasi(b.ver), 200) + " · " + short(ringkasBehavior(b.beh), 200) + (b.files.length ? " · " + b.files.length + " file berubah" : " · dari kommit " + short(b.head, 60));
      s.gate = { hard: b.hard.map((h) => ({ id: h.id, pass: h.pass, blocking: h.blocking, metrics: h.metrics })), light: [], verify: gateVerify, behavior: gateBehavior, at: (/* @__PURE__ */ new Date()).toISOString() };
      if (!sudah) {
        ctx.state.doneTasks++;
        ctx.state.sinceFull = (ctx.state.sinceFull || 0) + 1;
      }
      const awal = s.kotorAwal || null;
      delete s.kotorAwal;
      ctx.state.consecFails = 0;
      ctx.state.lastTask = a.id;
      const giliranBaru = sudah ? null : giliranJatuh(ctx, task);
      saveCtx(ctx);
      let kommit = "";
      if (ctx.gates.limits.autoCommit !== false) {
        const g = gitCommit(ctx, ctx.root, task, awal);
        const h = spawnSync10("git", ["log", "-1", "--format=%h %s"], { cwd: ctx.root, encoding: "utf8" });
        const txt1 = String(h.stdout || "").trim();
        if (txt1.includes(a.id)) kommit = " · kommit " + txt1;
        else log(ctx, a.id + " tercatat selesai tapi HEAD bukan kommitnya: " + (txt1 || "belum ada kommit"));
        if (g && g.ditinggal.length) kommit += " · tidak ikut kommit (bukan kerja task ini): " + short(g.ditinggal.join(", "), 200);
        if (g && g.bawaan.length) kommit += " · sudah berubah sebelum task dimulai tapi ikut kommit karena diubah lagi: " + short(g.bawaan.join(", "), 200);
      }
      log(ctx, a.id + " mark_done lewat MCP: DITERIMA (" + short(a.verification, 120) + ")");
      return txt("ok, " + a.id + " selesai — gerbang keras DAN perintah verification task ini udah ku jalanin sendiri dan hijau. " + s.note + kommit + (giliranBaru ? "\nBERIKUTNYA: " + giliranBaru.id + " — gerbang penuh (audit, perbaikan, refactor, performa) atas " + giliranBaru.from + ".." + giliranBaru.to + ". Panggil next_task untuk kartunya; task baru baru diserahkan sesudah giliran ini diterima." : '\nLANJUT OTOMATIS: panggil next_task lagi sekarang, kerjakan task berikutnya, lalu mark_done lagi. Satu trigger = SEMUA task, bukan satu task lalu diam. Ulangi tanpa minta manusia melanjutkan tiap task, sampai next_task menjawab BERHENTI (budget habis / terkendala / giliran gagal) atau "tidak ada task" (semua selesai).'));
    }
    if (t === "mark_failed" && ctx.state.giliran && a.id === ctx.state.giliran.id) {
      kerja(1);
      const gl = ctx.state.giliran;
      gl.gagal = short(a.reason, 200);
      ctx.state.fullHalt = { at: (/* @__PURE__ */ new Date()).toISOString(), upto: gl.to, kenapa: gl.id + " gagal: " + gl.gagal };
      saveCtx(ctx);
      log(ctx, gl.id + " ditandai gagal lewat MCP: " + gl.gagal + " — next_task berhenti sampai manusia memutuskan");
      return txt("ok, " + gl.id + " ditandai gagal. BERHENTI: task baru tidak diserahkan sampai manusia menjalankan `node worker.mjs giliran --ulang` atau `--lewati`.");
    }
    if (t === "mark_failed") {
      kerja(1);
      const s = ctx.state.tasks[a.id] || (ctx.state.tasks[a.id] = {});
      s.status = "gagal";
      s.note = short(a.reason, 200);
      saveCtx(ctx);
      return txt("ok, " + a.id + " ditandai gagal");
    }
    if (t === "mark_blocked") {
      kerja(1);
      const task = ctx.plan.tasks.tasks.find((x) => x.id === a.id);
      if (!task) return txt("task " + a.id + " tidak ada di plan — tidak ada yang kucatat");
      const s = ctx.state.tasks[a.id] || (ctx.state.tasks[a.id] = {});
      s.status = "terkendala";
      s.note = short(a.reason || "syarat task tidak tersedia", 250);
      s.blockedAt = (/* @__PURE__ */ new Date()).toISOString();
      saveCtx(ctx);
      log(ctx, a.id + " TERKENDALA lewat MCP: " + s.note + " — bukan gagal, tidak diserahkan lagi");
      return txt("ok, " + a.id + " dicatat TERKENDALA (bukan gagal): " + s.note + "\nBERHENTI. Laporkan ke manusia supaya syaratnya dipulihkan. Jangan mengarang file/data di luar task, dan jangan memanggil mark_failed untuk kondisi ini.");
    }
    if (t === "gate_list") {
      const rows = ctx.gates.reviews.filter((r) => r.enabled).map((r) => r.tier + " · " + r.label);
      return txt("keras (tiap task): " + ctx.gates.hard.filter((h) => h.enabled).map((h) => h.id + (h.blocking ? "*" : "")).join(", ") + "\n" + rows.join("\n") + "\n* = menahan loop kalau gagal\nlewat connector ini, gerbang penuh datang sebagai GILIRAN-n dari next_task tiap " + (ctx.gates.limits.fullEvery || 6) + " task" + (ctx.gates.limits.fullAtMilestoneEnd ? " dan di akhir tiap milestone" : "") + "; kamu yang mengerjakannya, worker yang membuktikannya.");
    }
    if (t === "audit_plan") {
      const a2 = auditPlan(ctx, ctx.root);
      const baris = a2.temuan.slice(0, 25).map((x) => "  " + (x.lvl === "error" ? "!!" : "~ ") + " " + x.id + " — " + x.msg);
      return txt("AUDIT " + a2.tasks + " task · " + a2.error.length + " error · " + a2.warn.length + " warning\n" + (baris.join("\n") || "  tidak ada temuan statis; belum membuktikan runtime/kelulusan") + (a2.temuan.length > 25 ? "\n  ... " + (a2.temuan.length - 25) + " lagi (node worker.mjs audit)" : "") + "\nERROR = struktur/kontrak rusak, perbaiki rencana. WARNING lingkungan = siapkan prasyarat, bukan penahan Connect/next_task; mark_done tetap menjalankan tes asli dan menolak hasil merah.");
    }
    return { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "tool tidak dikenal: " + t } };
  } catch (e) {
    return { jsonrpc: "2.0", id: msg.id, error: { code: -32e3, message: String(e.message || e) } };
  }
}

// src/worker/mcp/stdio.mjs
function mcpMain(argv) {
  const a = parseArgs(argv || process.argv.slice(3));
  const root = resolveRoot(a);
  if (!root) {
    console.error("tidak ada .planforge/plan.json — taruh worker.mjs di folder proyek atau jalankan dengan --dir <path>");
    return 1;
  }
  let ctx;
  try {
    ctx = loadCtx(root);
  } catch (e) {
    console.error(String(e.message || e));
    return 1;
  }
  if (a["no-gates"]) {
    ctx.gates.hard.forEach((h) => h.enabled = false);
    ctx.gates.reviews.forEach((r) => r.enabled = false);
    ctx.lewatiVerifikasi = true;
  }
  if (a["max-cost"] != null && a["max-cost"] !== true) ctx.gates.limits.maxCostUsd = Number(a["max-cost"]);
  if (a["max-calls-per-run"]) ctx.gates.limits.maxCallsPerRun = Number(a["max-calls-per-run"]);
  ctx.sesi = { mulai: (/* @__PURE__ */ new Date()).toISOString(), kerja: 0 };
  mulaiSesi(ctx);
  console.log = (...x) => process.stderr.write(x.join(" ") + "\n");
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        continue;
      }
      const seg = syncCtx(ctx);
      if (seg.berubah) {
        const sesi = ctx.sesi, lewat = ctx.lewatiVerifikasi;
        ctx = seg.ctx;
        ctx.sesi = sesi;
        ctx.lewatiVerifikasi = lewat;
        console.error("planforge: plan.json/gates.json/state.json berubah di disk -> dibaca ulang");
      }
      const out = mcpHandle(msg, ctx, { tua: buildLama() });
      if (out) process.stdout.write(JSON.stringify(out) + "\n");
    }
  });
  return 0;
}

// src/worker/connectors/process.mjs
import { spawnSync as spawnSync11 } from "node:child_process";
import path14 from "node:path";
import fs13 from "node:fs";
var EPOCH = 0;
function jamProsesWindows() {
  const skrip = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CreationDate } | ForEach-Object { "$($_.ProcessId)|$([Math]::Round((New-TimeSpan -Start ([DateTime]::new(1970,1,1,0,0,0,[DateTimeKind]::Utc)) -End $_.CreationDate.ToUniversalTime()).TotalMilliseconds))|$($_.CommandLine)" }`;
  const r = spawnSync11("powershell", ["-NoProfile", "-Command", skrip], { encoding: "utf8", timeout: 2e4 });
  return String(r.stdout || "").split(/\r?\n/).filter((l) => (l.match(/\|/g) || []).length >= 2).map((l) => {
    const bagi = l.split("|"), pid = Number(bagi[0]), mulai = Number(bagi[1]);
    return { pid, mulai, cmd: bagi.slice(2).join("|") };
  }).filter((x) => Number.isFinite(x.pid) && x.mulai > EPOCH && Number.isFinite(x.mulai));
}
function jamProsesPosix() {
  const r = spawnSync11("ps", ["-eo", "pid=,etime=,args="], { encoding: "utf8", timeout: 2e4 });
  const detik = (e) => {
    const potong = e.split(/[-:]/).map(Number);
    if (!potong.length || potong.some(isNaN)) return 0;
    const s = potong.pop(), m = potong.pop(), h = potong.pop(), d = potong.pop();
    return (d ? d * 86400 : 0) + (h ? h * 3600 : 0) + (m ? m * 60 : 0) + (s || 0);
  };
  return String(r.stdout || "").split(/\r?\n/).map((l) => l.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean).map((m) => ({ pid: Number(m[1]), cmd: m[3], mulai: Date.now() - detik(m[2]) * 1e3 })).filter((x) => x.mulai > 0);
}
var prosesNode = () => process.platform === "win32" ? jamProsesWindows() : jamProsesPosix();
function doctorMcp(root, daftar) {
  const file = path14.join(root, "worker.mjs");
  let wtulis = 0;
  try {
    wtulis = fs13.statSync(file).mtimeMs;
  } catch (_) {
  }
  const plan = path14.join(root, DIR, F_PLAN);
  let ptulis = 0;
  try {
    ptulis = fs13.statSync(plan).mtimeMs;
  } catch (_) {
  }
  const absolute = (s) => /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(s) || path14.posix.isAbsolute(s);
  const normal = (s) => /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(s) ? path14.win32.normalize(s).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() : path14.resolve(s);
  const proses = (daftar === void 0 ? prosesNode() : daftar).filter((p) => /worker\.mjs\b/.test(p.cmd || "") && /\bmcp\b/.test(p.cmd || ""));
  return {
    worker: file,
    wtulis,
    planTulis: ptulis,
    proses: proses.map((p) => {
      const tokens = Array.from(p.cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g), (m) => m[1] ?? m[2] ?? m[3]);
      const args = parseArgs(tokens.slice(tokens.indexOf("mcp") + 1));
      const want = typeof args.dir === "string" && absolute(args.dir) ? args.dir : null;
      const proyekRoot = want ? findRoot(want) || want : null;
      const proyek = !proyekRoot ? "tidak diketahui" : normal(proyekRoot) === normal(root) ? "sesuai" : "lain";
      const worker = tokens.find((s) => /(?:^|[\\/])worker\.mjs$/.test(s));
      let prosesTulis = 0;
      if (worker && absolute(worker)) {
        try {
          prosesTulis = fs13.statSync(worker).mtimeMs;
        } catch (_) {
        }
      }
      return {
        pid: p.pid,
        cmd: p.cmd,
        root: proyekRoot,
        proyek,
        umurMenit: Math.max(0, Math.round((Date.now() - p.mulai) / 6e4)),
        kodeLama: proyek === "sesuai" && prosesTulis > p.mulai,
        kartuLama: proyek === "sesuai" && ptulis > p.mulai
      };
    })
  };
}

// src/worker/environment/interpreter.mjs
import { spawnSync as spawnSync12 } from "node:child_process";
import fs14 from "node:fs";
import path15 from "node:path";
function kandidatInterpreter(cwd) {
  const cariPerintah = process.platform === "win32" ? "where" : "which";
  const keluar = [];
  for (const nama of ["python", "python3"]) {
    const r = spawnSync12(cariPerintah, process.platform === "win32" ? [nama] : ["-a", nama], { cwd, encoding: "utf8" });
    for (const baris of String(r.stdout || "").split(/\r?\n/)) {
      const p = baris.trim();
      if (p && !keluar.includes(p)) keluar.push(p);
    }
  }
  return keluar;
}
function jalurAman(p) {
  const mentah = String(p);
  if (process.platform !== "win32" || !/\s/.test(mentah)) return mentah;
  const r = spawnSync12('for %A in ("' + mentah + '") do @echo %~sA', { shell: true, encoding: "utf8" });
  const pendek = String(r.stdout || "").trim();
  return pendek && !/\s/.test(pendek) && fs14.existsSync(pendek) ? pendek : mentah;
}
function absolutkanScript(pkg, abs) {
  const baru = JSON.parse(JSON.stringify(pkg));
  const rapi = process.platform === "win32" ? jalurAman(abs) : String(abs).replace(/\\/g, "/");
  const token = /\s/.test(rapi) ? '"' + rapi + '"' : rapi;
  for (const k of Object.keys(baru.scripts || {})) {
    baru.scripts[k] = String(baru.scripts[k]).split(/(&&|\|\||;|\|)/).map((bagian) => {
      const mulai = bagian.replace(/^\s+/, "");
      const m = /^(python3?|pytest)\b([\s\S]*)$/.exec(mulai);
      if (!m) return bagian;
      const sisa = m[2] || "";
      const lead = bagian.slice(0, bagian.length - mulai.length);
      return m[1] === "pytest" ? lead + token + " -m pytest" + sisa : lead + token + sisa;
    }).join("");
  }
  return baru;
}
function pinInterpreter(ctx, cwd, kandidat) {
  const file = path15.join(cwd, "package.json");
  let mentah = "";
  try {
    mentah = fs14.readFileSync(file, "utf8");
  } catch (_) {
    mentah = "";
  }
  const asli = readJson(file, null);
  if (!asli || !asli.scripts) return { ok: false, kenapa: "tidak ada package.json dengan blok scripts di " + cwd + " — pin cuma untuk proyek yang gerbangnya lewat npm script" };
  const daftar = kandidat === void 0 ? kandidatInterpreter(cwd) : kandidat;
  if (!daftar.length) return { ok: false, kenapa: "tidak ada python/python3 yang ketemu di PATH mesin ini" };
  const crlf = /\r\n/.test(mentah);
  const akhiran = (mentah.match(/(?:\r?\n)+$/) || [""])[0];
  const indent = (mentah.match(/^\{\s*(?:\r?\n)([ \t]+)/) || [, "  "])[1];
  const tulis = (obj) => {
    let teks = JSON.stringify(obj, null, indent) + akhiran;
    if (crlf) teks = teks.replace(/\r?\n/g, "\r\n");
    fs14.writeFileSync(file, teks);
  };
  const coba = [];
  for (const abs of daftar) {
    const usul = absolutkanScript(asli, abs);
    if (JSON.stringify(usul) === JSON.stringify(asli)) {
      continue;
    }
    tulis(usul);
    const g = runHardGates(ctx, cwd, { hanyaBlocking: true });
    const merah = g.filter((x) => !x.pass);
    coba.push({ abs, hijau: !merah.length, merah: merah.map((x) => x.id) });
    if (!merah.length) {
      ctx.gates = loadCtx(ctx.root).gates;
      return { ok: true, abs, coba, gate: g };
    }
  }
  fs14.writeFileSync(file, mentah);
  return { ok: false, coba, kenapa: "tidak ada interpreter yang bikin gerbang hijau — package.json kunembalikan seperti semula" };
}

// src/worker/cli/environment-commands.mjs
function commandSetupEnv(cwd) {
  const r = setupEnv(cwd);
  console.log(r.message);
  return r.ok ? 0 : 1;
}
function commandEnvironment(cwd) {
  const r = environmentReadiness(cwd, { probe: true });
  console.log("== prasyarat lingkungan (baca saja, bukan gate kelulusan) ==");
  for (const x of r.findings) console.log("~ " + x.code + ": " + x.msg);
  console.log(r.checked ? "Pemeriksaan selesai; tidak menjalankan tes, install, migrasi, atau mengubah ledger." : "package.json belum ada; belum ada lingkungan Node yang dapat diperiksa.");
  return 0;
}
function commandDoctor(ctx, root, cwd, args) {
  console.log("== saran persiapan lingkungan (tidak menahan Connect; tes tetap wajib) ==");
  for (const x of environmentReadiness(cwd, { probe: true }).findings) console.log("  ~ " + x.msg);
  let gateMerah = [];
  if (!args["no-gates"]) {
    console.log("== gerbang keras dijalankan dari lingkungan worker ini (tanpa panggilan agen) ==");
    const semua = !!args["semua-gerbang"];
    const g = runHardGates(ctx, cwd, { hanyaBlocking: !semua });
    if (!g.length) console.log("  (tidak ada gerbang keras aktif — isi dulu lewat tab Runner)");
    for (const x of g) {
      if (x.blocking && !x.pass) gateMerah.push(x.id);
      console.log("  " + (x.pass ? "ok " : "!! ") + x.id + " (" + Math.round(x.ms / 1e3) + "s)" + (x.pass ? "" : " -> " + short(String(x.out).split(/\r?\n/).filter(Boolean).slice(-2).join(" / "), 160)));
    }
    const dilewati = (ctx.gates.hard || []).filter((x) => x && x.enabled && x.cmd && x.blocking === false);
    if (!semua && dilewati.length) console.log("  (" + dilewati.length + " gerbang lunak tidak dijalankan: " + dilewati.map((x) => x.id).join(", ") + " — yang begitu perlu server/browser hidup. Pakai --semua-gerbang kalau memang mau dicoba.)");
    if (gateMerah.length) console.log("  merah di sini = tiap task bakal TOLAK semalam, apa pun yang agen kerjakan. Perbaiki lingkungannya, bukan agennya.");
  }
  console.log("\n== bukti perilaku (browser yang mengukur, bukan klaim agen) ==");
  const binBeh = cariBrowser();
  const daftarTask = taskList(ctx.plan);
  const perluBeh = daftarTask.filter((t) => specBehavior(t));
  const uiTanpaBeh = daftarTask.filter((t) => !specBehavior(t) && masalahBehavior(t).length);
  console.log("  " + (binBeh ? "ok  browser: " + binBeh : "!! browser tidak ditemukan — pasang Edge/Chrome atau set PLANFORGE_BROWSER"));
  console.log("  " + (typeof WebSocket === "undefined" ? "!! Node " + process.version + " tanpa WebSocket global (butuh Node 22+)" : "ok  Node " + process.version + " punya WebSocket + fetch"));
  console.log("  " + perluBeh.length + " task punya behavior · " + uiTanpaBeh.length + " task menyentuh UI tapi belum punya behavior");
  if (uiTanpaBeh.length) console.log("  !! " + uiTanpaBeh.map((t) => t.id).join(", ") + " akan DITOLAK sampai behavior-nya diisi — itu pekerjaan manusia/audit, bukan agen.");
  if (!binBeh && perluBeh.length) gateMerah.push("browser");
  const d = doctorMcp(root);
  console.log("\nworker.mjs di disk ditulis: " + new Date(d.wtulis).toLocaleString() + " · rencana ditulis: " + (d.planTulis ? new Date(d.planTulis).toLocaleString() : "-"));
  if (!d.proses.length) {
    console.log("INFO: tidak ada proses `worker.mjs mcp` yang terbaca. Ini normal untuk runner CLI standalone di luar sesi MCP aktif; koneksi MCP belum terverifikasi.");
    return gateMerah.length ? 1 : 0;
  }
  const sesuai = d.proses.filter((p) => p.proyek === "sesuai");
  let lama = 0;
  for (const p of d.proses) {
    if (p.proyek !== "sesuai") {
      console.log("?? pid " + p.pid + (p.proyek === "lain" ? " — PROYEK LAIN: " + p.root : " — PROYEK BELUM DIKETAHUI: --dir absolut tidak terbaca"));
      console.log("     " + p.cmd);
      continue;
    }
    lama += p.kodeLama || p.kartuLama ? 1 : 0;
    console.log((p.kodeLama || p.kartuLama ? "!! " : "ok ") + "pid " + p.pid + " · proyek sesuai · umur " + p.umurMenit + " menit" + (p.kodeLama ? " — KODE LAMA: prosesnya mulai sebelum worker.mjs ditulis ulang" : "") + (p.kartuLama ? " — KARTU LAMA: prosesnya mulai sebelum plan.json disunting" : ""));
    console.log("     " + p.cmd);
  }
  if (!sesuai.length) {
    console.log("BELUM TERVERIFIKASI: tidak ada proses connector yang terbukti melayani " + root.replace(/\\/g, "/") + ".");
    console.log("Periksa target konfigurasi MCP di aplikasi. Restart saja tidak mengubah target proyek yang salah.");
    return 1;
  }
  if (lama) {
    console.log("\n" + lama + " dari " + sesuai.length + " proses connector proyek ini pakai aturan lama.");
    console.log("Muat ulang connector proyek ini di aplikasi (atau jalankan `node worker.mjs refresh`), lalu periksa plan_status sebelum mengambil task.");
    return 1;
  }
  console.log("Proses proyek ini terdeteksi. BELUM membuktikan chat memakai connector itu: cocokkan folder proyek di jawaban plan_status sebelum next_task.");
  return gateMerah.length ? 1 : 0;
}
function commandPin(ctx, cwd) {
  console.log("mencoba interpreter yang ada di PATH worker, satu per satu, sampai gerbang keras hijau:");
  const p = pinInterpreter(ctx, cwd);
  for (const c of p.coba || []) console.log("  " + (c.hijau ? "HIJAU" : "merah " + c.merah.join(",")) + " :: " + c.abs);
  if (p.ok) {
    console.log("\npackage.json dipin ke: " + p.abs);
    console.log("Sekarang gerbang tidak peduli lagi shell mana yang manggil worker. Coba: node worker.mjs doctor");
    return 0;
  }
  console.log("\n" + (p.kenapa || "gagal"));
  return 1;
}

// src/worker/cli/project-commands.mjs
function commandStatus(ctx, cwd) {
  for (const t of ctx.plan.tasks.tasks) {
    const s = ctx.state.tasks[t.id];
    console.log((isDone(s) ? "x " : isFail(s) ? "! " : "  ") + t.id + " [" + (s.status || "belum mulai") + "] " + t.title + " · " + (t.feature || "") + (s.note ? " · " + short(s.note, 60) : ""));
  }
  console.log("\nselesai " + ctx.state.doneTasks + " · call " + ctx.state.calls + "/" + ctx.gates.limits.maxCalls + " · agen " + ctx.gates.agent.name + " · " + cwd + (ctx.state.costUsd ? " · biaya $" + ctx.state.costUsd : "") + " · plafon biaya " + (ctx.gates.limits.maxCostUsd == null ? "tanpa batas" : "$" + ctx.gates.limits.maxCostUsd));
  if (ctx.state.fullHalt) console.log("!! gerbang penuh berhenti: " + ctx.state.fullHalt.kenapa);
  const b = budgetRencana(ctx), L = ctx.gates.limits;
  console.log("task tersisa " + b.task + " · butuh ≈ " + b.total + " panggilan · maxCalls " + L.maxCalls + " muat ±" + taskMuat(L.maxCalls, ctx.gates, b.milestoneSisa) + " task · maxCallsPerRun " + (L.maxCallsPerRun == null ? "tanpa batas" : L.maxCallsPerRun + " muat ±" + taskMuat(L.maxCallsPerRun, ctx.gates, b.milestoneSisa) + " task") + (b.total > 0 && (L.maxCalls != null && L.maxCalls < b.total || L.maxCallsPerRun != null && L.maxCallsPerRun < b.total) ? " · belum cukup: node worker.mjs run --auto-budget" : ""));
  return 0;
}
function commandBuild() {
  console.log("worker.mjs terbaru: " + cetakFile(SELF_FILE) + " · " + SELF_FILE.replace(/\\/g, "/"));
  console.log("bandingkan dengan baris `build worker yang menjawab kamu` di jawaban tool MCP agen.");
  console.log("kalau beda: restart connector PlanForge, atau pakai `node worker.mjs verify <T-xxx>` yang selalu pakai kode terbaru.");
  return 0;
}
function commandGiliran(ctx, args) {
  const g = ctx.state.giliran;
  if (!g) {
    console.log("tidak ada giliran terbuka · gerbang penuh terakhir sampai " + (ctx.state.lastFullMark || "-") + " · " + (ctx.state.sinceFull || 0) + " task sejak itu");
    return 0;
  }
  if (args.ulang) {
    delete g.gagal;
    delete g.diserahkan;
    delete ctx.state.fullHalt;
    saveCtx(ctx);
    log(ctx, g.id + " dibuka ulang oleh manusia — next_task akan menyerahkannya lagi");
    console.log(g.id + " dibuka ulang. Minta agen memanggil next_task.");
    return 0;
  }
  if (args.lewati) {
    const dilewatiSampai = g.to;
    ctx.state.history.push({ at: (/* @__PURE__ */ new Date()).toISOString(), gate: g.id, from: g.from, to: g.to, out: "DILEWATI manusia" + (g.gagal ? " sesudah gagal: " + g.gagal : "") });
    delete ctx.state.giliran;
    delete ctx.state.fullHalt;
    ctx.state.sinceFull = 0;
    ctx.state.lastFullMark = dilewatiSampai;
    saveCtx(ctx);
    log(ctx, g.id + " DILEWATI manusia — audit atas " + g.from + ".." + dilewatiSampai + " dilewati manusia (tercatat di history); giliran berikutnya dimulai setelah " + dilewatiSampai);
    console.log(g.id + " dilewati dan dicatat di ledger. Task berikutnya bisa diambil.");
    return 0;
  }
  console.log(g.id + " · gerbang penuh " + g.from + ".." + g.to + " · " + (g.gagal ? "GAGAL: " + g.gagal : g.diserahkan ? "sedang dikerjakan agen" : "menunggu next_task") + (g.note ? "\n  catatan terakhir: " + g.note : "") + "\n  --ulang = coba lagi · --lewati = lewati (tercatat)");
  return 0;
}

// src/worker/connectors/refresh.mjs
import { spawnSync as spawnSync13 } from "node:child_process";
function killPid(pid) {
  if (process.platform === "win32") {
    const r = spawnSync13("taskkill", ["/pid", String(pid), "/T", "/F"], { encoding: "utf8", timeout: 1e4 });
    return r.status === 0;
  }
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch (e) {
    return false;
  }
}
var tidurSync = (ms) => {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) {
  }
};
function refreshConnector(root, opts) {
  opts = opts || {};
  const scan = opts.scan || (() => doctorMcp(root));
  const kill = opts.kill || killPid;
  const tidur = opts.tidur || tidurSync;
  const tunggu = opts.tunggu != null ? Number(opts.tunggu) : 4e3;
  const proyek = root.replace(/\\/g, "/");
  const sesuai = (scan().proses || []).filter((p) => p.proyek === "sesuai");
  if (!sesuai.length) return { hasil: "tidak-ada", stale: [], dibunuh: [], fresh: [], pesan: "BELUM TERVERIFIKASI: tidak ada connector `worker.mjs mcp` yang terbukti melayani " + proyek + ". Connect dulu / buka app lu, lalu cek `node worker.mjs doctor`." };
  const stale = sesuai.filter((p) => p.kodeLama || p.kartuLama);
  if (!stale.length) return { hasil: "udah-baru", stale: [], dibunuh: [], fresh: sesuai.map((p) => p.pid), pesan: "Connector proyek ini sudah pakai kode baru (" + sesuai.length + " proses, tidak ada KODE LAMA/KARTU LAMA). Nggak perlu refresh. Langsung kirim trigger." };
  if (opts.dryRun) return { hasil: "dry-run", stale: stale.map((p) => p.pid), dibunuh: [], fresh: [], pesan: "DRY-RUN: connector basi yang AKAN dimatikan: " + stale.map((p) => "pid " + p.pid + (p.kodeLama ? " (KODE LAMA)" : "") + (p.kartuLama ? " (KARTU LAMA)" : "")).join(", ") + ". Jalankan `node worker.mjs refresh` tanpa --dry-run untuk eksekusi. Matikan hanya saat agen lagi diam, bukan tengah task." };
  const dibunuh = stale.map((p) => ({ pid: p.pid, ok: kill(p.pid) }));
  if (tunggu > 0) tidur(tunggu);
  const sesuai2 = (scan().proses || []).filter((p) => p.proyek === "sesuai");
  const fresh = sesuai2.filter((p) => !p.kodeLama && !p.kartuLama);
  const masihBasi = sesuai2.filter((p) => p.kodeLama || p.kartuLama);
  const matiOk = dibunuh.filter((x) => x.ok).map((x) => x.pid);
  if (fresh.length) {
    const ekstra = masihBasi.length ? " Peringatan: masih ada connector basi (" + masihBasi.map((p) => "pid " + p.pid).join(", ") + ") yang gagal dibunuh — pastikan app lu memakai yang baru, atau reconnect manual." : "";
    return { hasil: "fresh", stale: stale.map((p) => p.pid), dibunuh, fresh: fresh.map((p) => p.pid), pesan: "OK — connector proyek ini lahir lagi pakai kode baru (" + fresh.map((p) => "pid " + p.pid).join(", ") + "). Langsung kirim trigger; pastikan plan_status menyebut folder " + proyek + "." + ekstra };
  }
  if (masihBasi.length) return { hasil: "gagal-bunuh", stale: stale.map((p) => p.pid), dibunuh, fresh: [], pesan: "Connector basi masih hidup (" + masihBasi.map((p) => "pid " + p.pid).join(", ") + ") — gagal dimatikan (akses ditolak?). Reconnect manual di app lu: opencode Desktop `opencode service restart`; app lain tombol MCP Reload/reconnect atau tutup-buka app sepenuhnya. Lalu cek `node worker.mjs doctor`." };
  return { hasil: "mati", stale: stale.map((p) => p.pid), dibunuh, fresh: [], pesan: "Connector basi sudah dimatikan (" + (matiOk.length ? matiOk.map((p) => "pid " + p).join(", ") : "tidak ada") + "), tapi app lu belum menghidupkan lagi. Dua kemungkinan:\n  (a) app respawn waktu agen memanggil lagi -> kirim trigger baru, lalu cek `node worker.mjs doctor`.\n  (b) app tidak respawn -> reconnect manual di app lu. opencode Desktop: `opencode service restart`. App lain: tombol MCP Reload/reconnect, atau tutup-buka app sepenuhnya.\nJANGAN ambil task sebelum `node worker.mjs doctor` bilang ok (tidak ada KODE LAMA)." };
}

// src/worker/connectors/config.mjs
import path16 from "node:path";
import fs15 from "node:fs";
function mcpEntry(root, shape) {
  const workerPath = path16.join(root, "worker.mjs").replace(/\\/g, "/");
  const args = [workerPath, "mcp", "--dir", root.replace(/\\/g, "/")];
  if (shape === "servers") return { type: "stdio", command: "node", args, cwd: "${workspaceFolder}" };
  if (shape === "mcp") return { type: "local", command: ["node"].concat(args), environment: {}, enabled: true };
  return { command: "node", args, env: {}, disabled: false, timeout: 600 };
}
function mcpServerName(projectDir) {
  const dir = String(projectDir || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!dir) return "planforge";
  const normal = /^(?:[a-z]:\/|\/\/)/i.test(dir) ? dir.toLowerCase() : dir;
  const slug = normal.split("/").pop().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "proyek";
  let hash = 2166136261;
  for (let i = 0; i < normal.length; i++) hash = Math.imul(hash ^ normal.charCodeAt(i), 16777619);
  return "planforge-" + slug + "-" + (hash >>> 0).toString(16).padStart(8, "0");
}
function mcpSnippet(root, key) {
  const a = AGENT_ADAPTERS[key] || AGENT_ADAPTERS.generic;
  const entry = { [mcpServerName(root)]: mcpEntry(root, a.shape) };
  if (a.shape === "servers") return JSON.stringify({ servers: entry, inputs: [] }, null, 2);
  if (a.shape === "mcp") return JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { servers: entry } }, null, 2);
  return JSON.stringify({ mcpServers: entry }, null, 2);
}
function mcpUniversal(root) {
  const workerPath = path16.join(root, "worker.mjs").replace(/\\/g, "/");
  return {
    nama: mcpServerName(root),
    perintah: "node " + workerPath + " mcp --dir " + root.replace(/\\/g, "/"),
    blok: { mcpServers: mcpSnippet(root, "generic"), servers: mcpSnippet(root, "vscode"), mcp: mcpSnippet(root, "opencode") }
  };
}
var rulesText = (root) => [
  "# PlanForge — aturan buat AI agent di proyek ini",
  "",
  "Task list: `.planforge/plan.json`. Progress: `.planforge/state.json`. Gerbang kualitas: `.planforge/gates.json`.",
  "Connector: `" + mcpServerName(root) + "`. Sebelum mengambil task, panggil `plan_status` melalui connector ini. Folder proyek yang dilaporkan WAJIB sama dengan " + root.replace(/\\/g, "/") + ". Kalau berbeda atau tidak jelas: STOP. Jangan panggil next_task, mark_done, atau mark_failed pada proyek lain.",
  "Alur wajib per task:",
  "1. Panggil tool MCP `audit_plan` dulu — task yang berstatus error di sana gerbangnya tidak bisa dibuktikan: laporkan, jangan dikerjakan.",
  "1b. Kalau kartu task butuh file/data yang tidak ada dan membuatnya di luar cakupan task, panggil `mark_blocked` dengan id + alasan. Itu BUKAN `mark_failed`. Jangan mengarang proyek dasar, jangan menyunting plan.json, dan jangan menukar bukti supaya terlihat lolos.",
  "2. Panggil tool MCP `next_task` — dapat id, judul, acceptance criteria dan cara verifikasinya.",
  "3. Kerjakan HANYA task itu. Jangan nambah fitur di luar task. Dilarang mengarang baris data (mis. isi tabel DB) cuma supaya endpoint kelihatan berisi — pakai fixture CSV atau DB sementara.",
  "4. Jalanin gerbangnya beneran (`npm run build`, `npm test`, `npm run lint`) DAN perintah `verification` yang tertulis di kartu task. Semua harus hijau. Worker menjalankan ulang keduanya sendiri — exit code yang masuk ledger, bukan ceritamu.",
  "5. Lolos -> panggil `mark_done` dengan id + verification: PERINTAH ASLI YANG KAMU JALANKAN DAN OUTPUTNYA. Bukan rencana. Worker menjalankan gerbangnya sendiri, menolak kalau bohong, dan mengkommit atas nama task — kamu tidak perlu kommit lagi.",
  "6. Nggak lolos -> panggil `mark_failed` beserta alasannya. Menandai selesai tanpa bukti dianggap kegagalan.",
  '7. SEBELUM task pertama, jalankan `node worker.mjs doctor` di terminal proyek. Kalau keluar `!! pid ... KODE LAMA`: connector masih jalan dari aturan lama (balasan mark_done-nya tidak akan pernah menyebut "kommit <sha>"). STOP, laporkan baris itu, jangan ambil task. Banner `!! BUILD LAMA` di jawaban tool cuma bisa muncul kalau prosesnya sudah kode baru — jangan mengandalkaninya.',
  "8. Gerbang merah karena interpreter (`python` = lotere: shell yang satu punya fastapi/pytest, shell yang lain tidak)? Jalankan `node worker.mjs pin`. Dia menulis path interpreter absolut ke npm script sampai gerbang blocking hijau, dan mengembalikan package.json kalau semuanya merah. Jangan mengakalinya dengan menambah PATH atau mengganti isi gerbang.",
  '9. `verification` yang berupa kalimat ("buka browser, klik tombol, lihat tampilannya") TIDAK bisa dijalankan worker, jadi task itu tidak akan pernah lolos. Laporkan ke manusia supaya ditulis ulang sebagai perintah — jangan dikerjakan sambil mengarang bukti.',
  "10. Budget: `limits.maxCostUsd` (bawaan 0 = agen berbayar langsung dihentikan), `maxCallsPerRun`, `maxCalls`. Kalau `next_task` menjawab BERHENTI karena budget, jangan ambil task lagi dan jangan mengakalinya — laporkan baris itu ke manusia, dia yang memutuskan menaikkan batasnya.",
  "11. Kalau `next_task` menyerahkan `GILIRAN-n` (gerbang penuh: audit, perbaikan, refactor, performa), kerjakan itu dulu tanpa menambah fitur, lalu `mark_done` dengan id `GILIRAN-n` dan hasil tiap langkah (`audit: ...`, `fixbug: ...`, dst). Worker menjalankan ulang tes + browser task yang dicakup; task baru baru keluar sesudah giliran diterima.",
  '12. LOOP OTOMATIS: satu trigger dari manusia = kerjakan SEMUA task, bukan satu task lalu diam. Sesudah `mark_done` diterima, panggil `next_task` lagi dan lanjut ke task berikutnya tanpa minta izin ulang. Berhenti HANYA kalau `next_task` menjawab BERHENTI (budget habis / terkendala / giliran gagal) atau "tidak ada task" (semua selesai), atau kamu sendiri memanggil `mark_blocked`. Jangan menyunting state.json/gates.json untuk mengakali berhenti.',
  "",
  "Alternatif tanpa kamu pencet-pencet: `node worker.mjs run --max-calls 120` di folder ini.",
  "Folder proyek: " + root.replace(/\\/g, "/")
].join("\n");
function writeFileChecked(root, rel, text) {
  const p = path16.join(root, rel);
  fs15.mkdirSync(path16.dirname(p), { recursive: true });
  if (fs15.existsSync(p)) {
    const lama = fs15.readFileSync(p, "utf8");
    if (rel.endsWith(".json")) {
      let j;
      try {
        j = JSON.parse(lama);
      } catch (e) {
        return { file: rel, tulis: false, kenapa: "file-nya bukan JSON yang kebaca — biar aman, tidak kutulis (--force kalau mau timpa)" };
      }
      if (j.mcp && j.mcp.servers) {
        j.mcp.servers = Object.assign({}, j.mcp.servers, { [mcpServerName(root)]: mcpEntry(root, "mcp") });
        fs15.writeFileSync(p, JSON.stringify(j, null, 2));
        return { file: rel, tulis: true, kenapa: "ditempel ke dalam mcp.servers yang sudah ada" };
      }
      const key = j.mcpServers ? "mcpServers" : j.servers ? "servers" : null;
      if (!key) return { file: rel, tulis: false, kenapa: "tidak ada blok mcpServers/servers/mcp.servers yang kukenali" };
      j[key] = Object.assign({}, j[key], { [mcpServerName(root)]: mcpEntry(root, key === "servers" ? "servers" : "mcpServers") });
      fs15.writeFileSync(p, JSON.stringify(j, null, 2));
      return { file: rel, tulis: true, kenapa: "ditempel ke dalam " + key + " yang sudah ada" };
    }
    if (/PlanForge/.test(lama)) return { file: rel, tulis: false, kenapa: "sudah menyebut PlanForge, tidak kutumpuk" };
    fs15.appendFileSync(p, "\n\n" + text);
    return { file: rel, tulis: true, kenapa: "ditambah di akhir file yang sudah ada" };
  }
  fs15.writeFileSync(p, text);
  return { file: rel, tulis: true, kenapa: "file baru" };
}
function connectAgent(root, key) {
  const a = AGENT_ADAPTERS[key] || AGENT_ADAPTERS.generic;
  const hasil = [];
  if (a.file) hasil.push(Object.assign({ peran: "konfigurasi MCP" }, writeFileChecked(root, a.file, mcpSnippet(root, key))));
  hasil.push(Object.assign({ peran: "instruksi buat agent" }, writeFileChecked(root, a.rules, rulesText(root))));
  return { label: a.label, hint: a.hint, hasil };
}

// src/worker/cli/connect-commands.mjs
function commandRefresh(root, ctx, args) {
  const tunggu = args.tunggu != null && args.tunggu !== true ? Number(args.tunggu) : void 0;
  const r = refreshConnector(root, { dryRun: ctx.dryRun, tunggu });
  console.log(r.pesan);
  return r.hasil === "fresh" || r.hasil === "udah-baru" || r.hasil === "dry-run" ? 0 : 1;
}
function commandConnect(root, args) {
  const daftar = () => {
    console.log("agen yang bisa dipasang (node worker.mjs connect <nama>):");
    for (const k of Object.keys(AGENT_ADAPTERS)) console.log("  " + k.padEnd(10) + AGENT_ADAPTERS[k].label + (AGENT_ADAPTERS[k].file ? "  -> " + AGENT_ADAPTERS[k].file : "  -> cuma lewat UI-nya"));
  };
  const key = args._[1];
  if (args.list || !key) {
    daftar();
    if (!key && !args.list) console.log("pakai: node worker.mjs connect <agen>   |   connect --list");
    return key || args.list ? 0 : 1;
  }
  if (!AGENT_ADAPTERS[key]) {
    console.error("agen '" + key + "' tidak ada — pakai salah satu: " + Object.keys(AGENT_ADAPTERS).join(", "));
    return 1;
  }
  const c = connectAgent(root, key);
  console.log("== " + c.label + " ==");
  for (const h of c.hasil) console.log((h.tulis ? "  ditulis " : "  dibiarkan ") + h.file + " (" + h.kenapa + ")");
  console.log("\nlangkahmu: " + c.hint.replace("<nama-server>", mcpServerName(root)));
  if (AGENT_ADAPTERS[key].globalPath) {
    console.log("\nRegistrasi global SEKALI (aturan " + c.label + ", bukan PlanForge):");
    console.log("  1. Buka file global: " + AGENT_ADAPTERS[key].globalPath);
    console.log('  2. Tempel blok ini ke dalam "mcpServers" — server lain yang sudah ada jangan dihapus:');
    console.log(mcpSnippet(root, key).split("\n").map((s) => "     " + s).join("\n"));
    console.log("  3. Simpan file, tutup lalu buka lagi " + c.label + " sepenuhnya.");
  }
  if (key === "generic") {
    const u = mcpUniversal(root);
    console.log("\nJalur universal — app apa pun yang paham MCP (belum ada adapter khusus):");
    console.log("  Yang penting app kamu menjalankan perintah ini sebagai server MCP (stdio):");
    console.log("     " + u.perintah);
    console.log("  Nama connector: " + u.nama);
    console.log("  Bungkus JSON beda per app — pilih yang cocok, tempel ke pengaturan MCP app kamu (server lain jangan dihapus):");
    console.log("  [mcpServers — Claude/Cursor/WorkBuddy/Cline/Windsurf/kebanyakan app]");
    console.log(u.blok.mcpServers.split("\n").map((s) => "     " + s).join("\n"));
    console.log("  [servers — VS Code]");
    console.log(u.blok.servers.split("\n").map((s) => "     " + s).join("\n"));
    console.log("  [mcp.servers — opencode]");
    console.log(u.blok.mcp.split("\n").map((s) => "     " + s).join("\n"));
  }
  console.log("Konfigurasi tersimpan, BELUM bukti tersambung. Model eksekusi dipilih di aplikasi agen; Connect tidak memulainya.");
  console.log('lalu di agen itu bilang: "baca ' + AGENT_ADAPTERS[key].rules + ", gunakan connector " + mcpServerName(root) + ". Panggil plan_status: folder proyek harus " + root.replace(/\\/g, "/") + '. Jika berbeda atau tidak jelas, STOP tanpa mengubah task. Jika cocok, kerjakan task berikutnya."');
  return 0;
}

// src/worker/cli/verification-commands.mjs
import { spawnSync as spawnSync14 } from "node:child_process";
import fs16 from "node:fs";
import path17 from "node:path";
function commandVerify(ctx, cwd, args) {
  const id = args._[1] || args.only;
  if (!id) {
    console.error("pakai: node worker.mjs verify T-002");
    return 1;
  }
  const t = ctx.plan.tasks.tasks.find((x) => x.id === id);
  if (!t) {
    console.error("task " + id + " tidak ada");
    return 1;
  }
  const hard = runHardGates(ctx, cwd);
  hard.forEach((h) => console.log("  gerbang " + h.id + ": " + (h.pass ? "OK" : "GAGAL") + (h.out ? "\n    " + short(String(h.out).replace(/\s+/g, " "), 300) : "")));
  const ver = ctx.lewatiVerifikasi ? Object.assign({}, VERIF_DILEWATI) : runVerification(ctx, cwd, t);
  for (const h of ver.hasil) console.log("  verifikasi: " + (h.pass ? "OK" : "GAGAL") + " (exit " + h.code + ") " + short(h.cmd, 100) + (h.out ? "\n    " + short(String(h.out).replace(/\s+/g, " "), 300) : ""));
  const beh = ctx.lewatiVerifikasi ? Object.assign({}, BEH_DILEWATI) : runBehavior(ctx, cwd, t);
  for (const h of beh.hasil || []) console.log("  perilaku: " + (h.pass ? "OK" : "GAGAL") + " " + h.check + (h.ukur && typeof h.ukur === "object" && h.ukur.pixel != null ? " · " + h.ukur.pixel + "/" + h.ukur.total + " pixel terisi" : "") + (h.alasan ? "\n    " + h.alasan : ""));
  const blok = hard.filter((h) => !h.pass && h.blocking);
  const st = ctx.state.tasks[id];
  const head = spawnSync14("git", ["log", "-1", "--format=%h %s"], { cwd, encoding: "utf8" });
  const isi = spawnSync14("git", ["show", "--name-only", "--format=", "HEAD"], { cwd, encoding: "utf8" });
  const files = String(isi.stdout || "").split("\n").map((f) => f.trim()).filter((f) => f && !/^\.planforge(\/|$)/.test(f) && !/^\.agents(\/|$)/.test(f));
  const gate = {
    hard: hard.map((h) => ({ id: h.id, pass: h.pass, blocking: h.blocking, metrics: h.metrics })),
    light: [],
    verify: { pass: ver.ok, dilewati: !!ver.dilewati, hasil: ver.hasil, kurang: ver.kurang },
    behavior: {
      pass: beh.ok,
      dilewati: !!beh.dilewati,
      wajib: !!beh.wajib,
      hasil: beh.hasil || [],
      kurang: beh.kurang || [],
      console: beh.console || [],
      requests: beh.requests || 0,
      ms: beh.ms || 0
    },
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const catatGagal = (kenapa) => {
    if (String(st.status || "belum mulai").trim().toLowerCase() === "belum mulai") {
      console.log("\n" + id + " belum mulai: verify manual gagal, status ledger tidak diubah. Perbaiki task terlebih dahulu lalu jalankan `node worker.mjs run --only " + id + "` jika ingin mencobanya.");
      return 1;
    }
    if (isDone(st)) ctx.state.doneTasks = Math.max(0, ctx.state.doneTasks - 1);
    st.status = "gagal";
    st.gate = gate;
    st.note = "verifikasi ulang tanpa agen: " + short(kenapa, 240);
    st.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    ctx.state.consecFails++;
    ctx.state.lastTask = id;
    saveCtx(ctx);
    console.log("\n" + id + " TETAP gagal (dicatat di ledger): " + kenapa);
    return 1;
  };
  if (blok.length) return catatGagal(blok.map((b) => b.id).join(", ") + " masih merah.");
  if (!ver.ok) return catatGagal(ver.kurang.join(" · "));
  if (!beh.ok) return catatGagal((beh.kurang || []).join(" · "));
  const headTxt = String(head.stdout || "").trim();
  if (!headTxt.includes(id)) {
    console.log("\n" + id + " TETAP gagal: kommit HEAD bukan milik task ini (" + (headTxt || "belum ada kommit") + ").");
    return 1;
  }
  if (!files.length) {
    console.log("\n" + id + " TETAP gagal: " + headTxt + " tidak berisi satu file pun selain catatan PlanForge.");
    return 1;
  }
  if (!isDone(st)) ctx.state.doneTasks++;
  st.status = "selesai";
  st.gate = gate;
  st.note = "verifikasi ulang tanpa agen: gerbang keras hijau di " + short(headTxt, 90) + " · " + files.length + " file (" + short(files.join(", "), 160) + ") · " + short(ringkasVerifikasi(ver), 200) + " · " + short(ringkasBehavior(beh), 200);
  st.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  ctx.state.consecFails = 0;
  ctx.state.lastTask = id;
  saveCtx(ctx);
  console.log("\n" + id + " -> SELESAI · " + st.note);
  return 0;
}
function commandAudit(ctx, cwd) {
  const a = auditPlan(ctx, cwd);
  console.log("audit rencana · " + a.tasks + " task · 0 panggilan agen");
  for (const x of a.temuan) console.log("  " + (x.lvl === "error" ? "!! " : "~ ") + (x.id + " ").padEnd(7) + x.msg);
  if (!a.temuan.length) console.log("  bersih: setiap gerbang keliatan bisa dijalankan di mesin ini");
  fs16.writeFileSync(
    path17.join(cwd, DIR, "PLAN_AUDIT.md"),
    "# Audit rencana\n\n" + (a.temuan.length ? a.temuan.map((x) => "- **" + x.lvl + "** " + x.id + " — " + x.msg).join("\n") : "Tidak ada temuan.") + "\n\n" + a.error.length + " error · " + a.warn.length + " warning\n"
  );
  console.log("\n" + a.error.length + " error · " + a.warn.length + " warning · laporan: " + DIR + "/PLAN_AUDIT.md");
  if (a.error.length) console.log("Error struktur/kontrak harus diperbaiki sebelum eksekusi. Saran lingkungan tidak menahan Connect, tetapi tes tetap wajib lulus.");
  return a.error.length ? 1 : 0;
}

// src/worker/workflow/run-one.mjs
function runOne(ctx, t, cwd) {
  const st = ctx.state.tasks[t.id];
  const L = (n) => ctx.gates.reviews.filter((r) => r.enabled && r.tier === n);
  const card = taskCard(ctx.plan, t);
  ctx.state.calls > 0 && log(ctx, "call terpakai: " + ctx.state.calls + "/" + ctx.gates.limits.maxCalls);
  const headBefore = headSha(cwd);
  const kotorAwal = potretKotor(cwd);
  const controlSnapshot = snapshotControlFiles(cwd);
  const lindungiKontrol = () => {
    const restored = restoreControlFiles(ctx, cwd, controlSnapshot);
    if (restored.restored) {
      const pesan = "peringatan: agen dilarang mengubah berkas penilaian mandor; dikembalikan: " + restored.warnings.join(", ");
      log(ctx, t.id + " " + pesan);
    }
  };
  const statusSebelum = st.status;
  const berhenti = (r) => {
    if (!r) return null;
    if (r.budget) {
      st.status = statusSebelum;
      st.note = "belum dicoba: " + r.budget;
      ctx.state.haltNote = r.budget;
      log(ctx, t.id + " DITANGGUH — " + r.budget + " | loop dihentikan, tidak ada yang dianggap selesai");
      saveCtx(ctx);
      return "halt";
    }
    if (!r.agenError) return null;
    st.status = statusSebelum;
    st.note = "belum dicoba: agen menolak (" + short(r.agenError, 140) + ")";
    log(ctx, t.id + " DITANGGUH — agen menolak bekerja: " + short(r.agenError, 140) + " | loop dihentikan, tidak ada yang dianggap selesai");
    saveCtx(ctx);
    return "halt";
  };
  let res = callAgent(ctx, buildTaskPrompt(ctx, t), { tag: t.id });
  lindungiKontrol();
  if (res.dry) return "dry";
  const h0 = berhenti(res);
  if (h0) return h0;
  st.status = "sedang";
  st.startedAt = (/* @__PURE__ */ new Date()).toISOString();
  saveCtx(ctx);
  let sess = res.session, verdict = extractVerdict(res.text);
  if (verdict && verdict.blocked) {
    st.status = "gagal";
    st.note = "diblokir agen: " + short(verdict.reason, 200);
    ctx.state.consecFails++;
    log(ctx, t.id + " DIBLOKIR: " + short(verdict.reason, 160));
    saveCtx(ctx);
    return "blocked";
  }
  if (res.kosong) {
    st.status = "gagal";
    st.note = "agen membalas kosong: tidak ada satu pun tool yang boleh jalan";
    ctx.state.consecFails++;
    log(ctx, t.id + " BALASAN KOSONG — tambah --dangerously-skip-permissions (atau --mode auto) di args agen, atau kerjakan lewat chat IDE");
    saveCtx(ctx);
    return "fail";
  }
  const hard = runHardGates(ctx, cwd);
  let blockingFail = hard.filter((h) => !h.pass && h.blocking);
  let ver = ctx.lewatiVerifikasi ? Object.assign({}, VERIF_DILEWATI) : runVerification(ctx, cwd, t);
  const verBisa = ver.dilewati || ver.jalan;
  let beh = ctx.lewatiVerifikasi ? Object.assign({}, BEH_DILEWATI) : runBehavior(ctx, cwd, t);
  const behBisa = beh.dilewati || beh.jalan && !beh.planRusak && !beh.lingkungan;
  if (!behBisa) {
    st.status = "gagal";
    st.note = beh.kurang.join(" · ");
    st.gate = {
      hard: hard.map((h) => ({ id: h.id, pass: h.pass, blocking: h.blocking, metrics: h.metrics })),
      light: [],
      verify: { pass: ver.ok, dilewati: !!ver.dilewati, hasil: ver.hasil, kurang: ver.kurang },
      behavior: { pass: false, dilewati: false, wajib: !!beh.wajib, hasil: [], kurang: beh.kurang },
      at: (/* @__PURE__ */ new Date()).toISOString()
    };
    st.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    ctx.state.consecFails++;
    ctx.state.lastTask = t.id;
    ctx.state.haltNote = "bukti perilaku tidak bisa dijalankan: " + short(beh.kurang.join(" · "), 240);
    log(ctx, t.id + " GAGAL — " + st.note);
    log(ctx, "  !! " + ctx.state.haltNote + " — loop dihentikan; betulkan plan/mesin dulu, jangan bakar panggilan agen");
    saveCtx(ctx);
    return "halt";
  }
  const cekUlang = () => {
    const again = runHardGates(ctx, cwd);
    hard.splice(0, hard.length, ...again);
    blockingFail = again.filter((h) => !h.pass && h.blocking);
    if (verBisa && !ver.dilewati) ver = runVerification(ctx, cwd, t);
    if (behBisa && !beh.dilewati) beh = runBehavior(ctx, cwd, t);
  };
  const alasanGagal = () => {
    const a = [];
    if (blockingFail.length) a.push("gerbang keras gagal (" + blockingFail.map((b) => b.id).join(", ") + ")");
    if (!ver.ok) a.push("verification gagal");
    if (!beh.ok) a.push("perilaku di browser gagal");
    return a;
  };
  let rounds = 0;
  while ((blockingFail.length || verBisa && !ver.ok || behBisa && !beh.ok) && rounds < (ctx.gates.limits.fixRounds || 2)) {
    rounds++;
    st.tries = (st.tries || 0) + 1;
    log(ctx, "  " + t.id + ": " + alasanGagal().join(" + ") + " -> ronde perbaikan " + rounds);
    const why = [
      blockingFail.map((b) => "[" + b.label + "]\n" + short(b.out, 1200) + (b.metrics && b.metrics.length ? "\n" + b.metrics.join("; ") : "")).join("\n\n"),
      ver.kurang.length ? "[VERIFIKASI task ini — dijalankan worker, bukan klaim kamu]\n" + ver.kurang.join("\n") + ver.hasil.filter((h) => !h.pass).map((h) => "\n$ " + h.cmd + "\nexit " + h.code + "\n" + short(h.out, 1200)).join("") : "",
      beh.kurang && beh.kurang.length ? "[PERILAKU di browser sungguhan — worker yang mengukur, bukan klaim kamu]\n" + beh.kurang.join("\n") + "\nIni angka hasil pengukuran, bukan tebakan. Perbaiki kodenya sampai check ini hijau; jangan mengubah plan.json." : ""
    ].filter(Boolean).join("\n\n");
    const fx = callAgent(ctx, buildFixPrompt(ctx, t, why), { tag: t.id + "-fix" + rounds, session: sess });
    lindungiKontrol();
    const hf = berhenti(fx);
    if (hf) return hf;
    if (fx.session) sess = fx.session;
    cekUlang();
  }
  let light = [];
  const berubah = changedFiles(cwd, headBefore);
  const fallbackTerverifikasi = !!(ver.ok && beh.ok && !blockingFail.length && berubah && berubah.length > 0);
  if (L("light").length && !blockingFail.length && ver.ok && beh.ok) {
    for (const g of L("light")) {
      const nilai = () => {
        const r = callAgent(ctx, [g.label + " untuk task " + t.id + ":", card, g.prompt].join("\n\n"), { tag: g.id, session: sess });
        lindungiKontrol();
        const hr = berhenti(r);
        if (hr) return { halt: hr };
        if (r.session) sess = r.session;
        const raw = extractVerdict(r.text);
        const v = raw && (typeof raw.pass === "boolean" || Array.isArray(raw.issues)) ? raw : null;
        const issues = v ? v.issues || [] : fallbackTerverifikasi ? [] : ["reviewer tidak mengembalikan JSON verdict"];
        const pass = v ? v.pass !== false && !issues.length : fallbackTerverifikasi;
        log(ctx, "  reviewer " + g.id + ": " + (!v ? pass ? "fallback terverifikasi" : "TIDAK ADA VERDICT — dianggap belum lolos" : pass ? "bersih" : issues.length + " temuan"));
        return { pass, issues, v };
      };
      let rv = nilai();
      if (rv.halt) return rv.halt;
      if (!rv.pass && (ctx.gates.limits.fixRounds || 2) > 0) {
        const fx = callAgent(ctx, buildFixPrompt(ctx, t, rv.issues.join("\n") + "\n" + (rv.v && rv.v.fix || "")), { tag: "fix-" + g.id, session: sess });
        lindungiKontrol();
        const hfx = berhenti(fx);
        if (hfx) return hfx;
        if (fx.session) sess = fx.session;
        cekUlang();
        rv = nilai();
        if (rv.halt) return rv.halt;
      }
      light.push({ id: g.id, pass: rv.pass, issues: rv.issues });
    }
  }
  const alasan = [];
  if (blockingFail.length) alasan.push("gerbang gagal: " + blockingFail.map((b) => b.id).join(", "));
  if (!ver.ok) alasan.push(ver.kurang.join(" · "));
  if (!beh.ok) alasan.push((beh.kurang || []).join(" · "));
  const lightGagal = light.filter((x) => !x.pass);
  if (lightGagal.length) alasan.push("reviewer ringan menolak: " + lightGagal.map((x) => x.id + " (" + short((x.issues || []).join("; "), 160) + ")").join(" | "));
  if (!(verdict && verdict.done === true) && !fallbackTerverifikasi) alasan.push('agen tidak melaporkan {"done":true}');
  if (berubah && !berubah.length && !ctx.allowNoop) alasan.push("tidak ada file yang berubah");
  const passAll = !alasan.length;
  st.status = passAll ? "selesai" : "gagal";
  st.gate = {
    hard: hard.map((h) => ({ id: h.id, pass: h.pass, blocking: h.blocking, metrics: h.metrics })),
    light,
    verify: { pass: ver.ok, dilewati: !!ver.dilewati, hasil: ver.hasil, kurang: ver.kurang },
    behavior: {
      pass: beh.ok,
      dilewati: !!beh.dilewati,
      wajib: !!beh.wajib,
      hasil: beh.hasil || [],
      kurang: beh.kurang || [],
      console: beh.console || [],
      requests: beh.requests || 0,
      ms: beh.ms || 0
    },
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
  st.note = passAll ? "verifikasi (dijalankan worker): " + short(ringkasVerifikasi(ver), 260) + " · " + short(ringkasBehavior(beh), 200) + (berubah ? " · " + berubah.length + " file berubah" : "") : alasan.join(" · ");
  st.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
  const sudahSelesai = isDone({ status: statusSebelum });
  if (passAll) {
    ctx.state.consecFails = 0;
    if (!sudahSelesai) {
      ctx.state.doneTasks++;
      ctx.state.sinceFull++;
    }
  } else {
    ctx.state.consecFails++;
    if (sudahSelesai) ctx.state.doneTasks = Math.max(0, ctx.state.doneTasks - 1);
  }
  ctx.state.lastTask = t.id;
  saveCtx(ctx);
  if (passAll && ctx.gates.limits.autoCommit !== false) gitCommit(ctx, cwd, t, kotorAwal);
  log(ctx, t.id + " -> " + (passAll ? "SELESAI" : "GAGAL") + " · " + st.note);
  if (passAll && shouldRunFull(ctx, t)) {
    const f = runFullGates(ctx, cwd, t);
    if (f.ok) ctx.state.sinceFull = 0;
    const re = runHardGates(ctx, cwd).filter((h) => !h.pass && h.blocking);
    if (re.length) {
      log(ctx, "  !! gerbang penuh merusak build/test: " + re.map((x) => x.id).join(", ") + " -> dihentikan, perlu lihat manual");
      ctx.state.consecFails = ctx.gates.limits.maxConsecutiveFails || 3;
    }
    saveCtx(ctx);
    if (!f.ok) {
      ctx.state.haltNote = "gerbang penuh tidak membuktikan apa-apa: " + f.kenapa;
      log(ctx, "  !! " + ctx.state.haltNote + " — loop dihentikan, task berikutnya tidak diambil");
      saveCtx(ctx);
      return "halt";
    }
  }
  return passAll ? "ok" : "fail";
}

// src/worker/cli/run-command.mjs
function commandRun(ctx, cwd, args, cap) {
  const lim = ctx.gates.limits;
  if (args.only) {
    ctx.state.consecFails = 0;
  }
  if (!args["no-gates"]) pruneUnavailableGates(ctx, cwd);
  if (!ctx.dryRun) mulaiSesi(ctx);
  log(ctx, "mulai · sesi " + (ctx.state.runId || "-") + " · agen=" + ctx.gates.agent.name + " · maxCalls=" + lim.maxCalls + " · plafon biaya " + (lim.maxCostUsd == null ? "tanpa batas" : "$" + lim.maxCostUsd) + " · gerbang keras=" + ctx.gates.hard.filter((h) => h.enabled).map((h) => h.id).join(",") + " · penuh tiap " + lim.fullEvery + " task");
  if (lim.maxCostUsd === 0) log(ctx, "plafon biaya $0 = hanya agen yang melaporkan biaya nol yang boleh jalan terus. Kalau agen ini berbayar, worker berhenti setelah panggilan pertama yang melaporkan biaya — naikkan limits.maxCostUsd di gates.json (atau --max-cost) kalau memang mau membayarnya.");
  const butuh = budgetRencana(ctx);
  const muat = (x) => x == null ? "tanpa batas" : "±" + taskMuat(x, ctx.gates, butuh.milestoneSisa) + " task";
  log(ctx, "kebutuhan: " + butuh.task + " task tersisa ≈ " + butuh.total + " panggilan (kerja " + butuh.kerja + " + gerbang penuh " + butuh.penuh + " + cadangan " + butuh.cadangan + ") · maxCalls " + lim.maxCalls + " muat " + muat(lim.maxCalls) + " · maxCallsPerRun " + (lim.maxCallsPerRun == null ? "tanpa batas" : lim.maxCallsPerRun) + " muat " + muat(lim.maxCallsPerRun));
  if (lim.maxCalls != null && lim.maxCalls < butuh.total || lim.maxCallsPerRun != null && lim.maxCallsPerRun < butuh.total)
    log(ctx, "!! budget belum cukup untuk sekali jalan sampai habis — pakai `--auto-budget` (dihitung dari task tersisa) atau naikkan limits.maxCalls/maxCallsPerRun. State tersimpan, jadi run berikutnya melanjutkan, bukan mengulang.");
  let n = 0;
  while (true) {
    if (ctx.state.calls >= lim.maxCalls) {
      log(ctx, "budget panggilan habis (" + lim.maxCalls + ") — naikkan --max-calls kalau memang mau lanjut");
      break;
    }
    const lewat = sisaBudget(ctx);
    if (lewat) {
      log(ctx, "berhenti: " + lewat + " — tidak ada panggilan lagi yang dikirim. Naikkan batasnya di gates.json kalau memang mau lanjut.");
      break;
    }
    if (ctx.state.consecFails >= (lim.maxConsecutiveFails || 3)) {
      log(ctx, "berhenti: " + ctx.state.consecFails + " kegagalan berturut-turut. Ini biasanya bukan lagi soal model — cek RUN_LOG.md, perbaiki plan, lalu jalankan lagi.");
      break;
    }
    if (cap && n >= cap) {
      log(ctx, "berhenti: batas --max-tasks tercapai");
      break;
    }
    let t;
    if (args.only) {
      if (n > 0) break;
      t = ctx.plan.tasks.tasks.find((x) => x.id === args.only);
      if (!t) {
        console.error("task " + args.only + " tidak ada");
        return 1;
      }
    } else {
      t = nextTask(ctx.plan, ctx.state);
      if (!t) {
        log(ctx, "tidak ada task tersisa yang siap dijalankan");
        break;
      }
      if (t.__blocked) {
        const gagal = (t.needs || []).filter((id) => isFail(ctx.state.tasks[id]));
        if (gagal.length) {
          log(ctx, "mentok: " + t.id + " menunggu " + (t.needs || []).join(", ") + " yang belum selesai/gagal — hentikan loop. Task gagal: " + gagal.join(", ") + ". Untuk mencoba ulang, jalankan `node worker.mjs run --only " + gagal[0] + "`; setelah selesai, jalankan `node worker.mjs run` untuk melanjutkan antrean.");
        } else log(ctx, "mentok: " + t.id + " menunggu " + (t.needs || []).join(", ") + " yang belum selesai/gagal — hentikan loop");
        break;
      }
      const unmet = hasUnmetDeps(ctx.plan, ctx.state, t);
      if (unmet.length) {
        ctx.state.tasks[t.id].note = "menunggu " + unmet.join(", ");
        log(ctx, "lewati " + t.id + " (belum selesai: " + unmet.join(", ") + ")");
        ctx.state.consecFails = lim.maxConsecutiveFails || 3;
        break;
      }
    }
    log(ctx, "task berikutnya: " + t.id + " — " + short(t.title, 70));
    const r = runOne(ctx, t, cwd);
    n++;
    if (r === "dry") {
      log(ctx, "dry-run: prompt " + t.id + " sudah ditampilkan di atas — tidak ada task yang diubah, tidak ada commit");
      break;
    }
    if (r === "halt") {
      log(ctx, "BERHENTI — " + (ctx.state.haltNote || "agen tidak bisa dipakai (kuota/auth habis)") + ". " + t.id + " dibiarkan apa adanya, bukan dihitung gagal. Cek RUN_LOG.md, betulkan penyebabnya, lalu jalankan lagi.");
      break;
    }
    if (args.only || args.one) break;
    if (r === "blocked") log(ctx, "  (agen menyerah di task ini; loop lanjut ke task berikutnya yang tidak bergantung padanya)");
  }
  if (!ctx.dryRun) saveCtx(ctx);
  if (ctx.dryRun) {
    log(ctx, "selesai dry-run: " + n + " prompt dilihat · tidak ada task yang diubah, tidak ada commit");
    return 0;
  }
  log(ctx, "selesai sesi: " + n + " task diproses · " + ctx.state.doneTasks + "/" + ctx.plan.tasks.tasks.length + " selesai total · " + ctx.state.calls + " panggilan agen (sesi ini " + (ctx.state.callsThisRun || 0) + ")" + (ctx.state.costUsd ? " · biaya $" + ctx.state.costUsd + " (sesi ini $" + (ctx.state.costThisRun || 0) + ")" : ""));
  return 0;
}

// src/worker/cli/main.mjs
import path18 from "node:path";
function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd) {
    console.log("Penggunaan: node worker.mjs <perintah> [opsi]");
    console.log("Perintah: run, status, reset, doctor, setup-env, refresh, pin, build, verify, audit, connect, giliran, init, mcp, embed");
    console.log("Reset: node worker.mjs reset | node worker.mjs reset <task-id>");
    console.log("Contoh: node worker.mjs run --dry-run");
    console.log("Jalankan `node worker.mjs run` untuk memulai loop runner.");
    return 0;
  }
  if (cmd === "init") return commandInit(args);
  if (cmd === "mcp") return mcpMain();
  if (cmd === "__browser") return commandBrowser();
  if (cmd === "embed") return commandEmbed(args);
  const root = resolveRoot(args);
  if (!root) {
    console.error("tidak ada " + DIR + "/plan.json di cwd maupun di samping worker.mjs. Ekspor dulu dari PlanForge ke folder proyek, atau jalankan `node worker.mjs init`.");
    return 1;
  }
  const cwd = args.cwd ? path18.resolve(root, args.cwd) : root;
  if (cmd === "setup-env") return commandSetupEnv(cwd);
  if (cmd === "doctor" && args.environment) return commandEnvironment(cwd);
  const ctx = loadCtx(root);
  if (args.agent) ctx.gates.agent = Object.assign({}, ctx.gates.agent, presetAgen(args.agent) || {}, { name: args.agent });
  if (args["auto-budget"]) {
    const b = budgetRencana(ctx);
    ctx.gates.limits.maxCalls = (ctx.state.calls || 0) + b.total;
    ctx.gates.limits.maxCallsPerRun = b.total;
    log(ctx, "auto-budget: " + b.task + " task tersisa ≈ " + b.total + " panggilan (kerja " + b.kerja + " + gerbang penuh " + b.penuh + " + cadangan " + b.cadangan + ") · maxCalls " + ctx.gates.limits.maxCalls + " (" + (ctx.state.calls || 0) + " sudah terpakai + " + b.total + ") · maxCallsPerRun " + ctx.gates.limits.maxCallsPerRun + " · plafon biaya TIDAK diubah: " + (ctx.gates.limits.maxCostUsd == null ? "tanpa batas" : "$" + ctx.gates.limits.maxCostUsd) + ".");
  }
  if (args["max-calls"]) ctx.gates.limits.maxCalls = Number(args["max-calls"]);
  if (args["max-calls-per-run"]) ctx.gates.limits.maxCallsPerRun = Number(args["max-calls-per-run"]);
  if (args["max-cost"] != null && args["max-cost"] !== true) ctx.gates.limits.maxCostUsd = Number(args["max-cost"]);
  if (args["full-every"]) ctx.gates.limits.fullEvery = Number(args["full-every"]);
  if (args["no-gates"]) {
    ctx.gates.hard.forEach((h) => h.enabled = false);
    ctx.gates.reviews.forEach((r) => r.enabled = false);
    ctx.lewatiVerifikasi = true;
  }
  ctx.dryRun = !!args["dry-run"];
  ctx.allowNoop = !!args["allow-noop"];
  const cap = args["max-tasks"] ? Number(args["max-tasks"]) : null;
  if (cmd === "status") return commandStatus(ctx, cwd);
  if (cmd === "reset") {
    const id = args._[1];
    ctx.state.consecFails = 0;
    if (id) {
      if (!ctx.plan.tasks.tasks.some((t) => t.id === id)) {
        console.error("task " + id + " tidak ada");
        return 1;
      }
      ctx.state.tasks[id] = ctx.state.tasks[id] || { status: "belum mulai", tries: 0, gate: null, note: "" };
      ctx.state.tasks[id].status = "belum mulai";
      ctx.state.tasks[id].note = "";
      ctx.state.tasks[id].finishedAt = void 0;
      delete ctx.state.tasks[id].finishedAt;
      console.log(id + " di-reset menjadi belum mulai; consecutive failures di-reset menjadi 0");
    } else {
      for (const t of ctx.plan.tasks.tasks) {
        const s = ctx.state.tasks[t.id];
        if (s && s.status === "gagal") {
          s.status = "belum mulai";
          s.note = "";
          s.finishedAt = void 0;
          delete s.finishedAt;
        }
      }
      console.log("semua task gagal di-reset menjadi belum mulai; consecutive failures di-reset menjadi 0");
    }
    saveCtx(ctx);
    log(ctx, "reset " + (id || "semua") + ": consecFails=0");
    return 0;
  }
  if (cmd === "build") return commandBuild();
  if (cmd === "giliran") return commandGiliran(ctx, args);
  if (cmd === "doctor") return commandDoctor(ctx, root, cwd, args);
  if (cmd === "refresh") return commandRefresh(root, ctx, args);
  if (cmd === "pin") return commandPin(ctx, cwd);
  if (cmd === "connect") return commandConnect(root, args);
  if (cmd === "verify" || cmd === "verifikasi") return commandVerify(ctx, cwd, args);
  if (cmd === "audit" || cmd === "audit-plan") return commandAudit(ctx, cwd);
  if (cmd !== "run") {
    console.log("pakai: node worker.mjs [run|status|doctor|refresh|pin|build|verify|audit|connect|init|mcp] [--dry-run] [--only T-004] [--max-tasks N] [--auto-budget] [--max-calls N] [--max-calls-per-run N] [--max-cost USD] [--full-every N] [--tunggu MS] [--no-gates] [--semua-gerbang] [--allow-noop] [--agent agy|claude|cursor|gemini|codex|codebuddy|none]");
    return 1;
  }
  return commandRun(ctx, cwd, args, cap);
}

// src/worker/entry.mjs
import path19 from "node:path";
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(path19.resolve(process.argv[1])).href) {
  const kode = main();
  if (kode) process.exitCode = kode;
}
export {
  AGENT_ADAPTERS,
  AGENT_ALIAS,
  AGENT_PRESETS,
  BEH_DILEWATI,
  BROWSER_CALON,
  CHECK_BROWSER,
  FULL_GATES,
  HARD_CHECKS,
  LIGHT_REVIEW,
  MCP_TOOLS,
  VERIF_DILEWATI,
  absolutkanScript,
  auditPlan,
  bannerBuildLama,
  budgetRencana,
  buildFixPrompt,
  buildLama,
  buildTaskPrompt,
  bukanPerintah,
  buktiGiliran,
  buktiSelesai,
  callAgent,
  canonPlan,
  cariBrowser,
  catatBiaya,
  cetakFile,
  changedFiles,
  connectAgent,
  crc32,
  defaultGates,
  detectRateLimit,
  doctorMcp,
  environmentReadiness,
  extractVerdict,
  findRoot,
  giliranJatuh,
  gitCommit,
  hitungBudget,
  jalurAman,
  kandidatInterpreter,
  kartuBehavior,
  kartuGiliran,
  kutipSatuBocor,
  loadCtx,
  log,
  main,
  masalahBehavior,
  mcpEntry,
  mcpHandle,
  mcpServerName,
  mcpSnippet,
  mcpUniversal,
  metricProblems,
  missingNpmScripts,
  mulaiSesi,
  nextTask,
  npmScriptNama,
  parseArgs,
  parseLighthouse,
  perintahVerifikasi,
  pinInterpreter,
  planCoreFromPlan,
  planFingerprintPlan,
  potretKotor,
  presetAgen,
  prosesNode,
  pruneUnavailableGates,
  refreshConnector,
  resolveRoot,
  restoreControlFiles,
  ringkasBehavior,
  ringkasVerifikasi,
  runBehavior,
  runFullGates,
  runHardGates,
  runOne,
  runVerification,
  saveCtx,
  setupEnv,
  sisaBudget,
  sisaMilestone,
  snapshotControlFiles,
  specBehavior,
  syncCtx,
  taskCard,
  taskMuat,
  taskUi
};
