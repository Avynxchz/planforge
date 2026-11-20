import { NextResponse } from "next/server";
import { currentUser } from "../../../../lib/session";
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "belum masuk" }, { status: 401 });
  return NextResponse.json({ user });
}