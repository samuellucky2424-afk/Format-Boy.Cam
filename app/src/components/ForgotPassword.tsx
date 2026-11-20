import { useEffect, useState } from 'react';
import type { ComponentProps, FormEvent } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import {
  accountNeutralMessage,
  clearRecoverySession,
  EMAIL_FORMAT_MESSAGE,
  isValidAccountEmail,
  normalizeAccountEmail,
  normalizeResetCode,
  PASSWORD_MIN_LENGTH,
  requestPasswordResetCode,
  RESEND_COOLDOWN_SECONDS,
  updatePasswordAfterRecovery,
  verifyPasswordResetCode,
} from '@/lib/password-reset';
import { getPasswordResetAuth } from '@/lib/supabase';

type Step = 'email' | 'code' | 'password';
type PendingAction = 'send' | 'verify' | 'update';

interface ForgotPasswordProps {
  initialEmail: string;
  onBack: (email: string) => void;
}

const fieldClassName = 'h-11 bg-[#27272a] border-[#3f3f46] text-white placeholder:text-[#71717a]';

function ForgotPassword({ initialEmail, onBack }: ForgotPasswordProps) {
  const { login, clearError } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const busy = pending !== null;

  const startCooldown = (seconds: number | null) => {
    setCooldown(seconds && seconds > 0 ? seconds : RESEND_COOLDOWN_SECONDS);
  };

  const showFailure = (result: { message: string; retryAfterSeconds: number | null }) => {
    setErrorMessage(result.message);
    if (result.retryAfterSeconds || result.message.startsWith('Too many attempts')) {
      startCooldown(result.retryAfterSeconds);
    }
  };

  const returnToSignIn = () => {
    void clearRecoverySession(getPasswordResetAuth());
    onBack(email);
  };

  const handleSend = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || cooldown > 0) return;

    setErrorMessage(null);
    setPending('send');
    try {
      const result = await requestPasswordResetCode(getPasswordResetAuth(), email);
      if (!result.ok) {
        showFailure(result);
        return;
      }
      setCode('');
      setStep('code');
      startCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      setPending(null);
    }
  };

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setErrorMessage(null);
    setPending('verify');
    try {
      const result = await verifyPasswordResetCode(getPasswordResetAuth(), email, code);
      if (!result.ok) {
        showFailure(result);
        return;
      }
      setPassword('');
      setConfirmation('');
      setStep('password');
    } finally {
      setPending(null);
    }
  };

  const handleUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setErrorMessage(null);
    setPending('update');
    try {
      const auth = getPasswordResetAuth();
      const result = await updatePasswordAfterRecovery(auth, password, confirmation);
      if (!result.ok) {
        setErrorMessage(result.message);
        return;
      }

      const accountEmail = normalizeAccountEmail(email);
      await clearRecoverySession(auth);
      try {
        await login(accountEmail, password);
        toast.success('Password updated');
      } catch {
        clearError();
        toast.success('Password updated. Sign in with your new password.');
        onBack(accountEmail);
      }
    } finally {
      setPending(null);
    }
  };

  const openCodeStep = () => {
    if (!isValidAccountEmail(email)) {
      setErrorMessage(EMAIL_FORMAT_MESSAGE);
      return;
    }
    setErrorMessage(null);
    setStep('code');
  };

  return (
    <>
      <CardHeader className="pb-6">
        <CardTitle className="text-xl font-semibold text-white text-center">
          {step === 'password' ? 'Choose a new password' : step === 'code' ? 'Enter your code' : 'Reset your password'}
        </CardTitle>
        <p className="text-sm text-[#a1a1aa] text-center break-words">
          {step === 'email' && 'Enter your email. If an account exists, we will send a 6-digit code.'}
          {step === 'code' && accountNeutralMessage(email)}
          {step === 'password' && `Use at least ${PASSWORD_MIN_LENGTH} characters.`}
        </p>
      </CardHeader>
      <CardContent>
        {step === 'email' && (
          <form onSubmit={handleSend} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="reset-email" className="text-sm font-medium text-[#a1a1aa]">
                Email
              </label>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={fieldClassName}
                disabled={busy}
                autoFocus
                required
              />
            </div>
            {errorMessage && <FormError message={errorMessage} />}
            <Button
              type="submit"
              disabled={busy || cooldown > 0}
              className="w-full h-11 bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-medium disabled:opacity-50"
            >
              {pending === 'send' ? (
                <LoadingLabel label="Sending code..." />
              ) : cooldown > 0 ? (
                `Send code in ${cooldown}s`
              ) : (
                'Send code'
              )}
            </Button>
            <div className="flex items-center justify-between">
              <TextButton type="button" onClick={returnToSignIn} disabled={busy}>
                Back to sign in
              </TextButton>
              <TextButton type="button" onClick={openCodeStep} disabled={busy}>
                Already have a code?
              </TextButton>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="reset-code" className="text-sm font-medium text-[#a1a1aa]">
                6-digit code
              </label>
              <Input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(event) => setCode(normalizeResetCode(event.target.value))}
                className={`${fieldClassName} text-center text-lg tracking-[0.4em]`}
                disabled={busy}
                autoFocus
                required
                aria-invalid={errorMessage ? true : undefined}
              />
            </div>
            {errorMessage && <FormError message={errorMessage} />}
            <Button
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-medium disabled:opacity-50"
            >
              {pending === 'verify' ? <LoadingLabel label="Checking code..." /> : 'Verify code'}
            </Button>
            <div className="flex items-center justify-between">
              <TextButton
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setStep('email');
                }}
                disabled={busy}
              >
                Use a different email
              </TextButton>
              <TextButton type="button" onClick={() => void handleSend()} disabled={busy || cooldown > 0}>
                {pending === 'send' ? 'Sending code...' : cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </TextButton>
            </div>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <PasswordField
              id="reset-password"
              label="New password"
              value={password}
              onChange={setPassword}
              visible={showPassword}
              onToggle={() => setShowPassword((current) => !current)}
              disabled={busy}
              autoFocus
            />
            <PasswordField
              id="reset-password-confirm"
              label="Confirm password"
              value={confirmation}
              onChange={setConfirmation}
              visible={showConfirmation}
              onToggle={() => setShowConfirmation((current) => !current)}
              disabled={busy}
            />
            {errorMessage && <FormError message={errorMessage} />}
            <Button
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-medium disabled:opacity-50"
            >
              {pending === 'update' ? <LoadingLabel label="Updating password..." /> : 'Update password'}
            </Button>
            <div className="text-center">
              <TextButton type="button" onClick={returnToSignIn} disabled={busy}>
                Back to sign in
              </TextButton>
            </div>
          </form>
        )}
      </CardContent>
    </>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-red-400">
      {message}
    </p>
  );
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </span>
  );
}

function TextButton({
  className,
  ...props
}: ComponentProps<'button'>) {
  return (
    <button
      className={`text-sm text-[#2563eb] hover:text-[#3b82f6] font-medium disabled:text-[#52525b] disabled:hover:text-[#52525b] ${className || ''}`}
      {...props}
    />
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  visible,
  onToggle,
  disabled,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-[#a1a1aa]">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="Enter your password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${fieldClassName} pr-10`}
          disabled={disabled}
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-white transition-colors"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          disabled={disabled}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export default ForgotPassword;
