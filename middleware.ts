import { NextResponse, type NextRequest } from "next/server";

// Reachable without a session. /privacy and /terms must stay public: Meta requires a publicly
// accessible privacy policy and terms URL for the WhatsApp app, and checks them while logged out.
const PUBLIC = ["/login", "/privacy", "/terms"];

// Cheap presence check; real verification happens in layouts and API routes.
export function middleware(req: NextRequest) {
  const has = req.cookies.has("kollect_session");
  const { pathname } = req.nextUrl;
  const open = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!has && !open) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api|_next|favicon.ico).*)"] };
