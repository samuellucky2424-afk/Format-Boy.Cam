// Studio workspace — fxswap37 layout integrated into Henshin:
// persona panel (left) + Stage with draggable camera PiP + SessionBar.
// Engines: Reactor X2 (Fast) and fal.ai Lucy 2.5 (PRO).
import { useCallback, useEffect, useRef, useState } from 'react';
import { X2Provider } from '@reactor-models/x2';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { apiFetch } from '@/lib/api-client';
import { fetchReactorToken } from '@/lib/reactorToken';
import { REACTOR_API_URL } from '@/lib/reactorConfig';
import { formatReactorFailure } from '@/lib/reactorErrors';
import { loadLiveProvider, saveLiveProvider, type LiveProvider } from '@/lib/liveProvider';
import type { Persona } from '@/lib/personas';
import { startLiveSession } from '@/lib/session/applyPersona';
import { JsSessionProvider } from '@/lib/session/sessionBridge';
import { useSessionCommands } from '@/lib/session/sessionContext';
import { FalLucySessionProvider } from '@/lib/session/FalLucySessionProvider';
import { useVirtualCameraCapture } from '@/services/useVirtualCameraCapture';
import { useSourcePublisher } from '@/components/studio/useSourcePublisher';
import { Stage } from '@/components/studio/Stage';
import { SessionBar } from '@/components/studio/SessionBar';
import { PersonaPanel } from '@/components/studio/PersonaPanel';
import { CameraPickerDialog } from '@/components/studio/CameraPickerDialog';
import { SessionHistoryDialog } from '@/components/studio/SessionHistoryDialog';
import { ProAccessDialog } from '@/components/ProAccessDialog';
import { useProAccess } from '@/hooks/useProAccess';
import { TextureButton } from '@/components/ui/texture-button';

const CREDITS_PER_SECOND = 2;
const POLLING_INTERVAL_MS = 1000;
const PREVIEW_WINDOW_NAME = 'henshin-preview';
const PREVIEW_WINDOW_FEATURES =
  'popup=yes,width=1280,height=720,minWidth=640,minHeight=360,resizable=yes,scrollbars=no';

async function waitForGeneration(getGenerating: () => boolean, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (getGenerating()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error('Reactor connected but did not begin generating before the timeout.');
}

async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `API Error: ${response.statusText}`);
  }
  return response.json();
}

export default function Dashboard() {
  const { user } = useAuth();
  const [liveProvider, setLiveProvider] = useState<LiveProvider>(() => loadLiveProvider());
  const [proDialogOpen, setProDialogOpen] = useState(false);
  const { access: proAccess, loading: proAccessLoading, redeem: redeemProLicense } = useProAccess(user?.id);

  const authorizedLiveProvider = liveProvider === 'pro' && !proAccess.active
    ? 'fast'
    : liveProvider;

  useEffect(() => {
    if (authorizedLiveProvider === 'fast' && liveProvider === 'pro' && !proAccessLoading) {
      saveLiveProvider('fast');
    }
  }, [authorizedLiveProvider, liveProvider, proAccessLoading]);

  const onLiveProviderChange = useCallback((next: LiveProvider) => {
    if (next === 'pro' && !proAccess.active) {
      setProDialogOpen(true);
      return;
    }
    saveLiveProvider(next);
    setLiveProvider(next);
  }, [proAccess.active]);

  const workspace = authorizedLiveProvider === 'pro' ? (
    <FalLucySessionProvider>
      <Workspace
        liveProvider={authorizedLiveProvider}
        proCreditsPerSecond={proAccess.creditsPerSecond}
        onLiveProviderChange={onLiveProviderChange}
      />
    </FalLucySessionProvider>
  ) : (
    <X2Provider apiUrl={REACTOR_API_URL} getJwt={fetchReactorToken} connectOptions={{ autoConnect: false }}>
      <JsSessionProvider>
        <Workspace
          liveProvider={authorizedLiveProvider}
          proCreditsPerSecond={proAccess.creditsPerSecond}
          onLiveProviderChange={onLiveProviderChange}
        />
      </JsSessionProvider>
    </X2Provider>
  );

  return (
    <>
      {workspace}
      <ProAccessDialog
        open={proDialogOpen}
        access={proAccess}
        onOpenChange={setProDialogOpen}
        onRedeem={async (code) => {
          await redeemProLicense(code);
          saveLiveProvider('pro');
          setLiveProvider('pro');
        }}
      />
    </>
  );
}

function Workspace({
  liveProvider,
  proCreditsPerSecond,
  onLiveProviderChange,
}: {
  liveProvider: LiveProvider;
  proCreditsPerSecond: number | null;
  onLiveProviderChange: (next: LiveProvider) => void;
}) {
  const { user } = useAuth();
  const { credits, setCredits, setSessionStatus, refreshCredits, sessionHistory } = useApp();
  const session = useSessionCommands();

  const [panelOpen, setPanelOpen] = useState(true);
  const [resetNonce, setResetNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [cameraLabel, setCameraLabel] = useState('');
  const [cameraPickerOpen, setCameraPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [currentUsage, setCurrentUsage] = useState({ seconds: 0, credits: 0 });
  const [sessionRate, setSessionRate] = useState(liveProvider === 'fast' ? 2 : proCreditsPerSecond || 80);

  const [sourceStream, setSourceStream] = useState<MediaStream | null>(null);
  const [sourceTrack, setSourceTrack] = useState<MediaStreamTrack | null>(null);
  const [activePersona, setActivePersona] = useState<Persona | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [isObsMode, setIsObsMode] = useState(false);
  const obsWindowRef = useRef<Window | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef(session.status);
  const metadataRef = useRef(session.metadata);
  const providerSessionIdRef = useRef(session.providerSessionId);
  const billingSessionRef = useRef<string | null>(null);
  const sourceStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    statusRef.current = session.status;
  }, [session.status]);

  useEffect(() => {
    metadataRef.current = session.metadata;
    providerSessionIdRef.current = session.providerSessionId;
  }, [session.metadata, session.providerSessionId]);

  useEffect(() => {
    sourceStreamRef.current = sourceStream;
  }, [sourceStream]);

  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const outputHostRef = useRef<HTMLDivElement | null>(null);

  const isElectron =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { require?: unknown }).require !== 'undefined';

  // Virtual camera — Henshin's own service, fed by the VISIBLE output video.
  const captureLive = session.kind === 'pro' ? session.status === 'ready' : session.metadata.generating;
  useVirtualCameraCapture(outputHostRef, captureLive, Boolean(isElectron), liveProvider);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // ── Billing (Supabase) ────────────────────────────────────────────────────
  const pollSessionStatus = useCallback(async () => {
    const billingSessionId = billingSessionRef.current;
    if (!billingSessionId || !user?.id) return;
    try {
      const response = await apiRequest<{
        credits?: number;
        creditsPerSecond?: number;
        secondsUsed: number;
        creditsUsed?: number;
        remainingCredits?: number;
        shouldStop: boolean;
        forceEnd?: boolean;
        reason?: string;
      }>(`/session-status?userId=${encodeURIComponent(user.id)}&sessionId=${encodeURIComponent(billingSessionId)}`);
      setCurrentUsage({
        seconds: Number(response.secondsUsed || 0),
        credits: Number(response.creditsUsed || 0),
      });
      const latestCredits = Number.isFinite(response.remainingCredits)
        ? response.remainingCredits
        : Number.isFinite(response.credits)
          ? response.credits
          : null;

      if (latestCredits !== null && latestCredits !== undefined) {
        setCredits(latestCredits);
      }

      if (response.shouldStop || response.forceEnd) {
        const reason = response.reason || (response.forceEnd ? 'access_revoked' : 'credits_or_limit_reached');
        await handleStop(false, reason);
        toast.error(response.forceEnd ? 'Session ended because PRO access is inactive.' : 'Session ended because credits or the session limit were reached.');
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, setCredits]);

  // ── Camera ────────────────────────────────────────────────────────────────
  const activateCamera = async (deviceId: string) => {
    try {
      const constraints: MediaTrackConstraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      };
      if (deviceId) constraints.deviceId = { exact: deviceId };
      else constraints.facingMode = 'user';

      const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      const [track] = stream.getVideoTracks();
      if (track) track.contentHint = liveProvider === 'pro' ? 'motion' : 'detail';

      sourceStream?.getTracks().forEach((t) => t.stop());
      setSourceStream(stream);
      setSourceTrack(track ?? null);
      setCameraOn(true);
      setCameraPickerOpen(false);
    } catch (error) {
      console.error('Webcam error:', error);
      toast.error('Failed to access webcam. Please allow camera permissions.');
    }
  };

  const stopCamera = async () => {
    if (busyRef.current) return;
    if (statusRef.current !== 'disconnected') {
      await handleStop(false, 'camera_stopped');
    }
    sourceStreamRef.current?.getTracks().forEach((t) => t.stop());
    setSourceStream(null);
    setSourceTrack(null);
    setCameraOn(false);
    setCameraDeviceId(null);
    setCameraLabel('');
  };

  // ── Session controls ──────────────────────────────────────────────────────
  const handleStart = async () => {
    if (busyRef.current) return;
    if (!user?.id) {
      toast.error('Please sign in before starting a session.');
      return;
    }
    if (!sourceStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
      toast.error('Choose a camera first.');
      return;
    }
    if (!activePersona?.imageUrl) {
      toast.error('Choose a persona first.');
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setActionError(null);

    let openedSessionId: string | null = null;
    try {
      const clientSessionId = crypto.randomUUID();
      const sessionResponse = await apiRequest<{
        allowed: boolean;
        sessionId: string | null;
        error?: string;
        credits?: number;
        creditsPerSecond?: number;
      }>('/start-session', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          provider: liveProvider === 'fast' ? 'reactor' : 'fal',
          clientSessionId,
        }),
      });

      if (!sessionResponse.allowed || !sessionResponse.sessionId) {
        throw new Error(sessionResponse.error || 'Unable to start session.');
      }
      openedSessionId = sessionResponse.sessionId;
      billingSessionRef.current = openedSessionId;
      if (typeof sessionResponse.creditsPerSecond === 'number') setSessionRate(sessionResponse.creditsPerSecond);
      setCurrentUsage({ seconds: 0, credits: 0 });

      if (typeof sessionResponse.credits === 'number') {
        setCredits(sessionResponse.credits);
      }

      await startLiveSession(session, () => statusRef.current, activePersona, sourceStream, openedSessionId);

      if (liveProvider === 'fast') {
        await waitForGeneration(() => metadataRef.current.generating);
      }

      await apiRequest('/activate-session', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          sessionId: openedSessionId,
          providerSessionId: providerSessionIdRef.current || undefined,
        }),
      });

      stopPolling();
      pollIntervalRef.current = setInterval(() => void pollSessionStatus(), POLLING_INTERVAL_MS);
      void pollSessionStatus();

      setSessionStatus('LIVE');
    } catch (error) {
      console.error('Start session error:', error);

      if (openedSessionId) {
        try {
          await apiRequest('/end-session', {
            method: 'POST',
            body: JSON.stringify({
              userId: user.id,
              sessionId: openedSessionId,
              reason: 'start_failed',
            }),
          });
        } catch (cleanupError) {
          console.error('Session cleanup error:', cleanupError);
        }
      }
      stopPolling();
      billingSessionRef.current = null;

      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = liveProvider === 'fast' ? formatReactorFailure(rawMessage) || rawMessage : rawMessage;
      setActionError(message);
      toast.error(message);

      try {
        await session.disconnect();
      } catch {
        /* best effort */
      }
      setSessionStatus('IDLE');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  async function handleStop(showToast = true, reason = 'user_stop') {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    stopPolling();

    try {
      await session.disconnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
    }

    const billingSessionId = billingSessionRef.current;
    if (billingSessionId && user?.id) {
      try {
        const response = await apiRequest<{
          remainingCredits?: number;
          secondsUsed?: number;
          creditsUsed?: number;
        }>('/end-session', {
          method: 'POST',
          body: JSON.stringify({ userId: user.id, sessionId: billingSessionId, reason }),
        });
        if (Number.isFinite(response.remainingCredits)) setCredits(response.remainingCredits!);
        setCurrentUsage({
          seconds: Number(response.secondsUsed || 0),
          credits: Number(response.creditsUsed || 0),
        });
        await refreshCredits();
      } catch (error) {
        console.error('Stop session error:', error);
      } finally {
        billingSessionRef.current = null;
      }
    }

    setSessionStatus('IDLE');
    setResetNonce((n) => n + 1);

    busyRef.current = false;
    setBusy(false);
    if (showToast) toast.info('Session stopped');
  }

  useEffect(() => {
    if (session.status === 'disconnected') {
      setSessionStatus('IDLE');
    }
  }, [session.status, setSessionStatus]);

  // ── OBS preview window ────────────────────────────────────────────────────
  const closeObsPreviewWindow = useCallback((updateState = true) => {
    const previewWindow = obsWindowRef.current;
    if (previewWindow && !previewWindow.closed) previewWindow.close();
    obsWindowRef.current = null;
    if (updateState) setIsObsMode(false);
  }, []);

  const handleObsPreviewToggle = useCallback(() => {
    const existing = obsWindowRef.current;
    if (existing && !existing.closed) {
      closeObsPreviewWindow();
      return;
    }

    const previewUrl = new URL(window.location.href);
    previewUrl.hash = '/preview';
    const win = window.open(previewUrl.toString(), PREVIEW_WINDOW_NAME, PREVIEW_WINDOW_FEATURES);
    if (!win) {
      toast.error('Could not open the OBS preview window.');
      return;
    }
    obsWindowRef.current = win;
    win.focus();
    setIsObsMode(true);
  }, [closeObsPreviewWindow]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (user?.id) {
        const billingSessionId = billingSessionRef.current;
        if (billingSessionId) void apiFetch('/end-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, sessionId: billingSessionId, reason: 'window_closed' }),
          keepalive: true,
        }).catch(() => {});
      }
      stopPolling();
      sourceStreamRef.current?.getTracks().forEach((track) => track.stop());
      void session.disconnect().catch(() => {});
      closeObsPreviewWindow(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (obsWindowRef.current && obsWindowRef.current.closed) {
        obsWindowRef.current = null;
        setIsObsMode(false);
      }
    }, 500);
    return () => window.clearInterval(intervalId);
  }, []);

  const selectedRate = liveProvider === 'fast' ? CREDITS_PER_SECOND : proCreditsPerSecond || sessionRate;
  const remainingSeconds = Math.max(0, Math.floor(credits / selectedRate));
  const remainingLabel = remainingSeconds > 0
    ? `~${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s left`
    : 'No credits';

  return (
    <div className="flex h-full min-h-0 w-full flex-1 gap-3">
      {/* Left tab shell — Persona */}
      <aside
        className={`h-full shrink-0 flex-col overflow-hidden transition-all duration-300 ${
          panelOpen ? 'flex w-full lg:w-[338px]' : 'hidden'
        }`}
      >
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          {(actionError || publishError) && (
            <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs leading-snug text-red-400">
              {formatReactorFailure(actionError) || actionError || publishError}
              <TextureButton
                variant="destructive"
                size="icon"
                aria-label="Dismiss"
                className="float-right ml-2 !bg-transparent"
                contentClassName="!size-5 !bg-transparent text-red-300 hover:text-white"
                onClick={() => {
                  setActionError(null);
                  setPublishError(null);
                }}
              >
                ✕
              </TextureButton>
            </p>
          )}
          <PersonaPanel
            key={`persona${resetNonce}`}
            resetNonce={resetNonce}
            sourceStream={sourceStream}
            onActivePersonaChange={setActivePersona}
            onCollapse={() => setPanelOpen(false)}
          />
        </div>
      </aside>

      {/* Right tab shell — Stage + SessionBar */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
        <Stage
          generating={session.metadata.generating}
          activeLabel={activePersona?.name ?? null}
          cameraOn={cameraOn}
          sourceStream={sourceStream}
          remoteStream={session.remoteStream ?? null}
          remotePlayNonce={session.remotePlayNonce}
          liveProvider={liveProvider}
          webcamVideoRef={webcamVideoRef}
          outputHostRef={outputHostRef}
          onTrack={setSourceTrack}
          onStopCamera={() => void stopCamera()}
        />
        <SessionBar
          cameraOn={cameraOn}
          cameraLabel={cameraLabel}
          panelOpen={panelOpen}
          activePersona={activePersona}
          liveProvider={liveProvider}
          remainingCreditsLabel={remainingLabel}
          currentUsage={currentUsage}
          onLiveProviderChange={onLiveProviderChange}
          onOpenCameraPicker={() => setCameraPickerOpen(true)}
          onTogglePanel={() => setPanelOpen((open) => !open)}
          onStart={() => void handleStart()}
          onStop={() => void handleStop()}
          onToggleObsPreview={handleObsPreviewToggle}
          onOpenSessionHistory={() => setHistoryOpen(true)}
          obsActive={isObsMode}
          busy={busy}
          onError={setActionError}
        />
      </div>

      <CameraPickerDialog
        open={cameraPickerOpen}
        initialDeviceId={cameraDeviceId}
        onClose={() => setCameraPickerOpen(false)}
        onConfirm={(device) => {
          setCameraDeviceId(device.deviceId);
          setCameraLabel(device.label);
          void activateCamera(device.deviceId);
        }}
      />

      <SessionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        sessions={sessionHistory}
      />

      {/* Publish bridge (Reactor only) */}
      {liveProvider === 'fast' && <JsPublisherBridge track={sourceTrack} onError={setPublishError} />}
    </div>
  );
}

// Publishes the camera track onto the Reactor `source` slot and surfaces errors.
function JsPublisherBridge({
  track,
  onError,
}: {
  track: MediaStreamTrack | null;
  onError: (err: string | null) => void;
}) {
  const err = useSourcePublisher(track);

  useEffect(() => {
    onError(err);
  }, [err, onError]);

  return null;
}
