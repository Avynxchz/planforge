import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "../../../../lib/db";
import { COOKIE } from "../../../../lib/auth";
export async function POST() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await query("DELETE FROM sessions WHERE token = $1", [token]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}