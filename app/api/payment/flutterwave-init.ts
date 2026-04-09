// @ts-nocheck
import { supabaseAdmin } from '../supabase.js';

const CREDIT_PRICING = {
  500: 18500,
  1000: 37000,
  2000: 74000,
  5000: 185000
};

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, credits, email } = req.body;

  if (!userId || !credits || !email) {
    return res.status(400).json({
      status: 'failed',
      message: 'Missing required fields: userId, credits, email',
    });
  }

  const requestedCredits = Number(credits);
  const amountNGN = CREDIT_PRICING[requestedCredits as keyof typeof CREDIT_PRICING];

  if (!amountNGN) {
    return res.status(400).json({
      status: 'failed',
      message: 'Invalid credit package selected',
    });
  }

  // Generate a secure transaction reference bound to the user
  const tx_ref = `FMT-${Date.now()}-${userId}`;

  // Return the configured payment details to the frontend
  // The frontend PaymentModal will use these to spawn the popup
  return res.status(200).json({
    status: 'success',
    tx_ref,
    amount: amountNGN,
    credits: requestedCredits,
    payment_config: {
      currency: "NGN",
      tx_ref,
      amount: amountNGN
    }
  });
}
