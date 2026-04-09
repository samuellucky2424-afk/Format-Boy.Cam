function normalizeApiBase(value?: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  return trimmed.replace(/\/api$/i, '') || null;
}

function getApiBase(): string {
  const configuredBase = normalizeApiBase(import.meta.env.VITE_API_BASE_URL);
  return configuredBase ? `${configuredBase}/api` : '/api';
}

function withLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const normalizedPath = withLeadingSlash(path);
  const apiBase = getApiBase();
  return fetch(`${apiBase}${normalizedPath}`, init);
}
