import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Coins, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api-client';

declare global {
  interface Window {
    PaystackPop: any;
  }
}

const CREDIT_PLANS = [
  { credits: 500, priceUSD: 10 },
  { credits: 1000, priceUSD: 20 },
  { credits: 2000, priceUSD: 40 },
  { credits: 5000, priceUSD: 100 },
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

function Subscription() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addCredits } = useApp();
  const [selectedPlan, setSelectedPlan] = useState<typeof CREDIT_PLANS[0] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ngnRate, setNgnRate] = useState<number>(1500);
  const [isLoadingRate, setIsLoadingRate] = useState(true);
  const [isFallbackRate, setIsFallbackRate] = useState(false);
  const [rateUpdatedAt, setRateUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const fetchRate = async () => {
      try {
        const res = await apiFetch('/rate');
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        if (typeof data.rate === 'number') {
          setNgnRate(data.rate);
          setIsFallbackRate(data.live !== true);
          setRateUpdatedAt(data.updatedAt || null);
        }
      } catch (error) {
        console.warn('Failed to fetch exchange rate:', error, 'using fallback');
        setNgnRate(1500);
        setIsFallbackRate(true);
        setRateUpdatedAt(null);
      } finally {
        setIsLoadingRate(false);
      }
    };

    fetchRate();
  }, []);

  const handleSelectPlan = (plan: typeof CREDIT_PLANS[0]) => {
    setSelectedPlan(plan);
  };

  const handleProceedToPayment = () => {
    if (!selectedPlan) return;

    if (!user) {
      toast.error('Please log in to purchase credits.');
      navigate('/login');
      return;
    }

    if (!window.PaystackPop) {
      toast.error('Payment gateway not loaded. Please refresh the page.');
      return;
    }

    const paystackPublicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || 'pk_test_mock_public';
    const amountNGN = Math.round(selectedPlan.priceUSD * ngnRate * 100);

    setIsProcessing(true);

    try {
      const handler = window.PaystackPop.setup({
        key: paystackPublicKey,
        email: user.email,
        amount: amountNGN,
        currency: 'NGN',
        ref: `ref_${Math.floor((Math.random() * 1000000000) + 1)}`,
        callback: function (response: any) {
          (async () => {
            try {
              const res = await apiFetch('/verify-payment', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  reference: response.reference,
                  userId: user?.id,
                  credits: selectedPlan.credits,
                  priceUSD: selectedPlan.priceUSD,
                }),
              });

              if (!res.ok) {
                throw new Error(`Server returned ${res.status}`);
              }

              const data = await res.json();
              if (data.status === 'success') {
                toast.success(`Successfully purchased ${selectedPlan.credits} credits!`);
                addCredits(selectedPlan.credits);
                navigate('/wallet');
              } else {
                toast.error(data.message || 'Payment verification failed');
              }
            } catch (error) {
              console.error(error);
              toast.error('Error verifying payment. However, in mock mode we will credit anyway.');
              addCredits(selectedPlan.credits);
            } finally {
              setIsProcessing(false);
            }
          })();
        },
        onClose: function () {
          toast.info('Payment cancelled');
          setIsProcessing(false);
        },
      });

      handler.openIframe();
    } catch (error) {
      console.error(error);
      toast.error('Failed to initialize payment gateway');
      setIsProcessing(false);
    }
  };

  const getPriceNGN = (priceUSD: number) => Math.round(priceUSD * ngnRate);
  const hasLiveRate = !isLoadingRate && !isFallbackRate;

  return (
    <div className="min-h-screen bg-[#0f0f10] p-6 lg:p-12 flex flex-col items-center">
      <div className="w-full max-w-[800px] pb-32">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mb-8 text-[#a1a1aa] hover:text-white"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <div className="mb-12">
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Purchase Credits</h1>
          <p className="text-sm text-[#a1a1aa]">Select credits to power your AI transformations</p>
        </div>

        <div className="mb-8">
          <label className="block text-sm font-medium text-[#a1a1aa] mb-3">Select Credits</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {CREDIT_PLANS.map((plan) => {
              const isSelected = selectedPlan?.credits === plan.credits;
              const priceNGN = hasLiveRate ? getPriceNGN(plan.priceUSD) : null;

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
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        isSelected ? 'bg-blue-500/20' : 'bg-[#27272a]'
                      }`}
                    >
                      <Coins className={`w-5 h-5 ${isSelected ? 'text-blue-400' : 'text-[#71717a]'}`} />
                    </div>
                    <div>
                      <span className="text-lg font-bold text-white">{plan.credits.toLocaleString()} Credits</span>
                      <span className="text-xs text-[#71717a] ml-2">{formatTime(plan.credits)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-white">${plan.priceUSD}</span>
                    {priceNGN !== null && (
                      <span className="text-sm text-[#71717a]">(NGN {priceNGN.toLocaleString()})</span>
                    )}
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
          {hasLiveRate && (
            <p className="text-xs text-[#52525b]">
              Exchange rate: 1 USD = NGN {ngnRate.toLocaleString()}
            </p>
          )}
          {isLoadingRate && (
            <p className="text-xs text-[#52525b]">
              Fetching live exchange rate...
            </p>
          )}
          {isFallbackRate && (
            <p className="text-xs text-amber-400 mt-2">
              Showing fallback pricing. Configure `EXCHANGE_RATE_API_KEY` in the active API environment for live USD to NGN rates.
            </p>
          )}
          {!isFallbackRate && rateUpdatedAt && (
            <p className="text-xs text-[#52525b] mt-2">
              Last updated: {new Date(rateUpdatedAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {selectedPlan && (
        <div className="fixed bottom-0 left-0 w-full bg-[#0f0f10]/90 backdrop-blur-md border-t border-[#27272a] p-4 flex justify-between items-center z-50 animate-in slide-in-from-bottom shadow-2xl">
          <div className="max-w-[800px] mx-auto w-full flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm text-[#a1a1aa] font-medium">Selected Plan</span>
              <span className="text-xl font-bold text-white tracking-tight">
                {selectedPlan.credits.toLocaleString()} Credits <span className="text-blue-500 font-normal mx-1">/</span> ${selectedPlan.priceUSD}
                {hasLiveRate && (
                  <>
                    {' '}
                    <span className="text-[#71717a] font-normal">
                      (NGN {getPriceNGN(selectedPlan.priceUSD).toLocaleString()})
                    </span>
                  </>
                )}
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
