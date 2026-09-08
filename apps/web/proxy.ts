import { AUTH_SESSION_COOKIE } from '@omniroute/types';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function proxy(request: NextRequest): NextResponse {
  const hasSession = Boolean(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  const isLogin = request.nextUrl.pathname === '/login';

  if (!hasSession && !isLogin) {
    const login = new URL('/login', request.url);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/chat/:path*', '/login'],
};
