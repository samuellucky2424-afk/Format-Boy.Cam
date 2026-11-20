/**
 * Email-code password reset for the desktop app.
 *
 * The recovery email must contain the 6-digit code (`{{ .Token }}`).
 * This module never tells the user whether an address has an account.
 */

export const RESEND_COOLDOWN_SECONDS = 60;
export const PASSWORD_MIN_LENGTH = 6;
export const RECOVERY_OTP_TYPE = 'recovery' as const;

export const ACCOUNT_NEUTRAL_MESSAGE =
  'If an account exists for that email, we sent a 6-digit code. Check your inbox and spam folder.';

export function accountNeutralMessage(email: string): string {
  const shown = normalizeAccountEmail(email);
  if (!shown) return ACCOUNT_NEUTRAL_MESSAGE;
  return `If an account exists for ${shown}, we sent a 6-digit code. Check your inbox and spam folder.`;
}

export const CODE_REJECTED_MESSAGE =
  'That code is incorrect or has expired. Check the code or request a new one.';

export const CODE_FORMAT_MESSAGE = 'Enter the 6-digit code from the email.';

export const EMAIL_FORMAT_MESSAGE = 'Enter a valid email address.';

export const PASSWORD_MISMATCH_MESSAGE = 'Passwords do not match.';

export const REQUEST_FAILED_MESSAGE = "We couldn't send a code right now. Try again in a moment.";

export const VERIFY_FAILED_MESSAGE = "We couldn't verify that code. Try again.";

export const UPDATE_FAILED_MESSAGE = "We couldn't update your password. Try again.";

export const TIMEOUT_MESSAGE = 'The request timed out. Check your connection and try again.';

export const CONNECTION_MESSAGE = 'Connection problem. Check your internet and try again.';

const REQUEST_TIMEOUT_MS = 20_000;
const PROVIDER_NAME = /supabase|morphly/i;

export interface PasswordResetError {
  message?: string;
  code?: string;
  status?: number;
}

export interface PasswordResetAuth {
  resetPasswordForEmail: (
    email: string,
  ) => PromiseLike<{ data: unknown; error: PasswordResetError | null }>;
  verifyOtp: (params: {
    email: string;
    token: string;
    type: typeof RECOVERY_OTP_TYPE;
  }) => PromiseLike<{
    data: { session: unknown | null };
    error: PasswordResetError | null;
  }>;
  updateUser: (attributes: {
    password: string;
  }) => PromiseLike<{ data: unknown; error: PasswordResetError | null }>;
  signOut: (options?: { scope?: 'local' }) => PromiseLike<{ error: PasswordResetError | null }>;
}

export type PasswordResetStage = 'request' | 'verify' | 'update';

export type PasswordResetResult =
  | { ok: true }
  | { ok: false; message: string; retryAfterSeconds: number | null };

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidAccountEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeAccountEmail(email));
}

export function normalizeResetCode(code: string): string {
  return code.replace(/\D/g, '').slice(0, 6);
}

export function passwordLengthMessage(length = PASSWORD_MIN_LENGTH): string {
  return `Password must be at least ${length} characters.`;
}

export function validateNewPassword(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return passwordLengthMessage();
  }
  if (password !== confirmation) {
    return PASSWORD_MISMATCH_MESSAGE;
  }
  return null;
}

export function retryAfterSeconds(error: PasswordResetError | null | undefined): number | null {
  const text = errorText(error);
  const match = /(?:after|every|wait)\s+(\d+)\s*second/i.exec(text);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function mapPasswordResetError(error: unknown, stage: PasswordResetStage): {
  message: string;
  concealAccount: boolean;
} {
  const authError = asAuthError(error);
  const code = (authError?.code || '').toLowerCase();
  const text = errorText(authError ?? error);
  const status = authError?.status;

  if (stage === 'request' && isUnknownAccount(code, text)) {
    return { message: ACCOUNT_NEUTRAL_MESSAGE, concealAccount: true };
  }

  if (stage === 'request' && isInvalidEmail(code, text)) {
    return { message: safeMessage(EMAIL_FORMAT_MESSAGE), concealAccount: false };
  }

  if (isRateLimited(code, text, status)) {
    const seconds = retryAfterSeconds(authError);
    const wait = seconds ? ` Wait ${seconds} seconds and try again.` : ' Wait a while and try again.';
    return { message: safeMessage(`Too many attempts.${wait}`), concealAccount: false };
  }

  if (isConnectionProblem(text)) {
    return { message: safeMessage(CONNECTION_MESSAGE), concealAccount: false };
  }

  if (stage === 'verify' && isRejectedCode(code, text)) {
    return { message: safeMessage(CODE_REJECTED_MESSAGE), concealAccount: false };
  }

  if (stage === 'update' && isWeakPassword(code, text)) {
    const length = /at least (\d+)/i.exec(text)?.[1];
    if (length) {
      const parsed = Number(length);
      return {
        message: safeMessage(passwordLengthMessage(Number.isFinite(parsed) ? parsed : PASSWORD_MIN_LENGTH)),
        concealAccount: false,
      };
    }
    return {
      message: safeMessage('Choose a stronger password of at least 6 characters.'),
      concealAccount: false,
    };
  }

  if (stage === 'update' && (code === 'same_password' || text.includes('different from the old'))) {
    return {
      message: safeMessage('Choose a different password than your current one.'),
      concealAccount: false,
    };
  }

  if (
    stage === 'update' &&
    (code === 'session_not_found' ||
      code === 'session_expired' ||
      code === 'reauthentication_needed' ||
      text.includes('session') ||
      text.includes('reauthentication') ||
      status === 401)
  ) {
    return {
      message: safeMessage('Your reset session expired. Request a new code and try again.'),
      concealAccount: false,
    };
  }

  const fallback =
    stage === 'request' ? REQUEST_FAILED_MESSAGE : stage === 'verify' ? VERIFY_FAILED_MESSAGE : UPDATE_FAILED_MESSAGE;
  return { message: safeMessage(fallback), concealAccount: false };
}

export async function requestPasswordResetCode(
  auth: PasswordResetAuth,
  email: string,
): Promise<PasswordResetResult> {
  const normalized = normalizeAccountEmail(email);
  if (!isValidAccountEmail(normalized)) {
    return failure(EMAIL_FORMAT_MESSAGE);
  }

  try {
    const { error } = await withTimeout(Promise.resolve(auth.resetPasswordForEmail(normalized)), TIMEOUT_MESSAGE);
    if (!error) return { ok: true };
    const mapped = mapPasswordResetError(error, 'request');
    if (mapped.concealAccount) return { ok: true };
    return failure(mapped.message, retryAfterSeconds(error));
  } catch (error) {
    return failure(mapPasswordResetError(error, 'request').message);
  }
}

export async function verifyPasswordResetCode(
  auth: PasswordResetAuth,
  email: string,
  code: string,
): Promise<PasswordResetResult> {
  const normalized = normalizeAccountEmail(email);
  const token = normalizeResetCode(code);
  if (!isValidAccountEmail(normalized)) {
    return failure(EMAIL_FORMAT_MESSAGE);
  }
  if (token.length !== 6) {
    return failure(CODE_FORMAT_MESSAGE);
  }

  try {
    const { data, error } = await withTimeout(
      Promise.resolve(auth.verifyOtp({ email: normalized, token, type: RECOVERY_OTP_TYPE })),
      TIMEOUT_MESSAGE,
    );
    if (error) {
      return failure(mapPasswordResetError(error, 'verify').message, retryAfterSeconds(error));
    }
    if (!data?.session) {
      return failure(CODE_REJECTED_MESSAGE);
    }
    return { ok: true };
  } catch (error) {
    return failure(mapPasswordResetError(error, 'verify').message);
  }
}

export async function updatePasswordAfterRecovery(
  auth: PasswordResetAuth,
  password: string,
  confirmation: string,
): Promise<PasswordResetResult> {
  const validation = validateNewPassword(password, confirmation);
  if (validation) return failure(validation);

  try {
    const { error } = await withTimeout(Promise.resolve(auth.updateUser({ password })), TIMEOUT_MESSAGE);
    if (error) return failure(mapPasswordResetError(error, 'update').message);
    return { ok: true };
  } catch (error) {
    return failure(mapPasswordResetError(error, 'update').message);
  }
}

/** Drops the in-memory recovery session without revoking the account's other sessions. */
export async function clearRecoverySession(auth: PasswordResetAuth): Promise<void> {
  try {
    await auth.signOut({ scope: 'local' });
  } catch {
    // The password change already succeeded. Signing in does not depend on this cleanup.
  }
}

function failure(message: string, retryAfterSeconds: number | null = null): PasswordResetResult {
  return { ok: false, message: safeMessage(message), retryAfterSeconds };
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), REQUEST_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function asAuthError(error: unknown): PasswordResetError | null {
  if (!error || typeof error !== 'object') return null;
  return error as PasswordResetError;
}

function errorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error.toLowerCase();
  if (typeof error === 'object') {
    const authError = error as PasswordResetError;
    return `${authError.message || ''} ${authError.code || ''}`.toLowerCase();
  }
  return '';
}

function isUnknownAccount(code: string, text: string): boolean {
  return (
    code === 'user_not_found' ||
    text.includes('user not found') ||
    text.includes('email not found') ||
    text.includes('no user found')
  );
}

function isInvalidEmail(code: string, text: string): boolean {
  return code === 'email_address_invalid' || text.includes('invalid email') || text.includes('unable to validate email');
}

function isRateLimited(code: string, text: string, status: number | undefined): boolean {
  return (
    status === 429 ||
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    code === 'over_sms_send_rate_limit' ||
    text.includes('rate limit') ||
    text.includes('too many requests') ||
    text.includes('too many attempts') ||
    text.includes('only request this')
  );
}

function isConnectionProblem(text: string): boolean {
  return (
    text.includes('failed to fetch') ||
    text.includes('network') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('fetch failed')
  );
}

function isRejectedCode(code: string, text: string): boolean {
  return (
    code === 'otp_expired' ||
    code === 'otp_disabled' ||
    text.includes('expired') ||
    text.includes('invalid') ||
    text.includes('token')
  );
}

function isWeakPassword(code: string, text: string): boolean {
  return (
    code === 'weak_password' ||
    text.includes('at least') ||
    text.includes('weak') ||
    text.includes('leaked') ||
    text.includes('easy to guess') ||
    text.includes('pwned')
  );
}

function safeMessage(message: string): string {
  if (PROVIDER_NAME.test(message)) {
    return 'Something went wrong. Try again.';
  }
  return message;
}
