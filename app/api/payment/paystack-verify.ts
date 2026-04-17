// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../supabase.js';
import { requireWalletByUserId, logCreditUpdate, updateWalletCredits } from '../credit-utils.js';

const CREDIT_PRICING_NGN = {
  500: 14000,
  1000: 28000,
  2000: 56000,
  5000: 140000
};

const CREDITS_PER_SECOND = 2;

function toKobo(amountNGN) {
  const amount = Number(amountNGN);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

const CREDIT_PRICING_KOBO = Object.fromEntries(
  Object.entries(CREDIT_PRICING_NGN).map(([credits, ngn]) => [credits, toKobo(ngn)])
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { reference } = req.body;

  if (!reference) {
    return res.status(400).json({
      status: 'failed',
      message: 'Missing required field: reference',
    });
  }

  if (!supabaseAdmin) {
    return res.status(503).json({
      status: 'failed',
      message: supabaseAdminConfigError,
    });
  }

  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecretKey) {
    return res.status(500).json({
      status: 'failed',
      message: 'Paystack secret key not configured',
    });
  }

  try {
    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const verifyData = await verifyResponse.json();

    if (!verifyResponse.ok || !verifyData?.status) {
      return res.status(400).json({
        status: 'failed',
        message: verifyData?.message || 'Payment verification failed',
      });
    }

    if (verifyData.data?.status !== 'success') {
      return res.status(400).json({
        status: 'failed',
        message: 'Payment was not successful',
        paystack_status: verifyData.data?.status || 'unknown',
      });
    }

    if (verifyData.data?.currency !== 'NGN') {
      return res.status(400).json({
        status: 'failed',
        message: `Invalid currency: expected NGN, got ${verifyData.data?.currency}`,
      });
    }

    const amountKobo = Number(verifyData.data?.amount);
    if (!Number.isFinite(amountKobo)) {
      return res.status(400).json({
        status: 'failed',
        message: 'Invalid payment amount from provider',
      });
    }

    const referenceFromProvider = verifyData.data?.reference;
    if (referenceFromProvider && referenceFromProvider !== reference) {
      return res.status(400).json({
        status: 'failed',
        message: 'Transaction reference mismatch',
      });
    }

    const refParts = String(reference).split('-');
    const userId = refParts?.length >= 3 ? refParts.slice(2).join('-') : null;

    if (!userId) {
      return res.status(400).json({
        status: 'failed',
        message: 'Could not extract user ID from reference',
      });
    }

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

    let creditsToAdd = 0;
    for (const [credits, expectedKobo] of Object.entries(CREDIT_PRICING_KOBO)) {
      if (amountKobo === expectedKobo) {
        creditsToAdd = Number(credits);
        break;
      }
    }

    if (creditsToAdd === 0) {
      return res.status(400).json({
        status: 'failed',
        message: `Amount ₦${(amountKobo / 100).toLocaleString()} does not match any valid credit tier.`,
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

    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        wallet_id: creditAccount.id,
        amount: amountKobo / 100,
        credits: creditsToAdd,
        type: 'credit',
        status: 'success',
        reference,
        provider: 'paystack',
        description: 'Credit purchase via Paystack',
        metadata: {
          provider: 'paystack',
          transaction_id: String(verifyData.data?.id ?? ''),
          currency: 'NGN',
          gateway_response: verifyData.data?.gateway_response,
          channel: verifyData.data?.channel,
          paid_at: verifyData.data?.paid_at,
          credits_per_second: CREDITS_PER_SECOND,
        },
        created_at: new Date().toISOString(),
      });

    return res.status(200).json({
      status: 'success',
      message: 'Payment verified and credits added',
      amountPaid: amountKobo / 100,
      newCredits: updatedWallet.credits,
      creditsAdded: creditsToAdd,
      remainingSeconds: Math.floor(updatedWallet.credits / CREDITS_PER_SECOND),
    });
  } catch (error) {
    console.error('Paystack verify error:', error);
    return res.status(500).json({
      status: 'failed',
      message: 'Internal server error during payment verification',
    });
  }
}
