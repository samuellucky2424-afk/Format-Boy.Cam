import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/lib/routes';
import { buildAuthCallbackUrl } from '@/lib/auth';
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
  isAdmin?: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  register: (email: string, name: string, password: string) => Promise<RegistrationResult>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

interface RegistrationResult {
  requiresEmailConfirmation: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
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
    // Check active session on mount
    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      try {
        if (currentSession?.user) {
          const built = await buildUser(currentSession.user, currentSession);
          setUser(built);
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error('Error building user on mount:', err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }).catch((err) => {
      console.error('getSession failed:', err);
      setUser(null);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, currentSession) => {
        if (!currentSession?.user) {
          setUser(null);
          setLoading(false);
          return;
        }

        // Deduplicate: only call resolve-user once per access token
        const tokenKey = currentSession.access_token;
        if (resolvingSessionRef.current === tokenKey) return;
        resolvingSessionRef.current = tokenKey;

        // Supabase warns against awaiting more Supabase calls inside this
        // callback because the auth client still holds its internal lock. Run
        // profile resolution on the next task so signInWithPassword can finish.
        window.setTimeout(() => {
          void (async () => {
            try {
              const built = await buildUser(currentSession.user, currentSession);
              setUser(built);
            } catch (err) {
              console.error('Error building user on auth change:', err);
              setUser(null);
            } finally {
              if (resolvingSessionRef.current === tokenKey) {
                resolvingSessionRef.current = null;
              }
              setLoading(false);
            }
          })();
        }, 0);
      }
    );

    const timeoutId = setTimeout(() => {
      setLoading(false);
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [buildUser]);

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
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
          emailRedirectTo: buildAuthCallbackUrl(),
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
        return { requiresEmailConfirmation: false };
      } else if (data.user) {
        // Email confirmation is required
        setError(null);
        return { requiresEmailConfirmation: true };
      }

      throw new Error('Registration succeeded without creating a user');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: buildAuthCallbackUrl(),
          skipBrowserRedirect: true,
        },
      });
      if (authError) throw authError;
      if (!data.url) throw new Error('Google authentication returned no authorization URL');

      const bridge = window as Window & {
        require?: (id: string) => {
          ipcRenderer?: { invoke: (channel: string, value: string) => Promise<unknown> };
        };
      };
      const ipcRenderer = bridge.require?.('electron')?.ipcRenderer;
      if (ipcRenderer) {
        await ipcRenderer.invoke('open-auth-link', data.url);
      } else {
        window.location.assign(data.url);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Google authentication failed';
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
      loginWithGoogle,
      logout,
      register,
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
