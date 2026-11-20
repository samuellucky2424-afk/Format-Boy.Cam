import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PasswordResetAuth } from '@/lib/password-reset';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.invalid';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'public-placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    flowType: 'pkce',
    detectSessionInUrl: false,
  },
});

/**
 * Separate auth client for the email-code password reset.
 * The recovery session stays in memory so the sign-in screen is not
 * redirected away before the new password is saved.
 */
let passwordResetClient: SupabaseClient | null = null;

function createMemoryAuthStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

export function getPasswordResetAuth(): PasswordResetAuth {
  if (!passwordResetClient) {
    passwordResetClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'pkce',
        storage: createMemoryAuthStorage(),
        storageKey: 'call-me-password-reset',
      },
    });
  }

  const auth = passwordResetClient.auth;
  return {
    resetPasswordForEmail: (email) => auth.resetPasswordForEmail(email),
    verifyOtp: (params) => auth.verifyOtp(params),
    updateUser: (attributes) => auth.updateUser(attributes),
    signOut: (options) => auth.signOut(options),
  };
}
