import { useState } from 'react';
import { ArrowLeft, ArrowRight, Coins, Loader2, LogIn, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { apiFetch, isTimeoutError, isAbortError } from '@/lib/api-client';
import { ROUTES } from '@/lib/routes';
import { isFiniteNumber } from '@/lib/utils';

const CREDIT_PLANS = [
  { credits: 500, priceNGN: 14000 },
  { credits: 1000, priceNGN: 28000 },
  { credits: 2000, priceNGN: 56000 },
  { credits: 5000, priceNGN: 140000 },
];

function formatTime(credits: number): string {
  const seconds = credits / 2;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `~${minutes}m ${remainingSeconds}s`;
  }

  return `~${remainingSeconds}s`;
}

function loadPaystackSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof (window as any).PaystackPop?.setup === 'function') {
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

function Subscription() {
  const navigate = useNavigate();
  const { user, logout, loading: authLoading } = useAuth();
  const { refreshCredits } = useApp();
  const [selectedPlan, setSelectedPlan] = useState<typeof CREDIT_PLANS[0] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSelectPlan = (plan: typeof CREDIT_PLANS[0]) => {
    setSelectedPlan(plan);
  };

  const handleAuthAction = () => {
    if (user) {
      void logout();
      return;
    }

    navigate(ROUTES.PUBLIC.LOGIN);
  };

  const handleProceedToPayment = async () => {
    if (!selectedPlan) return;

    if (!user) {
      toast.error('Please log in to purchase credits.');
      navigate(ROUTES.PUBLIC.LOGIN);
      return;
    }

    setIsProcessing(true);

    try {
      await loadPaystackSDK();

      if (typeof (window as any).PaystackPop?.setup !== 'function') {
        toast.error('Paystack SDK not loaded. Please refresh the page.');
        setIsProcessing(false);
        return;
      }

      const initRes = await apiFetch('/payment/paystack-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          credits: selectedPlan.credits,
          email: user.email,
        }),
        retries: 0,
        timeoutMs: 45_000,
      });

      const initData = await initRes.json();
      if (!initRes.ok || initData.status !== 'success') {
        throw new Error(initData.message || 'Failed to initialize payment');
      }

      const reference = initData.reference;
      const amountKobo = initData.amountKobo;
      const accessCode = initData.access_code;

      const handler = (window as any).PaystackPop.setup({
        key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: amountKobo,
        ref: reference,
        ...(accessCode ? { access_code: accessCode } : {}),
        callback: async function (data: any) {
          setIsProcessing(true);
          try {
            const res = await apiFetch('/payment/paystack-verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reference: data?.reference || reference,
              }),
              retries: 0,
              timeoutMs: 45_000,
            });
            const verifyData = await res.json();

            if (verifyData.status === 'success') {
              if (!isFiniteNumber(verifyData.creditsAdded)) {
                throw new Error('Invalid payment verification response');
              }

              try {
                await refreshCredits();
              } catch (syncError) {
                console.warn('Failed to refresh credits after payment success:', syncError);
              }

              toast.success(`Payment verified! ${verifyData.creditsAdded.toLocaleString()} credits added.`);
              setSelectedPlan(null);
            } else if (verifyData.status === 'already_processed') {
              try {
                await refreshCredits();
              } catch (syncError) {
                console.warn('Failed to refresh credits after already-processed payment:', syncError);
              }
              toast.success('Payment already processed.');
            } else {
              toast.error(verifyData.message || 'Payment verification failed');
            }
          } catch (error) {
            if (isTimeoutError(error)) {
              toast.error('Payment verification is taking longer than expected. Your credits may still be applied shortly.');
            } else if (isAbortError(error)) {
            } else {
              console.error('Verification error payload:', error);
              toast.error('Unable to verify payment automatically.');
            }
          } finally {
            setIsProcessing(false);
          }
        },
        onClose: function () {
          setIsProcessing(false);
        },
      });

      handler.openIframe();
    } catch (error) {
      console.error('Payment init error:', error);
      toast.error('Unable to start payment. Please try again.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f10] p-6 lg:p-12 flex flex-col items-center">
      <div className="w-full max-w-[1400px] pb-32">
        <div className="mb-8 flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="text-[#a1a1aa] hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={handleAuthAction}
            disabled={authLoading}
            className="border border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#18181b]"
          >
            {authLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {user ? 'Signing out...' : 'Checking session...'}
              </>
            ) : user ? (
              <>
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4 mr-2" />
                Login
              </>
            )}
          </Button>
        </div>

        <div className="mb-12">
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Purchase Credits</h1>
          <p className="text-sm text-[#a1a1aa]">
            {user
              ? `Signed in as ${user.email}. Select credits to power your AI transformations`
              : 'Select credits to power your AI transformations'}
          </p>
        </div>

        <div className="mb-8">
          <label className="block text-sm font-medium text-[#a1a1aa] mb-3">Select Credits</label>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {CREDIT_PLANS.map((plan) => {
              const isSelected = selectedPlan?.credits === plan.credits;
              const priceNGN = plan.priceNGN;

              return (
                <button
                  key={plan.credits}
                  onClick={() => handleSelectPlan(plan)}
                  className={`p-5 rounded-xl border text-left transition-all duration-200 ${
                    isSelected
                      ? 'bg-gradient-to-br from-blue-600/15 via-blue-600/5 to-transparent border-blue-500 shadow-xl shadow-blue-500/20 ring-2 ring-blue-500/50'
                      : 'bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#27272a] hover:border-[#3f3f46] hover:bg-[#1a1a1f]'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                     <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-blue-500/20' : 'bg-[#27272a]'
                      }`}
                    >
                      <Coins className={`w-5 h-5 ${isSelected ? 'text-blue-400' : 'text-[#71717a]'}`} />
                    </div>
                    <div>
                      <span className="text-lg font-bold text-white leading-tight block">{plan.credits.toLocaleString()} Credits</span>
                      <span className="text-xs text-[#71717a] block mt-0.5">{formatTime(plan.credits)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                     <span className="text-2xl font-bold text-white">₦{priceNGN.toLocaleString()}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-[#131316] border border-[#27272a] rounded-xl p-5 mb-8">
          <h3 className="text-sm font-semibold text-white mb-2">How credits work</h3>
          <ul className="text-sm text-[#a1a1aa] space-y-1">
            <li>- 2 credits are deducted per second of stream time</li>
            <li>- 500 credits is about 4 minutes 10 seconds</li>
            <li>- 1000 credits is about 8 minutes 20 seconds</li>
            <li>- Credits never expire</li>
          </ul>
        </div>

        <div className="text-center">
          <p className="text-sm text-[#71717a] mb-4">All purchases are one-time. No subscriptions or hidden fees.</p>
        </div>
      </div>

      {selectedPlan && (
        <div className="fixed bottom-0 left-0 w-full bg-[#0f0f10]/90 backdrop-blur-md border-t border-[#27272a] p-4 flex justify-between items-center z-50 animate-in slide-in-from-bottom shadow-2xl">
          <div className="max-w-[1400px] mx-auto w-full flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm text-[#a1a1aa] font-medium">Selected Plan</span>
              <span className="text-xl font-bold text-white tracking-tight">
                {selectedPlan.credits.toLocaleString()} Credits <span className="text-blue-500 font-normal mx-1">/</span> ₦{selectedPlan.priceNGN.toLocaleString()}
              </span>
              <span className="text-xs text-[#71717a] mt-1">{formatTime(selectedPlan.credits)} estimated time</span>
            </div>
            <Button
              onClick={handleProceedToPayment}
              disabled={isProcessing}
              className="h-12 px-8 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 hover:scale-105 transition-all"
            >
              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : 'Pay Now'}
              {!isProcessing && <ArrowRight className="w-5 h-5 ml-2" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Subscription;
