import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, ArrowRight, Coins, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { AnimatedNumber } from '@/components/ui/animated-number';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { TextureCard } from '@/components/ui/texture-card';
import { TextureButton } from '@/components/ui/texture-button';
import { useApp } from '@/context/AppContext';
import { apiFetch } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';

type VerifyState = 'verifying' | 'success' | 'awaiting_admin' | 'processing' | 'failed';

const MAX_STATUS_CHECKS = 6;
const STATUS_POLL_INTERVAL_MS = 4_000;

interface FapshiStatusResponse {
  providerStatus?: string;
  paymentStatus?: string;
  credits?: number;
  amount?: number;
  currency?: string;
}

function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshCredits } = useApp();

  const [state, setState] = useState<VerifyState>('verifying');
  const [message, setMessage] = useState('Checking your payment...');
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [paidCurrency, setPaidCurrency] = useState<string>('XAF');
  const [paidCredits, setPaidCredits] = useState<number | null>(null);
  const [checkRequest, setCheckRequest] = useState(0);

  const externalSearchParams = new URLSearchParams(window.location.search);
  const paymentId = searchParams.get('ref') || externalSearchParams.get('ref');
  const transactionId = searchParams.get('transId') || externalSearchParams.get('transId');

  useEffect(() => {
    const controller = new AbortController();

    const checkPayment = async () => {
      try {
        setState('verifying');
        setMessage('Checking your payment...');

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          throw new Error('Your session has expired. Please sign in again.');
        }

        const reference = paymentId || transactionId;
        if (!reference) {
          setState('failed');
          setMessage('Missing transaction information. Please contact support.');
          return;
        }

        const queryKey = paymentId ? 'ref' : 'transId';

        for (let attempt = 0; attempt < MAX_STATUS_CHECKS; attempt += 1) {
          const res = await apiFetch(
            `/payment/fapshi-status?${queryKey}=${encodeURIComponent(reference)}`,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${session.access_token}` },
              signal: controller.signal,
              retries: 1,
              timeoutMs: 30_000,
            },
          );

          const data: FapshiStatusResponse & { error?: string } = await res.json();

          if (!res.ok) {
            if (res.status === 404) {
              setState('failed');
              setMessage(data.error || 'This payment could not be found. Please contact support.');
              return;
            }
            throw new Error(data.error || 'Unable to check the payment.');
          }

          setPaidAmount(Number.isFinite(data.amount) ? Number(data.amount) : null);
          setPaidCurrency(String(data.currency || 'XAF'));
          setPaidCredits(Number.isFinite(data.credits as number) ? Number(data.credits) : null);

          if (
            data.paymentStatus === 'failed' ||
            data.providerStatus === 'FAILED' ||
            data.providerStatus === 'EXPIRED'
          ) {
            setState('failed');
            setMessage(
              data.providerStatus === 'EXPIRED'
                ? 'The payment link expired before the payment was completed.'
                : 'The payment failed or was declined. No credits were added.',
            );
            toast.error('Payment failed');
            return;
          }

          // `paymentStatus` becomes "completed" once an admin confirmed and credited.
          if (data.paymentStatus === 'completed') {
            try {
              await refreshCredits();
            } catch (syncError) {
              console.warn('Failed to refresh credits:', syncError);
            }
            setState('success');
            setMessage(
              `${(data.credits ?? 0).toLocaleString()} credits have been added to your account.`,
            );
            toast.success('Payment confirmed! Credits added.');
            return;
          }

          if (data.providerStatus === 'SUCCESSFUL') {
            setState('awaiting_admin');
            setMessage(
              'We received your payment. An administrator is reviewing it and your credits will be added shortly.',
            );
            return;
          }

          if (attempt < MAX_STATUS_CHECKS - 1) {
            setState('processing');
            setMessage('Your Mobile Money payment is still processing. We will check again shortly.');
            await new Promise<void>((resolve) => {
              const timer = window.setTimeout(resolve, STATUS_POLL_INTERVAL_MS);
              controller.signal.addEventListener(
                'abort',
                () => {
                  window.clearTimeout(timer);
                  resolve();
                },
                { once: true },
              );
            });
            if (controller.signal.aborted) return;
          }
        }

        setState('processing');
        setMessage('Your payment is still processing. You can check again without starting a new payment.');
      } catch (error) {
        if (controller.signal.aborted) return;

        setState('failed');
        console.error('Payment status check error:', error);
        setMessage(
          error instanceof Error && error.message
            ? error.message
            : 'Unable to check the payment. Please contact support if you were charged.',
        );
      }
    };

    checkPayment();
    return () => controller.abort();
  }, [checkRequest, paymentId, refreshCredits, transactionId]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <TextureCard contentClassName="p-8 text-center">
          {/* Status Icon */}
          <div className="mb-6">
            {(state === 'verifying' || state === 'processing') && (
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-500/10 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              </div>
            )}
            {(state === 'success' || state === 'awaiting_admin') && (
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-500/10 flex items-center justify-center animate-in zoom-in duration-300">
                {state === 'awaiting_admin' ? (
                  <ShieldCheck className="w-10 h-10 text-blue-400" />
                ) : (
                  <CheckCircle className="w-10 h-10 text-blue-400" />
                )}
              </div>
            )}
            {state === 'failed' && (
              <div className="w-20 h-20 mx-auto rounded-full bg-red-500/10 flex items-center justify-center animate-in zoom-in duration-300">
                <XCircle className="w-10 h-10 text-red-500" />
              </div>
            )}
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">
            {state === 'verifying' && 'Checking Payment'}
            {state === 'processing' && 'Payment In Progress'}
            {state === 'awaiting_admin' && 'Payment Received'}
            {state === 'success' && 'Payment Confirmed!'}
            {state === 'failed' && 'Payment Failed'}
          </h1>

          {/* Message */}
          <p className="mb-8 text-sm text-muted-foreground">{message}</p>

          {/* Amount Display */}
          {(state === 'success' || state === 'awaiting_admin') && (paidAmount || paidCredits) && (
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 mb-6">
              {paidCredits && state === 'success' && (
                <>
                  <p className="text-xs text-blue-300/70 mb-1">Credits Added</p>
                  <p className="text-3xl font-bold text-blue-300">
                     <AnimatedNumber value={paidCredits} /> credits
                  </p>
                </>
              )}
              {paidCredits && state === 'awaiting_admin' && (
                <>
                  <p className="text-xs text-blue-300/70 mb-1">Credits Incoming</p>
                  <p className="text-3xl font-bold text-blue-300">
                     <AnimatedNumber value={paidCredits} /> credits
                  </p>
                </>
              )}
              {paidAmount && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Paid amount: {paidAmount.toLocaleString()} {paidCurrency === 'XAF' ? 'FCFA' : paidCurrency}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3">
            {(state === 'processing' || state === 'failed') && (paymentId || transactionId) && (
              <TextureButton
                variant="secondary"
                size="lg"
                onClick={() => setCheckRequest((request) => request + 1)}
                className="w-full"
              >
                Check again
              </TextureButton>
            )}

            {(state === 'success' || state === 'awaiting_admin' || state === 'processing') && (
              <>
                <CosmicButton
                  as="button"
                  onClick={() => navigate('/credits')}
                  className="w-full"
                  contentClassName="min-h-12"
                >
                  <Coins className="w-4 h-4 mr-2" />
                  Go to Credits
                </CosmicButton>
                <TextureButton
                  variant="minimal"
                  onClick={() => navigate('/dashboard')}
                  className="w-full"
                >
                  Back to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </TextureButton>
              </>
            )}

            {state === 'failed' && (
              <>
                <CosmicButton
                  as="button"
                  onClick={() => navigate('/credits')}
                  className="w-full"
                  contentClassName="min-h-12"
                >
                  Try Again
                </CosmicButton>
                <TextureButton
                  variant="minimal"
                  onClick={() => navigate('/dashboard')}
                  className="w-full"
                >
                  Back to Dashboard
                </TextureButton>
              </>
            )}
          </div>
        </TextureCard>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-muted-foreground/60">
          Credits are added once an administrator confirms your payment, usually within a few
          minutes.
        </p>
      </div>
    </div>
  );
}

export default PaymentSuccess;
