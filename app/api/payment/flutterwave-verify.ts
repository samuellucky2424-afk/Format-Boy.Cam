// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../supabase.js';
import { requireWalletByUserId, logCreditUpdate, updateWalletCredits } from '../credit-utils.js';

const CREDIT_PRICING = {
  500: 14000,
  1000: 28000,
  2000: 56000,
  5000: 140000
};
const CREDITS_PER_SECOND = 2;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { transaction_id, tx_ref } = req.body;

  if (!transaction_id) {
    return res.status(400).json({
      status: 'failed',
      message: 'Missing required field: transaction_id',
    });
  }

  if (!supabaseAdmin) {
    return res.status(503).json({
      status: 'failed',
      message: supabaseAdminConfigError,
    });
  }

  const flutterwaveSecretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!flutterwaveSecretKey) {
    return res.status(500).json({
      status: 'failed',
      message: 'Flutterwave secret key not configured',
    });
  }

  try {
    // 1. Verify with Flutterwave
    const verifyResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transaction_id)}/verify`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${flutterwaveSecretKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const verifyData = await verifyResponse.json();

    if (verifyData.status !== 'success' || verifyData.data?.status !== 'successful') {
      return res.status(400).json({
        status: 'failed',
        message: 'Payment was not successful',
        flutterwave_status: verifyData.data?.status || 'unknown',
      });
    }

    // 2. Validate currency
    if (verifyData.data.currency !== 'NGN') {
      return res.status(400).json({
        status: 'failed',
        message: `Invalid currency: expected NGN, got ${verifyData.data.currency}`,
      });
    }

    const amount = Number(verifyData.data.amount);
    if (!Number.isFinite(amount)) {
      return res.status(400).json({
        status: 'failed',
        message: 'Invalid payment amount from provider',
      });
    }

    const reference = verifyData.data.tx_ref;

    if (tx_ref && tx_ref !== reference) {
      return res.status(400).json({
        status: 'failed',
        message: 'Transaction reference mismatch',
      });
    }

    // 3. Extract user_id from tx_ref (format: FMT-{timestamp}-{userId})
    const txRefParts = reference?.split('-');
    const userId = txRefParts?.length >= 3 ? txRefParts.slice(2).join('-') : null;

    if (!userId) {
      return res.status(400).json({
        status: 'failed',
        message: 'Could not extract user ID from transaction reference',
      });
    }

    // 4. Check for duplicate — prevent double-credit
    const { data: existingTx } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('reference', reference)
      .eq('status', 'success')
      .maybeSingle();

    if (existingTx) {
      return res.status(200).json({
        status: 'already_processed',
        message: 'This transaction has already been processed',
      });
    }

    // 5. Map amount strictly to credits without trusting frontend meta
    let creditsToAdd = 0;
    for (const [credits, expectedPrice] of Object.entries(CREDIT_PRICING)) {
      if (amount === expectedPrice) {
        creditsToAdd = Number(credits);
        break;
      }
    }

    if (creditsToAdd === 0) {
      return res.status(400).json({
        status: 'failed',
        message: `Amount NGN ${amount} does not match any valid credit tier.`,
      });
    }

    const creditAccount = await requireWalletByUserId(userId, { createIfMissing: true });
    const newCredits = creditAccount.credits + creditsToAdd;
    const updatedWallet = await updateWalletCredits(userId, newCredits);
    logCreditUpdate({
      userId,
      before: creditAccount.credits,
      after: updatedWallet.credits,
      change: creditsToAdd,
      source: 'payment-verify',
    });

    // 6. Insert transaction record
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        wallet_id: creditAccount.id,
        amount,
        credits: creditsToAdd,
        type: 'credit',
        status: 'success',
        tx_ref: reference,
        reference,
        provider: 'flutterwave',
        description: 'Credit purchase via Flutterwave',
        metadata: {
          provider: 'flutterwave',
          transaction_id: String(transaction_id),
          currency: 'NGN',
          credits_per_second: CREDITS_PER_SECOND,
        },
        created_at: new Date().toISOString(),
      });

    return res.status(200).json({
      status: 'success',
      message: 'Payment verified and credits added',
      amountPaid: amount,
      newCredits: updatedWallet.credits,
      creditsAdded: creditsToAdd,
      remainingSeconds: Math.floor(updatedWallet.credits / CREDITS_PER_SECOND),
    });
  } catch (error) {
    console.error('Flutterwave verify error:', error);
    return res.status(500).json({
      status: 'failed',
      message: 'Internal server error during payment verification',
    });
  }
}
