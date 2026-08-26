// Cached fetcher for the server-minted Reactor session JWT (/api/reactor-token).
// The token lives in memory only; it is reminted when close to expiry or when
// a provider error invalidates it.

import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-client';

let cache: { jwt: string; expiresAtMs: number } | null = null;

function jwtExpMs(jwt: string): number | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    /* unauthenticated — server decides */
  }
  return {};
}

export function invalidateReactorTokenCache(): void {
  cache = null;
}

export async function fetchReactorToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAtMs - 60_000 > now) return cache.jwt;

  const headers = await authHeader();
  const r = await apiFetch('/reactor-token', {
    cache: 'no-store',
    headers,
    retries: 0,
    timeoutMs: 30_000,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Token fetch failed: ${r.status}`);
  }
  const { jwt } = (await r.json()) as { jwt: string };
  if (!jwt) throw new Error('Token fetch returned an empty JWT');
  cache = {
    jwt,
    expiresAtMs: jwtExpMs(jwt) ?? now + 50 * 60 * 1000,
  };
  return jwt;
}
