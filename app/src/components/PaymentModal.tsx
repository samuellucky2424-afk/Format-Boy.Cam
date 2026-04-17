import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { apiFetch, isTimeoutError } from '@/lib/api-client';
import { isFiniteNumber } from '@/lib/utils';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: { credits: number; priceNGN: number } | null;
}

type PaystackCallbackResponse = {
  reference: string;
};

type PaystackSetupOptions = {
  key: string;
  email: string;
  amount: number;
  ref?: string;
  access_code?: string;
  callback: (data: PaystackCallbackResponse) => void;
  onClose: () => void;
};

type PaystackHandler = {
  openIframe: () => void;
};

declare global {
  interface Window {
    PaystackPop?: {
      setup: (options: PaystackSetupOptions) => PaystackHandler;
    };
  }
}

function loadPaystackSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window.PaystackPop?.setup === 'function') {
      resolve();
      return;
    }

    const existing = document.querySelector('script[src*="js.paystack.co"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Paystack SDK')));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Paystack SDK'));
    document.head.appendChild(script);
  });
}

export function PaymentModal({ isOpen, onClose, plan }: PaymentModalProps) {
  const { user } = useAuth();
  const { refreshCredits } = useApp();
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<'initial' | 'initializing' | 'verifying' | 'success'>('initial');

  if (!isOpen || !plan || !user) return null;

  const handlePayNow = async () => {
    setIsProcessing(true);
    setStep('initializing');

    try {
      const initRes = await apiFetch('/payment/paystack-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          credits: plan.credits,
          email: user.email,
        }),
      });

      const initData = await initRes.json();
      
      if (!initRes.ok || initData.status !== 'success') {
        throw new Error(initData.message || 'Failed to initialize payment');
      }

      const reference = initData.reference;
      const amountKobo = initData.amountKobo;
      const accessCode = initData.access_code;

      await loadPaystackSDK();

      if (typeof window.PaystackPop?.setup !== 'function') {
        toast.error('Paystack SDK not loaded. Please refresh the page.');
        setIsProcessing(false);
        setStep('initial');
        return;
      }

      const handler = window.PaystackPop.setup({
        key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: amountKobo,
        ref: reference,
        ...(accessCode ? { access_code: accessCode } : {}),
        callback: async function (data: PaystackCallbackResponse) {
          setStep('verifying');
          try {
            const verifyRes = await apiFetch('/payment/paystack-verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reference: data.reference || reference,
              }),
              retries: 0,
              timeoutMs: 45_000,
            });
            const verifyData = await verifyRes.json();

            if (verifyData.status === 'success') {
              if (!isFiniteNumber(verifyData.creditsAdded)) {
                throw new Error('Invalid payment verification response');
              }

              try {
                await refreshCredits();
              } catch (syncError) {
                console.warn('Failed to refresh credits after payment:', syncError);
              }

              setStep('success');
              toast.success(`Payment verified! ${verifyData.creditsAdded.toLocaleString()} credits added.`);
              setTimeout(() => {
                onClose();
                setStep('initial');
                setIsProcessing(false);
              }, 2000);
            } else {
              if (verifyData.status === 'already_processed') {
                try {
                  await refreshCredits();
                } catch (syncError) {
                  console.warn('Failed to refresh credits after already-processed payment:', syncError);
                }
              }
              toast.error(verifyData.message || 'Payment verification failed');
              setStep('initial');
              setIsProcessing(false);
            }
          } catch (error) {
            if (isTimeoutError(error)) {
              toast.error('Payment verification is taking longer than expected. Your credits may still be applied shortly.');
            } else {
              console.error('Verification error:', error);
              toast.error('Unable to verify payment automatically. Contact support.');
            }
            setStep('initial');
            setIsProcessing(false);
          }
        },
        onClose: function () {
          if (step !== 'verifying' && step !== 'success') {
            setIsProcessing(false);
            setStep('initial');
          }
        },
      });

      handler.openIframe();
    } catch (error: unknown) {
      console.error('Payment flow error:', error);
      toast.error(error instanceof Error ? error.message : 'Unable to start payment. Please try again.');
      setIsProcessing(false);
      setStep('initial');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#131316] border border-[#27272a] rounded-2xl p-6 w-full max-w-md shadow-2xl relative">
        <button
          onClick={() => {
            if (!isProcessing) onClose();
          }}
          disabled={isProcessing}
          aria-label="Close"
          className="absolute top-4 right-4 text-[#71717a] hover:text-white disabled:opacity-50 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-2xl font-bold text-white mb-2">Confirm Purchase</h2>
        <p className="text-[#a1a1aa] text-sm mb-6">You are about to purchase credits.</p>

        <div className="bg-[#1a1a1f] border border-[#27272a] rounded-xl p-4 mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[#a1a1aa] text-sm">Package</span>
            <span className="text-white font-semibold">{plan.credits.toLocaleString()} Credits</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#a1a1aa] text-sm">Total</span>
            <span className="text-xl font-bold text-white">₦{plan.priceNGN.toLocaleString()}</span>
          </div>
        </div>

        {step === 'verifying' && (
          <div className="flex flex-col items-center justify-center py-4 mb-4 text-blue-400">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <p className="text-sm font-medium animate-pulse">Verifying payment, please wait...</p>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center justify-center py-4 mb-4 text-emerald-500">
            <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center mb-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <p className="text-sm font-medium">Payment Successful!</p>
          </div>
        )}

        {(step === 'initial' || step === 'initializing') && (
          <div className="flex flex-col gap-3">
            <Button
              onClick={handlePayNow}
              disabled={isProcessing}
              className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg transition-all"
            >
              {step === 'initializing' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Initializing...
                </>
              ) : (
                'Pay Now'
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isProcessing}
              className="w-full h-12 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-xl"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
