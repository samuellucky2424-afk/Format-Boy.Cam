import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/lib/routes';
import { buildElectronCallbackUrl, buildGoogleCallbackPath, buildHashRouteUrl, normalizeRedirectPath } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { observeAuthSession } from '@/lib/auth-session';
import { toast } from 'sonner';
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
  isAdmin?: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  signInWithGoogle: (redirectPath?: string) => Promise<void>;
  loading: boolean;
  retryingSession: boolean;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const GOOGLE_AUTH_POPUP_NAME = 'format-boy-google-auth';
const GOOGLE_AUTH_POPUP_WIDTH = 520;
const GOOGLE_AUTH_POPUP_HEIGHT = 720;
const AUTH_REQUEST_TIMEOUT_MS = 20_000;
const PROFILE_REQUEST_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect if running inside Electron */
function isElectron(): boolean {
  if (typeof window === 'undefined') return false;

  return Boolean(
    (window as any).process?.versions?.electron ||
    navigator.userAgent.includes('Electron')
  );
}

function parseOAuthCallbackUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    try {
      return new URL(url.replace('formatboy://', 'https://localhost/'));
    } catch {
      return null;
    }
  }
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
  const [retryingSession, setRetryingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  /** Build a User from a Supabase session, resolving canonical ID on the backend. */
  const buildUser = useCallback(async (su: SupabaseUser, session: Session): Promise<User> => {
    const authId = su.id;
    const canonicalId = await resolveCanonicalUserId(session, authId);

    let isAdmin = false;
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('users')
          .select('is_admin')
          .eq('id', canonicalId)
          .single(),
        PROFILE_REQUEST_TIMEOUT_MS,
        'Timed out while checking administrator access',
      );
      
      if (!error && data) {
        isAdmin = data.is_admin;
      }
    } catch (e) {
      console.warn('Failed to fetch is_admin:', e);
    }

    return {
      id: canonicalId,
      authId,
      name: su.user_metadata?.name || su.user_metadata?.full_name || su.email?.split('@')[0] || 'User',
      email: su.email || '',
      avatar: su.user_metadata?.avatar_url || su.user_metadata?.picture,
      createdAt: su.created_at,
      isAdmin,
    };
  }, []);

  useEffect(() => {
    let generation = 0;
    let profileTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = observeAuthSession(supabase.auth, (session) => {
      const currentGeneration = ++generation;
      clearTimeout(profileTimer);
      setRetryingSession(false);

      if (!session) {
        setUser(null);
        setLoading(false);
        return;
      }

      // The SDK holds its auth lock while delivering events. Profile requests
      // must run after the callback has returned.
      const loadProfile = () => {
        void buildUser(session.user, session).then((built) => {
          if (generation !== currentGeneration) return;
          setUser(built);
          setRetryingSession(false);
          setLoading(false);
        }).catch((err) => {
          console.error('Could not load the signed-in profile:', err);
          if (generation !== currentGeneration) return;
          setRetryingSession(true);
          profileTimer = setTimeout(loadProfile, 5000);
        });
      };
      profileTimer = setTimeout(loadProfile, 0);
    }, () => setRetryingSession(true));

    return () => {
      generation++;
      clearTimeout(profileTimer);
      unsubscribe();
    };
  }, [buildUser]);

  // Electron deep-link OAuth callback handler
  useEffect(() => {
    if (!isElectron()) return;

    try {
      const { ipcRenderer } = (window as any).require('electron');
      const handler = (_event: any, url: string) => {
        if (!url) return;

        const parsed = parseOAuthCallbackUrl(url);
        if (!parsed) return;

        const code = parsed.searchParams.get('code');
        const nextPath = normalizeRedirectPath(parsed.searchParams.get('next'));
        const oauthError = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');

        if (oauthError) {
          setError(oauthError);
          return;
        }

        if (!code) return;

        supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
          if (exchangeError) {
            setError(exchangeError.message || 'Google sign-in failed');
          } else {
            navigate(nextPath, { replace: true });
          }
        });
      };

      ipcRenderer.on('oauth-callback', handler);
      ipcRenderer.send('oauth-callback-ready');
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
      const { data, error: authError } = await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        AUTH_REQUEST_TIMEOUT_MS,
        'Login timed out. Check your internet connection and try again.',
      );

      if (authError) {
        throw authError;
      }

      if (!data.user || !data.session) {
        throw new Error('Login succeeded without an active session');
      }

      // Populate auth context before navigating. AdminDashboard reads this state
      // immediately and would otherwise redirect while the auth listener is still
      // resolving the user. buildUser also handles canonical IDs consistently.
      const authenticatedUser = await buildUser(data.user, data.session);
      setUser(authenticatedUser);

      navigate(
        authenticatedUser.isAdmin ? ROUTES.PROTECTED.ADMIN_DASHBOARD : ROUTES.DEFAULT,
        { replace: true },
      );
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

    // In Electron, use the native auth popup and hand the callback back into the app.
    if (isElectron()) {
      try {
        const { ipcRenderer } = (window as any).require('electron');

        const callbackUrl = buildElectronCallbackUrl(redirectPath);

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
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      setUser(null);
      setError(null);
      navigate(ROUTES.PUBLIC.LOGIN, { replace: true });
    } catch (err) {
      console.error('Logout error:', err);
      toast.error('Could not sign out. Check your connection and try again.');
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
      retryingSession,
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
