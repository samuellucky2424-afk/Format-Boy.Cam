// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';
import { getWalletByUserId } from './credit-utils.js';

const CREDITS_PER_SECOND = 2;
const MAX_SESSION_DURATION = 600;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Actually, standardizing parameterized requests /api/session-status?userId=xxx because Vercel doesn't do /api/session-status/:userId by default without a rewrite.
  // Wait, I will just accept ?userId=...

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Actually, standardizing parameterized requests /api/session-status?userId=xxx because Vercel doesn't do /api/session-status/:userId by default without a rewrite.
  // Wait, I will just accept ?userId=...
  const userId = req.query.userId || req.query.id; 

  if (!userId) return res.status(400).json({ error: 'User ID is required' });
  if (!supabaseAdmin) return res.status(503).json({ error: supabaseAdminConfigError });

  try {
    const wallet = await getWalletByUserId(userId, { createIfMissing: true });
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const actualCredits = wallet.credits;

    const { data: activeSession } = await supabaseAdmin
      .from('sessions').select('*').eq('user_id', userId).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(1).single();

    if (!activeSession) {
      return res.json({ secondsUsed: 0, creditsUsed: 0, remainingCredits: actualCredits, credits: actualCredits, shouldStop: false, forceEnd: false });
    }

    let startTimeStr = activeSession.start_time;
    if (!startTimeStr.endsWith('Z') && !startTimeStr.includes('+')) {
      startTimeStr = startTimeStr.replace(' ', 'T') + 'Z';
    }
    const startTime = new Date(startTimeStr).getTime();
    
    // Prevent negative seconds if there is a tiny clock drift
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    const cost = Math.round(elapsedSeconds * CREDITS_PER_SECOND);
    
    const remainingCredits = Math.max(0, actualCredits - cost);
    const shouldStop = (remainingCredits <= 0) || (elapsedSeconds > MAX_SESSION_DURATION);
    const forceEnd = remainingCredits <= 0;

    res.json({ secondsUsed: elapsedSeconds, creditsUsed: cost, cost, remainingCredits, credits: remainingCredits, shouldStop, forceEnd });
  } catch (error) {
    console.error('Session status error:', error);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
}
