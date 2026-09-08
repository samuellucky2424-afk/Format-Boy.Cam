// @ts-nocheck -- Vercel/Express route follows the repository's untyped server convention.
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import { getWalletByUserId } from '../api/credit-utils.js';

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
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  const appOrigin = options.appOrigin ?? process.env.APP_ORIGIN;
  const desktopOrigin = options.desktopOrigin ?? process.env.APP_DESKTOP_ORIGIN;
  const allowedOrigins = [appOrigin, desktopOrigin].filter(Boolean);
  if (!appOrigin || allowedOrigins.some((origin) => normalizeRequestedOrigin(origin) !== origin) ||
      (desktopOrigin && desktopOrigin !== 'http://localhost:5173')) {
    return res.status(503).json({ error: 'Configure exact Morphly application origins on the server.', code: 'APP_ORIGIN_MISSING' });
  }
  // Select only an exact server-configured origin. Never infer it from the body.
  const origin = allowedOrigins.find((value) => value === req.headers?.origin);
  if (!origin || (req.body?.origin !== undefined && req.body.origin !== origin)) {
    return res.status(403).json({ error: 'Morphly origin is not allowed.', code: 'ORIGIN_NOT_ALLOWED' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  }
  if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body))) {
    return res.status(400).json({ error: 'Send a JSON object to start Morphly.', code: 'INVALID_SESSION_REQUEST' });
  }

  if (!admin) {
    return res.status(503).json({
      error: supabaseAdminConfigError,
      code: 'SERVER_CONFIGURATION_ERROR',
    });
  }

  const morphlyApiKey = options.morphlyApiKey || process.env.MORPHLY_API_KEY;
  if (!morphlyApiKey) {
    return res.status(500).json({
      error: 'Morphly is not configured on the server.',
      code: 'MORPHLY_API_KEY_MISSING',
    });
  }

  const bearer = String(req.headers?.authorization || '').match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) {
    return res.status(401).json({ error: 'Sign in before starting Morphly.', code: 'APP_LOGIN_REQUIRED' });
  }

  try {
    const { data, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !data?.user) {
      return res.status(401).json({ error: 'Sign in again before starting Morphly.', code: 'APP_LOGIN_REQUIRED' });
    }
    const authUser = data.user;
    const userId = getRequestedUserId(req) || authUser.id;
    // Preserve canonical accounts while verifying linked identities server-side.
    if (userId !== authUser.id) {
      const { data: linked, error } = await admin.auth.admin.getUserById(userId);
      if (error || !authUser.email_confirmed_at || !linked?.user?.email_confirmed_at ||
          !authUser.email || authUser.email.toLowerCase() !== linked.user.email?.toLowerCase()) {
        return res.status(403).json({ error: 'This account does not match your login.', code: 'ACCOUNT_NOT_ALLOWED' });
      }
    }
    const duration = getRequestedDuration(req.body?.maxSessionSeconds);
    const model = req.body?.model ?? MORPHLY_REALTIME_MODEL;
    if (duration === null || !['lucy-2.5', MORPHLY_REALTIME_MODEL].includes(model)) {
      return res.status(400).json({ error: 'Use a supported Morphly model and an integer duration from 1 to 300 seconds.', code: 'INVALID_SESSION_REQUEST' });
    }
    const wallet = await (options.getWallet || getWalletByUserId)(userId, { createIfMissing: true });
    if (!wallet || wallet.credits <= 0) {
      return res.status(402).json({
        error: 'Insufficient credits',
        code: 'INSUFFICIENT_CREDITS',
      });
    }

    const { data: activeSession, error: activeSessionError } = await admin
      .from('sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSessionError) {
      return res.status(500).json({
        error: 'Could not verify the active session',
        code: 'ACTIVE_SESSION_LOOKUP_FAILED',
      });
    }

    if (!activeSession) {
      return res.status(409).json({
        error: 'Start an app session before requesting a Morphly credential.',
        code: 'APP_SESSION_REQUIRED',
      });
    }

    const { data: rateAllowed, error: rateError } = await admin.rpc('claim_morphly_session_attempt', { p_user_id: userId });
    if (rateError) {
      return res.status(503).json({ error: 'Morphly session rate limiting is not configured.', code: 'RATE_LIMIT_UNAVAILABLE' });
    }
    if (rateAllowed !== true) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Wait a minute before starting Morphly again.', code: 'RATE_LIMITED' });
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
      return res.status(503).json({
        error: 'Morphly realtime service is temporarily unavailable. Please try again shortly.',
        code: 'MORPHLY_UPSTREAM_UNAVAILABLE',
      });
    }

    if (!upstream.ok) {
      console.error('Morphly session creation failed:', {
        status: upstream.status,
        code: typeof result?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(result.code) ? result.code : null,
        attempts,
      });

    }

    return res.status(upstream.status).json(result);
  } catch {
    return res.status(502).json({
      error: 'Could not reach Morphly.',
      code: 'MORPHLY_UNAVAILABLE',
    });
  }
}
