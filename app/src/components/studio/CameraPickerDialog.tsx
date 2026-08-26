// CameraPickerDialog — adapted from fxswap37 (preview + physical-only list).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Video, X } from 'lucide-react';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { MetalIconButton } from '@/components/ui/metal-button';
import { TextureCard } from '@/components/ui/texture-card';
import { TextureButton } from '@/components/ui/texture-button';
import {
  listPhysicalCameras,
  openCameraPreview,
  type CameraDeviceOption,
} from '@/lib/cameraDevices';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function CameraPickerDialog({
  open,
  onClose,
  onConfirm,
  initialDeviceId,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (device: CameraDeviceOption) => void;
  initialDeviceId?: string | null;
}) {
  const [cameras, setCameras] = useState<CameraDeviceOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);

  const stopPreview = useCallback(() => {
    previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    previewStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const refreshCameras = useCallback(async () => {
    setListing(true);
    setError(null);
    try {
      const list = await listPhysicalCameras();
      setCameras(list);
      const preferred =
        list.find((c) => c.deviceId === initialDeviceId)?.deviceId ?? list[0]?.deviceId ?? null;
      setSelectedId(preferred);
    } catch (reason) {
      setError(errorMessage(reason));
      setCameras([]);
      setSelectedId(null);
    } finally {
      setListing(false);
    }
  }, [initialDeviceId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refreshCameras();
    });
    return () => {
      cancelled = true;
    };
  }, [open, refreshCameras]);

  useEffect(() => {
    if (!open || !selectedId) {
      stopPreview();
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;
    const video = videoRef.current;

    stopPreview();

    const markReady = () => {
      if (!cancelled && requestId === requestIdRef.current) {
        setPreviewLoading(false);
      }
    };

    video?.addEventListener('playing', markReady);

    queueMicrotask(() => {
      if (cancelled) return;
      setPreviewError(null);
      setPreviewLoading(true);
      void openCameraPreview(selectedId).then(async (stream) => {
        if (cancelled || requestId !== requestIdRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        previewStreamRef.current = stream;
        const el = videoRef.current;
        if (!el) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        el.srcObject = stream;
        try {
          await el.play();
        } catch {
          /* autoplay may already be running */
        }
        if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          markReady();
        }
      }).catch((reason) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setPreviewError(errorMessage(reason));
        setPreviewLoading(false);
      });
    });

    return () => {
      cancelled = true;
      video?.removeEventListener('playing', markReady);
      stopPreview();
    };
  }, [open, selectedId, stopPreview]);

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      stopPreview();
    }
  }, [open, stopPreview]);

  if (!open) return null;

  const selected = cameras.find((c) => c.deviceId === selectedId);
  const canConfirm = Boolean(selected) && !previewLoading && !previewError;

  const confirm = () => {
    if (!selected || !canConfirm) return;
    setError(null);
    stopPreview();
    onConfirm(selected);
  };

  return (
    <div
      className="app-region-no-drag fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <TextureCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-picker-title"
        className="w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <h2 id="camera-picker-title" className="text-base font-semibold text-foreground">
              Choose camera
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Preview before you go live. Virtual outputs are hidden.
            </p>
          </div>
          <MetalIconButton
            variant="ghost"
            strength={0.4}
            disableGlow
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </MetalIconButton>
        </div>

        <div className="grid gap-5 px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="min-h-[200px]">
            <p className="kpi-label">Physical cameras</p>
            {listing && <p className="mt-3 text-sm text-muted-foreground">Scanning…</p>}
            {!listing && !cameras.length && (
              <p className="mt-3 text-sm text-muted-foreground">
                No camera found. Check Windows privacy settings.
              </p>
            )}
            <ul className="mt-3 space-y-1">
              {cameras.map((camera) => {
                const active = camera.deviceId === selectedId;
                return (
                  <li key={camera.deviceId}>
                    <TextureButton
                      variant={active ? 'accent' : 'minimal'}
                      size="sm"
                      onClick={() => setSelectedId(camera.deviceId)}
                      className="w-full"
                      contentClassName="justify-start py-2.5"
                    >
                      <Video className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{camera.label}</span>
                    </TextureButton>
                  </li>
                );
              })}
            </ul>
            <TextureButton
              variant="secondary"
              size="sm"
              onClick={() => void refreshCameras()}
              disabled={listing}
              className="mt-3"
            >
              Refresh list
            </TextureButton>
          </div>

          <div>
            <p className="kpi-label">Preview</p>
            <div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-border bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full -scale-x-100 object-cover transition-opacity duration-150 ${
                  previewLoading || previewError ? 'opacity-0' : 'opacity-100'
                }`}
              />
              {!selectedId && !previewError && !previewLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
                  Select a camera
                </div>
              )}
              {previewLoading && !previewError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500/40 border-t-blue-400" />
                  <p className="text-sm text-white/80">Opening camera…</p>
                </div>
              )}
              {previewError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center text-sm text-red-300">
                  {previewError}
                </div>
              )}
            </div>
            {selected && (
              <p className="mt-2 truncate text-xs text-muted-foreground">
                {previewLoading ? 'Connecting…' : selected.label}
              </p>
            )}
          </div>
        </div>

        {(error || previewError) && (
          <p className="bg-red-500/10 px-5 py-2 text-xs text-red-400">{error ?? previewError}</p>
        )}

        <div className="flex justify-end gap-2 px-5 py-4">
          <TextureButton
            variant="minimal"
            onClick={onClose}
          >
            Cancel
          </TextureButton>
          <CosmicButton
            as="button"
            disabled={!canConfirm}
            onClick={confirm}
            className="min-h-9"
            contentClassName="min-h-8 px-4 py-1"
          >
            {previewLoading ? 'Opening…' : 'Use this camera'}
          </CosmicButton>
        </div>
      </TextureCard>
    </div>
  );
}
