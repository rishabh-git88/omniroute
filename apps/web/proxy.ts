import { AUTH_SESSION_COOKIE } from '@omniroute/types';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function proxy(request: NextRequest): NextResponse {
  const hasSession = Boolean(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;
  const isProtectedRoute =
    pathname === '/chat' || pathname.startsWith('/chat/');

  if (!hasSession && isProtectedRoute) {
    const login = new URL('/login', request.url);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/chat/:path*'],
};
