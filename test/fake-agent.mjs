/* Agen bohongan untuk uji PlanForge Worker.
   Dipanggil sebagai: node fake-agent.mjs "<prompt>"
   Membalas dengan bentuk yang sama dengan `agy -p ... --output-format json`. */
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const prompt = String(process.argv[2] || "");
const blockFile = fs.existsSync(".planforge/force-block");

function reply(resultText){
  process.stdout.write(JSON.stringify({
    result: resultText, session_id: "fake-session-1", total_cost_usd: 0.0042,
    usage: { input_tokens: 1200, output_tokens: 300 }
  }) + "\n");
}

if(process.env.PF_NOVERDICT){
  reply("Sudah kuperiksa, kelihatannya rapi kok.");
  process.exit(0);
}

/* agen yang nolak kerja: kredit habis — exit code bukan nol + amplop ERROR + baris log sebelum JSON */
if(process.env.PF_CREDITS){
  process.stdout.write("[agy] menyiapkan sesi...\n" + JSON.stringify({
    conversation_id: "5508181d", status: "ERROR", response: "", duration_seconds: 613.2, num_turns: 1,
    error: "Your AI credits balance is too low to continue.",
    usage: { input_tokens: 300501, output_tokens: 3 }
  }) + "\n");
  process.exit(3);
}

/* balasan yang cuma JSON tapi bukan verdict */
if(process.env.PF_NOTVERDICT){
  reply('{"info":"sudah kulihat kok"}');
  process.exit(0);
}

/* ronde perbaikan yang beneran menulis bukti: dipakai menguji verifikasi merah -> hijau.
   Promptnya ikut disimpan supaya uji bisa memastikan exit code asli benar-benar sampai ke agen. */
if(process.env.PF_FIX_VERIF && prompt.includes("Perbaikan untuk task")){
  fs.writeFileSync("bukti.txt", "dibuat oleh ronde perbaikan\n");
  fs.writeFileSync("prompt-perbaikan.txt", prompt);
  reply("Perbaikan kecil selesai.\n{\"fixed\":true}");
  process.exit(0);
}

/* gerbang penuh (audit/fixbug/refactor/performa) yang balas kosong atau tanpa verdict */
const penuh = /^(Audit menyeluruh|Perbaiki bug hasil audit|Rapikan & buang kode mati|Performa)/.test(prompt)
  || /Audit kualitas kode dari task|Perbaiki HANYA temuan|Refactor tanpa mengubah perilaku|Optimalkan performa untuk HP/.test(prompt);
if(penuh && process.env.PF_FULL_SILENT){
  process.stdout.write(JSON.stringify({
    conversation_id: "00000000-0000-0000-0000-000000000002", status: "SUCCESS", response: "",
    duration_seconds: 9.4, num_turns: 1, usage: { input_tokens: 4102, output_tokens: 0 }
  }) + "\n");
  process.exit(0);
}
if(penuh && process.env.PF_FULL_NOVERDICT){
  reply("Sudah kuperiksa semuanya, kelihatannya rapi kok.");
  process.exit(0);
}

/* agen yang mengakhiri kerjanya dengan `git commit` sendiri: working tree jadi bersih */
if(process.env.PF_SELF_COMMIT){
  fs.mkdirSync("src", { recursive: true });
  fs.writeFileSync("src/dari-agen.js", "export const selesai = true;\n");
  spawnSync("git", ["add", "src/dari-agen.js"], { encoding: "utf8" });
  spawnSync("git", ["commit", "-q", "-m", "kerja agen"], { encoding: "utf8" });
  reply("Sukuku kommit sendiri.\n{\"done\":true,\"verification\":\"lulus lewat kommit HEAD\"}");
  process.exit(0);
}

if(blockFile){
  reply("Aku tidak bisa lanjut.\n{\"blocked\":true,\"reason\":\"informasi skema belum ada di task\"}");
  process.exit(0);
}

if(prompt.includes("Kerjakan SATU task")){
  const id = (/TASK (T-\d{3})/.exec(prompt) || [, "T-???"])[1];
  reply("Sudah kubuat dan kuuji untuk " + id + ".\n{\"done\":true,\"verification\":\"" + id + " diverifikasi: hasil sesuai kriteria\",\"files\":[\"src/app.js\"]}");
} else if(prompt.includes("Perbaikan untuk task")){
  reply("Perbaikan kecil selesai.\n{\"fixed\":true}");
} else if(prompt.includes("Review ringan")){
  if(process.env.PF_LIGHT_FAIL) reply("Review selesai.\n{\"pass\":false,\"issues\":[\"temuan uji: tombol simpan belum terhubung\"]}");
  else reply("Review selesai.\n{\"pass\":true,\"issues\":[]}");
} else if(prompt.includes("Audit menyeluruh")){
  reply("Audit selesai.\n{\"issues\":[]}");
} else if(prompt.includes("Perbaiki HANYA temuan")){
  reply("Tidak ada yang perlu diperbaiki.\n{\"fixed\":[],\"skipped\":[],\"reason_skipped\":\"audit bersih\"}");
} else if(prompt.includes("Rapikan & buang kode mati")){
  reply("Rapikan selesai.\n{\"changed\":[],\"removed\":[]}");
} else if(prompt.includes("Performa")){
  reply("Optimasi selesai.\n{\"changes\":[],\"measured\":\"fcp=900ms\"}");
} else {
  reply("{\"done\":true}");
}
process.exit(0);
