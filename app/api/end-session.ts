// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';
import { getWalletByUserId, logCreditUpdate, updateWalletCredits } from './credit-utils.js';

const CREDITS_PER_SECOND = 2;
const MAX_SESSION_DURATION = 600;
const HEARTBEAT_GRACE_SECONDS = 3;

async function closeActiveSession(userId, activeSession) {
  try {
    const wallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (!wallet) throw new Error('Wallet not found');

    const actualCredits = wallet.credits;
    let startTimeStr = typeof activeSession?.start_time === 'string'
      ? activeSession.start_time
      : activeSession?.start_time
        ? new Date(activeSession.start_time).toISOString()
        : new Date().toISOString();
    if (!startTimeStr.endsWith('Z') && !startTimeStr.includes('+')) {
      startTimeStr = startTimeStr.replace(' ', 'T') + 'Z';
    }
    const startTime = new Date(startTimeStr).getTime();

    const metadata = activeSession?.metadata && typeof activeSession.metadata === 'object'
      ? activeSession.metadata
      : {};

    const lastHeartbeatRaw = metadata?.last_heartbeat;
    const lastHeartbeatMs = typeof lastHeartbeatRaw === 'string' ? new Date(lastHeartbeatRaw).getTime() : NaN;

    const nowMs = Date.now();
    const maxEndMs = startTime + MAX_SESSION_DURATION * 1000;

    const billingEndMs = Number.isFinite(lastHeartbeatMs)
      ? Math.min(nowMs, lastHeartbeatMs + HEARTBEAT_GRACE_SECONDS * 1000, maxEndMs)
      : Math.min(nowMs, maxEndMs);

    const billableMs = Math.max(0, billingEndMs - startTime);
    const elapsedSeconds = Math.floor(billableMs / 1000);
    const creditsPerSecond = Number.isFinite(activeSession?.credits_per_second)
      ? activeSession.credits_per_second
      : CREDITS_PER_SECOND;
    const cost = Math.round(elapsedSeconds * creditsPerSecond);
    
    const finalCost = Math.min(actualCredits, cost);
    const newCredits = Math.max(0, actualCredits - finalCost);

    await supabaseAdmin
      .from('sessions')
      .update({
        end_time: new Date(billingEndMs).toISOString(),
        cost: finalCost,
        seconds_used: elapsedSeconds,
        credits_used: finalCost,
        status: 'ended'
      }).eq('id', activeSession.id).eq('status', 'active');

    const updatedWallet = await updateWalletCredits(userId, newCredits);
    logCreditUpdate({
      userId,
      before: actualCredits,
      after: updatedWallet.credits,
      change: -finalCost,
      source: 'session-end',
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!supabaseAdmin) return res.status(503).json({ success: false, message: supabaseAdminConfigError });

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'User ID is required' });

    const { data: activeSession } = await supabaseAdmin
      .from('sessions').select('*').eq('user_id', userId).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(1).single();

    if (!activeSession) return res.json({ success: false, message: 'No active session' });

    const endResult = await closeActiveSession(userId, activeSession);
    res.status(endResult.success ? 200 : 500).json(endResult);
  } catch (error) {
    console.error('End session error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
