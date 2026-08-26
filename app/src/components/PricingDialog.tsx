import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Coins, Loader2, Zap } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FapshiPaymentModal } from '@/components/FapshiPaymentModal';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { TextureCard } from '@/components/ui/texture-card';
import { TextureButton } from '@/components/ui/texture-button';
import { PricingDialogContext } from '@/hooks/usePricingDialog';
import { useProAccess } from '@/hooks/useProAccess';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

export interface CreditPackage {
  id: string;
  credits: number;
  priceXAF: number;
  priceUSD: number;
  name?: string;
}

function formatPrice(plan: CreditPackage): string {
  if (plan.priceXAF > 0) return `${plan.priceXAF.toLocaleString()} FCFA`;
  if (plan.priceUSD > 0) return `$${plan.priceUSD.toLocaleString()}`;
  return 'Contact us';
}

function formatDuration(credits: number, rate = 2): string {
  const seconds = Math.floor(credits / rate);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    const remainingMinutes = Math.floor((seconds % 3600) / 60);
    return `${hours} h ${remainingMinutes} min`;
  }
  return minutes > 0 ? `${minutes} min ${remainingSeconds} s` : `${remainingSeconds} s`;
}

export function PricingDialogProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const { access: proAccess } = useProAccess(user?.id);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [dismissedQueryKey, setDismissedQueryKey] = useState<string | null>(null);
  const [plans, setPlans] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentPlan, setPaymentPlan] = useState<CreditPackage | null>(null);
  const loadStarted = useRef(false);
  const paymentTimer = useRef<number | null>(null);

  const buyRequested = new URLSearchParams(location.search).get('buy') === '1';
  const dialogOpen = pricingOpen || (buyRequested && dismissedQueryKey !== location.key);

  const openPricing = () => {
    setDismissedQueryKey(null);
    setPricingOpen(true);
  };

  const handlePricingOpenChange = (open: boolean) => {
    setPricingOpen(open);
    if (!open && buyRequested) setDismissedQueryKey(location.key);
  };

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;

    async function loadPlans() {
      try {
        const { data, error } = await supabase
          .from('credit_packages')
          .select('id, credits, price_xaf, price_usd, name')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('credits', { ascending: true });

        if (error) throw error;
        setPlans(
          (data ?? []).map((plan) => ({
            id: plan.id,
            credits: plan.credits,
            priceXAF: Number(plan.price_xaf || 0),
            priceUSD: Number(plan.price_usd || 0),
            name: plan.name || undefined,
          })),
        );
      } catch (error) {
        console.error('Failed to load credit packages:', error);
        toast.error('Failed to load credit packages.');
      } finally {
        setLoading(false);
      }
    }

    void loadPlans();
  }, []);

  useEffect(
    () => () => {
      if (paymentTimer.current !== null) window.clearTimeout(paymentTimer.current);
    },
    [],
  );

  const startCheckout = (plan: CreditPackage) => {
    handlePricingOpenChange(false);
    paymentTimer.current = window.setTimeout(() => {
      setPaymentPlan(plan);
      paymentTimer.current = null;
    }, 200);
  };

  const popularIndex = plans.length > 1 ? Math.floor(plans.length / 2) : -1;

  return (
    <PricingDialogContext.Provider value={{ openPricing }}>
      {children}

      <Dialog open={dialogOpen} onOpenChange={handlePricingOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] !max-w-[1120px] gap-0 overflow-hidden border-blue-500/15 bg-background/95 p-0 shadow-none backdrop-blur-xl sm:!max-w-[1120px]">
          <div className="custom-scrollbar overflow-y-auto px-4 py-8 sm:px-7 lg:px-10 lg:py-10">
            <DialogHeader className="mx-auto mb-8 max-w-3xl items-center text-center sm:text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Credits</p>
              <DialogTitle className="bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl">
                Pay per use. No subscription.
              </DialogTitle>
              <DialogDescription className="max-w-xl leading-relaxed">
                Pick the right amount for your next live sessions. Packs are calibrated for the
                current Reactor X2 rate and Henshin credits never expire.
              </DialogDescription>
            </DialogHeader>

            {loading ? (
              <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                Loading packages...
              </div>
            ) : plans.length === 0 ? (
              <div className="rounded-2xl border border-blue-500/15 bg-panel/70 px-6 py-14 text-center text-sm text-muted-foreground">
                No credit packages are currently available.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {plans.map((plan, index) => {
                  const popular = index === popularIndex;
                  return (
                    <TextureCard
                      key={plan.id}
                      className={`pricing-card relative min-h-[360px] overflow-hidden ${
                        popular
                          ? 'ring-1 ring-primary/60'
                          : ''
                      }`}
                    >
                      {popular && <div className="pricing-card-glow" aria-hidden />}
                      <div className="relative flex flex-1 flex-col gap-7 p-6 sm:p-7">
                        <div className="flex min-h-8 items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <Coins className="size-5 shrink-0 text-primary" strokeWidth={1.75} />
                            <span className="truncate text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
                              {plan.name || `${plan.credits.toLocaleString()} credits`}
                            </span>
                          </div>
                          {popular && (
                            <span className="flex shrink-0 items-center gap-1 rounded-lg border border-primary/25 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                              <Zap className="size-3.5" />
                              Popular
                            </span>
                          )}
                        </div>

                        <div>
                          <p className="text-3xl font-semibold tracking-[-0.04em] text-foreground xl:text-4xl">
                            {formatPrice(plan)}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">One-time payment</p>
                        </div>

                        <ul className="flex flex-1 flex-col gap-3 text-sm text-muted-foreground">
                          <li className="flex gap-2.5">
                            <Check className="mt-0.5 size-[18px] shrink-0 text-primary" />
                            <span><strong className="font-medium text-foreground">{plan.credits.toLocaleString()}</strong> Henshin credits</span>
                          </li>
                          <li className="flex gap-2.5">
                            <Check className="mt-0.5 size-[18px] shrink-0 text-primary" />
                            <span>About {formatDuration(plan.credits)} in Fast mode</span>
                          </li>
                          {proAccess.active && proAccess.creditsPerSecond && (
                            <li className="flex gap-2.5">
                              <Check className="mt-0.5 size-[18px] shrink-0 text-primary" />
                              <span>About {formatDuration(plan.credits, proAccess.creditsPerSecond)} in PRO mode</span>
                            </li>
                          )}
                          <li className="flex gap-2.5">
                            <Check className="mt-0.5 size-[18px] shrink-0 text-primary" />
                            <span>No expiration or hidden fee</span>
                          </li>
                        </ul>

                        {popular ? (
                          <CosmicButton
                            as="button"
                            onClick={() => startCheckout(plan)}
                            className="w-full"
                            contentClassName="min-h-12"
                          >
                            Choose this pack
                          </CosmicButton>
                        ) : (
                          <TextureButton
                            variant="secondary"
                            size="lg"
                            onClick={() => startCheckout(plan)}
                            className="w-full"
                          >
                            Choose this pack
                          </TextureButton>
                        )}
                      </div>
                    </TextureCard>
                  );
                })}
              </div>
            )}

            <p className="mt-7 text-center text-xs text-muted-foreground">
              Fast costs 2 Henshin credits per second. PRO uses the server-authoritative rate assigned to the license.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <FapshiPaymentModal
        isOpen={paymentPlan !== null}
        onClose={() => setPaymentPlan(null)}
        plan={paymentPlan}
      />
    </PricingDialogContext.Provider>
  );
}
