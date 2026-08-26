// @ts-nocheck
import { requireAuthorizedUser, sendApiError } from '../api/auth.js';
import { getWalletByUserId } from './credit-utils.js';
import { supabaseAdmin } from '../api/supabase.js';
import { FAL_LUCY_APP, getProLicenseByUserId, PRO_CONTACT_PHONE } from './pro-utils.js';

const TOKEN_DURATION_SECONDS = 120;

export function isAuthorizedFalRealtimeApp(app) {
  return String(app || '').trim() === FAL_LUCY_APP;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = String(req.body?.userId || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();
  const app = String(req.body?.app || '').trim();
  if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });
  if (!isAuthorizedFalRealtimeApp(app)) {
    return res.status(403).json({ error: 'This fal.ai endpoint is not authorized' });
  }

  try {
    await requireAuthorizedUser(req, userId);
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .select('id, user_id, provider, status, pro_license_id, credits_per_second')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .eq('provider', 'fal')
      .eq('status', 'active')
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) {
      return res.status(409).json({ error: 'An active fal.ai PRO session is required', code: 'APP_SESSION_REQUIRED' });
    }

    const license = await getProLicenseByUserId(userId);
    if (!license || license.status !== 'active' || license.id !== session.pro_license_id) {
      return res.status(403).json({
        error: 'An active PRO license is required',
        code: 'PRO_LICENSE_REQUIRED',
        contactPhone: PRO_CONTACT_PHONE,
      });
    }

    const wallet = await getWalletByUserId(userId, { createIfMissing: false });
    if (!wallet || wallet.credits < Number(session.credits_per_second)) {
      return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
    }

    const falKey = process.env.FAL_KEY;
    if (!falKey) {
      return res.status(503).json({ error: 'fal.ai is not configured on the server', code: 'FAL_KEY_MISSING' });
    }

    const upstream = await fetch('https://rest.fal.ai/tokens/realtime', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${falKey}`,
      },
      body: JSON.stringify({ allowed_apps: [FAL_LUCY_APP], duration: TOKEN_DURATION_SECONDS }),
    });
    const body = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !body?.token) {
      console.error('fal.ai realtime token failed:', upstream.status, body?.detail || body?.error);
      return res.status(502).json({ error: 'Could not create fal.ai realtime token' });
    }

    return res.json({ token: body.token, expiresIn: TOKEN_DURATION_SECONDS });
  } catch (error) {
    return sendApiError(res, error, 'Failed to authorize fal.ai realtime access');
  }
}
