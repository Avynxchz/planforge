import { NextResponse } from "next/server";
import { COOKIE } from "./lib/cookie";
export function middleware(req) {
  const punya = req.cookies.get(COOKIE)?.value;
  if (req.nextUrl.pathname.startsWith("/dashboard") && !punya) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/dashboard/:path*"] };