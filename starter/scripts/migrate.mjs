import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL belum diset. Salin .env.example ke .env.local atau export DATABASE_URL."); process.exit(1); }
const sql = fs.readFileSync(path.join(import.meta.dirname, "..", "db", "schema.sql"), "utf8");
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(sql);
await client.end();
console.log("migrasi selesai: users, sessions, items siap.");