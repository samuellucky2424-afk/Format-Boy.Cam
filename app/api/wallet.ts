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
      balance: 0,
      credits: 0,
      transactions: [],
      warning: supabaseAdminConfigError,
    });
  }

  try {
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('wallets')
      .select('balance, credits')
      .eq('user_id', userId)
      .maybeSingle();
    const { data: txs, error: txsError } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (walletError) {
      console.error('Failed to load wallet:', walletError);
    }

    if (txsError) {
      console.error('Failed to load transactions:', txsError);
    }
    
    // Map DB columns to our frontend transaction structure
    const mappedTxs = (txs || []).map(tx => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      credits: tx.credits || 0,
      description: tx.description || (tx.type === 'credit' ? 'Credits purchased' : 'Session usage'),
      timestamp: tx.created_at,
    }));
    
    res.json({
      balance: wallet?.balance || 0,
      credits: wallet?.credits || 0,
      transactions: mappedTxs
    });
  } catch (error) {
    console.error('Wallet handler error:', error);
    res.json({ balance: 0, credits: 0, transactions: [] });
  }
}
