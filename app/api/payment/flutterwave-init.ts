// @ts-nocheck
const NGN_PER_CREDIT = 30;

function resolveFrontendOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    return origin.replace(/\/+$/, '');
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch (_error) {
      return null;
    }
  }

  return null;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, amount, email } = req.body;

  if (!userId || !amount || !email) {
    return res.status(400).json({
      status: 'failed',
      message: 'Missing required fields: userId, amount, email',
    });
  }

  if (typeof amount !== 'number' || amount < 100) {
    return res.status(400).json({
      status: 'failed',
      message: 'Amount must be a number and at least NGN 100',
    });
  }

  const flutterwaveSecretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!flutterwaveSecretKey) {
    return res.status(500).json({
      status: 'failed',
      message: 'Flutterwave secret key not configured',
    });
  }

  const frontendOrigin = resolveFrontendOrigin(req);
  if (!frontendOrigin) {
    return res.status(400).json({
      status: 'failed',
      message: 'Unable to determine the frontend origin for payment redirect',
    });
  }

  const tx_ref = `FMT-${Date.now()}-${userId}`;
  const calculatedCredits = Math.floor(amount / NGN_PER_CREDIT);
  const requestedCredits = typeof req.body.credits === 'number' && req.body.credits > 0
    ? Math.floor(req.body.credits)
    : calculatedCredits;

  try {
    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${flutterwaveSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref,
        amount,
        currency: 'NGN',
        redirect_url: `${frontendOrigin}/payment-success`,
        customer: {
          email,
        },
        customizations: {
          title: 'Format-Boy Cam - Credits',
          description: `Buy ${requestedCredits.toLocaleString()} credits for NGN ${amount.toLocaleString()}`,
          logo: 'https://format-boy.cam/logo.png',
        },
        meta: {
          user_id: userId,
          requested_credits: requestedCredits,
          calculated_credits: calculatedCredits,
        },
      }),
    });

    const data = await response.json();

    if (data.status === 'success' && data.data?.link) {
      return res.status(200).json({
        status: 'success',
        payment_link: data.data.link,
        tx_ref,
        credits: calculatedCredits,
      });
    }

    console.error('Flutterwave init error:', data);
    return res.status(400).json({
      status: 'failed',
      message: data.message || 'Failed to initialize payment',
    });
  } catch (error) {
    console.error('Flutterwave init exception:', error);
    return res.status(500).json({
      status: 'failed',
      message: 'Internal server error while initializing payment',
    });
  }
}
