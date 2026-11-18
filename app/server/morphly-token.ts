// @ts-nocheck -- Vercel/Express route follows the repository's untyped server convention.
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import { getWalletByUserId } from '../api/credit-utils.js';
import { getActiveAccess } from '../api/access.js';

const MORPHLY_SESSION_URL = 'https://api.morphly.fun/v1/realtime/sessions';
const PROMPT_MODEL = 'M 2.1';
const SUBJECT_MODEL = 'M2.5';
const LEGACY_PROMPT_MODELS = new Set(['lucy-2.5', 'morphly-realtime']);

export function resolveRealtimeModel(value) {
  if (value == null || value === '') return PROMPT_MODEL;
  if (typeof value !== 'string') return null;
  if (LEGACY_PROMPT_MODELS.has(value)) return value;
  const compact = value.replace(/\s/g, '').toLowerCase();
  if (compact === 'm2.1') return PROMPT_MODEL;
  if (compact === 'm2.5') return SUBJECT_MODEL;
  return null;
}
const DEFAULT_MORPHLY_SESSION_SECONDS = 300;
// The hosted SDK validates provider credentials against this upper bound.
const MAX_MORPHLY_SESSION_SECONDS = 3600;

function getRequestedUserId(req) {
  const queryUserId = Array.isArray(req.query?.userId)
    ? req.query.userId[0]
    : req.query?.userId;
  const bodyUserId = req.body?.userId;
  return String(queryUserId || bodyUserId || '').trim();
}

export function getRequestedDuration(value) {
  if (value == null) return DEFAULT_MORPHLY_SESSION_SECONDS;
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

export async function createMorphlySession({
  morphlyApiKey,
  body,
  idempotencyKey,
  fetchImplementation = fetch,
}) {
  // Creation can succeed before an upstream 5xx is returned. Morphly does not
  // replay credentials on retry (it returns 409), so send only one request.
  const response = await fetchImplementation(MORPHLY_SESSION_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${morphlyApiKey}`,
      'content-type': 'application/json',
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
  return { response, result, attempts: 1 };
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
    return logged(503, { error: 'Configure the exact application origins on the server.', code: 'APP_ORIGIN_MISSING' });
  }
  // Select only an exact server-configured origin. Never infer it from the body.
  const origin = allowedOrigins.find((value) => value === req.headers?.origin);
  if (!origin || (req.body?.origin !== undefined && req.body.origin !== origin)) {
    return logged(403, { error: 'This app origin is not allowed.', code: 'ORIGIN_NOT_ALLOWED' });
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
      error: 'Live video is not configured on the server.',
      code: 'MORPHLY_API_KEY_MISSING',
    });
  }

  const bearer = String(req.headers?.authorization || '').match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) {
    return logged(401, { error: 'Sign in before starting.', code: 'APP_LOGIN_REQUIRED' });
  }

  try {
    const { data, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !data?.user) {
      return logged(401, { error: 'Sign in again before starting.', code: 'APP_LOGIN_REQUIRED' });
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
    const model = resolveRealtimeModel(req.body?.model);
    if (duration === null || !model) {
      return logged(400, { error: 'Use M2.1 or M2.5 and an integer duration from 1 to 3600 seconds.', code: 'INVALID_SESSION_REQUEST' });
    }
    const upstreamBody = {
      model,
      max_session_seconds: duration,
      origin,
    };
    if (model === SUBJECT_MODEL) {
      const imageUrl = typeof req.body?.image_url === 'string' ? req.body.image_url.trim() : '';
      const editingType = req.body?.editing_type ?? 'subject_replacement';
      if (!imageUrl || imageUrl.length > 12_000_000) {
        return logged(400, { error: 'M2.5 needs a reference image.', code: 'REFERENCE_IMAGE_REQUIRED' });
      }
      if (editingType !== 'subject_replacement') {
        return logged(400, { error: 'M2.5 only supports subject replacement.', code: 'INVALID_EDITING_TYPE' });
      }
      upstreamBody.image_url = imageUrl;
      upstreamBody.editing_type = 'subject_replacement';
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
        error: 'Start an app session before requesting a live credential.',
        code: 'APP_SESSION_REQUIRED',
      });
    }

    const { response: upstream, result, attempts } = await createMorphlySession({
      morphlyApiKey,
      body: upstreamBody,
      idempotencyKey: crypto.randomUUID(),
      fetchImplementation: options.fetchImplementation,
    });

    if (!upstream) {
      return logged(503, {
        error: 'Live video is temporarily unavailable. Please try again shortly.',
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
          error: 'The live video key on the server was rejected.',
          code: 'MORPHLY_API_KEY_REJECTED',
        });
      }
      console.info('[morphly-token]', { status: upstream.status, code: code || 'UPSTREAM_REJECTED' });
      return res.status(upstream.status).json(result);
    }

    // Record credential issuance separately from the first output heartbeat.
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
      console.error('Could not record realtime credential issuance.');
      return logged(500, {
        error: 'Could not prepare the realtime session.',
        code: 'SESSION_ACTIVATION_FAILED',
      });
    }

    console.info('[morphly-token]', { status: upstream.status, code: 'issued' });
    return res.status(upstream.status).json(result);
  } catch {
    return logged(502, {
      error: 'Could not reach the live video service.',
      code: 'MORPHLY_UNAVAILABLE',
    });
  }
}
