import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { createMorphlySession, getRequestedDuration } from '../server/morphly-token.ts';
import { MorphlySessionOwner, morphlyDiagnostic, morphlyErrorMessage, readMorphlyBalance } from '../src/lib/morphly-session.ts';
import type { MorphlySession } from '../src/lib/morphly-session.ts';

const origin = 'http://localhost:5173';
const upstreamBody = { session_id: 'fixture-session', session_token: 'opaque-session', client_token: 'opaque-client', expires_at: 'later', model: 'morphly-realtime', max_session_seconds: 30, balance: { available_credits: 50, reserved_credits: 60 } };
function fixture(overrides: Record<string, unknown> = {}) {
  let fetches = 0;
  let forwarded: Record<string, unknown> | null = null;
  const activations: Record<string, unknown>[] = [];
  let activationError: { message: string } | null = null;
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'user@example.test', email_confirmed_at: 'verified' } } }),
      admin: { getUserById: async () => ({ data: { user: { id: 'canonical', email: 'user@example.test', email_confirmed_at: 'verified' } } }) } },
    from: () => {
      const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, maybeSingle: async () => ({ data: { id: 'app-session', metadata: { existing: true } } }),
        update: (value: Record<string, unknown>) => {
          activations.push(value);
          return { eq: () => ({ eq: async () => ({ error: activationError }) }) };
        } };
      return query;
    },
    rpc: async () => ({ data: true }),
  };
  const req = { method: 'POST', headers: { origin, authorization: 'Bearer fake-login' }, query: { userId: 'user-1' }, body: { model: 'lucy-2.5', origin, maxSessionSeconds: 30 } };
  const res = { statusCode: 0, body: null as unknown, headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this.headers[key] = value; },
    status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; }, end() { return this; } };
  const options = { admin, appOrigin: origin, desktopOrigin: '', morphlyApiKey: 'fake-server-key', getWallet: async () => ({ credits: 100 }),
    fetchImplementation: async (_url: string, init: RequestInit) => {
      fetches++;
      forwarded = JSON.parse(init.body as string);
      assert.equal(init.cache, 'no-store');
      assert.ok((init.headers as Record<string, string>)['idempotency-key']);
      return Response.json(upstreamBody, { status: 201 });
    }, ...overrides };
  return { req, res, options, admin, activations, failActivation: () => { activationError = { message: 'fixture failure' }; }, fetches: () => fetches, forwarded: () => forwarded };
}

test('proxy forwards full metered response, legacy model, exact origin and status without caching', async () => {
  const f = fixture();
  await handler(f.req, f.res, f.options);
  assert.equal(f.res.statusCode, 201);
  assert.deepEqual(f.res.body, upstreamBody);
  assert.deepEqual(f.forwarded(), { model: 'lucy-2.5', max_session_seconds: 30, origin });
  assert.equal(f.res.headers['Cache-Control'], 'no-store');
  assert.equal(f.res.headers['Access-Control-Allow-Origin'], origin);
});
test('new requests default to Morphly model; canonical caller identity remains accepted', async () => {
  const f = fixture();
  delete (f.req.body as { model?: string }).model;
  f.req.query.userId = 'canonical';
  await handler(f.req, f.res, f.options);
  assert.equal(f.res.statusCode, 201);
  assert.equal(f.forwarded()?.model, 'morphly-realtime');
});
test('app billing activates only after a successful Morphly credential response', async () => {
  const f = fixture();
  await handler(f.req, f.res, f.options);
  assert.equal(f.activations.length, 1);
  const metadata = f.activations[0].metadata as Record<string, unknown>;
  assert.equal(metadata.existing, true);
  assert.ok(Number.isFinite(Date.parse(String(metadata.realtime_credential_issued_at))));
  const rejected = fixture({ fetchImplementation: async () => Response.json({ code: 'INSUFFICIENT_CREDITS' }, { status: 402 }) });
  await handler(rejected.req, rejected.res, rejected.options);
  assert.equal(rejected.res.statusCode, 402);
  assert.equal(rejected.activations.length, 0);
});
test('app billing activation failure returns the existing safe failure code', async () => {
  const f = fixture(); f.failActivation();
  await handler(f.req, f.res, f.options);
  assert.equal(f.res.statusCode, 500);
  assert.deepEqual(f.res.body, { error: 'Could not prepare the realtime session.', code: 'SESSION_ACTIVATION_FAILED' });
});
test('missing login and foreign origin cannot create a Morphly session', async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.req.headers.authorization = ''; }, (f: ReturnType<typeof fixture>) => { f.req.headers.origin = 'https://attacker.test'; }, (f: ReturnType<typeof fixture>) => { f.req.body.origin = 'https://attacker.test'; }]) {
    const f = fixture(); mutate(f);
    await handler(f.req, f.res, f.options);
    assert.ok([401, 403].includes(f.res.statusCode));
    assert.equal(f.fetches(), 0);
  }
});
test('invalid JWT and unrelated canonical account are rejected', async () => {
  const f = fixture();
  f.admin.auth.getUser = async () => ({ data: { user: null } }) as never;
  await handler(f.req, f.res, f.options);
  assert.equal(f.res.statusCode, 401);
  const g = fixture(); g.req.query.userId = 'other-user';
  g.admin.auth.admin.getUserById = async () => ({ data: { user: { id: 'other-user', email: 'other@example.test', email_confirmed_at: 'verified' } } });
  await handler(g.req, g.res, g.options);
  assert.equal(g.res.statusCode, 403);
  assert.equal(g.fetches(), 0);
});
test('duration is validated, not silently rounded, clamped or defaulted', () => {
  assert.equal(getRequestedDuration(undefined), 300);
  for (const invalid of [0, -1, 1.5, 301, '30', NaN, Infinity]) assert.equal(getRequestedDuration(invalid), null);
  assert.equal(getRequestedDuration(30), 30);
});
test('invalid model/duration, empty wallet and rate limit fail before creation', async () => {
  const invalid = fixture(); invalid.req.body.maxSessionSeconds = 0;
  await handler(invalid.req, invalid.res, invalid.options);
  assert.equal(invalid.res.statusCode, 400); assert.equal(invalid.fetches(), 0);
  const empty = fixture({ getWallet: async () => ({ credits: 0 }) });
  await handler(empty.req, empty.res, empty.options);
  assert.equal(empty.res.statusCode, 402); assert.equal(empty.fetches(), 0);
  const rate = fixture(); rate.admin.rpc = async () => ({ data: false });
  await handler(rate.req, rate.res, rate.options);
  assert.equal(rate.res.statusCode, 429); assert.equal(rate.fetches(), 0);
});
test('service setup error preserves body/status, without retries or replacement sessions', async () => {
  let attempts = 0;
  const body = { error: 'Server update required', code: 'REALTIME_SETUP_REQUIRED' };
  const f = fixture({ fetchImplementation: async () => { attempts++; return Response.json(body, { status: 503 }); } });
  await handler(f.req, f.res, f.options);
  assert.equal(attempts, 1); assert.equal(f.res.statusCode, 503); assert.deepEqual(f.res.body, body);
});
test('upstream retries reuse one idempotency key and stop on 409', async () => {
  const keys: string[] = [];
  const result = await createMorphlySession({ morphlyApiKey: 'fake', body: {}, idempotencyKey: 'one-attempt', waitImplementation: async () => {},
    fetchImplementation: async (_url: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)['idempotency-key']);
      return Response.json({ code: keys.length === 1 ? 'UNAVAILABLE' : 'CONFLICT' }, { status: keys.length === 1 ? 502 : 409 });
    } });
  assert.deepEqual(keys, ['one-attempt', 'one-attempt']); assert.equal(result.response.status, 409);
});
test('all upstream error statuses and bodies are forwarded intact', async () => {
  for (const status of [401, 402, 403, 409, 429, 502, 503]) {
    const body = { error: 'fixture failure', code: `HTTP_${status}` };
    const f = fixture({ fetchImplementation: async () => Response.json(body, { status }), waitImplementation: async () => {} });
    await handler(f.req, f.res, f.options);
    assert.equal(f.res.statusCode, status); assert.deepEqual(f.res.body, body);
  }
});

function fakeSession(disconnect: () => Promise<void>): MorphlySession {
  return { disconnect, set: async () => {}, setPrompt: async () => {}, on: () => {}, off: () => {} };
}
test('pending stop retains exact SDK session, blocks Start, and retries same object', async () => {
  const owner = new MorphlySessionOwner(); let calls = 0; let cleaned = 0; let tracksStopped = 0;
  assert.equal(owner.begin(), true); assert.equal(owner.begin(), false);
  owner.own({ getTracks: () => [{ stop: () => { tracksStopped++; } }] } as unknown as MediaStream);
  const session = fakeSession(async () => { if (++calls === 1) throw { code: 'SESSION_STOP_PENDING' }; });
  owner.attach(session); owner.onCleanup(async () => { cleaned++; }); owner.finishStart(true);
  await assert.rejects(owner.stop());
  assert.equal(owner.session, session); assert.equal(owner.getSnapshot(), 'stop-pending'); assert.equal(owner.begin(), false);
  assert.ok(tracksStopped > 0); assert.equal(cleaned, 0);
  await owner.stop();
  assert.equal(calls, 2); assert.equal(cleaned, 1); assert.equal(owner.session, null); assert.equal(owner.getSnapshot(), 'idle');
});
test('navigation during connection waits for late session and disconnects it once', async () => {
  const owner = new MorphlySessionOwner(); let calls = 0;
  owner.begin(); const stopping = owner.stop();
  assert.equal(owner.stop(), stopping);
  owner.attach(fakeSession(async () => { calls++; })); owner.finishStart(true);
  await stopping;
  assert.equal(calls, 1); assert.equal(owner.getSnapshot(), 'idle');
});
test('app cleanup failure does not repeat a confirmed Morphly disconnect', async () => {
  const owner = new MorphlySessionOwner(); let stops = 0; let cleanups = 0;
  owner.begin(); owner.attach(fakeSession(async () => { stops++; }));
  owner.onCleanup(async () => { if (++cleanups === 1) throw new Error('App unavailable'); });
  owner.finishStart(true);
  await assert.rejects(owner.stop(), { code: 'APP_SESSION_STOP_PENDING' });
  assert.equal(owner.session, null); assert.equal(owner.begin(), false);
  await owner.stop();
  assert.equal(stops, 1); assert.equal(cleanups, 2); assert.equal(owner.getSnapshot(), 'idle');
});
test('reported Morphly balance survives stop until the next session starts', async () => {
  const owner = new MorphlySessionOwner(); owner.begin();
  owner.updateBalance({ available_credits: 100, reserved_credits: 60 });
  owner.attach(fakeSession(async () => { owner.updateBalance({ charged_credits: 20, billable_seconds: 10 }); }));
  owner.finishStart(true); await owner.stop();
  assert.deepEqual(owner.getBalance(), { available_credits: 100, reserved_credits: 60, charged_credits: 20, billable_seconds: 10 });
  owner.begin(); assert.deepEqual(owner.getBalance(), {});
  owner.finishStart(false); await owner.stop();
});
test('diagnostics whitelist code/status, never use raw error messages or credentials', () => {
  const error = { code: 'REALTIME_SETUP_REQUIRED', status: 503, message: 'secret', session_token: 'secret' };
  assert.deepEqual(morphlyDiagnostic(error), { code: 'REALTIME_SETUP_REQUIRED', status: 503 });
  assert.match(morphlyErrorMessage(error), /Contact Morphly support/);
  assert.doesNotMatch(morphlyErrorMessage(error), /secret/);
  assert.deepEqual(readMorphlyBalance({ available_credits: 1, reserved_credits: 2, charged_credits: 3, billable_seconds: 4, session_token: 'secret' }), { available_credits: 1, reserved_credits: 2, charged_credits: 3, billable_seconds: 4 });
});
