export const ROUTES = {
  PUBLIC: {
    LOGIN: '/login',
    SIGNUP: '/signup',
  },
  PROTECTED: {
    DASHBOARD: '/dashboard',
    WALLET: '/wallet',
    SUBSCRIPTION: '/subscription',
    SETTINGS: '/settings',
  },
  DEFAULT: '/dashboard',
} as const;

export const PUBLIC_ROUTES = Object.values(ROUTES.PUBLIC);
export const PROTECTED_ROUTES = Object.values(ROUTES.PROTECTED);
export const ALL_ROUTES = [...PUBLIC_ROUTES, ...PROTECTED_ROUTES];
