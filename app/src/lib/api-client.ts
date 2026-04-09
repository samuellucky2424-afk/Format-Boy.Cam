const DEPLOYED_APP_ORIGIN = 'https://morphly-alpha.vercel.app';
const LOCAL_API_BASE = '/api';

function normalizeApiBase(value?: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function getApiBase(): string {
  if (import.meta.env.DEV) {
    return LOCAL_API_BASE;
  }

  const configuredBase = normalizeApiBase(import.meta.env.VITE_API_URL);
  return configuredBase || `${DEPLOYED_APP_ORIGIN}/api`;
}

function withLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const normalizedPath = withLeadingSlash(path);
  const apiBase = getApiBase();
  return fetch(`${apiBase}${normalizedPath}`, init);
}
