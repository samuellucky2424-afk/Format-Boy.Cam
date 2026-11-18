import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import type { AuthError, Session } from '@supabase/supabase-js';
import { submitWithCheckoutSession } from '../src/lib/checkout-session.ts';

function fixture(statuses: number[], refreshedUserId = 'checkout-user', refreshError: AuthError | null = null) {
  const user = { id: 'checkout-user', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' };
  const session: Session = { user, access_token: 'stored', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600 };
  const tokens: string[] = [];
  let refreshes = 0;
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    refreshSession: async () => {
      refreshes++;
      if (refreshError) return { data: { user: null, session: null }, error: refreshError };
      const refreshedUser = { ...user, id: refreshedUserId };
      return { data: { user: refreshedUser, session: { ...session, user: refreshedUser, access_token: 'renewed' } }, error: null };
    },
  };
  const submit = async (token: string) => {
    tokens.push(token);
    const status = statuses.shift();
    assert.ok(status, 'unexpected checkout request');
    return new Response(null, { status });
  };
  return {
    run: () => submitWithCheckoutSession(auth, user.id, submit),
    tokens,
    refreshes: () => refreshes,
  };
}

test('checkout with a rejected token refreshes once and submits with the renewed token', async () => {
  const f = fixture([401, 201]);
  assert.equal((await f.run()).status, 201);
  assert.equal(f.refreshes(), 1);
  assert.deepEqual(f.tokens, ['stored', 'renewed']);
});

test('checkout does not resubmit after success, a server error, or a second auth rejection', async () => {
  for (const status of [201, 503]) {
    const f = fixture([status]);
    assert.equal((await f.run()).status, status);
    assert.equal(f.refreshes(), 0);
    assert.deepEqual(f.tokens, ['stored']);
  }

  const rejected = fixture([401, 401]);
  await assert.rejects(rejected.run(), /could not verify your renewed sign-in/);
  assert.equal(rejected.refreshes(), 1);
  assert.deepEqual(rejected.tokens, ['stored', 'renewed']);
});

test('checkout does not resubmit under a different user or after a temporary refresh failure', async () => {
  const changed = fixture([401], 'other-user');
  await assert.rejects(changed.run(), /Your account changed/);
  assert.deepEqual(changed.tokens, ['stored']);

  const unavailable = fixture([401], 'checkout-user', new AuthRetryableFetchError('offline', 0));
  await assert.rejects(unavailable.run(), /Could not verify your sign-in right now/);
  assert.deepEqual(unavailable.tokens, ['stored']);
});
