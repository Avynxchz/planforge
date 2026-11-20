export function validateLogin(body) {
  const errors = [];
  const email = String(body?.email || "").trim();
  const password = String(body?.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push("email tidak valid");
  if (password.length < 8) errors.push("password minimal 8 karakter");
  return { ok: errors.length === 0, errors, email, password };
}
export function validateItem(body) {
  const errors = [];
  const name = String(body?.name || "").trim();
  const qty = Number(body?.qty);
  if (!name) errors.push("nama wajib diisi");
  if (name.length > 120) errors.push("nama maksimal 120 karakter");
  if (!Number.isInteger(qty) || qty < 0) errors.push("qty harus bilangan bulat >= 0");
  return { ok: errors.length === 0, errors, name, qty };
}