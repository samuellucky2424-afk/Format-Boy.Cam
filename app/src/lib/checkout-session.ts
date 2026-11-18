import type { SupabaseClient } from '@supabase/supabase-js';

type CheckoutAuth = Pick<SupabaseClient['auth'], 'getSession' | 'refreshSession'>;

export async function submitWithCheckoutSession(
  auth: CheckoutAuth,
  authUserId: string,
  submit: (accessToken: string) => Promise<Response>,
): Promise<Response> {
  const { data, error } = await auth.getSession();
  if (!error && data.session) {
    if (data.session.user.id !== authUserId) {
      throw new Error('Your account changed. Reopen checkout under the account you used to pay.');
    }
    const response = await submit(data.session.access_token);
    if (response.status !== 401) return response;
  }

  const { data: refreshed, error: refreshError } = await auth.refreshSession();
  if (refreshError?.name === 'AuthRetryableFetchError' || refreshError?.name === 'AuthUnknownError'
      || (refreshError?.status ?? 0) >= 500 || refreshError?.status === 429) {
    throw new Error('Could not verify your sign-in right now. Try submitting again without sending another payment.');
  }
  if (refreshError || !refreshed.session) {
    throw new Error('Sign in again, then submit your existing payment from the same account.');
  }
  if (refreshed.session.user.id !== authUserId) {
    throw new Error('Your account changed. Reopen checkout under the account you used to pay.');
  }

  // The checkout API returns 401 before a payment record can be created.
  const response = await submit(refreshed.session.access_token);
  if (response.status === 401) {
    throw new Error('Checkout could not verify your renewed sign-in. Keep your transaction receipt if you already paid.');
  }
  return response;
}
