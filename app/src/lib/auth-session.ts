import type { Session, SupabaseClient } from '@supabase/supabase-js';

type SessionAuth = Pick<SupabaseClient['auth'], 'getSession' | 'onAuthStateChange'>;

export function observeAuthSession(
  auth: SessionAuth,
  onSession: (session: Session | null) => void,
  onRetry: () => void,
  retryDelayMs = 5000,
) {
  let stopped = false;
  let restoring = true;
  let userId: string | null | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const publish = (session: Session | null, profileChanged = false) => {
    restoring = false;
    clearTimeout(retryTimer);
    const nextUserId = session?.user.id ?? null;
    if (nextUserId === userId && !profileChanged) return;
    userId = nextUserId;
    onSession(session);
  };

  const restore = async () => {
    try {
      const { data, error } = await auth.getSession();
      if (!restoring || stopped) return;
      if (error) throw error;
      publish(data.session);
    } catch {
      if (!restoring || stopped) return;
      onRetry();
      retryTimer = setTimeout(() => { void restore(); }, retryDelayMs);
    }
  };

  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    // INITIAL_SESSION can supply null on a failed refresh. getSession exposes
    // the actual error so we can retry without sending the user to sign-in.
    if (stopped || event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_OUT') publish(null);
    else if (session) publish(session, event === 'USER_UPDATED');
  });

  void restore();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    subscription.unsubscribe();
  };
}
