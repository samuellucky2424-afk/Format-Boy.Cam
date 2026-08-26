// @ts-nocheck
import { requireAuthorizedUser, sendApiError } from './auth.js';
import { getWalletByUserId } from '../server/credit-utils.js';
import { supabaseAdmin } from './supabase.js';

const MAX_SESSION_SECONDS = 600;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = String(req.query?.userId || '').trim();
  const sessionId = String(req.query?.sessionId || '').trim();
  if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });

  try {
    await requireAuthorizedUser(req, userId);
    const wallet = await getWalletByUserId(userId, { createIfMissing: true });
    const { data: session, error: lookupError } = await supabaseAdmin
      .from('sessions')
      .select('id, provider, pro_license_id, status, billable_started_at, credits_per_second, seconds_used, credits_used')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.provider === 'fal') {
      const { data: license, error: licenseError } = await supabaseAdmin
        .from('pro_licenses')
        .select('status')
        .eq('id', session.pro_license_id)
        .eq('user_id', userId)
        .maybeSingle();
      if (licenseError) throw licenseError;
      if (license?.status !== 'active') {
        return res.json({
          secondsUsed: Number(session.seconds_used || 0),
          creditsUsed: Number(session.credits_used || 0),
          remainingCredits: wallet.credits,
          shouldStop: true,
          forceEnd: true,
          reason: 'pro_license_inactive',
        });
      }
    }

    if (session.status !== 'active') {
      return res.json({
        secondsUsed: Number(session.seconds_used || 0),
        creditsUsed: Number(session.credits_used || 0),
        remainingCredits: wallet.credits,
        shouldStop: true,
      });
    }

    if (!session.billable_started_at) {
      return res.json({
        secondsUsed: 0,
        creditsUsed: 0,
        remainingCredits: wallet.credits,
        shouldStop: wallet.credits <= 0,
      });
    }

    const heartbeatAt = new Date().toISOString();
    const { error: heartbeatError } = await supabaseAdmin
      .from('sessions')
      .update({ last_heartbeat_at: heartbeatAt })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .eq('status', 'active');
    if (heartbeatError) throw heartbeatError;

    const secondsUsed = Math.min(
      MAX_SESSION_SECONDS,
      Math.max(0, Math.floor((Date.now() - Date.parse(session.billable_started_at)) / 1000)),
    );
    const rate = Number(session.credits_per_second);
    if (!Number.isFinite(rate) || rate < 0) throw new Error('Session has an invalid billing rate');
    const accruedCredits = Math.round(secondsUsed * rate);
    const creditsUsed = Math.min(wallet.credits, accruedCredits);
    const remainingCredits = Math.max(0, wallet.credits - creditsUsed);

    return res.json({
      secondsUsed,
      creditsUsed,
      remainingCredits,
      creditsPerSecond: rate,
      shouldStop: accruedCredits >= wallet.credits || secondsUsed >= MAX_SESSION_SECONDS,
    });
  } catch (error) {
    return sendApiError(res, error, 'Failed to fetch session status');
  }
}
