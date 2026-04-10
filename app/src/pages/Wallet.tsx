import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, ExternalLink, LogOut } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { PaymentModal } from '@/components/PaymentModal';

const CREDIT_PLANS = [
  { credits: 500, priceNGN: 18500 },
  { credits: 1000, priceNGN: 37000 },
  { credits: 2000, priceNGN: 74000 },
  { credits: 5000, priceNGN: 185000 },
];

const CREDITS_PER_SECOND = 2;

function Wallet() {
  const { credits, transactions } = useApp();
  const { user, logout } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<typeof CREDIT_PLANS[0] | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [showFundModal, setShowFundModal] = useState(false);

  const remainingSeconds = Math.floor(credits / CREDITS_PER_SECOND);

  const handleFundWallet = () => {
    if (!user) {
      toast.error('Please log in to buy credits.');
      return;
    }

    if (!selectedPlan) {
      toast.error('Please select a credit package.');
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
            Buy Credits
          </Button>
        </CardContent>
      </Card>

      {showFundModal && (
        <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20 mb-6 animate-in slide-in-from-top-2 duration-200">
          <CardHeader className="pb-4 border-b border-[#1f1f23]">
            <CardTitle className="text-sm font-medium text-[#71717a]">Buy Credits</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <label className="block text-xs font-medium text-[#a1a1aa] mb-3">Select Package</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {CREDIT_PLANS.map((plan) => (
                <button
                  key={plan.credits}
                  onClick={() => setSelectedPlan(plan)}
                  className={`p-4 rounded-xl border text-left transition-all duration-150 ${
                    selectedPlan?.credits === plan.credits
                      ? 'bg-blue-600/15 border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/10'
                      : 'bg-[#1a1a1f] border-[#27272a] text-white hover:border-[#3f3f46] hover:bg-[#222]'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className={`text-lg font-bold ${selectedPlan?.credits === plan.credits ? 'text-blue-400' : 'text-white'}`}>
                      {plan.credits.toLocaleString()} Credits
                    </span>
                    <span className="text-sm text-[#a1a1aa] mt-1">NGN {plan.priceNGN.toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </div>

            <Button
              onClick={handleFundWallet}
              disabled={!selectedPlan}
              className="w-full h-12 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
              id="proceed-payment-btn"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Pay {selectedPlan ? `NGN ${selectedPlan.priceNGN.toLocaleString()}` : 'with Flutterwave'}
            </Button>

            <p className="text-xs text-[#52525b] text-center mt-3">
              You&apos;ll be redirected to Flutterwave&apos;s secure payment page
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

      <PaymentModal
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
