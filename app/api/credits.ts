// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query.userId || req.query.id;
  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  if (!supabaseAdmin) {
    return res.json({
      credits: 0,
      remainingSeconds: 0,
      transactions: [],
      warning: supabaseAdminConfigError,
    });
  }

  try {
    const { data: creditAccount, error: creditAccountError } = await supabaseAdmin
      .from('wallets')
      .select('credits')
      .eq('user_id', userId)
      .maybeSingle();
    const { data: txs, error: txsError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (creditAccountError) {
      console.error('Failed to load credits:', creditAccountError);
    }

    if (txsError) {
      console.error('Failed to load transactions:', txsError);
    }

    const mappedTxs = (txs || []).map(tx => ({
      id: tx.id,
      type: tx.type,
      amount: 0,
      credits: tx.credits || 0,
      description: tx.description || (tx.type === 'credit' ? 'Credits purchased' : 'Session usage'),
      timestamp: tx.created_at,
    }));

    res.json({
      credits: creditAccount?.credits || 0,
      remainingSeconds: Math.floor((creditAccount?.credits || 0) / 2),
      transactions: mappedTxs
    });
  } catch (error) {
    console.error('Credits handler error:', error);
    res.json({ credits: 0, remainingSeconds: 0, transactions: [] });
  }
}
