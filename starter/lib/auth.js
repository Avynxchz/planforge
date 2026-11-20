import crypto from "node:crypto";
import { COOKIE } from "./cookie.js";
export { COOKIE };
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return salt + ":" + hash;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const cand = crypto.scryptSync(String(password), salt, 64);
  const want = Buffer.from(hash, "hex");
  return cand.length === want.length && crypto.timingSafeEqual(cand, want);
}
export function newSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}
export function sessionExpiry(hours) {
  const h = Number(hours) > 0 ? Number(hours) : 72;
  return new Date(Date.now() + h * 3600 * 1000);
}