import fs from "node:fs";
import path from "node:path";
import { now } from "../text.mjs";
import { F_LOG } from "./files.mjs";

export function log(ctx, line){
  const s = "[" + now() + "] " + line;
  console.log(s);
  fs.mkdirSync(ctx.dir, { recursive: true });
  if(!fs.existsSync(path.join(ctx.dir, F_LOG))) fs.writeFileSync(path.join(ctx.dir, F_LOG), "# Log kerja PlanForge\n\n");
  fs.appendFileSync(path.join(ctx.dir, F_LOG), "- " + s + "\n");
}
