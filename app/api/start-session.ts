// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';
import { getWalletByUserId, logCreditUpdate, updateWalletCredits } from './credit-utils.js';

const CREDITS_PER_SECOND = 2;
const MAX_SESSION_DURATION = 600;

async function closeActiveSession(userId, activeSession) {
  try {
    const wallet = await getWalletByUserId(userId);
    if (!wallet) throw new Error('Wallet not found');

    const actualCredits = wallet.credits;
    let startTimeStr = activeSession.start_time;
    if (!startTimeStr.endsWith('Z') && !startTimeStr.includes('+')) {
      startTimeStr = startTimeStr.replace(' ', 'T') + 'Z';
    }
    const startTime = new Date(startTimeStr).getTime();
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    const cost = Math.round(elapsedSeconds * CREDITS_PER_SECOND);
    
    const finalCost = Math.min(actualCredits, cost);
    const newCredits = Math.max(0, actualCredits - finalCost);

    await supabaseAdmin
      .from('sessions')
      .update({
        end_time: new Date(),
        cost: finalCost,
        seconds_used: elapsedSeconds,
        status: 'ended'
      })
      .eq('id', activeSession.id).eq('status', 'active');

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!supabaseAdmin) return res.status(503).json({ allowed: false, error: supabaseAdminConfigError });

  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ allowed: false, error: 'User ID is required' });

    const { data: existingActiveSessions } = await supabaseAdmin
      .from('sessions').select('*').eq('user_id', userId).eq('status', 'active');

    if (existingActiveSessions && existingActiveSessions.length > 0) {
      for (const session of existingActiveSessions) {
        const closeResult = await closeActiveSession(userId, session);
        if (!closeResult.success) {
          return res.status(500).json({ allowed: false, error: closeResult.message || 'Failed to reconcile active session' });
        }
      }
    }

    const freshWallet = await getWalletByUserId(userId);
    if (!freshWallet) {
      return res.status(404).json({ allowed: false, error: 'Wallet not found' });
    }

    const currentCredits = freshWallet.credits;

    if (currentCredits <= 0) {
      return res.json({ allowed: false, error: 'Insufficient credits', credits: currentCredits });
    }

    const { data: newSession, error: sessionError } = await supabaseAdmin
      .from('sessions')
      .insert({
        user_id: userId, status: 'active', start_time: new Date().toISOString(), cost: 0, seconds_used: 0
      }).select('id').single();

    if (sessionError) return res.status(500).json({ allowed: false, error: 'Failed to create session' });

    res.json({ allowed: true, sessionId: newSession.id, token: process.env.DECART_API_KEY, credits: currentCredits });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ allowed: false, error: 'Internal server error' });
  }
}
