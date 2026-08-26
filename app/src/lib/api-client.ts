function normalizeApiBase(value?: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  return trimmed.replace(/\/api$/i, '') || null;
}

function getApiBase(): string {
  // During development, keep browser requests on the page's current origin.
  // Vite can proxy /api when it runs alone, while `vercel dev` serves the
  // functions directly. This also avoids localhost/127.0.0.1 mismatches.
  if (import.meta.env.DEV) {
    return '/api';
  }

  const configuredBase = normalizeApiBase(import.meta.env.VITE_API_BASE_URL);
  if (configuredBase) {
    // If it's configured to localhost but we are in production, override it to Vercel.
    // This prevents the desktop app from being broken if VITE_API_BASE_URL was left as localhost.
    if (!import.meta.env.DEV && configuredBase.includes('localhost')) {
      return 'https://henshin.vercel.app/api';
    }
    return `${configuredBase}/api`;
  }

  // Fall back to the Vercel app in production if no explicit API base is configured.
  return import.meta.env.DEV ? '/api' : 'https://henshin.vercel.app/api';
}

function withLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function getApiUrl(path: string): string {
  return `${getApiBase()}${withLeadingSlash(path)}`;
}

const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000; // 1 second base delay

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ApiTimeoutError extends Error {
  timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'ApiTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && (error.name === 'AbortError' || error.message === 'signal is aborted without reason')) return true;
  return false;
}

export function isTimeoutError(error: unknown): error is ApiTimeoutError {
  return error instanceof ApiTimeoutError;
}

function forwardAbort(source: AbortSignal, controller: AbortController): () => void {
  if (source.aborted) {
    controller.abort(source.reason);
    return () => {};
  }

  const handleAbort = () => controller.abort(source.reason);
  source.addEventListener('abort', handleAbort, { once: true });

  return () => source.removeEventListener('abort', handleAbort);
}

export async function apiFetch(
  path: string,
  init?: RequestInit & { retries?: number; timeoutMs?: number },
): Promise<Response> {
  const url = getApiUrl(path);
  const { retries, timeoutMs: customTimeoutMs, signal, ...fetchInit } = init ?? {};
  const method = String(fetchInit.method || 'GET').toUpperCase();
  const maxRetries = retries ?? (method === 'GET' || method === 'HEAD' ? MAX_RETRIES : 0);
  const timeoutMs = customTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutError = new ApiTimeoutError(timeoutMs);
    let didTimeout = false;
    const clearExternalAbort = signal ? forwardAbort(signal, controller) : undefined;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort(timeoutError);
    }, timeoutMs);

    try {
      const headers = new Headers(fetchInit.headers);
      if (!headers.has('Authorization')) {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
      }

      const response = await fetch(url, {
        ...fetchInit,
        headers,
        signal: controller.signal,
      });
      return response;
    } catch (error: unknown) {
      const resolvedError = didTimeout ? timeoutError : error;
      lastError = resolvedError;

      // Don't retry if the caller explicitly aborted
      if (signal?.aborted) throw resolvedError;

      const isRetryable =
        error instanceof TypeError || // network error
        didTimeout;

      if (!isRetryable || attempt >= maxRetries) throw resolvedError;

      // Exponential backoff: 1s, 2s
      await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
    } finally {
      clearTimeout(timeoutId);
      clearExternalAbort?.();
    }
  }

  throw lastError;
}
import { supabase } from '@/lib/supabase';
