import { ROUTES } from '@/lib/routes';

export const GOOGLE_AUTH_MESSAGE_TYPE = 'format-boy-google-auth-complete';

export function buildHashRouteUrl(path: string): string {
  if (typeof window === 'undefined') {
    return path;
  }

  return `${window.location.origin}${window.location.pathname}#${path}`;
}

export function normalizeRedirectPath(path?: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) {
    return ROUTES.DEFAULT;
  }

  return path;
}

export function buildGoogleCallbackPath(nextPath: string = ROUTES.DEFAULT, popup = false): string {
  const params = new URLSearchParams({
    next: normalizeRedirectPath(nextPath),
  });

  if (popup) {
    params.set('auth', 'popup');
  }

  return `${ROUTES.PUBLIC.AUTH_CALLBACK}?${params.toString()}`;
}

export function buildElectronCallbackUrl(nextPath: string = ROUTES.DEFAULT): string {
  const params = new URLSearchParams({
    next: normalizeRedirectPath(nextPath),
  });

  return `formatboy://auth/callback?${params.toString()}`;
}
