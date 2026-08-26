// Engine selection for live sessions.
//   "fast" — Reactor X2 (prioritized, default)
//   "pro"  — fal.ai Lucy 2.5 (license-gated)
export type LiveProvider = 'fast' | 'pro';

// v3 ignores legacy Morphly preferences so users cannot boot into PRO before
// the current account-bound entitlement has been checked.
const KEY = 'henshin.liveProvider.v3';

export const LIVE_PROVIDER_OPTIONS: { value: LiveProvider; label: string; hint: string }[] = [
  { value: 'fast', label: 'Fast', hint: 'Reactor X2' },
  { value: 'pro', label: 'PRO', hint: 'fal.ai Lucy 2.5' },
];

export const DEFAULT_LIVE_PROVIDER: LiveProvider = 'fast';

export function isLiveProvider(value: unknown): value is LiveProvider {
  return value === 'fast' || value === 'pro';
}

export function loadLiveProvider(): LiveProvider {
  if (typeof window === 'undefined') return DEFAULT_LIVE_PROVIDER;
  try {
    const raw = localStorage.getItem(KEY);
    return isLiveProvider(raw) ? raw : DEFAULT_LIVE_PROVIDER;
  } catch {
    return DEFAULT_LIVE_PROVIDER;
  }
}

export function saveLiveProvider(provider: LiveProvider): void {
  try {
    localStorage.setItem(KEY, provider);
  } catch {
    /* best effort */
  }
}
