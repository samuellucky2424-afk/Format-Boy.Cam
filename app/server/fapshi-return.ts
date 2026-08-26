// @ts-nocheck
// GET /api/payment/fapshi-return
// HTTPS bridge required because Fapshi rejects custom-protocol redirect URLs.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANS_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const ALLOWED_STATUSES = new Set(['CREATED', 'PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED']);

function readQueryValue(value) {
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  );

  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const paymentId = readQueryValue(req.query?.ref);
  const transId = readQueryValue(req.query?.transId);
  const status = readQueryValue(req.query?.status).toUpperCase();

  if (!UUID_PATTERN.test(paymentId) || (transId && !TRANS_ID_PATTERN.test(transId))) {
    return res.status(400).send('Invalid payment return parameters');
  }

  const params = new URLSearchParams({ ref: paymentId });
  if (transId) params.set('transId', transId);
  if (ALLOWED_STATUSES.has(status)) params.set('status', status);

  const deepLink = `henshin://payment-success?${params.toString()}`;
  const scriptDeepLink = JSON.stringify(deepLink).replace(/</g, '\\u003c');
  const attributeDeepLink = deepLink.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Return to Henshin</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #101218; color: #e8eaf0; }
      main { width: min(360px, calc(100vw - 40px)); text-align: center; }
      p { color: #9299a8; line-height: 1.5; }
      a { display: inline-block; margin-top: 12px; padding: 12px 18px; border-radius: 10px; background: #6197ff; color: white; font-weight: 650; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>Payment received</h1>
      <p>Returning you to the Henshin application...</p>
      <a href="${attributeDeepLink}">Open Henshin</a>
    </main>
    <script>window.location.replace(${scriptDeepLink});</script>
  </body>
</html>`);
}
