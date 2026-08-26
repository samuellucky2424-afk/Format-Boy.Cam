// The Reactor API the SDK talks to. The browser-side X2Provider and the
// server-side token mint (/api/reactor-token) must both point at the same
// environment — a JWT minted against one environment is not valid on another.
export const REACTOR_API_URL =
  (import.meta.env.VITE_REACTOR_API_URL as string | undefined) || 'https://api.reactor.inc';

export const REACTOR_DASHBOARD_URL =
  (import.meta.env.VITE_REACTOR_DASHBOARD_URL as string | undefined) ||
  'https://www.reactor.inc/dashboard';
