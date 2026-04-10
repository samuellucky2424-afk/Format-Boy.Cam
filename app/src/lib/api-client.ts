function normalizeApiBase(value?: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  return trimmed.replace(/\/api$/i, '') || null;
}

function getApiBase(): string {
  // In development, use relative path so Vite's dev proxy handles it.
  // In production (or Electron), use the full configured URL.
  if (import.meta.env.DEV) {
    return '/api';
  }

  const configuredBase = normalizeApiBase(import.meta.env.VITE_API_BASE_URL);
  return configuredBase ? `${configuredBase}/api` : '/api';
}

function withLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
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
  const normalizedPath = withLeadingSlash(path);
  const apiBase = getApiBase();
  const url = `${apiBase}${normalizedPath}`;
  const { retries, timeoutMs: customTimeoutMs, signal, ...fetchInit } = init ?? {};
  const maxRetries = retries ?? MAX_RETRIES;
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
      const response = await fetch(url, {
        ...fetchInit,
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
