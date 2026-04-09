import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, Loader2, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';

const FUND_AMOUNTS = [500, 1000, 2000, 5000, 10000, 20000];
const CREDITS_PER_SECOND = 2;
const NGN_PER_CREDIT = 30;

function Wallet() {
  const { credits, transactions } = useApp();
  const { user } = useAuth();
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showFundModal, setShowFundModal] = useState(false);

  const fundAmount = selectedAmount || Number(customAmount) || 0;
  const estimatedCredits = Math.floor(fundAmount / NGN_PER_CREDIT);
  const remainingSeconds = Math.floor(credits / CREDITS_PER_SECOND);

  const handleFundWallet = async () => {
    if (!user) {
      toast.error('Please log in to buy credits.');
      return;
    }

    if (fundAmount < 100) {
      toast.error('Minimum purchase amount is NGN 100');
      return;
    }

    setIsProcessing(true);

    try {
      const res = await apiFetch('/payment/flutterwave-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          amount: fundAmount,
          email: user.email,
        }),
      });

      const data = await res.json();

      if (data.status === 'success' && data.payment_link) {
        // Redirect to Flutterwave payment page
        window.location.href = data.payment_link;
      } else {
        toast.error(data.message || 'Failed to initialize payment');
      }
    } catch (error) {
      console.error('Payment init error:', error);
      toast.error('Unable to start payment. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-[800px]">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Credits</h1>
        <p className="text-sm text-[#a1a1aa]">Manage your credits, estimate stream time, and review transactions</p>
      </div>

      {/* Credits Card */}
      <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20 mb-6">
        <CardHeader className="pb-4 border-b border-[#1f1f23]">
          <CardTitle className="text-sm font-medium text-[#71717a]">Available Credits</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-4xl font-semibold text-white mb-6 animate-pulse">{Math.round(credits).toLocaleString()} <span className="text-xl text-[#71717a]">Credits</span></p>
          <p className="text-sm text-[#71717a] mb-6">Estimated remaining stream time: {Math.floor(remainingSeconds / 60)}m {remainingSeconds % 60}s</p>
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

      {/* Credit Purchase Panel */}
      {showFundModal && (
        <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20 mb-6 animate-in slide-in-from-top-2 duration-200">
          <CardHeader className="pb-4 border-b border-[#1f1f23]">
            <CardTitle className="text-sm font-medium text-[#71717a]">Buy Credits</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {/* Preset amounts */}
            <label className="block text-xs font-medium text-[#a1a1aa] mb-3">Select Amount (NGN)</label>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {FUND_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => { setSelectedAmount(amt); setCustomAmount(''); }}
                  className={`p-3 rounded-xl border text-center font-semibold transition-all duration-150 ${
                    selectedAmount === amt
                      ? 'bg-blue-600/15 border-blue-500 text-blue-400 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/10'
                      : 'bg-[#1a1a1f] border-[#27272a] text-white hover:border-[#3f3f46] hover:bg-[#222]'
                  }`}
                  id={`fund-amount-${amt}`}
                >
                  NGN {amt.toLocaleString()}
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-[#a1a1aa] mb-2">Or enter custom amount</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#71717a] text-sm font-medium">NGN</span>
                <input
                  type="number"
                  value={customAmount}
                  onChange={(e) => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
                  placeholder="Enter amount (min NGN 100)"
                  min={100}
                  className="w-full h-11 pl-14 pr-4 bg-[#1a1a1f] border border-[#27272a] rounded-xl text-white text-sm placeholder:text-[#52525b] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                  id="custom-fund-amount"
                />
              </div>
            </div>

            <div className="mb-5 rounded-xl border border-[#27272a] bg-[#17171b] p-4">
              <p className="text-xs font-medium text-[#a1a1aa] mb-1">Estimated credits from this payment</p>
              <p className="text-lg font-semibold text-white">{estimatedCredits.toLocaleString()} credits</p>
              <p className="text-xs text-[#71717a] mt-1">That is about {Math.floor((estimatedCredits / CREDITS_PER_SECOND) / 60)}m {Math.floor(estimatedCredits / CREDITS_PER_SECOND) % 60}s of stream time.</p>
            </div>

            {/* Pay button */}
            <Button
              onClick={handleFundWallet}
              disabled={isProcessing || fundAmount < 100}
              className="w-full h-12 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
              id="proceed-payment-btn"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Initializing...
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Pay NGN {fundAmount > 0 ? fundAmount.toLocaleString() : '0'} with Flutterwave
                </>
              )}
            </Button>

            <p className="text-xs text-[#52525b] text-center mt-3">
              You'll be redirected to Flutterwave's secure payment page
            </p>
          </CardContent>
        </Card>
      )}

      {/* Transaction History */}
      <Card className="bg-gradient-to-br from-[#131316] to-[#0f0f10] border-[#1f1f23] overflow-hidden rounded-2xl shadow-2xl shadow-black/20">
        <CardHeader className="pb-4 border-b border-[#1f1f23]">
          <CardTitle className="text-sm font-medium text-[#71717a]">Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="text-center py-8 text-[#71717a]">
              No transactions found.
            </div>
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
                        <p className="text-xs text-[#71717a]">
                          {new Date(tx.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${tx.type === 'credit' ? 'text-emerald-500' : 'text-red-500'}`}>
                        {tx.type === 'debit' ? '-' : '+'}{(tx.credits || 0).toLocaleString()} Credits
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
    </div>
  );
}

export default Wallet;
