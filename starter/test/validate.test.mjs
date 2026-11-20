import test from "node:test";
import assert from "node:assert/strict";
import { validateLogin, validateItem } from "../lib/validate.js";
test("login valid lolos", () => {
  assert.ok(validateLogin({ email: "a@b.co", password: "rahasia123" }).ok);
});
test("login email rusak / password pendek ditolak", () => {
  assert.equal(validateLogin({ email: "bukan-email", password: "rahasia123" }).ok, false);
  assert.equal(validateLogin({ email: "a@b.co", password: "pendek" }).ok, false);
});
test("item valid lolos", () => {
  const v = validateItem({ name: "Kopi", qty: 3 });
  assert.ok(v.ok); assert.equal(v.name, "Kopi"); assert.equal(v.qty, 3);
});
test("item nama kosong / qty negatif / qty pecahan ditolak", () => {
  assert.equal(validateItem({ name: "", qty: 1 }).ok, false);
  assert.equal(validateItem({ name: "x", qty: -1 }).ok, false);
  assert.equal(validateItem({ name: "x", qty: 1.5 }).ok, false);
});