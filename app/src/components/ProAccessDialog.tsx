import { useState } from 'react';
import { KeyRound, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TextureButton } from '@/components/ui/texture-button';
import type { ProAccessState } from '@/hooks/useProAccess';

export function ProAccessDialog({
  open,
  access,
  onOpenChange,
  onRedeem,
}: {
  open: boolean;
  access: ProAccessState;
  onOpenChange: (open: boolean) => void;
  onRedeem: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const phone = access.contactPhone || '237620124019';
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent('Bonjour, je souhaite obtenir une licence Henshin PRO pour mon compte.')}`;

  const activate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onRedeem(code);
      setCode('');
      onOpenChange(false);
      toast.success('Henshin PRO is now active on this account.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'PRO activation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="size-5 text-blue-400" /> Unlock Henshin PRO</DialogTitle>
          <DialogDescription>
            Lucy 2.5 PRO requires a license assigned by administration and enough wallet credits.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={activate} className="space-y-3">
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="HENSHIN-PRO-XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            required
          />
          <TextureButton type="submit" variant="accent" disabled={busy} className="w-full">
            {busy ? 'Activating...' : 'Activate license'}
          </TextureButton>
        </form>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> No license yet? <span className="h-px flex-1 bg-border" />
        </div>
        <TextureButton
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => window.open(whatsappUrl, '_blank', 'noopener,noreferrer')}
        >
          <MessageCircle className="size-4" /> Contact administration on WhatsApp
        </TextureButton>
        <p className="text-center font-mono text-xs text-muted-foreground">+{phone}</p>
      </DialogContent>
    </Dialog>
  );
}
