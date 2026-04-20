import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session — IMPORTANT for auth to work
  const { data: { user } } = await supabase.auth.getUser();

  // If request is on reasonqa.io domain, redirect root to /reasonqa
  const host = request.headers.get('host') || '';
  const isReasonQADomain = host.includes('reasonqa.io');
  if (isReasonQADomain && request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/reasonqa';
    // Copy session cookies onto the redirect so they aren't lost
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach(c => redirect.cookies.set(c));
    return redirect;
  }

  // After login on reasonqa.io, redirect to /reasonqa/dashboard instead of Jasper home
  if (isReasonQADomain && request.nextUrl.pathname === '/login' && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/reasonqa/dashboard';
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach(c => redirect.cookies.set(c));
    return redirect;
  }

  // Redirect unauthenticated users to login (except for auth routes and static assets)
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/auth') ||
    request.nextUrl.pathname.startsWith('/welcome') ||
    request.nextUrl.pathname.startsWith('/privacy') ||
    request.nextUrl.pathname === '/reasonqa' ||
    request.nextUrl.pathname === '/reasonqa/pricing' ||
    request.nextUrl.pathname === '/reasonqa/terms' ||
    request.nextUrl.pathname === '/reasonqa/privacy' ||
    request.nextUrl.pathname === '/reasonqa/security';
  const isApiRoute = request.nextUrl.pathname.startsWith('/api');

  if (!user && !isAuthRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach(c => redirect.cookies.set(c));
    return redirect;
  }

  return supabaseResponse;
}
