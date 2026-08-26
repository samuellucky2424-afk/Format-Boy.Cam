import { fal } from '@fal-ai/client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api-client';
import {
  EMPTY_SESSION_METADATA,
  SessionCommandsContext,
  type SessionCommands,
  type SessionConnectOptions,
  type SessionStatus,
} from './sessionContext';

const FAL_LUCY_APP = 'decart/lucy-2-5/realtime';
const TOKEN_EXPIRATION_SECONDS = 120;
const FIRST_FRAME_TIMEOUT_MS = 45_000;

type LucySignal = {
  type?: string | null;
  sdp?: string | null;
  candidate?: RTCIceCandidateInit | null;
  iceServers?: RTCIceServer[] | null;
  error?: unknown;
};

type LucyInput = {
  type?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  prompt?: string | null;
  reference_image_url?: string | null;
  enable_prompt_expansion?: boolean;
};

type LucyConnection = {
  send: (input: LucyInput) => void;
  close: () => void;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read the reference image.'));
    reader.readAsDataURL(blob);
  });
}

async function waitForVisibleVideo(stream: MediaStream): Promise<void> {
  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not validate Lucy video output.');
  canvas.width = 32;
  canvas.height = 18;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});

  try {
    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (Date.now() - startedAt >= FIRST_FRAME_TIMEOUT_MS) {
          window.clearInterval(timer);
          reject(new Error('Lucy connected but did not return visible video frames.'));
          return;
        }
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let visible = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] > 16 || pixels[index + 1] > 16 || pixels[index + 2] > 16) visible += 1;
          if (visible >= 8) {
            window.clearInterval(timer);
            resolve();
            return;
          }
        }
      }, 100);
    });
  } finally {
    video.srcObject = null;
  }
}

export function FalLucySessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<SessionStatus>('disconnected');
  const [lastError, setLastError] = useState<{ message: string } | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remotePlayNonce, setRemotePlayNonce] = useState(0);
  const [hasReference, setHasReference] = useState(false);
  const statusRef = useRef<SessionStatus>('disconnected');
  const connectionRef = useRef<LucyConnection | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const sourceStreamRef = useRef<MediaStream | null>(null);
  const promptRef = useRef('');
  const referenceDataUrlRef = useRef<string | null>(null);
  const readyRef = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const disconnect = useCallback(async () => {
    readyRef.current?.reject(new Error('Lucy session was closed before it became ready.'));
    readyRef.current = null;
    connectionRef.current?.close();
    connectionRef.current = null;
    const peer = peerRef.current;
    peerRef.current = null;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }
    sourceStreamRef.current = null;
    setHasReference(false);
    setRemoteStream(null);
    setStatus('disconnected');
  }, []);

  const connect = useCallback(async (options?: SessionConnectOptions) => {
    if (!user?.id) throw new Error('Sign in before starting Lucy PRO.');
    if (!options?.billingSessionId) throw new Error('A billed PRO session is required.');
    const stream = options.stream;
    if (!stream?.getVideoTracks().some((track) => track.readyState === 'live')) {
      throw new Error('A live camera stream is required for Lucy PRO.');
    }

    await disconnect();
    setStatus('connecting');
    setLastError(null);
    sourceStreamRef.current = stream;
    promptRef.current = options.prompt || '';
    referenceDataUrlRef.current = options.image ? await blobToDataUrl(options.image) : null;
    setHasReference(Boolean(referenceDataUrlRef.current));

    const ready = new Promise<void>((resolve, reject) => {
      readyRef.current = { resolve, reject };
    });
    const rejectConnection = (error: unknown) => {
      const resolved = error instanceof Error ? error : new Error(String(error));
      setLastError({ message: resolved.message });
      readyRef.current?.reject(resolved);
      readyRef.current = null;
      void disconnect();
    };

    const sendConfiguration = (extra: LucyInput = {}) => {
      connectionRef.current?.send({
        prompt: promptRef.current || null,
        reference_image_url: referenceDataUrlRef.current,
        enable_prompt_expansion: true,
        ...extra,
      });
    };
    const pendingCandidates: RTCIceCandidateInit[] = [];

    const flushCandidates = async (peer: RTCPeerConnection) => {
      while (peer.remoteDescription && pendingCandidates.length > 0) {
        await peer.addIceCandidate(pendingCandidates.shift()!);
      }
    };

    const createPeer = async (iceServers: RTCIceServer[] = []) => {
      if (peerRef.current) return peerRef.current;
      const peer = new RTCPeerConnection({ iceServers });
      peerRef.current = peer;
      for (const track of stream.getVideoTracks()) peer.addTrack(track, stream);
      peer.onicecandidate = (event) => {
        if (event.candidate) sendConfiguration({ type: 'candidate', candidate: event.candidate.toJSON() });
      };
      peer.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(peer.connectionState) && statusRef.current !== 'disconnected') {
          rejectConnection(new Error(`Lucy WebRTC connection ${peer.connectionState}.`));
        }
      };
      peer.ontrack = (event) => {
        const output = event.streams[0] || new MediaStream([event.track]);
        void waitForVisibleVideo(output)
          .then(() => {
            setRemoteStream(output);
            setRemotePlayNonce((value) => value + 1);
            setStatus('ready');
            readyRef.current?.resolve();
            readyRef.current = null;
          })
          .catch(rejectConnection);
      };
      return peer;
    };

    const handleSignal = async (signal: LucySignal) => {
      if (signal.error) throw new Error(String(signal.error));
      const peer = await createPeer(signal.iceServers || []);
      if (signal.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else pendingCandidates.push(signal.candidate);
      }
      if (signal.sdp && signal.type === 'offer') {
        await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        await flushCandidates(peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendConfiguration({ type: answer.type, sdp: answer.sdp || '' });
        return;
      }
      if (signal.sdp && signal.type === 'answer') {
        await peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        await flushCandidates(peer);
        return;
      }
      if (signal.iceServers && !peer.localDescription) {
        const offer = await peer.createOffer({ offerToReceiveVideo: true });
        await peer.setLocalDescription(offer);
        sendConfiguration({ type: offer.type, sdp: offer.sdp || '' });
      }
    };

    connectionRef.current = fal.realtime.connect<LucyInput, LucySignal>(FAL_LUCY_APP, {
      connectionKey: `henshin-pro-${options.billingSessionId}`,
      throttleInterval: 0,
      maxBuffering: 2,
      tokenExpirationSeconds: TOKEN_EXPIRATION_SECONDS,
      tokenProvider: async (app) => {
        const response = await apiFetch('/fal-realtime-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, sessionId: options.billingSessionId, app }),
          timeoutMs: 20_000,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.token) throw new Error(body.error || 'Could not authorize fal.ai.');
        return body.token;
      },
      onResult: (signal) => void handleSignal(signal).catch(rejectConnection),
      onError: rejectConnection,
    });

    sendConfiguration();
    const timeout = window.setTimeout(() => {
      rejectConnection(new Error('Timed out while connecting to Lucy PRO.'));
    }, FIRST_FRAME_TIMEOUT_MS + 10_000);
    try {
      await ready;
    } finally {
      window.clearTimeout(timeout);
    }
  }, [disconnect, user]);

  const requireReady = useCallback(() => {
    if (statusRef.current !== 'ready') throw new Error('Start a PRO session before this action.');
  }, []);

  const setPrompt = useCallback(async ({ prompt }: { prompt?: string }) => {
    requireReady();
    promptRef.current = prompt || '';
    connectionRef.current?.send({ prompt: promptRef.current, enable_prompt_expansion: true });
  }, [requireReady]);

  const setReferenceImage = useCallback(async ({ blob }: { blob?: Blob }) => {
    requireReady();
    if (!blob) return;
    referenceDataUrlRef.current = await blobToDataUrl(blob);
    setHasReference(true);
    connectionRef.current?.send({
      prompt: promptRef.current,
      reference_image_url: referenceDataUrlRef.current,
      enable_prompt_expansion: true,
    });
  }, [requireReady]);

  useEffect(() => () => void disconnect(), [disconnect]);

  const value = useMemo<SessionCommands>(() => ({
    kind: 'pro',
    status,
    metadata: status === 'ready' && remoteStream
      ? { ...EMPTY_SESSION_METADATA, generating: true, hasReference }
      : EMPTY_SESSION_METADATA,
    lastError,
    remoteStream,
    remotePlayNonce,
    connect,
    disconnect,
    reset: async () => requireReady(),
    setPrompt,
    setPointer: async () => false,
    setKeepBacklog: async () => {},
    setReferenceImage,
  }), [status, remoteStream, hasReference, lastError, remotePlayNonce, connect, disconnect, requireReady, setPrompt, setReferenceImage]);

  return <SessionCommandsContext.Provider value={value}>{children}</SessionCommandsContext.Provider>;
}
