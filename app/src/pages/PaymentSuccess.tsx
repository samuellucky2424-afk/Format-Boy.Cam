import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, ArrowRight, Coins } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { apiFetch, isAbortError, isTimeoutError } from '@/lib/api-client';
import { isFiniteNumber } from '@/lib/utils';

type VerifyState = 'verifying' | 'success' | 'already_processed' | 'failed';

function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshCredits } = useApp();

  const [state, setState] = useState<VerifyState>('verifying');
  const [message, setMessage] = useState('Verifying your payment...');
  const [creditedAmount, setCreditedAmount] = useState<number | null>(null);
  const [creditedCredits, setCreditedCredits] = useState<number | null>(null);

  useEffect(() => {
    const transactionId = searchParams.get('transaction_id');
    const txRef = searchParams.get('tx_ref');
    const status = searchParams.get('status');

    // If Flutterwave returned a non-successful status
    if (status && status !== 'successful' && status !== 'completed') {
      setState('failed');
      setMessage('Payment was not completed. Please try again.');
      return;
    }

    if (!transactionId) {
      setState('failed');
      setMessage('Missing transaction information. Please contact support.');
      return;
    }

    const controller = new AbortController();

    const verifyPayment = async () => {
      try {
        const res = await apiFetch('/payment/flutterwave-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_id: transactionId,
            tx_ref: txRef,
          }),
          signal: controller.signal,
          retries: 0,
          timeoutMs: 45_000,
        });

        const data = await res.json();

        if (data.status === 'success') {
          if (!isFiniteNumber(data.creditsAdded)) {
            throw new Error('Invalid payment verification response');
          }

          try {
            await refreshCredits();
          } catch (syncError) {
            console.warn('Failed to refresh credits after payment success:', syncError);
          }

          setState('success');
          setMessage(`${data.creditsAdded.toLocaleString()} credits have been added to your account.`);
          setCreditedAmount(isFiniteNumber(data.amountPaid) ? data.amountPaid : null);
          setCreditedCredits(data.creditsAdded);
          toast.success('Payment successful! Credits added.');
        } else if (data.status === 'already_processed') {
          try {
            await refreshCredits();
          } catch (syncError) {
            console.warn('Failed to refresh credits after already-processed payment:', syncError);
          }
          setState('already_processed');
          setMessage('This payment has already been processed.');
        } else {
          setState('failed');
          setMessage(data.message || 'Payment verification failed.');
          toast.error('Payment verification failed');
        }
      } catch (error) {
        if (isAbortError(error)) return;

        setState('failed');
        if (isTimeoutError(error)) {
          setMessage('Payment verification is taking longer than expected. The webhook may add your credits shortly.');
          return;
        }

        console.error('Verification error:', error);
        setMessage('Unable to verify payment. The webhook may add your credits shortly.');
      }
    };

    verifyPayment();
    return () => controller.abort();
  }, [refreshCredits, searchParams]);

  return (
    <div className="min-h-screen bg-[#0f0f10] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border border-[#1f1f23] rounded-2xl p-8 shadow-2xl shadow-black/40 text-center">
          {/* Status Icon */}
          <div className="mb-6">
            {state === 'verifying' && (
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-500/10 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              </div>
            )}
            {(state === 'success' || state === 'already_processed') && (
              <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center animate-in zoom-in duration-300">
                <CheckCircle className="w-10 h-10 text-emerald-500" />
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
            {state === 'verifying' && 'Verifying Payment'}
            {state === 'success' && 'Payment Successful!'}
            {state === 'already_processed' && 'Already Processed'}
            {state === 'failed' && 'Payment Failed'}
          </h1>

          {/* Message */}
          <p className="text-sm text-[#a1a1aa] mb-8">{message}</p>

          {/* Credited Amount Display */}
          {state === 'success' && (creditedAmount || creditedCredits) && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 mb-6">
              {creditedCredits && (
                <>
                  <p className="text-xs text-emerald-400/70 mb-1">Credits Added</p>
                  <p className="text-3xl font-bold text-emerald-400">
                    {creditedCredits.toLocaleString()} credits
                  </p>
                </>
              )}
              {creditedAmount && (
                <p className="text-xs text-[#a1a1aa] mt-2">Payment amount: NGN {creditedAmount.toLocaleString()}</p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3">
            {(state === 'success' || state === 'already_processed') && (
              <>
                <Button
                  onClick={() => navigate('/credits')}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02]"
                >
                  <Coins className="w-4 h-4 mr-2" />
                  Go to Credits
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => navigate('/dashboard')}
                  className="w-full h-10 text-[#a1a1aa] hover:text-white"
                >
                  Back to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </>
            )}

            {state === 'failed' && (
              <>
                <Button
                  onClick={() => navigate('/credits')}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02]"
                >
                  Try Again
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => navigate('/dashboard')}
                  className="w-full h-10 text-[#a1a1aa] hover:text-white"
                >
                  Back to Dashboard
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-[#52525b] mt-6">
          If your credits are not updated yet, please wait a moment and refresh the credits page.
          The system will automatically apply successful payments.
        </p>
      </div>
    </div>
  );
}

export default PaymentSuccess;
