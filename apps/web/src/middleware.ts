import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  decideAuthRedirect,
  isApiProxyPath,
} from "./lib/auth-guard";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isApiProxyPath(pathname)) {
    return NextResponse.next();
  }
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const decision = decideAuthRedirect(pathname, hasSession);

  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.to, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api(?:/.*)?$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
