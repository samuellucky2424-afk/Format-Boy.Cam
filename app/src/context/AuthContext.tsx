import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/lib/routes';
import { buildGoogleCallbackPath, buildHashRouteUrl, GOOGLE_AUTH_MESSAGE_TYPE, normalizeRedirectPath } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * `id`     — the CANONICAL user ID (oldest account for this email).
 *            Use this for every API call (credits, sessions, payments, etc.).
 * `authId` — the actual Supabase auth.users ID for the current session.
 *            May differ from `id` when the user signed in with a provider
 *            (e.g. Google) that created a duplicate account.
 */
interface User {
  id: string;
  authId: string;
  name: string;
  email: string;
  avatar?: string;
  createdAt?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  register: (email: string, name: string, password: string) => Promise<void>;
  signInWithGoogle: (redirectPath?: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const GOOGLE_AUTH_POPUP_NAME = 'format-boy-google-auth';
const GOOGLE_AUTH_POPUP_WIDTH = 520;
const GOOGLE_AUTH_POPUP_HEIGHT = 720;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect if running inside Electron */
function isElectron(): boolean {
  return typeof (window as any).require !== 'undefined';
}

function openCenteredPopup(): Window | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const left = Math.max(0, window.screenX + Math.round((window.outerWidth - GOOGLE_AUTH_POPUP_WIDTH) / 2));
  const top = Math.max(0, window.screenY + Math.round((window.outerHeight - GOOGLE_AUTH_POPUP_HEIGHT) / 2));
  const features = [
    `width=${GOOGLE_AUTH_POPUP_WIDTH}`,
    `height=${GOOGLE_AUTH_POPUP_HEIGHT}`,
    `left=${left}`,
    `top=${top}`,
    'popup=yes',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');

  return window.open('', GOOGLE_AUTH_POPUP_NAME, features);
}

function renderPopupLoadingState(popup: Window): void {
  try {
    popup.document.title = 'Continue with Google';
    popup.document.body.innerHTML = `
      <div style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111827;color:#f9fafb;font-family:Arial,sans-serif;">
        <div style="text-align:center;padding:24px;">
          <div style="font-size:16px;font-weight:600;margin-bottom:8px;">Connecting to Google</div>
          <div style="font-size:13px;color:#9ca3af;">Please finish sign in in this popup.</div>
        </div>
      </div>
    `;
  } catch {
    // Ignore popup document write failures and continue with auth redirect.
  }
}

function getApiBase(): string {
  if (import.meta.env.DEV) return '/api';
  const base = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  return base ? `${base}/api` : '/api';
}

/**
 * Calls the backend resolve-user endpoint and returns the canonical user ID.
 * Falls back to `fallbackId` on any error so the app keeps functioning.
 */
async function resolveCanonicalUserId(session: Session, fallbackId: string): Promise<string> {
  try {
    const res = await fetch(`${getApiBase()}/auth/resolve-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn('[AuthContext] resolve-user returned', res.status);
      return fallbackId;
    }

    const json = await res.json();
    const canonical = json?.canonicalUserId;

    if (typeof canonical === 'string' && canonical.length > 0) {
      if (canonical !== fallbackId) {
        console.log(`[AuthContext] Identity linked: ${fallbackId} → ${canonical}`);
      }
      return canonical;
    }

    return fallbackId;
  } catch (err) {
    console.warn('[AuthContext] resolve-user failed (non-fatal):', err);
    return fallbackId;
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Guard against running resolve-user concurrently for the same session.
  const resolvingSessionRef = useRef<string | null>(null);

  /** Build a User from a Supabase session, resolving canonical ID on the backend. */
  const buildUser = useCallback(async (su: SupabaseUser, session: Session): Promise<User> => {
    const authId = su.id;
    const canonicalId = await resolveCanonicalUserId(session, authId);

    return {
      id: canonicalId,
      authId,
      name: su.user_metadata?.name || su.user_metadata?.full_name || su.email?.split('@')[0] || 'User',
      email: su.email || '',
      avatar: su.user_metadata?.avatar_url || su.user_metadata?.picture,
      createdAt: su.created_at,
    };
  }, []);

  useEffect(() => {
    // Check active session on mount
    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      if (currentSession?.user) {
        const built = await buildUser(currentSession.user, currentSession);
        setUser(built);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, currentSession) => {
        if (!currentSession?.user) {
          setUser(null);
          setLoading(false);
          return;
        }

        // Deduplicate: only call resolve-user once per access token
        const tokenKey = currentSession.access_token;
        if (resolvingSessionRef.current === tokenKey) return;
        resolvingSessionRef.current = tokenKey;

        try {
          const built = await buildUser(currentSession.user, currentSession);
          setUser(built);
        } finally {
          // Allow re-resolution if the token changes later
          if (resolvingSessionRef.current === tokenKey) {
            resolvingSessionRef.current = null;
          }
          setLoading(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [buildUser]);

  // Electron deep-link OAuth callback handler
  useEffect(() => {
    if (!isElectron()) return;

    try {
      const { ipcRenderer } = (window as any).require('electron');
      const handler = (_event: any, url: string) => {
        if (!url || !url.startsWith('formatboy://')) return;

        // Parse the deep link: formatboy://auth/callback?code=XXX&next=/dashboard
        try {
          const parsed = new URL(url.replace('formatboy://', 'https://localhost/'));
          const code = parsed.searchParams.get('code');
          const nextPath = normalizeRedirectPath(parsed.searchParams.get('next'));

          if (code) {
            supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
              if (exchangeError) {
                setError(exchangeError.message || 'Google sign-in failed');
              } else {
                navigate(nextPath, { replace: true });
              }
            });
          }
        } catch (parseErr) {
          console.error('Failed to parse OAuth deep link:', parseErr);
        }
      };

      ipcRenderer.on('oauth-callback', handler);
      return () => {
        ipcRenderer.removeListener('oauth-callback', handler);
      };
    } catch {
      // Not in Electron or ipcRenderer not available
    }
  }, [navigate]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw authError;
      }

      navigate(ROUTES.DEFAULT, { replace: true });
    } catch (err: any) {
      const message = err.message || 'Login failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, name: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      if (name.trim().length < 2) {
        throw new Error('Name must be at least 2 characters');
      }

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: name.trim(),
          },
          emailRedirectTo: buildHashRouteUrl(ROUTES.PUBLIC.LOGIN),
        }
      });

      if (authError) {
        throw authError;
      }

      // If user is created and confirmed (no email confirmation required), auto sign in
      if (data.user && data.user.confirmed_at) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          throw signInError;
        }

        navigate(ROUTES.DEFAULT, { replace: true });
      } else if (data.user) {
        // Email confirmation is required
        setError(null);
        navigate(ROUTES.DEFAULT, { replace: true });
      }
    } catch (err: any) {
      const message = err.message || 'Registration failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async (redirectPath: string = ROUTES.DEFAULT) => {
    setLoading(true);
    setError(null);

    // In Electron, use the system browser + deep link instead of popup
    if (isElectron()) {
      try {
        const { ipcRenderer } = (window as any).require('electron');

        const webCallbackUrl = (import.meta.env.VITE_API_BASE_URL || '')
          .replace(/\/api\/?$/i, '') + '/#/auth/callback?next=' + encodeURIComponent(redirectPath) + '&auth=deeplink';

        const { data, error: authError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: webCallbackUrl,
            queryParams: {
              access_type: 'offline',
              prompt: 'consent',
            },
            skipBrowserRedirect: true,
          },
        });

        if (authError) throw authError;

        if (!data?.url) {
          throw new Error('Google OAuth did not return a redirect URL.');
        }

        ipcRenderer.send('open-auth-popup', data.url);
      } catch (err: any) {
        const message = err.message || 'Google sign in failed';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
      return;
    }

    // Web: use popup flow
    const popup = openCenteredPopup();
    const callbackUrl = buildHashRouteUrl(buildGoogleCallbackPath(redirectPath, true));

    try {
      if (!popup) {
        throw new Error('Google sign-in popup was blocked. Please allow popups and try again.');
      }

      renderPopupLoadingState(popup);

      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
          skipBrowserRedirect: true,
        },
      });

      if (authError) {
        throw authError;
      }

      if (!data?.url) {
        throw new Error(
          `Google OAuth did not return a redirect URL. Confirm ${callbackUrl} is allowed in Supabase Auth URL Configuration and your Supabase callback URL is configured in Google Cloud.`
        );
      }

      popup.location.href = data.url;
      popup.focus();
    } catch (err: any) {
      popup?.close();
      const message = err.message || 'Google sign in failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = useCallback(async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
      setUser(null);
      setError(null);
      navigate(ROUTES.PUBLIC.LOGIN, { replace: true });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      login,
      logout,
      register,
      signInWithGoogle,
      loading,
      error,
      clearError
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
