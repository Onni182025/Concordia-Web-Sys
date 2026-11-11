import { NextRequest, NextResponse } from 'next/server';
const secret = () => {
  const value = process.env.AUTH_SECRET;
  return value && new TextEncoder().encode(value).length >= 32 ? value : null;
};

async function validSession(value?: string) {
  if (!value) return false;
  const signingSecret = secret();
  if (!signingSecret) return false;
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const [userId, sessionVersion, expiresAt, signature] = parts;
  if (!userId || !/^\d+$/.test(sessionVersion) || !/^\d+$/.test(expiresAt) || !signature || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}.${sessionVersion}.${expiresAt}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return signature === expected;
}

export async function middleware(request: NextRequest) {
  if (request.method === 'POST') return NextResponse.next();
  if (request.nextUrl.pathname === '/concordia-logo.png') return NextResponse.next();
  if (request.nextUrl.pathname === '/api/auth/session') return NextResponse.next();
  if (request.nextUrl.pathname === '/login') {
    if (await validSession(request.cookies.get('concordia_session')?.value)) return NextResponse.redirect(new URL('/', request.url));
    return NextResponse.next();
  }
  if (!await validSession(request.cookies.get('concordia_session')?.value)) return NextResponse.redirect(new URL('/login', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
