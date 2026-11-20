import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/session";
import { query } from "../../../lib/db";
import { validateItem } from "../../../lib/validate";
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "belum masuk" }, { status: 401 });
  const r = await query("SELECT id, name, qty, created_at FROM items ORDER BY created_at DESC LIMIT 100");
  return NextResponse.json({ items: r.rows });
}
export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "belum masuk" }, { status: 401 });
  const v = validateItem(await req.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ errors: v.errors }, { status: 400 });
  const r = await query("INSERT INTO items (name, qty) VALUES ($1, $2) RETURNING id, name, qty", [v.name, v.qty]);
  return NextResponse.json({ item: r.rows[0] }, { status: 201 });
}