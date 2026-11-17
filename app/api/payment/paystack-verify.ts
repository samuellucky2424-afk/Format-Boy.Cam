// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../supabase.js';
import { requireWalletByUserId, logCreditUpdate, updateWalletCredits } from '../credit-utils.js';

const CREDITS_PER_SECOND = 2;

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

    const paidCurrency = verifyData.data?.currency;
    if (paidCurrency !== 'NGN' && paidCurrency !== 'USD') {
      return res.status(400).json({
        status: 'failed',
        message: `Invalid currency: expected USD or NGN, got ${paidCurrency}`,
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

    const { data: plans, error: plansError } = await supabaseAdmin
      .from('credit_packages')
      .select('id, name, price_ngn, price_usd, credits, plan_code, duration_days')
      .eq('is_active', true);

    if (plansError || !plans) {
      return res.status(500).json({
        status: 'failed',
        message: 'Failed to retrieve plans from database for verification',
      });
    }

    const paidMajor = amountKobo / 100;
    const matchedPlan = plans.find((plan) => {
      const expected = paidCurrency === 'USD' ? Number(plan.price_usd) : Number(plan.price_ngn);
      return Math.round(expected * 100) === amountKobo;
    });

    if (!matchedPlan) {
      return res.status(400).json({
        status: 'failed',
        message: `Amount ${paidMajor.toLocaleString()} ${paidCurrency} does not match an active plan.`,
      });
    }

    const creditsToAdd = Number(matchedPlan.credits) || 0;
    const creditAccount = await requireWalletByUserId(userId, { createIfMissing: true });

    if (matchedPlan.plan_code) {
      const { error: accessError } = await supabaseAdmin.rpc('grant_plan_access', {
        p_user_id: userId,
        p_package_id: matchedPlan.id,
        p_amount: paidMajor,
        p_currency: paidCurrency,
      });
      if (accessError) {
        console.error('Plan access grant failed:', accessError);
        return res.status(500).json({
          status: 'failed',
          message: 'Payment was received, but access could not be granted. Apply the access-plan database migration and confirm again.',
        });
      }
    } else if (creditsToAdd > 0) {
      const newCredits = creditAccount.credits + creditsToAdd;
      const updatedWallet = await updateWalletCredits(userId, newCredits);
      logCreditUpdate({
        userId,
        before: creditAccount.credits,
        after: updatedWallet.credits,
        change: creditsToAdd,
        source: 'payment-verify',
      });
    } else {
      return res.status(400).json({
        status: 'failed',
        message: 'The paid plan does not grant access.',
      });
    }

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
        description: matchedPlan.plan_code
          ? `Access plan: ${matchedPlan.name}`
          : 'Credit purchase via Paystack',
        metadata: {
          provider: 'paystack',
          transaction_id: String(verifyData.data?.id ?? ''),
          currency: paidCurrency,
          plan_code: matchedPlan.plan_code,
          gateway_response: verifyData.data?.gateway_response,
          channel: verifyData.data?.channel,
          paid_at: verifyData.data?.paid_at,
          credits_per_second: CREDITS_PER_SECOND,
        },
        created_at: new Date().toISOString(),
      });

    return res.status(200).json({
      status: 'success',
      message: matchedPlan.plan_code ? 'Payment verified and access granted' : 'Payment verified and credits added',
      amountPaid: amountKobo / 100,
      currency: paidCurrency,
      plan: matchedPlan.name,
      creditsAdded: creditsToAdd,
    });
  } catch (error) {
    console.error('Paystack verify error:', error);
    return res.status(500).json({
      status: 'failed',
      message: 'Internal server error during payment verification',
    });
  }
}
