// @ts-nocheck
import { authorizedUserIds, requireAuthUser, sendApiError } from './auth.js';
import { getWalletByUserId } from '../server/credit-utils.js';
import { supabaseAdmin } from './supabase.js';

const REACTOR_API_URL = process.env.REACTOR_API_URL || 'https://api.reactor.inc';
const MODEL_NAME = 'xmax/x2';
const TOKEN_LIFETIME_SECONDS = 60 * 60;
const TOKEN_FETCH_TIMEOUT_MS = 25_000;

async function activeReactorSession(authUser, requestedSessionId) {
  const userIds = await authorizedUserIds(authUser);
  let query = supabaseAdmin
    .from('sessions')
    .select('id, user_id')
    .in('user_id', userIds)
    .eq('provider', 'reactor')
    .eq('status', 'active')
    .order('start_time', { ascending: false })
    .limit(1);
  if (requestedSessionId) query = query.eq('id', requestedSessionId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authUser = await requireAuthUser(req);
    const sessionId = String(req.body?.sessionId || req.query?.sessionId || '').trim();
    const session = await activeReactorSession(authUser, sessionId);
    if (!session) return res.status(409).json({ error: 'An active Reactor app session is required' });

    const wallet = await getWalletByUserId(session.user_id, { createIfMissing: false });
    if (!wallet || wallet.credits <= 0) {
      return res.status(402).json({ error: 'Insufficient credits' });
    }

    const apiKey = process.env.REACTOR_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'Reactor is not configured on the server' });

    let upstream;
    try {
      upstream = await fetch(`${REACTOR_API_URL}/tokens`, {
        method: 'POST',
        headers: { 'Reactor-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expires_after: TOKEN_LIFETIME_SECONDS,
          authorization_details: [{
            type: 'session',
            resources: { models: { match: [MODEL_NAME] } },
            constraints: { max_sessions: 1 },
          }],
        }),
        signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      return res.status(504).json({ error: `Reactor /tokens unreachable: ${error?.message || 'request failed'}` });
    }

    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status === 401 || upstream.status === 402 ? upstream.status : 502)
        .json({ error: body.message || body.error || `Reactor /tokens returned ${upstream.status}` });
    }
    if (!body.jwt) return res.status(502).json({ error: 'Reactor returned an invalid token response' });
    return res.json({ jwt: body.jwt });
  } catch (error) {
    return sendApiError(res, error, 'Failed to mint Reactor token');
  }
}
