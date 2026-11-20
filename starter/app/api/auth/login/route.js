import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { hashPassword, verifyPassword, newSessionToken, sessionExpiry, COOKIE } from "../../../../lib/auth";
import { validateLogin } from "../../../../lib/validate";
export async function POST(req) {
  const body = await req.json().catch(() => null);
  const v = validateLogin(body);
  if (!v.ok) return NextResponse.json({ errors: v.errors }, { status: 400 });
  const r = await query("SELECT id, password_hash FROM users WHERE email = $1", [v.email]);
  const user = r.rows[0];
  if (!user || !verifyPassword(v.password, user.password_hash)) {
    return NextResponse.json({ error: "email atau password salah" }, { status: 401 });
  }
  const token = newSessionToken();
  await query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, user.id, sessionExpiry(process.env.SESSION_TTL_HOURS)]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", expires: sessionExpiry(process.env.SESSION_TTL_HOURS) });
  return res;
}