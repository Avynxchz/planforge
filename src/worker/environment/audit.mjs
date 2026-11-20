import fs from "node:fs";
import path from "node:path";
import { taskList, isDone } from "../ledger/tasks.mjs";
import { environmentReadiness } from "./readiness.mjs";
import { missingNpmScripts } from "../../shared/npm-contract.mjs";
import { cariBrowser } from "../browser/discovery.mjs";
import { specBehavior, masalahBehavior, taskUi } from "../../shared/behavior-spec.mjs";
import { short } from "../text.mjs";
import { AWAL_PERINTAH, segmen, bukanPerintah, tokenAwal, BUILTIN, BERISIKO, hasBin, kutipSatuBocor, TOKEN_FILE, desimal } from "./shell.mjs";

export function auditPlan(ctx, cwd){
  const temuan = [], st = ctx.state, tasks = taskList(ctx.plan);
  const add = (lvl, id, msg)=> temuan.push({ lvl, id, msg });
  temuan.push(...environmentReadiness(cwd).findings);
  let pkg; try{ pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")); }catch(_){}
  if(pkg) for(const x of missingNpmScripts(tasks, pkg)) add("error", x.id, x.msg);
  if(new Set(tasks.map(t=>t.id)).size !== tasks.length) add("error", "PLAN", "ID task duplikat — struktur rencana harus diperbaiki.");
  const binBrowser = cariBrowser();
  const adaBehavior = tasks.some(t=>specBehavior(t));
  if(adaBehavior && !binBrowser)
    add("warn", "ENV", "ada task dengan bukti perilaku tapi tidak ada Edge/Chrome di mesin ini — worker tidak bisa mengukur, jadi tidak akan menandai selesai. Pasang browser atau set PLANFORGE_BROWSER.");
  if(adaBehavior && typeof WebSocket === "undefined")
    add("warn", "ENV", "Node " + process.version + " tidak punya WebSocket global — gerbang perilaku butuh Node 22+.");

  /* A missing scaffold must be reported before an agent invents out-of-scope files. */
  const pertama = tasks[0];
  if(pertama){
    const judul = String(pertama.title || "") + " " + String(pertama.description || "");
    const scaffold = /scaffold|kerangka|skeleton|setup|inisial|struktur dasar|bootstrap|bangun dasar/i.test(judul);
    const butuhBuild = /\bnpm run\b|\byarn\b|\bpnpm\b|\bvite\b|next build|\btsc\b/i.test(String(pertama.verification || ""));
    const disebut = (pertama.files_or_areas || []).map(f=>String(f)).filter(f=>!/^(test\/|\.planforge\/)/.test(f));
    const hilang = disebut.filter(f=>!fs.existsSync(path.join(ctx.root, f)));
    const berkasInti = ["index.html","package.json","src","app.js","main.py","pyproject.toml","Cargo.toml","go.mod"];
    const adaProyek = berkasInti.some(f=>fs.existsSync(path.join(ctx.root, f)));
    if(!adaProyek && !scaffold && butuhBuild && hilang.length)
      add("error", pertama.id, "folder proyek masih kosong tapi task pertama ini bukan scaffold dan butuh build; file yang disebut tidak ada: "
        + short(hilang.join(", "), 180) + ". Tidak ada task yang membuatnya. Tambahkan task T-001 scaffold ke rencana, atau pulihkan file aplikasi — jangan mengarang proyek dasar di luar task.");
    else if(!adaProyek && !scaffold && hilang.length)
      add("warn", pertama.id, "folder proyek masih kosong dan file yang disebut belum ada: " + short(hilang.join(", "), 160) + " — pastikan task scaffold ada sebelum task ini.");
    if(String(pertama.id || "").toUpperCase() !== "T-001")
      add("error", "PLAN", "task pertama ber-ID " + pertama.id + ", bukan T-001 — periksa apakah task scaffold hilang.");
  }

  for(const t of tasks){
    const rusakBeh = masalahBehavior(t);
    if(rusakBeh.length) add("error", t.id, rusakBeh.join(" · "));
    const specBeh = specBehavior(t);
    if(specBeh){
      if(/localhost:|127\.0\.0\.1:/.test(specBeh.url) && !(specBeh.server && specBeh.server.cmd))
        add("warn", t.id, "behavior.url menunjuk server lokal tapi behavior.server.cmd kosong — kalau servernya mati, pengukuran gagal. Isi server.cmd supaya worker menyalakannya sendiri lalu mematikannya lagi.");
      if(!binBrowser) add("warn", t.id, "prasyarat lingkungan: browser tidak ada; siapkan sebelum verifikasi, bukan hapus behavior atau klaim lulus");
    } else if(t.ui === false && taskUi(t))
      add("warn", t.id, "ditandai ui:false padahal menyentuh " + short((t.files_or_areas || []).join(", ") || t.title, 60)
        + " — bukti perilaku dilewati atas keputusan manusia, bukan karena terukur hijau");

    const raw = String(t.verification || "").trim();
    if(!raw){ add("error", t.id, "verification kosong — tidak ada satu pun yang bisa membuktikan task ini"); continue; }
    const v = raw.replace(AWAL_PERINTAH, "");
    const segs = segmen(v);
    const bukan = bukanPerintah(v);
    if(bukan)
      add("error", t.id, "verification bukan perintah shell: \"" + short(bukan, 80) + "\" — gerbang ini lolos kosong, agen tinggal klaim");

    for(const s of segs){
      const tk = tokenAwal(s);
      if(!tk || BUILTIN.has(tk) || /[\/\\]/.test(tk)) continue;
      if(BERISIKO[tk]) add("warn", t.id, "memakai " + tk + " — " + BERISIKO[tk]);
      else if(/^[a-z][\w-]*$/.test(tk) && !hasBin(tk))
        add("warn", t.id, "biner \"" + tk + "\" tidak ada di PATH — prasyarat lingkungan, siapkan sebelum menjalankan verifikasi; bukan penahan Connect/next_task dan bukan izin melewati tes");
    }

    /* An always-successful suffix hides a failed verification command. */
    for(const baris of v.split(/[\n\r]+/)){
      const ekor = baris.split(/;/).pop().trim();
      const tutup = ekor.split(/ \|\| /).pop().trim();
      const cumaSukses = (s)=> /^(?:echo|printf|true|:)(?:\s|$)/.test(s);
      const penutup = cumaSukses(ekor) ? ekor : (cumaSukses(tutup) && tutup !== ekor ? tutup : "");
      if(penutup)
        add("error", t.id, "gerbang ini tidak bisa gagal: barisnya ditutup \"" + short(penutup, 40)
          + "\" — echo/true selalu mengembalikan 0, jadi perintah di depannya boleh gagal total dan task tetap lulus."
          + " Buang penutup itu, atau rangkai pakai `&&`.");
    }

    /* cmd.exe treats operators inside single quotes as real shell operators. */
    if(process.platform === "win32"){
      const bocor = kutipSatuBocor(v);
      if(bocor)
        add("error", t.id, "kutip satu tidak melindungi apa pun di cmd.exe: " + short(bocor, 50)
          + " dipecah jadi perintah lain (| & < > tetap operator). Bungkus argumen itu dengan kutip dua"
          + " atau buang metakarakternya — di mesin ini perintah tersebut tidak akan pernah hijau.");
    }

    /* Some sqlite3 shims wait forever when stdin is left open. */
    if(/\bsqlite3\b/.test(v) && !/<\s*\/dev\/null/.test(v))
      add("warn", t.id, "memakai sqlite3 tanpa menutup stdin — kalau dia shim Python, perintahnya menunggu selamanya."
        + " Tambahkan ` < /dev/null`.");

    for(const s of segs){
      const db = (s.match(/[\w.@\/-]*\.db\b/i) || [])[0];
      if(db && /pragma|insert|update|delete|create|drop|alter|vacuum/i.test(s) && fs.existsSync(path.resolve(cwd, db.replace(/^\.\//, ""))))
        add("warn", t.id, "menulis ke \"" + db + "\" yang ada di disk (DB produksi proyek) — salin dulu ke DB sementara,"
          + " jangan ubah file/PRAGMA milik data live demi gerbang hijau.");
    }

    for(const f of new Set([...v.matchAll(TOKEN_FILE)].map(m=>m[1]))){
      if(/:\/\//.test(f)) continue;
      const ada = fs.existsSync(path.resolve(cwd, f.replace(/^\.\//, "")));
      if(ada) continue;
      if(isDone(st.tasks[t.id] || {})) add("error", t.id, "sudah ditandai selesai tapi \"" + f + "\" tidak ada di proyek");
      else add("warn", t.id, "\"" + f + "\" belum ada — harusnya file ini yang dibuat task-nya");
    }

    if(/localhost:|127\.0\.0\.1:/.test(v))
      add("warn", t.id, "butuh server yang hidup (curl) — nyalakan dulu, jangan ganti pakai bukti setara");

    const ket = desimal([t.title, t.description, t.agent_hint].join(" "));
    const contoh = desimal((t.acceptance_criteria || []).join(" "));
    if(ket.size && contoh.size && [...contoh].every(n=>!ket.has(n)))
      add("warn", t.id, "angka di instruksi (" + [...ket].join(", ") + ") tidak ada yang cocok dengan contoh kriteria (" + [...contoh].join(", ") + ") — putuskan manual, jangan biarkan agen nebak");

    /* Unexpected CJK in generated task text can leak into agent-written code. */
    const nyasar = [t.title, t.description, t.agent_hint, (t.acceptance_criteria || []).join(" "), t.verification]
      .join(" ").match(/[\u3400-\u9fff\u3040-\u30ff]/g);
    if(nyasar) add("error", t.id, "ada aksara Mandarin nyasar di teks task (\"" + nyasar.slice(0, 4).join("") + "\") — teks ini yang dibaca agen, betulkan sebelum dikerjakan");
  }
  return { temuan, tasks: tasks.length, error: temuan.filter(x=>x.lvl === "error"), warn: temuan.filter(x=>x.lvl === "warn") };
}
