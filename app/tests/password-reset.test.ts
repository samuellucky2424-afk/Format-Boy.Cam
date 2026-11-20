import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNT_NEUTRAL_MESSAGE,
  accountNeutralMessage,
  clearRecoverySession,
  CODE_FORMAT_MESSAGE,
  CODE_REJECTED_MESSAGE,
  EMAIL_FORMAT_MESSAGE,
  mapPasswordResetError,
  normalizeResetCode,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MISMATCH_MESSAGE,
  requestPasswordResetCode,
  RESEND_COOLDOWN_SECONDS,
  retryAfterSeconds,
  updatePasswordAfterRecovery,
  verifyPasswordResetCode,
  type PasswordResetAuth,
  type PasswordResetError,
} from '../src/lib/password-reset.ts';

const session = { access_token: 'recovery-access' };

function auth(overrides: Partial<PasswordResetAuth> = {}): PasswordResetAuth & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    resetPasswordForEmail: async (email) => {
      calls.push(`reset:${email}`);
      return { data: {}, error: null };
    },
    verifyOtp: async (params) => {
      calls.push(`verify:${params.email}:${params.token}:${params.type}`);
      return { data: { session }, error: null };
    },
    updateUser: async (attributes) => {
      calls.push(`update:${attributes.password}`);
      return { data: { user: { id: 'user' } }, error: null };
    },
    signOut: async (options) => {
      calls.push(`signout:${options?.scope}`);
      return { error: null };
    },
    ...overrides,
  };
}

test('recovery request, code check, and password update use the email OTP', async () => {
  const client = auth();
  assert.deepEqual(await requestPasswordResetCode(client, '  Person@Example.com '), { ok: true });
  assert.deepEqual(await verifyPasswordResetCode(client, 'Person@Example.com', '12 34-56'), { ok: true });
  assert.deepEqual(await updatePasswordAfterRecovery(client, 'new-secret', 'new-secret'), { ok: true });
  assert.deepEqual(client.calls, [
    'reset:person@example.com',
    'verify:person@example.com:123456:recovery',
    'update:new-secret',
  ]);
});

test('an unknown email looks the same as a successful code request', async () => {
  const missing = auth({
    resetPasswordForEmail: async () => ({
      data: null,
      error: { code: 'user_not_found', message: 'User not found', status: 400 },
    }),
  });
  const sent = auth();
  assert.deepEqual(await requestPasswordResetCode(missing, 'missing@example.com'), { ok: true });
  assert.deepEqual(await requestPasswordResetCode(sent, 'missing@example.com'), { ok: true });
  assert.equal(accountNeutralMessage('missing@example.com'), ACCOUNT_NEUTRAL_MESSAGE.replace('that email', 'missing@example.com'));
  assert.doesNotMatch(accountNeutralMessage('missing@example.com'), /not found|does not exist|no account/i);
});

test('wrong, expired, and over-attempted codes have distinct messages', async () => {
  const wrong = auth({
    verifyOtp: async () => ({
      data: { session: null },
      error: { code: 'otp_expired', message: 'Token has expired or is invalid', status: 403 },
    }),
  });
  const limited = auth({
    verifyOtp: async () => ({
      data: { session: null },
      error: { code: 'over_request_rate_limit', message: 'Request rate limit reached', status: 429 },
    }),
  });

  const wrongResult = await verifyPasswordResetCode(wrong, 'person@example.com', '000000');
  const limitedResult = await verifyPasswordResetCode(limited, 'person@example.com', '000000');
  assert.equal(wrongResult.ok, false);
  assert.equal(limitedResult.ok, false);
  if (!wrongResult.ok && !limitedResult.ok) {
    assert.equal(wrongResult.message, CODE_REJECTED_MESSAGE);
    assert.match(limitedResult.message, /Too many attempts/);
    assert.doesNotMatch(`${wrongResult.message} ${limitedResult.message}`, /supabase|morphly/i);
  }
});

test('a code request that is too soon reports the server wait and keeps the account private', () => {
  const error: PasswordResetError = {
    status: 429,
    message: 'For security purposes, you can only request this after 42 seconds.',
  };
  const mapped = mapPasswordResetError(error, 'request');
  assert.equal(mapped.concealAccount, false);
  assert.equal(retryAfterSeconds(error), 42);
  assert.equal(mapped.message, 'Too many attempts. Wait 42 seconds and try again.');
  assert.equal(RESEND_COOLDOWN_SECONDS, 60);
});

test('provider errors are rewritten and a missing session does not change the password', async () => {
  const mapped = mapPasswordResetError(new Error('Supabase exploded while talking to Morphly'), 'verify');
  assert.equal(mapped.concealAccount, false);
  assert.doesNotMatch(mapped.message, /supabase|morphly/i);

  const client = auth({
    verifyOtp: async () => ({ data: { session: null }, error: null }),
  });
  const result = await verifyPasswordResetCode(client, 'person@example.com', '123456');
  assert.deepEqual(result, { ok: false, message: CODE_REJECTED_MESSAGE, retryAfterSeconds: null });
  assert.deepEqual(client.calls, []);
});

test('password rules are checked before the account is updated', async () => {
  const client = auth();
  const short = await updatePasswordAfterRecovery(client, 'short', 'short');
  const mismatch = await updatePasswordAfterRecovery(client, 'long-enough', 'different');
  assert.equal(short.ok, false);
  assert.equal(mismatch.ok, false);
  if (!short.ok && !mismatch.ok) {
    assert.match(short.message, new RegExp(`${PASSWORD_MIN_LENGTH}`));
    assert.equal(mismatch.message, PASSWORD_MISMATCH_MESSAGE);
  }
  assert.deepEqual(client.calls, []);
  assert.equal(normalizeResetCode('12a34'), '1234');
  assert.deepEqual(await requestPasswordResetCode(client, 'not-an-email'), {
    ok: false,
    message: EMAIL_FORMAT_MESSAGE,
    retryAfterSeconds: null,
  });
  assert.deepEqual(await verifyPasswordResetCode(client, 'person@example.com', '12345'), {
    ok: false,
    message: CODE_FORMAT_MESSAGE,
    retryAfterSeconds: null,
  });
});

test('the same password and a weak password stay understandable', () => {
  assert.equal(
    mapPasswordResetError({ code: 'same_password', message: 'New password should be different from the old password.' }, 'update').message,
    'Choose a different password than your current one.',
  );
  assert.match(
    mapPasswordResetError({ code: 'weak_password', message: 'Password is known to be weak and easy to guess' }, 'update').message,
    /stronger password/,
  );
  assert.equal(
    mapPasswordResetError({ message: 'Password should be at least 8 characters' }, 'update').message,
    'Password must be at least 8 characters.',
  );
  assert.equal(
    mapPasswordResetError({ message: 'Auth session missing!', status: 400 }, 'update').message,
    'Your reset session expired. Request a new code and try again.',
  );
});

test('clearing the recovery session is local and ignores cleanup failures', async () => {
  const client = auth();
  await clearRecoverySession(client);
  assert.deepEqual(client.calls, ['signout:local']);

  const broken = auth({
    signOut: async () => {
      throw new Error('offline');
    },
  });
  await clearRecoverySession(broken);
});
