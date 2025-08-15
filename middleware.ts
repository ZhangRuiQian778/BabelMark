import { NextRequest, NextResponse } from 'next/server';

function unauthorized() {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Protected", charset="UTF-8"',
    },
  });
}

export function middleware(req: NextRequest) {
  const SITE_PASSWORD = process.env.SITE_PASSWORD;
  const SITE_USER = process.env.SITE_USER; // optional: if not set, any username is accepted
  const isDev = process.env.NODE_ENV === 'development';

  // If password not configured, block in prod/preview; allow in dev to avoid local lockout
  if (!SITE_PASSWORD) {
    if (isDev) return NextResponse.next();
    return new NextResponse('SITE_PASSWORD not configured', { status: 500 });
  }

  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Basic ')) {
    return unauthorized();
  }

  try {
    const base64 = auth.slice(6).trim();
    const decoded = atob(base64);
    const idx = decoded.indexOf(':');
    const user = idx >= 0 ? decoded.slice(0, idx) : '';
    const pass = idx >= 0 ? decoded.slice(idx + 1) : '';

    if (!pass || pass !== SITE_PASSWORD) return unauthorized();
    if (SITE_USER && user !== SITE_USER) return unauthorized();

    // OK
    return NextResponse.next();
  } catch {
    return unauthorized();
  }
}

// Protect everything except static assets and common public files
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|assets|fonts|icon\\.png|apple-touch-icon\\.png).*)',
  ],
};
