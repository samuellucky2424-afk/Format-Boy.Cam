import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { isSameAccountIdentity } from '../api/auth';
import { isAuthorizedFalRealtimeApp } from '../server/fal-realtime-token';
import {
  generateLicenseCode,
  hashLicenseCode,
  normalizeLicenseCode,
  publicLicenseStatus,
  resolveSessionCreditsPerSecond,
} from '../server/pro-utils';

describe('PRO authorization', () => {
  test('accepts only the authenticated account or its matching email identity', () => {
    const authUser = { id: 'auth-user', email: 'client@example.com' };
    expect(isSameAccountIdentity(authUser, 'auth-user')).toBe(true);
    expect(isSameAccountIdentity(authUser, 'legacy-user', 'CLIENT@example.com')).toBe(true);
    expect(isSameAccountIdentity(authUser, 'other-user', 'attacker@example.com')).toBe(false);
    expect(isSameAccountIdentity({ id: 'auth-user' }, 'other-user', '')).toBe(false);
  });

  test('restricts realtime tokens to Lucy 2.5 exactly', () => {
    expect(isAuthorizedFalRealtimeApp('decart/lucy-2-5/realtime')).toBe(true);
    expect(isAuthorizedFalRealtimeApp('decart/lucy2-vton/realtime')).toBe(false);
    expect(isAuthorizedFalRealtimeApp('fal-ai/fast-lcm-diffusion/realtime')).toBe(false);
  });
});

describe('PRO licenses and rates', () => {
  test('generates a one-time code format and stores only its deterministic hash', () => {
    const code = generateLicenseCode();
    expect(code).toMatch(/^HENSHIN-PRO-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    expect(hashLicenseCode(code)).toHaveLength(64);
    expect(hashLicenseCode(`  ${code.toLowerCase()}  `)).toBe(hashLicenseCode(code));
    expect(normalizeLicenseCode(` ${code.toLowerCase()} `)).toBe(code);
  });

  test('exposes a rate only after redemption activates the account-bound license', () => {
    expect(publicLicenseStatus({ id: 'license', status: 'pending', credits_per_second: 80 }).creditsPerSecond).toBeNull();
    expect(publicLicenseStatus({ id: 'license', status: 'active', credits_per_second: 46 }).creditsPerSecond).toBe(46);
  });

  test('selects Fast, negotiated PRO, and default future PRO rates server-side', () => {
    expect(resolveSessionCreditsPerSecond('reactor', null)).toBe(2);
    expect(resolveSessionCreditsPerSecond('fal', { status: 'active', credits_per_second: 46 })).toBe(46);
    expect(resolveSessionCreditsPerSecond('fal', { status: 'active', credits_per_second: 80 })).toBe(80);
    expect(resolveSessionCreditsPerSecond('fal', { status: 'revoked', credits_per_second: 80 })).toBeNull();
  });
});

describe('database security contract', () => {
  test('stays within the Vercel Hobby serverless function limit', async () => {
    const apiFiles = await readdir(join(import.meta.dir, '../api'), { recursive: true });
    const functions = apiFiles.filter((name) => /\.(?:ts|js)$/.test(String(name)));
    expect(functions).toHaveLength(12);
  });

  test('keeps billing idempotent and starts it only after usable provider output', async () => {
    const baseSql = await Bun.file(join(import.meta.dir, '../../supabase/20260824_billed_session_history.sql')).text();
    const proSql = await Bun.file(join(import.meta.dir, '../../supabase/20260826_pro_mode_fal.sql')).text();
    expect(baseSql).toContain('transactions_one_successful_debit_per_session_idx');
    expect(baseSql).toContain("IF v_session.status <> 'active' THEN");
    expect(proSql).toContain("'provider_output_usable_at', v_started_at");
    expect(proSql).toContain('COALESCE(v_session.billable_started_at, clock_timestamp())');
    expect(proSql).toContain('reconcile_stale_billed_sessions');
    const cronApi = await Bun.file(join(import.meta.dir, '../server/reconcile-sessions.ts')).text();
    const vercelConfig = await Bun.file(join(import.meta.dir, '../vercel.json')).json();
    expect(cronApi).toContain('Bearer ${cronSecret}');
    expect(cronApi).toContain('p_stale_after_seconds: 15');
    expect(vercelConfig.crons).toEqual([{ path: '/api/reconcile-sessions', schedule: '0 3 * * *' }]);
  });

  test('makes audit immutable and admin mutations service-role only', async () => {
    const sql = await Bun.file(join(import.meta.dir, '../../supabase/20260826_pro_mode_fal.sql')).text();
    const adminApi = await Bun.file(join(import.meta.dir, '../server/admin.ts')).text();
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.admin_audit_log');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.admin_decide_payment');
    expect(sql).toContain('TO service_role');
    expect(sql).toContain("'payment.' || p_status");
    expect(adminApi).toContain('await requireAdminUser(req)');
    expect(adminApi).toContain("action === 'adjust-credits'");
    expect(adminApi).toContain("action === 'manage-license'");
    expect(adminApi).toContain("action === 'decide-payment'");
  });
});
