import { ROUTES } from '@/lib/routes';

function isElectronRenderer(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const bridge = window as Window & { require?: (id: string) => unknown };
    return Boolean(bridge.require?.('electron'));
  } catch {
    return false;
  }
}

export function buildAuthCallbackUrl(): string {
  if (typeof window === 'undefined') {
    return ROUTES.PUBLIC.AUTH_CALLBACK;
  }

  if (isElectronRenderer()) {
    return 'henshin://auth-callback';
  }

  return `${window.location.origin}${ROUTES.PUBLIC.AUTH_CALLBACK}`;
}

export function normalizeWebAuthCallbackLocation(): void {
  if (typeof window === 'undefined' || window.location.pathname !== ROUTES.PUBLIC.AUTH_CALLBACK) {
    return;
  }

  const callbackRoute = `/#${ROUTES.PUBLIC.AUTH_CALLBACK}${window.location.search}`;
  window.history.replaceState(null, '', callbackRoute);
}

export function normalizeRedirectPath(path?: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) {
    return ROUTES.DEFAULT;
  }

  return path;
}
