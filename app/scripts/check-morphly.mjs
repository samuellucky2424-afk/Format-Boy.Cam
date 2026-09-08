// Run on the server: node --env-file=.env.vercel scripts/check-morphly.mjs
// This is a free key validation request; it never creates a realtime session.
const key = process.env.MORPHLY_API_KEY;
if (!key) {
  console.error('MORPHLY_API_KEY is missing. Enter it directly in server settings.');
  process.exitCode = 1;
} else {
  try {
    const response = await fetch('https://api.morphly.fun/v1/realtime/validate-key', {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store', signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({}));
    console.log(JSON.stringify({
      status: response.status,
      valid: body.valid === true,
      code: typeof body.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(body.code) ? body.code : undefined,
      realtime_available: typeof body.realtime_available === 'boolean' ? body.realtime_available : undefined,
      realtime_configured: typeof body.realtime_configured === 'boolean' ? body.realtime_configured : undefined,
      session_creation_enabled: typeof body.session_creation_enabled === 'boolean' ? body.session_creation_enabled : undefined,
    }));
    if (!response.ok || body.valid !== true || body.realtime_configured === false ||
        body.session_creation_enabled === false || body.realtime_available === false) process.exitCode = 1;
  } catch {
    console.error('Morphly key validation could not reach the service. No session was started.');
    process.exitCode = 1;
  }
}
