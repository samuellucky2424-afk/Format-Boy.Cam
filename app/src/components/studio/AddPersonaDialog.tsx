// AddPersonaDialog — adapted from fxswap37 to the Henshin dark+blue tokens.
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { MetalIconButton } from '@/components/ui/metal-button';
import { TextureCard } from '@/components/ui/texture-card';
import { TextureButton } from '@/components/ui/texture-button';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AddPersonaDialog({
  open,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onSave: (name: string, file: File) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setName('');
      setFile(null);
      setPreview(null);
      setError(null);
      if (fileRef.current) fileRef.current.value = '';
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  if (!open) return null;

  const pickFile = (next?: File) => {
    if (preview) URL.revokeObjectURL(preview);
    if (!next) {
      setFile(null);
      setPreview(null);
      return;
    }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setError(null);
  };

  const save = async () => {
    if (!name.trim() || !file) return;
    setError(null);
    try {
      await onSave(name.trim(), file);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const canSave = Boolean(name.trim() && file) && !busy;

  return (
    <div
      className="app-region-no-drag fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={busy ? undefined : onClose}
    >
      <TextureCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-persona-title"
        className="w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div>
            <h2 id="add-persona-title" className="text-base font-semibold text-foreground">
              Add persona
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Name, and a portrait.</p>
          </div>
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

        <div className="space-y-4 px-5 pb-5">
          <div className="space-y-1.5">
            <label htmlFor="persona-name" className="kpi-label">
              Name
            </label>
            <input
              id="persona-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Studio look"
              autoFocus
              maxLength={40}
              className="h-10 w-full rounded-lg border border-input bg-panel px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring/60"
            />
          </div>

          <div className="space-y-1.5">
            <span className="kpi-label">Portrait</span>
            {preview ? (
              <div className="relative overflow-hidden rounded-lg border border-border bg-panel">
                <img src={preview} alt="" className="aspect-[4/5] max-h-56 w-full object-cover" />
                <MetalIconButton
                  variant="destructive"
                  strength={0.35}
                  disableGlow
                  aria-label="Remove image"
                  onClick={() => pickFile(undefined)}
                  metalFxClassName="absolute right-2 top-2"
                  className="text-white"
                >
                  <X className="size-4" />
                </MetalIconButton>
              </div>
            ) : (
              <TextureButton
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                className="w-full"
                contentClassName="aspect-video"
              >
                Choose an image…
              </TextureButton>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <TextureButton
            variant="minimal"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </TextureButton>
          <CosmicButton
            as="button"
            disabled={!canSave}
            onClick={() => void save()}
            className="min-h-9"
            contentClassName="min-h-8 px-4 py-1"
          >
            {busy ? 'Saving…' : 'Save persona'}
          </CosmicButton>
        </div>
      </TextureCard>
    </div>
  );
}
