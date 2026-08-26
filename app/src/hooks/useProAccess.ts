import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';

export interface ProAccessState {
  hasLicense: boolean;
  active: boolean;
  status: 'none' | 'pending' | 'active' | 'revoked';
  licenseId: string | null;
  creditsPerSecond: number | null;
  codeLast4: string | null;
  redeemedAt: string | null;
  contactPhone: string;
}

const EMPTY_ACCESS: ProAccessState = {
  hasLicense: false,
  active: false,
  status: 'none',
  licenseId: null,
  creditsPerSecond: null,
  codeLast4: null,
  redeemedAt: null,
  contactPhone: '237620124019',
};

export function useProAccess(userId?: string) {
  const [access, setAccess] = useState<ProAccessState>(EMPTY_ACCESS);
  const [loading, setLoading] = useState(Boolean(userId));

  const refresh = useCallback(async () => {
    if (!userId) {
      setAccess(EMPTY_ACCESS);
      setLoading(false);
      return EMPTY_ACCESS;
    }
    setLoading(true);
    try {
      const response = await apiFetch(`/pro-license?userId=${encodeURIComponent(userId)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not check PRO access.');
      setAccess(body as ProAccessState);
      return body as ProAccessState;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const redeem = useCallback(async (code: string) => {
    if (!userId) throw new Error('Sign in before activating PRO.');
    const response = await apiFetch('/pro-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, code }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not activate this PRO license.');
    setAccess(body as ProAccessState);
    return body as ProAccessState;
  }, [userId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh().catch(() => {}), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  return { access, loading, refresh, redeem };
}
