// @ts-nocheck
import { requireAuthorizedUser, sendApiError } from './auth.js';
import { getWalletByUserId } from '../server/credit-utils.js';
import { supabaseAdmin } from './supabase.js';
import fapshiInitHandler from '../server/fapshi-init.js';
import fapshiReturnHandler from '../server/fapshi-return.js';
import fapshiStatusHandler from '../server/fapshi-status.js';
import fapshiWebhookHandler from '../server/fapshi-webhook.js';

export default async function handler(req, res) {
  if (req.query?.action === 'fapshi-init') return fapshiInitHandler(req, res);
  if (req.query?.action === 'fapshi-return') return fapshiReturnHandler(req, res);
  if (req.query?.action === 'fapshi-status') return fapshiStatusHandler(req, res);
  if (req.query?.action === 'fapshi-webhook') return fapshiWebhookHandler(req, res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = String(req.query?.userId || '').trim();
  try {
    await requireAuthorizedUser(req, userId);

    const [wallet, transactionsResult, sessionsResult] = await Promise.all([
      getWalletByUserId(userId, { createIfMissing: true }),
      supabaseAdmin
        .from('transactions')
        .select('id, type, amount, credits, description, status, provider, reference, session_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('sessions')
        .select('id, provider, provider_session_id, start_time, end_time, seconds_used, credits_per_second, credits_used, status, end_reason, model')
        .eq('user_id', userId)
        .order('start_time', { ascending: false })
        .limit(50),
    ]);

    if (transactionsResult.error) throw transactionsResult.error;
    if (sessionsResult.error) throw sessionsResult.error;

    return res.json({
      credits: wallet.credits,
      remainingSeconds: Math.floor(wallet.credits / 2),
      fastRemainingSeconds: Math.floor(wallet.credits / 2),
      transactions: (transactionsResult.data || []).map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        amount: Number(transaction.amount || 0),
        credits: Number(transaction.credits || 0),
        description: transaction.description,
        status: transaction.status,
        provider: transaction.provider,
        reference: transaction.reference,
        sessionId: transaction.session_id,
        timestamp: transaction.created_at,
      })),
      sessions: (sessionsResult.data || []).map((session) => ({
        id: session.id,
        provider: session.provider,
        providerSessionId: session.provider_session_id,
        date: session.start_time,
        duration: Number(session.seconds_used || 0),
        rate: Number(session.credits_per_second || 0),
        credits: Number(session.credits_used || 0),
        status: session.status,
        reason: session.end_reason,
        model: session.model,
      })),
    });
  } catch (error) {
    return sendApiError(res, error, 'Failed to fetch wallet');
  }
}
