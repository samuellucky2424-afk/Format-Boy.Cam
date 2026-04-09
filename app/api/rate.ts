// @ts-nocheck
let cachedRate = null;
let cacheTimestamp = null;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const FALLBACK_RATE = 1500;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = Date.now();

    if (cachedRate && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION_MS) {
      return res.json({
        rate: cachedRate,
        cached: true,
        live: true,
        updatedAt: new Date(cacheTimestamp).toISOString(),
      });
    }

    const apiKey = process.env.VITE_EXCHANGE_RATE_API_KEY || process.env.EXCHANGE_RATE_API_KEY;

    if (!apiKey) {
      return res.json({
        rate: FALLBACK_RATE,
        cached: false,
        live: false,
        fallback: true,
        error: 'Missing exchange rate API key',
        updatedAt: new Date(now).toISOString(),
      });
    }

    const response = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`);

    if (!response.ok) {
      throw new Error(`Exchange rate API returned ${response.status}`);
    }

    const data = await response.json();

    if (data && data.conversion_rates && data.conversion_rates.NGN) {
      cachedRate = data.conversion_rates.NGN;
      cacheTimestamp = now;

      return res.json({
        rate: cachedRate,
        cached: false,
        live: true,
        updatedAt: new Date(cacheTimestamp).toISOString(),
      });
    }

    return res.json({
      rate: FALLBACK_RATE,
      cached: false,
      live: false,
      fallback: true,
      error: 'NGN rate not found in API response',
      updatedAt: new Date(now).toISOString(),
    });
  } catch (error) {
    const fallbackTimestamp = Date.now();

    return res.json({
      rate: FALLBACK_RATE,
      cached: false,
      live: false,
      fallback: true,
      error: error.message || 'Failed to fetch exchange rate',
      updatedAt: new Date(fallbackTimestamp).toISOString(),
    });
  }
}
