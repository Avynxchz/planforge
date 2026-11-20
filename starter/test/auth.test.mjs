import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, newSessionToken, sessionExpiry } from "../lib/auth.js";
test("hash lalu verify password benar", () => {
  const h = hashPassword("rahasia123");
  assert.ok(verifyPassword("rahasia123", h));
});
test("password salah ditolak", () => {
  const h = hashPassword("rahasia123");
  assert.equal(verifyPassword("salah12345", h), false);
});
test("stored rusak / kosong ditolak tanpa throw", () => {
  assert.equal(verifyPassword("x", ""), false);
  assert.equal(verifyPassword("x", "tanpa-colon"), false);
});
test("token session 64 hex dan unik", () => {
  const a = newSessionToken(), b = newSessionToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});
test("expiry session di masa depan", () => {
  assert.ok(sessionExpiry(1).getTime() > Date.now());
});