// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';
import { getWalletByUserId } from './credit-utils.js';
import { getActiveAccess } from './access.js';

import { firstOutputTime } from '../server/session-usage.js';

const CREDITS_PER_SECOND = 2;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query.userId || req.query.id;

  if (!userId) return res.status(400).json({ error: 'User ID is required' });
  if (!supabaseAdmin) return res.status(503).json({ error: supabaseAdminConfigError });

  try {
    const wallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const actualCredits = wallet.credits;

    let query = supabaseAdmin.from('sessions').select('*').eq('user_id', userId).eq('status', 'active');
    if (req.query.sessionId) query = query.eq('id', req.query.sessionId);
    const { data: activeSession, error: lookupError } = await query
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (lookupError) throw lookupError;

    const metadata = activeSession?.metadata ?? {};
    if (!activeSession || !Number.isFinite(Date.parse(metadata.realtime_credential_issued_at))) {
      return res.json({ secondsUsed: 0, creditsUsed: 0, remainingCredits: actualCredits, credits: actualCredits, shouldStop: false, forceEnd: false });
    }

    // The dashboard begins polling only after its first transformed frame.
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const nextMetadata = {
      ...metadata,
      first_output_at: metadata.first_output_at ?? metadata.last_heartbeat ?? nowIso,
      last_heartbeat: nowIso,
    };
    const { error: heartbeatError } = await supabaseAdmin
      .from('sessions')
      .update({ metadata: nextMetadata })
      .eq('id', activeSession.id)
      .eq('status', 'active');
    if (heartbeatError) throw heartbeatError;

    const elapsedSeconds = Math.max(0, Math.floor((now - firstOutputTime(nextMetadata)) / 1000));
    const creditsPerSecond = Number.isFinite(activeSession.credits_per_second)
      ? activeSession.credits_per_second
      : CREDITS_PER_SECOND;
    const access = await getActiveAccess(supabaseAdmin, userId);
    const cost = access ? 0 : Math.round(elapsedSeconds * creditsPerSecond);
    const remainingCredits = Math.max(0, actualCredits - cost);
    const shouldStop = !access && remainingCredits <= 0;

    res.json({ secondsUsed: elapsedSeconds, creditsUsed: cost, cost, remainingCredits, credits: remainingCredits, shouldStop, forceEnd: shouldStop });
  } catch (error) {
    console.error('Session status error:', error);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
}
