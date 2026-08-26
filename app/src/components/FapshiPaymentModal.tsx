import { useState } from 'react';
import { Loader2, Smartphone, ShieldCheck } from 'lucide-react';
import { CosmicButton } from '@/components/ui/cosmic-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TextureButton } from '@/components/ui/texture-button';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { getApiUrl } from '@/lib/api-client';

interface FapshiPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: { id?: string; credits: number; priceXAF: number; priceUSD?: number } | null;
}

type ElectronIpcRenderer = {
  invoke: (channel: string, link: string) => Promise<unknown>;
};

function getElectronIpcRenderer(): ElectronIpcRenderer | null {
  if (typeof window === 'undefined') return null;

  try {
    const electronRequire = (window as Window & { require?: (id: string) => unknown }).require;
    if (!electronRequire) return null;
    const electron = electronRequire('electron') as { ipcRenderer?: ElectronIpcRenderer };
    return electron.ipcRenderer ?? null;
  } catch {
    return null;
  }
}

export function FapshiPaymentModal({ isOpen, onClose, plan }: FapshiPaymentModalProps) {
  const { user } = useAuth();
  const [isRedirecting, setIsRedirecting] = useState(false);

  if (!isOpen || !plan || !user) return null;

  const handlePay = async () => {
    setIsRedirecting(true);

    try {
      if (!plan.id) throw new Error('Invalid credit package');
      const ipcRenderer = getElectronIpcRenderer();

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const response = await fetch(getApiUrl('/payment/fapshi-init'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          packageId: plan.id,
          userId: user.id,
          returnToApp: Boolean(ipcRenderer),
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.link) {
        throw new Error(result.error || 'Failed to create the payment.');
      }

      const paymentLink = String(result.link);
      toast.success('Opening secure Fapshi checkout...');

      if (ipcRenderer) {
        await ipcRenderer.invoke('open-payment-link', paymentLink);
        setIsRedirecting(false);
        onClose();
      } else {
        window.location.assign(paymentLink);
      }
    } catch (error: unknown) {
      console.error('Fapshi payment error:', error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : 'Failed to start the payment',
      );
      setIsRedirecting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isRedirecting) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto border-blue-500/20 bg-card p-6 shadow-[0_24px_80px_hsl(var(--primary)/0.2)]"
        showCloseButton={!isRedirecting}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-tight text-foreground">
            Mobile Money payment
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            Pay securely with MTN Mobile Money or Orange Money through Fapshi.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-blue-500/15 bg-panel p-4">
          <div className="mb-2 flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Package</span>
            <span className="font-semibold text-foreground">{plan.credits.toLocaleString()} Credits</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Amount</span>
            <span className="text-xl font-bold text-primary">
              {plan.priceXAF > 0
                ? `${plan.priceXAF.toLocaleString()} FCFA`
                : plan.priceUSD
                  ? `$${plan.priceUSD.toLocaleString()}`
                  : '—'}
            </span>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-blue-500/15 bg-primary/5 p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            After payment, your request is reviewed by an administrator and credits are added to
            your wallet shortly.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <CosmicButton
            as="button"
            onClick={handlePay}
            disabled={isRedirecting}
            className="w-full"
            contentClassName="min-h-12"
          >
            {isRedirecting ? (
              <>
                <Loader2 className="mr-2 size-5 animate-spin" />
                Redirecting...
              </>
            ) : (
              <>
                <Smartphone className="mr-2 size-5" />
                Pay with Fapshi
              </>
            )}
          </CosmicButton>
          <TextureButton
            variant="minimal"
            size="lg"
            onClick={onClose}
            disabled={isRedirecting}
            className="w-full"
          >
            Cancel
          </TextureButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
