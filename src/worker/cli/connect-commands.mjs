import { refreshConnector } from "../connectors/refresh.mjs";
import { AGENT_ADAPTERS } from "../../shared/agent-contracts.mjs";
import { connectAgent, mcpServerName, mcpSnippet, mcpUniversal } from "../connectors/config.mjs";

export function commandRefresh(root, ctx, args){
  /* Do not claim refresh succeeded unless the app spawned a fresh connector. */
  const tunggu = args.tunggu != null && args.tunggu !== true ? Number(args.tunggu) : undefined;
  const r = refreshConnector(root, { dryRun: ctx.dryRun, tunggu });
  console.log(r.pesan);
  return (r.hasil === "fresh" || r.hasil === "udah-baru" || r.hasil === "dry-run") ? 0 : 1;
}

export function commandConnect(root, args){
  const daftar = ()=>{
    console.log("agen yang bisa dipasang (node worker.mjs connect <nama>):");
    for(const k of Object.keys(AGENT_ADAPTERS)) console.log("  " + k.padEnd(10) + AGENT_ADAPTERS[k].label + (AGENT_ADAPTERS[k].file ? "  -> " + AGENT_ADAPTERS[k].file : "  -> cuma lewat UI-nya"));
  };
  const key = args._[1];
  if(args.list || !key){ daftar(); if(!key && !args.list) console.log("pakai: node worker.mjs connect <agen>   |   connect --list"); return key || args.list ? 0 : 1; }
  if(!AGENT_ADAPTERS[key]){ console.error("agen '" + key + "' tidak ada — pakai salah satu: " + Object.keys(AGENT_ADAPTERS).join(", ")); return 1; }
  const c = connectAgent(root, key);
  console.log("== " + c.label + " ==");
  for(const h of c.hasil) console.log((h.tulis ? "  ditulis " : "  dibiarkan ") + h.file + " (" + h.kenapa + ")");
  console.log("\nlangkahmu: " + c.hint.replace("<nama-server>", mcpServerName(root)));
  /* Print global registration instructions without writing global configuration. */
  if(AGENT_ADAPTERS[key].globalPath){
    console.log("\nRegistrasi global SEKALI (aturan " + c.label + ", bukan PlanForge):");
    console.log("  1. Buka file global: " + AGENT_ADAPTERS[key].globalPath);
    console.log("  2. Tempel blok ini ke dalam \"mcpServers\" — server lain yang sudah ada jangan dihapus:");
    console.log(mcpSnippet(root, key).split("\n").map(s=>"     " + s).join("\n"));
    console.log("  3. Simpan file, tutup lalu buka lagi " + c.label + " sepenuhnya.");
  }
  if(key === "generic"){
    const u = mcpUniversal(root);
    console.log("\nJalur universal — app apa pun yang paham MCP (belum ada adapter khusus):");
    console.log("  Yang penting app kamu menjalankan perintah ini sebagai server MCP (stdio):");
    console.log("     " + u.perintah);
    console.log("  Nama connector: " + u.nama);
    console.log("  Bungkus JSON beda per app — pilih yang cocok, tempel ke pengaturan MCP app kamu (server lain jangan dihapus):");
    console.log("  [mcpServers — Claude/Cursor/WorkBuddy/Cline/Windsurf/kebanyakan app]");
    console.log(u.blok.mcpServers.split("\n").map(s=>"     " + s).join("\n"));
    console.log("  [servers — VS Code]");
    console.log(u.blok.servers.split("\n").map(s=>"     " + s).join("\n"));
    console.log("  [mcp.servers — opencode]");
    console.log(u.blok.mcp.split("\n").map(s=>"     " + s).join("\n"));
  }
  console.log("Konfigurasi tersimpan, BELUM bukti tersambung. Model eksekusi dipilih di aplikasi agen; Connect tidak memulainya.");
  console.log("lalu di agen itu bilang: \"baca " + AGENT_ADAPTERS[key].rules + ", gunakan connector " + mcpServerName(root)
    + ". Panggil plan_status: folder proyek harus " + root.replace(/\\/g, "/") + ". Jika berbeda atau tidak jelas, STOP tanpa mengubah task. Jika cocok, kerjakan task berikutnya.\"");
  return 0;
}
