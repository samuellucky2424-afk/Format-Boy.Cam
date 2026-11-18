import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { observeAuthSession } from '../src/lib/auth-session.ts';

const savedSession: Session = {
  access_token: 'fixture-access',
  refresh_token: 'fixture-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: 'fixture-user', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
};

type SessionAuth = Parameters<typeof observeAuthSession>[0];

function fixture(getSession: SessionAuth['getSession']) {
  let callback: Parameters<SessionAuth['onAuthStateChange']>[0] | undefined;
  const auth = {
    getSession,
    onAuthStateChange: (listener: NonNullable<typeof callback>) => {
      callback = listener;
      return { data: { subscription: { id: 'fixture', callback: listener, unsubscribe: () => { callback = undefined; } } } };
    },
  };
  return {
    auth,
    emit: (event: AuthChangeEvent, session: Session | null) => { void callback?.(event, session); },
  };
}

test('restores a saved session without publishing a signed-out state while waiting', async () => {
  let finish!: (value: Awaited<ReturnType<SessionAuth['getSession']>>) => void;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const states: (Session | null)[] = [];
  const stop = observeAuthSession(f.auth, (session) => states.push(session), () => assert.fail('unexpected retry'));
  try {
    f.emit('INITIAL_SESSION', null);
    assert.deepEqual(states, []);
    finish({ data: { session: savedSession }, error: null });
    await Promise.resolve();
    assert.deepEqual(states, [savedSession]);
  } finally {
    stop();
  }
});

test('retries a temporary refresh error and restores the same session', async () => {
  let reads = 0;
  let retries = 0;
  const f = fixture(async () => ++reads === 1
    ? { data: { session: null }, error: new AuthRetryableFetchError('offline', 0) }
    : { data: { session: savedSession }, error: null });
  const { promise, resolve } = Promise.withResolvers<Session | null>();
  const stop = observeAuthSession(f.auth, resolve, () => { retries++; }, 0);
  try {
    assert.equal(await promise, savedSession);
    assert.equal(retries, 1);
  } finally {
    stop();
  }
});

test('sign-out wins over a late startup read and a token refresh keeps the same profile', async () => {
  let finish!: (value: Awaited<ReturnType<SessionAuth['getSession']>>) => void;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const states: (Session | null)[] = [];
  const stop = observeAuthSession(f.auth, (session) => states.push(session), () => assert.fail('unexpected retry'));
  try {
    f.emit('SIGNED_IN', savedSession);
    f.emit('TOKEN_REFRESHED', { ...savedSession, access_token: 'fixture-renewed' });
    f.emit('SIGNED_OUT', null);
    finish({ data: { session: savedSession }, error: null });
    await Promise.resolve();
    assert.deepEqual(states, [savedSession, null]);
  } finally {
    stop();
  }
});

test('a successful startup read with no saved session shows sign-in', async () => {
  const f = fixture(async () => ({ data: { session: null }, error: null }));
  const { promise, resolve } = Promise.withResolvers<Session | null>();
  const stop = observeAuthSession(f.auth, resolve, () => assert.fail('unexpected retry'));
  try {
    assert.equal(await promise, null);
  } finally {
    stop();
  }
});
