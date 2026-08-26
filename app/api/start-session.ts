// @ts-nocheck
import { requireAuthorizedUser, sendApiError } from './auth.js';
import { getWalletByUserId } from '../server/credit-utils.js';
import { supabaseAdmin } from './supabase.js';
import { getProLicenseByUserId, PRO_CONTACT_PHONE, resolveSessionCreditsPerSecond } from '../server/pro-utils.js';

const PROVIDERS = new Set(['reactor', 'fal']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function finishSession(userId, sessionId, reason) {
  const { error } = await supabaseAdmin.rpc('finish_billed_session', {
    p_user_id: userId,
    p_session_id: sessionId,
    p_reason: reason,
  });
  if (error) throw new Error(`Could not reconcile session ${sessionId}: ${error.message}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = String(req.body?.userId || '').trim();
  const provider = String(req.body?.provider || '').trim();
  const clientSessionId = String(req.body?.clientSessionId || '').trim();
  if (!PROVIDERS.has(provider)) {
    return res.status(400).json({ allowed: false, error: 'Provider must be reactor or fal' });
  }
  if (!UUID_PATTERN.test(clientSessionId)) {
    return res.status(400).json({ allowed: false, error: 'clientSessionId must be a UUID' });
  }

  try {
    await requireAuthorizedUser(req, userId);

    const proLicense = provider === 'fal' ? await getProLicenseByUserId(userId) : null;
    if (provider === 'fal' && proLicense?.status !== 'active') {
      return res.status(403).json({
        allowed: false,
        sessionId: null,
        error: 'An active PRO license is required',
        code: 'PRO_LICENSE_REQUIRED',
        contactPhone: PRO_CONTACT_PHONE,
      });
    }
    const creditsPerSecond = resolveSessionCreditsPerSecond(provider, proLicense);
    if (!creditsPerSecond) throw new Error('The server resolved an invalid billing rate');

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('sessions')
      .select('id, status, provider, credits_per_second')
      .eq('user_id', userId)
      .eq('client_session_id', clientSessionId)
      .maybeSingle();
    if (existingError) throw existingError;

    const initialWallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (existing) {
      if (existing.provider !== provider) {
        return res.status(409).json({
          allowed: false,
          sessionId: existing.id,
          credits: initialWallet.credits,
          error: 'clientSessionId is already associated with another provider',
        });
      }
      return res.json({
        allowed: existing.status === 'active' && initialWallet.credits >= Number(existing.credits_per_second || creditsPerSecond),
        sessionId: existing.id,
        credits: initialWallet.credits,
        creditsPerSecond: Number(existing.credits_per_second || creditsPerSecond),
      });
    }

    const { data: activeSessions, error: activeError } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (activeError) throw activeError;
    for (const activeSession of activeSessions || []) {
      await finishSession(userId, activeSession.id, 'reconciled_on_start');
    }

    const wallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (wallet.credits < creditsPerSecond) {
      return res.json({ allowed: false, sessionId: null, credits: wallet.credits, creditsPerSecond });
    }

    const model = provider === 'reactor' ? 'xmax/x2' : 'decart/lucy-2-5/realtime';
    const { data: session, error: insertError } = await supabaseAdmin
      .from('sessions')
      .insert({
        user_id: userId,
        wallet_id: wallet.id,
        provider,
        client_session_id: clientSessionId,
        model,
        pro_license_id: proLicense?.id || null,
        status: 'active',
        start_time: new Date().toISOString(),
        credits_per_second: creditsPerSecond,
        seconds_used: 0,
        credits_used: 0,
        cost: 0,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: raced, error: racedError } = await supabaseAdmin
          .from('sessions')
          .select('id, status, provider')
          .eq('user_id', userId)
          .eq('client_session_id', clientSessionId)
          .maybeSingle();
        if (racedError) throw racedError;
        if (raced) {
          const sameProvider = raced.provider === provider;
          return res.status(sameProvider ? 200 : 409).json({
            allowed: sameProvider && raced.status === 'active',
            sessionId: raced.id,
            credits: wallet.credits,
            ...(sameProvider ? {} : { error: 'clientSessionId is already associated with another provider' }),
          });
        }
        return res.status(409).json({
          allowed: false,
          error: 'Another session is already active',
          credits: wallet.credits,
        });
      }
      throw insertError;
    }

    return res.json({ allowed: true, sessionId: session.id, credits: wallet.credits, creditsPerSecond });
  } catch (error) {
    return sendApiError(res, error, 'Failed to start session');
  }
}
