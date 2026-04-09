import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Coins, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { apiFetch } from '@/lib/api-client';
import { PaymentModal } from '@/components/PaymentModal';
const CREDIT_PLANS = [
  { credits: 500, priceNGN: 18500 },
  { credits: 1000, priceNGN: 37000 },
  { credits: 2000, priceNGN: 74000 },
  { credits: 5000, priceNGN: 185000 },
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
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
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

  const handleProceedToPayment = async () => {
    if (!selectedPlan) return;

    if (!user) {
      toast.error('Please log in to purchase credits.');
      navigate('/login');
      return;
    }

    const amountNGN = selectedPlan.priceNGN;

    setIsProcessing(true);

    try {
      const tx_ref = `FMT-${Date.now()}-${user.id}`;
      if (typeof (window as any).FlutterwaveCheckout === "function") {
        (window as any).FlutterwaveCheckout({
          public_key: import.meta.env.VITE_FLUTTERWAVE_PUBLIC_KEY,
          tx_ref: tx_ref,
          amount: amountNGN,
          currency: "NGN",
          payment_options: "card, mobilemoneyghana, ussd",
          customer: { email: user.email },
          customizations: {
            title: "Format-Boy Cam - Credits",
            description: `Buy ${selectedPlan.credits.toLocaleString()} credits for ₦${amountNGN.toLocaleString()}`,
            logo: "/favicon.png",
          },
          callback: async function (data: any) {
            setIsProcessing(true);
            try {
              const res = await apiFetch('/payment/flutterwave-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  transaction_id: data.transaction_id,
                  tx_ref: tx_ref,
                }),
              });
              const verifyData = await res.json();
              if (verifyData.status === 'success') {
                toast.success(`Payment verified! ${verifyData.creditsAdded?.toLocaleString() || 0} credits added.`);
                if (typeof verifyData.creditsAdded === 'number') {
                  addCredits(verifyData.creditsAdded);
                }
                setSelectedPlan(null);
              } else {
                toast.error(verifyData.message || 'Payment verification failed');
              }
            } catch (error) {
              console.error('Verification error:', error);
              toast.error('Unable to verify payment automatically.');
            } finally {
              setIsProcessing(false);
            }
          },
          onclose: function () {
            setIsProcessing(false);
          }
        });
      } else {
        toast.error('Flutterwave SDK not loaded. Please refresh the page.');
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('Payment init error:', error);
      toast.error('Unable to start payment. Please try again.');
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
                    <span className="text-xl font-bold text-white">₦{priceNGN.toLocaleString()}</span>
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
          <div className="max-w-[800px] mx-auto w-full flex items-center justify-between">
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
