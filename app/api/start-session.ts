// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';
import { getWalletByUserId, logCreditUpdate, updateWalletCredits } from './credit-utils.js';
import { getActiveAccess } from './access.js';
import { settledSessionUsage } from '../server/session-usage.js';
import morphlyTokenHandler from '../server/morphly-token.js';

const CREDITS_PER_SECOND = 2;
const MORPHLY_API_KEY = process.env.MORPHLY_API_KEY;

async function closeActiveSession(userId, activeSession) {
  try {
    const wallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (!wallet) throw new Error('Wallet not found');

    const actualCredits = wallet.credits;
    const metadata = activeSession.metadata ?? {};
    const { seconds: elapsedSeconds, endTime } = settledSessionUsage(metadata, Date.now());
    const creditsPerSecond = Number.isFinite(activeSession?.credits_per_second)
      ? activeSession.credits_per_second
      : CREDITS_PER_SECOND;
    const cost = Math.round(elapsedSeconds * creditsPerSecond);
    
    const access = await getActiveAccess(supabaseAdmin, userId);
    const finalCost = access ? 0 : Math.min(actualCredits, cost);
    const newCredits = Math.max(0, actualCredits - finalCost);

    const { data: closedSession, error: closeError } = await supabaseAdmin
      .from('sessions')
      .update({
        end_time: new Date(endTime).toISOString(),
        cost: finalCost,
        seconds_used: elapsedSeconds,
        credits_used: finalCost,
        status: 'ended',
      })
      .eq('id', activeSession.id).eq('status', 'active').select('id').maybeSingle();
    if (closeError) throw closeError;
    if (!closedSession || finalCost === 0) {
      return { success: true, deducted: 0, remainingCredits: actualCredits };
    }

    const updatedWallet = await updateWalletCredits(userId, newCredits);
    logCreditUpdate({
      userId,
      before: actualCredits,
      after: updatedWallet.credits,
      change: -finalCost,
      source: 'session-close',
    });

    if (finalCost > 0) {
      await supabaseAdmin.from('transactions').insert({
        user_id: userId, type: 'debit', amount: 0, credits: finalCost, description: 'Session usage', status: 'success', created_at: new Date()
      });
    }

    return { success: true, deducted: finalCost, remainingCredits: updatedWallet.credits };
  } catch (err) {
    console.error('Failed to close session:', err);
    return { success: false, message: 'Internal error closing session' };
  }
}

export default async function handler(req, res) {
  if (req.query?.action === 'morphly-token') {
    return morphlyTokenHandler(req, res, { morphlyApiKey: MORPHLY_API_KEY });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!supabaseAdmin) return res.status(503).json({ allowed: false, error: supabaseAdminConfigError });

  try {
    const { userId } = req.body;
    if (!userId) {
      console.info('[start-session]', { outcome: 'denied', reason: 'USER_ID_REQUIRED' });
      return res.status(400).json({ allowed: false, error: 'User ID is required' });
    }

    const { data: existingActiveSessions } = await supabaseAdmin
      .from('sessions').select('*').eq('user_id', userId).eq('status', 'active');

    if (existingActiveSessions && existingActiveSessions.length > 0) {
      for (const session of existingActiveSessions) {
        const closeResult = await closeActiveSession(userId, session);
        if (!closeResult.success) {
          console.info('[start-session]', { outcome: 'denied', reason: 'ACTIVE_SESSION_CLOSE_FAILED', userId });
          return res.status(500).json({ allowed: false, error: closeResult.message || 'Failed to reconcile active session' });
        }
      }
    }

    const freshWallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (!freshWallet) {
      console.info('[start-session]', { outcome: 'denied', reason: 'WALLET_NOT_FOUND', userId });
      return res.status(404).json({ allowed: false, error: 'Wallet not found' });
    }

    const currentCredits = freshWallet.credits;
    const access = await getActiveAccess(supabaseAdmin, userId);

    if (!access && currentCredits <= 0) {
      console.info('[start-session]', { outcome: 'denied', reason: 'PLAN_EXPIRED', credits: currentCredits });
      return res.json({ allowed: false, error: 'Your plan has expired. Choose a plan to keep streaming.', credits: currentCredits });
    }

    const { data: newSession, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .insert({
        user_id: userId, status: 'active', start_time: new Date().toISOString(), cost: 0, seconds_used: 0
      }).select('id').single();

    if (sessionError) {
      console.info('[start-session]', { outcome: 'denied', reason: 'SESSION_INSERT_FAILED', userId });
      return res.status(500).json({ allowed: false, error: 'Failed to create session' });
    }

    console.info('[start-session]', { outcome: 'allowed', userId, hasAccess: Boolean(access), credits: currentCredits, sessionId: newSession.id });
    res.json({ allowed: true, sessionId: newSession.id, credits: currentCredits });
  } catch (error) {
    console.error('[start-session]', { outcome: 'error', message: error instanceof Error ? error.message : 'unknown' });
    res.status(500).json({ allowed: false, error: 'Internal server error' });
  }
}
