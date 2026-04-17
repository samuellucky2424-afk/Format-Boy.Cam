// @ts-nocheck
const CREDIT_PRICING_NGN = {
  500: 14000,
  1000: 28000,
  2000: 56000,
  5000: 140000
};

function toKobo(amountNGN) {
  const amount = Number(amountNGN);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

export default async function handler(req, res) {
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
  const amountNGN = CREDIT_PRICING_NGN[requestedCredits as keyof typeof CREDIT_PRICING_NGN];

  if (!amountNGN) {
    return res.status(400).json({
      status: 'failed',
      message: 'Invalid credit package selected',
    });
  }

  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecretKey) {
    return res.status(500).json({
      status: 'failed',
      message: 'Paystack secret key not configured',
    });
  }

  const reference = `FMT-${Date.now()}-${userId}`;
  const amountKobo = toKobo(amountNGN);

  if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
    return res.status(500).json({
      status: 'failed',
      message: 'Invalid payment amount configuration',
    });
  }

  try {
    const initResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountKobo,
        reference,
        currency: 'NGN',
        metadata: {
          user_id: userId,
          credits: requestedCredits,
        },
      }),
    });

    const initData = await initResponse.json();

    if (!initResponse.ok || !initData?.status) {
      return res.status(400).json({
        status: 'failed',
        message: initData?.message || 'Failed to initialize Paystack transaction',
      });
    }

    return res.status(200).json({
      status: 'success',
      reference,
      amountNGN,
      amountKobo,
      credits: requestedCredits,
      authorization_url: initData?.data?.authorization_url,
      access_code: initData?.data?.access_code,
    });
  } catch (error) {
    console.error('Paystack init error:', error);
    return res.status(500).json({
      status: 'failed',
      message: 'Internal server error during payment initialization',
    });
  }
}
