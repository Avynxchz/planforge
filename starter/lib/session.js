import { cookies } from "next/headers";
import { query } from "./db";
import { COOKIE } from "./auth";
export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const r = await query(
    "SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()",
    [token]
  );
  return r.rows[0] || null;
}