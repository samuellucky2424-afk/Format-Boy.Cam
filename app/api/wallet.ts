// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';
import { getWalletByUserId } from './credit-utils.js';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const userId = req.query.userId || req.query.id;
  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  if (!supabaseAdmin) {
    return res.status(503).json({ error: supabaseAdminConfigError });
  }

  try {
    const { data: txs, error: txsError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (txsError) {
      console.error('Failed to load transactions:', txsError);
      return res.status(500).json({ error: 'Failed to fetch credits' });
    }

    const creditAccount = await getWalletByUserId(userId);
    if (!creditAccount) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    // Map DB columns to our frontend transaction structure
    const mappedTxs = (txs || []).map(tx => ({
      id: tx.id,
      type: tx.type,
      amount: 0,
      credits: typeof tx.credits === 'number' && Number.isFinite(tx.credits) ? tx.credits : undefined,
      description: tx.description || (tx.type === 'credit' ? 'Credits purchased' : 'Session usage'),
      timestamp: tx.created_at,
    }));

    res.json({
      credits: creditAccount.credits,
      remainingSeconds: Math.floor(creditAccount.credits / 2),
      transactions: mappedTxs
    });
  } catch (error) {
    console.error('Credits handler error:', error);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
}
