// @ts-nocheck -- Vercel/Express route follows the repository's untyped server convention.
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import { getWalletByUserId } from '../api/credit-utils.js';
import { getActiveAccess } from '../api/access.js';

const MORPHLY_SESSION_URL = 'https://api.morphly.fun/v1/realtime/sessions';
const MORPHLY_REALTIME_MODEL = 'morphly-realtime';
const MAX_MORPHLY_SESSION_SECONDS = 300;
const MAX_MORPHLY_SESSION_ATTEMPTS = 3;
const RETRYABLE_MORPHLY_STATUS_CODES = new Set([500, 501, 502, 503, 504]);

function getRequestedUserId(req) {
  const queryUserId = Array.isArray(req.query?.userId)
    ? req.query.userId[0]
    : req.query?.userId;
  const bodyUserId = req.body?.userId;
  return String(queryUserId || bodyUserId || '').trim();
}

export function getRequestedDuration(value) {
  if (value == null) return MAX_MORPHLY_SESSION_SECONDS;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 &&
    value <= MAX_MORPHLY_SESSION_SECONDS ? value : null;
}

export function normalizeMorphlyApiKey(value) {
  if (typeof value !== 'string') return '';

  let key = value.trim();
  if (key.length >= 2 &&
      ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/^Bearer\s+/i, '').trim();
  // Morphly hashes the exact bearer token. Internal whitespace cannot match a stored key.
  if (!key || /\s/.test(key)) return '';
  return key;
}

function upstreamErrorCode(result) {
  return typeof result?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(result.code) ? result.code : null;
}

export function isUncodedMorphlyKeyRejection(status, result) {
  return status === 401 && !upstreamErrorCode(result);
}

export function normalizeRequestedOrigin(value) {
  if (typeof value !== 'string') return '';

  const requestedOrigin = value.trim();
  if (!requestedOrigin || requestedOrigin === 'null') return '';

  try {
    const parsed = new URL(requestedOrigin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function createMorphlySession({
  morphlyApiKey,
  body,
  idempotencyKey,
  fetchImplementation = fetch,
  waitImplementation = wait,
}) {
  let lastResponse = null;
  let lastResult = null;

  for (let attempt = 1; attempt <= MAX_MORPHLY_SESSION_ATTEMPTS; attempt += 1) {
    const response = await fetchImplementation(MORPHLY_SESSION_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${morphlyApiKey}`,
        'content-type': 'application/json',
        // Reuse this key for every retry, so a late successful attempt cannot
        // create more than one provider session.
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });

    const result = await response.json().catch(() => ({
      error: `Morphly returned HTTP ${response.status}`,
      code: `HTTP_${response.status}`,
    }));

    if (response.ok || result?.code === 'REALTIME_SETUP_REQUIRED' ||
        !RETRYABLE_MORPHLY_STATUS_CODES.has(response.status)) {
      return { response, result, attempts: attempt };
    }

    lastResponse = response;
    lastResult = result;

    if (attempt < MAX_MORPHLY_SESSION_ATTEMPTS) {
      await waitImplementation(250 * attempt);
    }
  }

  return {
    response: lastResponse,
    result: lastResult,
    attempts: MAX_MORPHLY_SESSION_ATTEMPTS,
  };
}

export default async function handler(req, res, options = {}) {
  const admin = options.admin || supabaseAdmin;
  const logged = (status, body) => {
    console.info('[morphly-token]', { status, code: body?.code || null });
    return res.status(status).json(body);
  };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  const desktopOrigin = options.desktopOrigin ?? process.env.APP_DESKTOP_ORIGIN;
  const allowedOrigins = [appOrigin, desktopOrigin].filter(Boolean);
  if (!appOrigin || allowedOrigins.some((origin) => normalizeRequestedOrigin(origin) !== origin) ||
      (desktopOrigin && desktopOrigin !== 'http://localhost:5173')) {
    return logged(503, { error: 'Configure exact Morphly application origins on the server.', code: 'APP_ORIGIN_MISSING' });
  }
  // Select only an exact server-configured origin. Never infer it from the body.
  const origin = allowedOrigins.find((value) => value === req.headers?.origin);
  if (!origin || (req.body?.origin !== undefined && req.body.origin !== origin)) {
    return logged(403, { error: 'Morphly origin is not allowed.', code: 'ORIGIN_NOT_ALLOWED' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return logged(405, {
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }
  if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body))) {
    return logged(400, { error: 'Send a JSON object to start Morphly.', code: 'INVALID_SESSION_REQUEST' });
  }

  if (!admin) {
    return logged(503, {
      error: supabaseAdminConfigError,
      code: 'SERVER_CONFIGURATION_ERROR',
    });
  }

  const morphlyApiKey = normalizeMorphlyApiKey(options.morphlyApiKey || process.env.MORPHLY_API_KEY);
  if (!morphlyApiKey) {
    return logged(500, {
      error: 'Morphly is not configured on the server.',
      code: 'MORPHLY_API_KEY_MISSING',
    });
  }

  const bearer = String(req.headers?.authorization || '').match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) {
    return logged(401, { error: 'Sign in before starting Morphly.', code: 'APP_LOGIN_REQUIRED' });
  }

  try {
    const { data, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !data?.user) {
      return logged(401, { error: 'Sign in again before starting Morphly.', code: 'APP_LOGIN_REQUIRED' });
    }
    const authUser = data.user;
    const userId = getRequestedUserId(req) || authUser.id;
    // Preserve canonical accounts while verifying linked identities server-side.
    if (userId !== authUser.id) {
      const { data: linked, error } = await admin.auth.admin.getUserById(userId);
      if (error || !authUser.email_confirmed_at || !linked?.user?.email_confirmed_at ||
          !authUser.email || authUser.email.toLowerCase() !== linked.user.email?.toLowerCase()) {
        return logged(403, { error: 'This account does not match your login.', code: 'ACCOUNT_NOT_ALLOWED' });
      }
    }
    const duration = getRequestedDuration(req.body?.maxSessionSeconds);
    const model = req.body?.model ?? MORPHLY_REALTIME_MODEL;
    if (duration === null || !['lucy-2.5', MORPHLY_REALTIME_MODEL].includes(model)) {
      return logged(400, { error: 'Use a supported Morphly model and an integer duration from 1 to 300 seconds.', code: 'INVALID_SESSION_REQUEST' });
    }
    const wallet = await (options.getWallet || getWalletByUserId)(userId, { createIfMissing: true });
    const access = await (options.getAccess || getActiveAccess)(admin, userId);
    if ((!wallet || wallet.credits <= 0) && !access) {
      return logged(402, {
        error: 'Your plan has expired. Choose a plan to keep streaming.',
        code: 'PLAN_EXPIRED',
      });
    }

    const { data: activeSession, error: activeSessionError } = await admin
      .from('sessions')
      .select('id, metadata')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSessionError) {
      return logged(500, {
        error: 'Could not verify the active session',
        code: 'ACTIVE_SESSION_LOOKUP_FAILED',
      });
    }

    if (!activeSession) {
      return logged(409, {
        error: 'Start an app session before requesting a Morphly credential.',
        code: 'APP_SESSION_REQUIRED',
      });
    }

    const { data: rateAllowed, error: rateError } = await admin.rpc('claim_morphly_session_attempt', { p_user_id: userId });
    if (rateError) {
      return logged(503, { error: 'Morphly session rate limiting is not configured.', code: 'RATE_LIMIT_UNAVAILABLE' });
    }
    if (rateAllowed !== true) {
      res.setHeader('Retry-After', '60');
      return logged(429, { error: 'Wait a minute before starting Morphly again.', code: 'RATE_LIMITED' });
    }
    const upstreamBody = {
      model,
      max_session_seconds: duration,
      origin,
    };

    const { response: upstream, result, attempts } = await createMorphlySession({
      morphlyApiKey,
      body: upstreamBody,
      idempotencyKey: crypto.randomUUID(),
      fetchImplementation: options.fetchImplementation,
      waitImplementation: options.waitImplementation,
    });

    if (!upstream) {
      return logged(503, {
        error: 'Morphly realtime service is temporarily unavailable. Please try again shortly.',
        code: 'MORPHLY_UPSTREAM_UNAVAILABLE',
      });
    }

    if (!upstream.ok) {
      const code = upstreamErrorCode(result);
      console.error('Morphly session creation failed:', {
        status: upstream.status,
        code,
        attempts,
      });
      // Morphly rejects a bad server key with HTTP 401 and no code. Forwarding
      // that unchanged makes the desktop app tell a signed-in user to sign in again.
      if (isUncodedMorphlyKeyRejection(upstream.status, result)) {
        return logged(401, {
          error: 'The Morphly API key on the server was rejected.',
          code: 'MORPHLY_API_KEY_REJECTED',
        });
      }
      console.info('[morphly-token]', { status: upstream.status, code: code || 'UPSTREAM_REJECTED' });
      return res.status(upstream.status).json(result);
    }

    // A session created by /start-session is only billable once a realtime
    // credential exists. This route is the final server-side step before the
    // desktop client can connect, so recording it here prevents a rejected
    // provider request from being charged when the client cleans up.
    const metadata = activeSession.metadata && typeof activeSession.metadata === 'object'
      ? activeSession.metadata
      : {};
    const { error: activationError } = await admin
      .from('sessions')
      .update({
        metadata: {
          ...metadata,
          realtime_credential_issued_at: new Date().toISOString(),
        },
      })
      .eq('id', activeSession.id)
      .eq('status', 'active');

    if (activationError) {
      console.error('Could not activate billable realtime session.');
      return logged(500, {
        error: 'Could not prepare the realtime session.',
        code: 'SESSION_ACTIVATION_FAILED',
      });
    }

    console.info('[morphly-token]', { status: upstream.status, code: 'issued' });
    return res.status(upstream.status).json(result);
  } catch {
    return logged(502, {
      error: 'Could not reach Morphly.',
      code: 'MORPHLY_UNAVAILABLE',
    });
  }
}
