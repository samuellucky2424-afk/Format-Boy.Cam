import { useState, useEffect } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, ExternalLink, LogOut } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { CryptoPaymentModal } from '@/components/CryptoPaymentModal';
import { supabase } from '@/lib/supabase';
import { accessLabel, formatPlanPrice, type AccessPlanView } from '@/lib/access-plans';

const CREDITS_PER_SECOND = 2;

function Wallet() {
  const { credits, transactions } = useApp();
  const { user, logout } = useAuth();
  const [plans, setPlans] = useState<AccessPlanView[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<AccessPlanView | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [showFundModal, setShowFundModal] = useState(false);

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

  const remainingSeconds = Math.floor(credits / CREDITS_PER_SECOND);

  const handleFundWallet = () => {
    if (!user) {
      toast.error('Please log in to choose a plan.');
      return;
    }

    if (!selectedPlan) {
      toast.error('Please select a plan.');
      return;
    }

    setIsPaymentModalOpen(true);
  };

  return (
    <div className="max-w-[800px]">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Credits</h1>
          <p className="text-sm text-[#a1a1aa]">Manage your credits, estimate stream time, and review transactions</p>
        </div>
        <Button
          onClick={logout}
          variant="ghost"
          className="flex items-center gap-2 text-[#71717a] hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 rounded-xl transition-all px-4 h-10"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm font-medium">Logout</span>
        </Button>
      </div>

      <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20 mb-6">
        <CardHeader className="pb-4 border-b border-[#1f1f23]">
          <CardTitle className="text-sm font-medium text-[#71717a]">Available Credits</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-4xl font-semibold text-white mb-6 animate-pulse">
            {Math.round(credits).toLocaleString()} <span className="text-xl text-[#71717a]">Credits</span>
          </p>
          <p className="text-sm text-[#71717a] mb-6">
            Estimated remaining stream time: {Math.floor(remainingSeconds / 60)}m {remainingSeconds % 60}s
          </p>
          <Button
            onClick={() => setShowFundModal(!showFundModal)}
            className="h-11 px-6 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02]"
            id="fund-wallet-btn"
          >
            <Plus className="w-4 h-4 mr-2" />
            Choose a plan
          </Button>
        </CardContent>
      </Card>

      {showFundModal && (
        <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20 mb-6 animate-in slide-in-from-top-2 duration-200">
          <CardHeader className="pb-4 border-b border-[#1f1f23]">
            <CardTitle className="text-sm font-medium text-[#71717a]">Choose a plan</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <label className="block text-xs font-medium text-[#a1a1aa] mb-3">Select a plan</label>
            {loadingPlans ? (
              <div className="text-center py-4 text-[#71717a]">Loading packages...</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan)}
                    className={`p-4 rounded-xl border text-left transition-all duration-150 ${
                      selectedPlan?.id === plan.id
                        ? 'bg-blue-600/15 border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/10'
                        : 'bg-[#1a1a1f] border-[#27272a] text-white hover:border-[#3f3f46] hover:bg-[#222]'
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className={`text-lg font-bold ${selectedPlan?.id === plan.id ? 'text-blue-400' : 'text-white'}`}>
                        {plan.name}
                      </span>
                      <span className="text-sm text-[#a1a1aa] mt-1">{accessLabel(plan.durationDays, plan.planCode)}</span>
                      <span className="text-sm text-white mt-2">{formatPlanPrice(plan)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <Button
              onClick={handleFundWallet}
              disabled={!selectedPlan}
              className="w-full h-12 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
              id="proceed-payment-btn"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Pay {selectedPlan ? formatPlanPrice(selectedPlan) : 'Now'}
            </Button>

            <p className="text-xs text-[#52525b] text-center mt-3">
              Choose from the active payment methods configured by the administrator
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20">
        <CardHeader className="pb-4 border-b border-[#1f1f23]">
          <CardTitle className="text-sm font-medium text-[#71717a]">Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="text-center py-8 text-[#71717a]">No transactions found.</div>
          ) : (
            <div className="space-y-4 pt-4">
              {transactions.map((tx, index) => (
                <div key={tx.id}>
                  <div className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'credit' ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                        {tx.type === 'credit' ? (
                          <ArrowDownLeft className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <ArrowUpRight className="w-5 h-5 text-red-500" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {tx.description || (tx.type === 'credit' ? 'Credits purchased' : 'Stream usage')}
                        </p>
                        <p className="text-xs text-[#71717a]">{new Date(tx.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${tx.type === 'credit' ? 'text-emerald-500' : 'text-red-500'}`}>
                        {typeof tx.credits === 'number' && Number.isFinite(tx.credits)
                          ? `${tx.type === 'debit' ? '-' : '+'}${tx.credits.toLocaleString()} Credits`
                          : 'Credits unavailable'}
                      </p>
                      <p className="text-xs text-[#71717a]">Completed</p>
                    </div>
                  </div>
                  {index < transactions.length - 1 && <Separator className="bg-[#27272a]" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CryptoPaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setShowFundModal(false);
        }}
        plan={selectedPlan}
      />
    </div>
  );
}

export default Wallet;
