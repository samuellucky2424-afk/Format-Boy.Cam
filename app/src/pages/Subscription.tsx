import { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, Loader2, LogIn, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { apiFetch, isTimeoutError, isAbortError } from '@/lib/api-client';
import { ROUTES } from '@/lib/routes';
import { isFiniteNumber } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { CryptoPaymentModal } from '@/components/CryptoPaymentModal';
import { accessLabel, formatPlanPrice, type AccessPlanView } from '@/lib/access-plans';

function Subscription() {
  const navigate = useNavigate();
  const { user, logout, loading: authLoading } = useAuth();
  const { refreshCredits } = useApp();
  const [plans, setPlans] = useState<AccessPlanView[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<AccessPlanView | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    async function loadPlans() {
      try {
        const { data, error } = await supabase
          .from('credit_packages')
          .select('id, name, price_ngn, price_usd, duration_days, plan_code')
          .eq('is_active', true)
          .order('sort_order', { ascending: true });

        if (error) throw error;
        if (data) {
          setPlans(data.map(p => ({
            id: p.id,
            name: p.name || 'Plan',
            priceNGN: Number(p.price_ngn),
            priceUSD: Number(p.price_usd || 0),
            durationDays: p.duration_days == null ? null : Number(p.duration_days),
            planCode: p.plan_code,
          })));
        }
      } catch (err) {
        console.error('Failed to load plans:', err);
        toast.error('Failed to load plans.');
      } finally {
        setLoadingPlans(false);
      }
    }
    loadPlans();
  }, []);

  const handleSelectPlan = (plan: AccessPlanView) => {
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
      toast.error('Please log in to choose a plan.');
      navigate(ROUTES.PUBLIC.LOGIN);
      return;
    }

    setIsProcessing(true);
    // Show crypto modal instead of paystack logic
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
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Choose a plan</h1>
          <p className="text-sm text-[#a1a1aa]">
            {user
              ? `Signed in as ${user.email}. Pick how long you want access.`
              : 'Pick how long you want access.'}
          </p>
        </div>

        <div className="mb-8">
          <label className="block text-sm font-medium text-[#a1a1aa] mb-3">Plans</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {loadingPlans ? (
              <div className="col-span-full text-center py-8 text-[#71717a]">Loading plans...</div>
            ) : (
              plans.map((plan) => {
                const isSelected = selectedPlan?.id === plan.id;

                return (
                  <button
                    key={plan.id}
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
                        <CalendarClock className={`w-5 h-5 ${isSelected ? 'text-blue-400' : 'text-[#71717a]'}`} />
                      </div>
                      <div>
                        <span className="text-lg font-bold text-white leading-tight block">{plan.name}</span>
                        <span className="text-xs text-[#71717a] block mt-0.5">{accessLabel(plan.durationDays, plan.planCode)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                       <span className="text-2xl font-bold text-white">
                         {formatPlanPrice(plan)}
                       </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-[#131316] border border-[#27272a] rounded-xl p-5 mb-8">
          <h3 className="text-sm font-semibold text-white mb-2">How access works</h3>
          <ul className="text-sm text-[#a1a1aa] space-y-1">
            <li>- $100 gives 14 days of access</li>
            <li>- $250 gives 30 days of access</li>
            <li>- $500 does not expire</li>
            <li>- Buying another timed plan extends the current end date</li>
          </ul>
        </div>
      </div>

      {selectedPlan && (
        <div className="fixed bottom-0 left-0 w-full bg-[#0f0f10]/90 backdrop-blur-md border-t border-[#27272a] p-4 flex justify-between items-center z-50 animate-in slide-in-from-bottom shadow-2xl">
          <div className="max-w-[1400px] mx-auto w-full flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm text-[#a1a1aa] font-medium">Selected Plan</span>
              <span className="text-xl font-bold text-white tracking-tight">
                {selectedPlan.name} <span className="text-blue-500 font-normal mx-1">/</span> {formatPlanPrice(selectedPlan)}
              </span>
              <span className="text-xs text-[#71717a] mt-1">{accessLabel(selectedPlan.durationDays, selectedPlan.planCode)}</span>
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

      <CryptoPaymentModal
        isOpen={isProcessing}
        onClose={() => setIsProcessing(false)}
        plan={selectedPlan}
      />
    </div>
  );
}

export default Subscription;
