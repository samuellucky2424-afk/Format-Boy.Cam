import process from 'node:process';

const required = [
  'VITE_API_BASE_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FAPSHI_BASE_URL',
  'FAPSHI_APIUSER',
  'FAPSHI_APIKEY',
  'FAPSHI_WEBHOOK_SECRET',
  'APP_PUBLIC_URL',
  'PAYMENT_RETURN_URL',
  'FAPSHI_APP_RETURN_URL',
  'REACTOR_API_KEY',
];

const urlVariables = [
  'VITE_API_BASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_URL',
  'FAPSHI_BASE_URL',
  'APP_PUBLIC_URL',
  'PAYMENT_RETURN_URL',
  'FAPSHI_APP_RETURN_URL',
];

const errors = [];
for (const name of required) {
  const value = String(process.env[name] || '').trim();
  if (!value) errors.push(`${name} is missing`);
  if (/your[_-]|placeholder|example\.com/i.test(value)) errors.push(`${name} still contains a placeholder`);
}

for (const name of urlVariables) {
  const value = String(process.env[name] || '').trim();
  if (!value) continue;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') errors.push(`${name} must use HTTPS`);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      errors.push(`${name} must not point to localhost in production`);
    }
  } catch {
    errors.push(`${name} is not a valid URL`);
  }
}

if (String(process.env.FAPSHI_BASE_URL || '').replace(/\/+$/, '') !== 'https://live.fapshi.com') {
  errors.push('FAPSHI_BASE_URL must be https://live.fapshi.com in production');
}

if (errors.length) {
  console.error(`Vercel production preflight failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}

console.log('Vercel production environment preflight passed.');
