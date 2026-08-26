// Stage — the model's edited output filling the workspace, with the own
// camera as a draggable picture-in-picture floating above it (fxswap37
// pattern, Henshin dark+blue tokens). The PiP is draggable anywhere inside
// the stage (bounded) and can expand into a split view without remounting
// the camera.
import { useEffect, useRef, useState } from 'react';
import { useX2Track } from '@reactor-models/x2';
import { Pipette, SplitSquareHorizontal, X } from 'lucide-react';
import { MetalIconButton } from '@/components/ui/metal-button';
import { useSessionCommands } from '@/lib/session/sessionContext';
import type { LiveProvider } from '@/lib/liveProvider';

// Padding used to clamp the dragged PiP inside the stage.
const PIP_PADDING = 8;

// Status-aware idle copy for the placeholder.
const PLACEHOLDER_COPY: Record<string, { title: string; subtitle: string }> = {
  disconnected: {
    title: 'Ready',
    subtitle: 'Pick a camera and a persona, then press Start',
  },
  connecting: { title: 'Starting…', subtitle: 'Opening the session' },
  waiting: {
    title: 'Starting…',
    subtitle: 'The model boots on first connect',
  },
  ready: { title: 'Live', subtitle: 'Generation is starting' },
};

function Placeholder({ provider }: { provider: LiveProvider }) {
  const { status } = useSessionCommands();
  const copy =
    provider === 'pro'
      ? status === 'disconnected'
        ? { title: 'Ready', subtitle: 'Pick a persona, then press Start' }
        : { title: 'Connecting…', subtitle: 'Opening fal.ai Lucy 2.5 PRO' }
      : (PLACEHOLDER_COPY[status] ?? PLACEHOLDER_COPY.ready);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 px-6 text-center transition-opacity duration-500">
      <div className="flex size-[38px] items-center justify-center overflow-hidden rounded-xl">
        <img src="./logo.png" alt="" className="h-full w-full object-cover opacity-40" />
      </div>
      <p className="text-[40px] font-medium leading-none tracking-tight text-white/50">{copy.title}</p>
      <p className="text-sm leading-snug text-white/40">{copy.subtitle}</p>
    </div>
  );
}

export function Stage({
  generating,
  activeLabel,
  cameraOn,
  sourceStream,
  remoteStream,
  remotePlayNonce,
  liveProvider,
  webcamVideoRef,
  outputHostRef,
  onTrack,
  onStopCamera,
}: {
  generating: boolean;
  activeLabel?: string | null;
  cameraOn: boolean;
  /** Raw camera stream acquired by the Workspace. */
  sourceStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remotePlayNonce?: number;
  liveProvider: LiveProvider;
  /** Stable hidden <video> that carries the raw camera feed (PiP + providers). */
  webcamVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Host of the visible edited output — vcam capture resolves its <video>. */
  outputHostRef: React.RefObject<HTMLDivElement | null>;
  onTrack?: (track: MediaStreamTrack | null) => void;
  onStopCamera: () => void;
}) {
  // true: original | edited side by side. false: floating draggable PiP.
  const [split, setSplit] = useState(false);
  // PiP offset in px inside the stage; null = default bottom-right corner.
  const [pip, setPip] = useState<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const proLive = liveProvider === 'pro' && Boolean(remoteStream);

  // Bind the raw camera stream to the PiP video and report its track up.
  useEffect(() => {
    const video = webcamVideoRef.current;
    if (!video) return;
    if (video.srcObject !== sourceStream) {
      video.srcObject = sourceStream;
      void video.play().catch(() => {});
    }
    if (sourceStream) {
      const track = sourceStream.getVideoTracks()[0] ?? null;
      onTrack?.(track);
    } else {
      onTrack?.(null);
    }
  }, [sourceStream, webcamVideoRef, onTrack]);

  // Bind the Lucy remote stream to the visible PRO video element.
  useEffect(() => {
    if (liveProvider !== 'pro') return;
    const host = outputHostRef.current;
    const video = host?.querySelector('video');
    if (!video || !remoteStream) return;

    video.srcObject = remoteStream;
    video.muted = true;
    video.playbackRate = 1;
    (video as HTMLVideoElement & { latencyHint?: string }).latencyHint = 'interactive';

    const play = () => {
      void video.play().catch(() => {});
    };
    const onUnmute = () => play();
    const tracks = remoteStream.getVideoTracks();
    for (const track of tracks) {
      track.addEventListener('unmute', onUnmute);
    }
    video.addEventListener('loadedmetadata', play);
    play();
    return () => {
      video.removeEventListener('loadedmetadata', play);
      for (const track of tracks) {
        track.removeEventListener('unmute', onUnmute);
      }
      if (video.srcObject === remoteStream) video.srcObject = null;
    };
  }, [remoteStream, remotePlayNonce, liveProvider, outputHostRef]);

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (split || e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(
      Math.max(e.clientX - stage.left - d.dx, PIP_PADDING),
      stage.width - box.width - PIP_PADDING,
    );
    const y = Math.min(
      Math.max(e.clientY - stage.top - d.dy, PIP_PADDING),
      stage.height - box.height - PIP_PADDING,
    );
    setPip({ x, y });
  }

  function endDrag() {
    dragRef.current = null;
  }

  return (
    <section
      ref={stageRef}
      className="relative min-h-0 w-full flex-1 overflow-hidden rounded-xl bg-black/55"
    >
      {/* Edited output — full stage in PiP mode, right half in split mode. */}
      <div ref={outputHostRef} className={`absolute ${split ? 'inset-y-0 right-0 w-1/2' : 'inset-0'}`}>
        {liveProvider === 'pro' ? (
          <video
            id="output"
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <FastOutputVideo />
        )}
        {!generating && !proLive && <Placeholder provider={liveProvider} />}
        <span className="pointer-events-none absolute left-2 top-2 max-w-[40%] truncate rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-tight text-white/60">
          {generating ? (activeLabel ?? 'edited') : 'edited'}
        </span>
      </div>

      {/* Own camera — ONE stable wrapper, never remounted across layouts. */}
      {cameraOn && (
        <div
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`absolute touch-none select-none overflow-hidden bg-black ${
            split
              ? 'inset-y-0 left-0 z-10 w-1/2'
              : 'z-20 aspect-video w-[26%] min-w-[180px] cursor-grab rounded-lg border border-white/40 shadow-[0_8px_24px_rgba(0,0,0,0.35)] active:cursor-grabbing'
          }`}
          style={
            split
              ? undefined
              : pip
                ? { left: pip.x, top: pip.y }
                : { right: 12, bottom: 12 }
          }
        >
          <video
            ref={webcamVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full -scale-x-100 object-cover"
          />

          {/* Top strip (drag handle + view controls). */}
          <div className="absolute inset-x-0 top-0 z-10 flex h-8 items-center justify-between gap-1 bg-gradient-to-b from-black/60 to-transparent px-2">
            <span className="font-mono text-[10px] uppercase tracking-tight text-white/80">
              {split ? 'original' : 'camera'}
            </span>
            <div className="flex items-center gap-1">
              <MetalIconButton
                variant="ghost"
                strength={0.35}
                disableGlow
                aria-label={split ? 'Back to picture-in-picture' : 'Open split view'}
                title={split ? 'Back to picture-in-picture' : 'Open split view'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setSplit((s) => !s)}
                className="size-7 text-white/80 hover:text-white"
              >
                {split ? <Pipette className="size-3.5" /> : <SplitSquareHorizontal className="size-3.5" />}
              </MetalIconButton>
              <MetalIconButton
                variant="destructive"
                strength={0.35}
                disableGlow
                aria-label="Stop camera"
                title="Stop camera"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={onStopCamera}
                className="size-7 text-white/80 hover:text-white"
              >
                <X className="size-3.5" />
              </MetalIconButton>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FastOutputVideo() {
  const track = useX2Track('main_video');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const stream = track ? new MediaStream([track]) : null;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => {});
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [track]);

  return (
    <video
      id="output"
      ref={videoRef}
      autoPlay
      playsInline
      muted
      data-vcam-capture="fast"
      className="absolute inset-0 h-full w-full object-contain"
    />
  );
}
