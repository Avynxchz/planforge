import pg from "pg";
import nextEnv from "@next/env";
import { hashPassword } from "../lib/auth.js";
nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DATABASE_URL;
const email = process.env.SEED_EMAIL || "owner@example.com";
const password = process.env.SEED_PASSWORD || "rahasia123";
if (!url) { console.error("DATABASE_URL belum diset."); process.exit(1); }
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(
  "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'owner') ON CONFLICT (email) DO NOTHING",
  [email, hashPassword(password)]
);
await client.end();
console.log("seed selesai: " + email + " (password dari SEED_PASSWORD atau default rahasia123).");