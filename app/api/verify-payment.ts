// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { reference, userId, planName, planMinutes, credits, priceUSD } = req.body;
  if (!reference || !userId) return res.status(400).json({ status: 'failed', message: 'Missing reference or userId' });
  if (!supabaseAdmin) return res.status(503).json({ status: 'failed', message: supabaseAdminConfigError });

  try {
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecretKey) return res.status(500).json({ status: 'failed', message: 'Missing Paystack Secret Key' });

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${paystackSecretKey}` }
    });

    const data = await response.json();

    if (data.status && data.data.status === 'success') {
      const amountInNaira = data.data.amount / 100;
      const purchasedCredits = Number.isFinite(credits) ? Number(credits) : (planMinutes || Math.round(amountInNaira / 69.2 / 60));
      
      let { data: walletData } = await supabaseAdmin.from('wallets').select('balance, credits').eq('user_id', userId).maybeSingle();
        
      const currentBalance = walletData ? walletData.balance || 0 : 0;
      const currentCredits = walletData ? walletData.credits || 0 : 0;
      const newBalance = currentBalance + amountInNaira;
      const newCredits = currentCredits + purchasedCredits;
      
      await supabaseAdmin.from('wallets').update({ balance: newBalance, credits: newCredits }).eq('user_id', userId);
        
      await supabaseAdmin.from('transactions').insert({
        user_id: userId, type: 'credit', amount: amountInNaira, credits: purchasedCredits, reference: reference, description: 'Credits purchased', status: 'success', created_at: new Date()
      });

      const pName = planName || `${purchasedCredits} Credits`;
      const pMins = purchasedCredits;

      await supabaseAdmin.from('subscriptions').insert({
        user_id: userId, plan_name: pName, amount_paid: amountInNaira, credits: pMins, status: 'active', created_at: new Date()
      });
        
      res.json({ status: 'success', message: 'Payment verification successful', data: data.data, newBalance, newCredits });
    } else {
      res.status(400).json({ status: 'failed', message: data.message || 'Payment verification failed' });
    }
  } catch (error) {
    res.status(500).json({ status: 'failed', message: 'Internal server error' });
  }
}
