// ConfirmDialog — adapted from fxswap37 to the Henshin dark+blue tokens.
import { X } from 'lucide-react';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { MetalIconButton } from '@/components/ui/metal-button';
import { TextureCard } from '@/components/ui/texture-card';
import { TextureButton } from '@/components/ui/texture-button';

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="app-region-no-drag fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={busy ? undefined : onClose}
    >
      <TextureCard
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        className="w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <MetalIconButton
            variant="ghost"
            strength={0.4}
            disableGlow
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X className="size-4" />
          </MetalIconButton>
        </div>
        <p id="confirm-dialog-body" className="px-5 pb-4 text-sm leading-snug text-muted-foreground">
          {body}
        </p>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <TextureButton
            variant="minimal"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </TextureButton>
          <CosmicButton
            as="button"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-9"
            contentClassName="min-h-8 px-4 py-1"
          >
            {busy ? 'Working…' : confirmLabel}
          </CosmicButton>
        </div>
      </TextureCard>
    </div>
  );
}
