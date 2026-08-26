import { ArrowDownLeft, ArrowUpRight, Plus, LogOut } from 'lucide-react';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { Separator } from '@/components/ui/separator';
import { TextureButton } from '@/components/ui/texture-button';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { usePricingDialog } from '@/hooks/usePricingDialog';
import { useProAccess } from '@/hooks/useProAccess';

const CREDITS_PER_SECOND = 2;

function Wallet() {
  const { credits, transactions } = useApp();
  const { user, logout } = useAuth();
  const { openPricing } = usePricingDialog();
  const { access: proAccess } = useProAccess(user?.id);

  const remainingSeconds = Math.floor(credits / CREDITS_PER_SECOND);
  const proRemainingSeconds = proAccess.active && proAccess.creditsPerSecond
    ? Math.floor(credits / proAccess.creditsPerSecond)
    : null;

  return (
    <div className="max-w-[800px]">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">Credits</h1>
          <p className="text-sm text-muted-foreground">Manage your credits, estimate stream time, and review transactions</p>
        </div>
        <TextureButton
          onClick={logout}
          variant="destructive"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm font-medium">Logout</span>
        </TextureButton>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">Available Credits</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="mb-6 text-4xl font-semibold text-foreground">
            <AnimatedNumber value={Math.round(credits)} /> <span className="text-xl text-muted-foreground">Credits</span>
          </p>
          <div className="mb-6 space-y-1 text-sm text-muted-foreground">
            <p>Fast at 2 cr/s: {Math.floor(remainingSeconds / 60)}m {remainingSeconds % 60}s remaining</p>
            {proRemainingSeconds !== null && (
              <p>
                PRO at {proAccess.creditsPerSecond} cr/s: {Math.floor(proRemainingSeconds / 60)}m {proRemainingSeconds % 60}s remaining
              </p>
            )}
          </div>
          <CosmicButton
            as="button"
            onClick={openPricing}
            id="fund-wallet-btn"
          >
            <Plus className="w-4 h-4 mr-2" />
            Buy Credits
          </CosmicButton>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-muted-foreground">Transaction History</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No transactions found.</div>
          ) : (
            <div className="space-y-4 pt-4">
              {transactions.map((tx, index) => (
                <div key={tx.id}>
                  <div className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex size-10 items-center justify-center rounded-full ${tx.type === 'credit' ? 'bg-primary/10' : 'bg-destructive/10'}`}>
                        {tx.type === 'credit' ? (
                          <ArrowDownLeft className="size-5 text-primary" />
                        ) : (
                          <ArrowUpRight className="size-5 text-destructive" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {tx.description || (tx.type === 'credit' ? 'Credits purchased' : 'Stream usage')}
                        </p>
                        <p className="text-xs text-muted-foreground">{new Date(tx.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${tx.type === 'credit' ? 'text-primary' : 'text-destructive'}`}>
                        {typeof tx.credits === 'number' && Number.isFinite(tx.credits)
                          ? `${tx.type === 'debit' ? '-' : '+'}${tx.credits.toLocaleString()} Credits`
                          : 'Credits unavailable'}
                      </p>
                      <p className="text-xs text-muted-foreground">Completed</p>
                    </div>
                  </div>
                  {index < transactions.length - 1 && <Separator className="bg-blue-500/10" />}
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
