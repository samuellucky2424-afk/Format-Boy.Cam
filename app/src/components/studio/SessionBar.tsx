// SessionBar — transport controls under the Stage (fxswap37 pattern,
// Henshin dark+blue tokens). Fast = Reactor X2, PRO = fal.ai Lucy 2.5.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Video, X } from 'lucide-react';
import { TextureCard } from '@/components/ui/texture-card';
import { TextureButton } from '@/components/ui/texture-button';
import { usePricingDialog } from '@/hooks/usePricingDialog';
import { useSessionCommands } from '@/lib/session/sessionContext';
import type { Persona } from '@/lib/personas';
import type { LiveProvider } from '@/lib/liveProvider';

const STATUS_PILL: Record<string, { dotClass: string; label: string }> = {
  disconnected: { dotClass: 'bg-muted-foreground', label: 'Idle' },
  connecting: { dotClass: 'animate-pulse bg-blue-400', label: 'Starting…' },
  waiting: { dotClass: 'animate-pulse bg-blue-400', label: 'Starting…' },
  ready: { dotClass: 'bg-blue-400', label: 'Connected' },
};

const GHOST_MODE_KEY = 'henshin.ghostMode.v1';

function loadGhostMode() {
  try {
    return localStorage.getItem(GHOST_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function SessionBar({
  cameraOn,
  cameraLabel,
  panelOpen,
  activePersona,
  liveProvider,
  remainingCreditsLabel,
  currentUsage,
  onLiveProviderChange,
  onOpenCameraPicker,
  onTogglePanel,
  onStart,
  onStop,
  onToggleObsPreview,
  onOpenSessionHistory,
  obsActive,
  busy,
  onError,
}: {
  cameraOn: boolean;
  cameraLabel?: string;
  panelOpen: boolean;
  activePersona: Persona | null;
  liveProvider: LiveProvider;
  remainingCreditsLabel?: string | null;
  currentUsage?: { seconds: number; credits: number } | null;
  onLiveProviderChange: (next: LiveProvider) => void;
  onOpenCameraPicker: () => void;
  onTogglePanel: () => void;
  onStart: () => void;
  onStop: () => void;
  onToggleObsPreview: () => void;
  onOpenSessionHistory: () => void;
  obsActive: boolean;
  busy: boolean;
  onError: (message: string | null) => void;
}) {
  const session = useSessionCommands();
  const { openPricing } = usePricingDialog();
  const { status } = session;

  const tone = status === 'ready' && session.metadata.generating
    ? { dotClass: 'animate-pulse bg-emerald-500', label: 'Live' }
    : STATUS_PILL[status] ?? STATUS_PILL.disconnected;
  const idle = status === 'disconnected';
  const starting = status === 'connecting' || status === 'waiting';
  const [ghost, setGhost] = useState(loadGhostMode);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

  const toggleGhost = () => {
    const next = !ghost;
    try {
      const bridge = window as unknown as {
        require?: (id: string) => { ipcRenderer: { send: (channel: string, data: unknown) => void } };
      };
      bridge.require?.('electron')?.ipcRenderer.send('toggle-capture-protection', {
        isProtected: next,
      });
    } catch {
      /* not in Electron */
    }
    try {
      localStorage.setItem(GHOST_MODE_KEY, String(next));
    } catch {
      /* persistence unavailable */
    }
    setGhost(next);
  };

  const canStart =
    cameraOn && Boolean(activePersona?.imageUrl) && idle && !busy;
  const startHint = !cameraOn
    ? 'Choose a camera first'
    : !activePersona?.imageUrl
      ? 'Choose a persona first'
      : 'Start session';
  const metadataLabel = session.metadata.generating
    ? [
        session.metadata.outputWidth && session.metadata.outputHeight
          ? `${session.metadata.outputWidth}x${session.metadata.outputHeight}`
          : null,
        activePersona?.name,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const banner = session.lastError?.message;

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <TextureButton
            variant="icon"
            size="icon"
            aria-label={panelOpen ? 'Collapse persona panel' : 'Expand persona panel'}
            title={panelOpen ? 'Collapse persona panel' : 'Expand persona panel'}
            onClick={onTogglePanel}
            className="inline-flex"
          >
            {panelOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
          </TextureButton>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5">
            <span className={`size-1.5 rounded-full ${tone.dotClass}`} />
            <span className="font-mono text-[11px] uppercase tracking-tight text-muted-foreground">
              {tone.label}
            </span>
          </span>
          {starting && (
            <span className="hidden truncate font-mono text-[11px] uppercase tracking-tight text-muted-foreground sm:inline">
              {activePersona?.name ? `· ${activePersona.name}` : ''}
            </span>
          )}
          {metadataLabel && !starting && (
            <span className="hidden truncate font-mono text-[11px] uppercase tracking-tight text-muted-foreground sm:inline">
              {metadataLabel}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {remainingCreditsLabel === 'No credits' ? (
            <TextureButton variant="destructive" size="sm" onClick={openPricing}>
              Add credits
            </TextureButton>
          ) : remainingCreditsLabel ? (
            <span className={`hidden font-mono text-[10px] uppercase tracking-wide md:inline ${
              'text-muted-foreground'
            }`}>
              {remainingCreditsLabel}
            </span>
          ) : null}
          {currentUsage && status !== 'disconnected' && (
            <span className="hidden font-mono text-[10px] uppercase tracking-wide text-blue-300 lg:inline">
              {currentUsage.credits} cr used · {currentUsage.seconds}s
            </span>
          )}

          {/* Engine switch. PRO access is enforced before this callback changes provider. */}
          <TextureButton
            variant="minimal"
            size="sm"
            disabled={!idle}
            onClick={() => onLiveProviderChange(liveProvider === 'pro' ? 'fast' : 'pro')}
            aria-label={liveProvider === 'pro' ? 'Switch to Fast' : 'Switch to Pro'}
            title={
              idle
                ? liveProvider === 'pro'
                  ? 'Swap to Fast (Reactor X2)'
                  : 'Switch to PRO (fal.ai Lucy 2.5)'
                : 'Stop the session before swapping'
            }
            contentClassName="gap-1.5 px-2 text-xs tracking-tight"
          >
            <ArrowLeftRight className="size-3 text-muted-foreground" />
            <span className={liveProvider === 'fast' ? 'text-blue-300' : 'text-foreground'}>
              {liveProvider === 'fast' ? 'Fast · X2' : 'PRO · Lucy 2.5'}
            </span>
          </TextureButton>

          <TextureButton
            variant="secondary"
            onClick={onOpenCameraPicker}
            disabled={!idle || busy}
            title={cameraOn ? cameraLabel || 'Change camera' : 'Choose camera'}
            className="max-w-[170px]"
            contentClassName="gap-2 px-3 text-[13px]"
          >
            <Video className="size-3.5 shrink-0" />
            <span className="truncate">{cameraOn ? cameraLabel || 'Camera' : 'Choose camera'}</span>
          </TextureButton>

          {idle ? (
            <TextureButton
              variant="accent"
              disabled={busy || !canStart}
              onClick={onStart}
              title={startHint}
              contentClassName="px-4 text-[13px]"
            >
              {busy ? 'Starting…' : 'Start'}
            </TextureButton>
          ) : (
            <TextureButton
              variant="destructive"
              disabled={busy}
              onClick={onStop}
            >
              <X className="h-3.5 w-3.5" />
              {busy ? 'Stopping…' : 'Stop session'}
            </TextureButton>
          )}

          <div className="relative" ref={moreRef}>
            <TextureButton
              variant="icon"
              size="icon"
              aria-label="More"
              aria-expanded={moreOpen}
              title="More"
              onClick={() => setMoreOpen((v) => !v)}
            >
              <MoreHorizontal className="size-4" />
            </TextureButton>
            {moreOpen && (
              <TextureCard
                className="absolute bottom-10 right-0 z-30 min-w-[190px]"
                contentClassName="py-1"
              >
                <MoreItem
                  disabled={session.kind !== 'fast' || status !== 'ready' || busy}
                  onClick={() => {
                    setMoreOpen(false);
                    onError(null);
                    void session.reset().catch((error) => {
                      onError(error instanceof Error ? error.message : String(error));
                    });
                  }}
                >
                  Reset generation
                </MoreItem>
                <MoreItem
                  onClick={() => {
                    setMoreOpen(false);
                    toggleGhost();
                  }}
                >
                  {ghost ? 'Disable Ghost Mode' : 'Enable Ghost Mode'}
                </MoreItem>
                <MoreItem onClick={onToggleObsPreview}>
                  {obsActive ? 'Close OBS preview' : 'Open OBS preview'}
                </MoreItem>
                <MoreItem
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenSessionHistory();
                  }}
                >
                  Session history
                </MoreItem>
              </TextureCard>
            )}
          </div>
        </div>
      </div>
      {banner && <p className="px-3 pb-2 text-xs text-red-400">{banner}</p>}
    </div>
  );
}

function MoreItem({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <TextureButton
      variant="minimal"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className="mx-1 w-[calc(100%-0.5rem)]"
      contentClassName="justify-start"
    >
      {children}
    </TextureButton>
  );
}
