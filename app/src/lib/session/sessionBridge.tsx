// Session bridge — one command interface for every live engine.
//   kind "fast" → Reactor X2 (JsSessionProvider, wraps @reactor-models/x2)
//   kind "pro"  → fal.ai Lucy 2.5 (FalLucySessionProvider)
// Adapted from the fxswap37 reference; the native/Tauri paths were dropped —
// Henshin is Electron-only.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  useX2,
  useX2CommandError,
  useX2GenerationStarted,
  useX2GenerationStopped,
  useX2ReferenceImageAccepted,
  useX2StateUpdate,
} from '@reactor-models/x2';
import {
  formatReactorFailure,
  isBenignReactorError,
  shouldRemintReactorToken,
} from '@/lib/reactorErrors';
import { invalidateReactorTokenCache } from '@/lib/reactorToken';
import {
  EMPTY_SESSION_METADATA,
  SessionCommandsContext,
  type SessionCommands,
  type SessionStatus,
} from './sessionContext';

function reactorFallback(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function requireReady(status: SessionStatus, action: string): void {
  if (status !== 'ready') {
    throw new Error(`Start a session before ${action} (status: ${status}).`);
  }
}

function isClosedTransportError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not open|closed|Failed to fetch/i.test(msg);
}

/**
 * Reactor X2 engine. Must be mounted under <X2Provider getJwt={fetchReactorToken}>.
 * Publishing of the source track happens in useSourcePublisher.
 */
export function JsSessionProvider({ children }: { children: ReactNode }) {
  const x2 = useX2();
  const x2Ref = useRef(x2);
  const pointerDeadRef = useRef(false);
  const hasReferenceRef = useRef(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState(EMPTY_SESSION_METADATA);

  useEffect(() => {
    x2Ref.current = x2;
  }, [x2]);

  useX2StateUpdate((message) => {
    hasReferenceRef.current = message.has_reference_image;
    setMetadata((current) => ({
      generating: message.generating,
      activePrompt: typeof message.prompt === 'string' ? message.prompt : null,
      outputWidth: typeof message.width === 'number' ? message.width : null,
      outputHeight: typeof message.height === 'number' ? message.height : null,
      hasReference: message.has_reference_image,
      keepBacklog: message.keep_backlog,
      referenceAccepted: message.has_reference_image ? current.referenceAccepted : null,
    }));
  });
  useX2ReferenceImageAccepted((message) => {
    hasReferenceRef.current = true;
    setMetadata((current) => ({
      ...current,
      hasReference: true,
      referenceAccepted: { width: message.width, height: message.height },
    }));
  });
  useX2GenerationStarted((message) => {
    setMetadata((current) => ({
      ...current,
      generating: true,
      activePrompt: message.prompt,
      outputWidth: message.width,
      outputHeight: message.height,
      hasReference: message.has_reference_image,
    }));
  });
  useX2GenerationStopped(() => {
    setMetadata((current) => ({ ...current, generating: false }));
  });
  useX2CommandError((message) => {
    setEventError(`${message.command}: ${message.reason}`);
  });

  const value = useMemo<SessionCommands>(
    () => ({
      kind: 'fast',
      status: x2.status as SessionStatus,
      providerSessionId: x2.sessionId,
      providerSessionExpiration: x2.sessionExpiration,
      metadata,
      remoteStream: null,
      lastError: eventError
        ? { message: formatReactorFailure(eventError) || eventError }
        : x2.lastError && !isBenignReactorError(x2.lastError.message)
          ? { message: formatReactorFailure(x2.lastError) || x2.lastError.message }
          : null,
      connect: async () => {
        pointerDeadRef.current = false;
        hasReferenceRef.current = false;
        setEventError(null);
        setMetadata(EMPTY_SESSION_METADATA);
        try {
          await x2Ref.current.connect();
        } catch (err) {
          if (shouldRemintReactorToken(err)) {
            invalidateReactorTokenCache();
            try {
              await x2Ref.current.connect();
              return;
            } catch (retryErr) {
              throw new Error(formatReactorFailure(retryErr) || reactorFallback(retryErr));
            }
          }
          throw new Error(formatReactorFailure(err) || reactorFallback(err));
        }
      },
      disconnect: async () => {
        invalidateReactorTokenCache();
        try {
          await x2Ref.current.disconnect();
        } finally {
          pointerDeadRef.current = false;
          hasReferenceRef.current = false;
          setMetadata(EMPTY_SESSION_METADATA);
        }
      },
      reset: async () => {
        requireReady(x2Ref.current.status as SessionStatus, 'reset');
        await x2Ref.current.reset();
      },
      setPrompt: async (params) => {
        requireReady(x2Ref.current.status as SessionStatus, 'setting a prompt');
        await x2Ref.current.setPrompt(params);
      },
      setPointer: async (params) => {
        if (pointerDeadRef.current || x2Ref.current.status !== 'ready') return false;
        try {
          await x2Ref.current.setPointer(params);
          return true;
        } catch (error) {
          if (isClosedTransportError(error)) {
            pointerDeadRef.current = true;
            return false;
          }
          throw error;
        }
      },
      setKeepBacklog: async (params) => {
        requireReady(x2Ref.current.status as SessionStatus, 'changing backlog policy');
        await x2Ref.current.setKeepBacklog(params);
      },
      setReferenceImage: async (params) => {
        requireReady(x2Ref.current.status as SessionStatus, 'setting a reference image');
        await x2Ref.current.setReferenceImage(params as Parameters<typeof x2Ref.current.setReferenceImage>[0]);
      },
      uploadFile: async (blob, options) => x2Ref.current.uploadFile(blob, options),
      hasReference: () => hasReferenceRef.current,
    }),
    [x2, metadata, eventError],
  );

  return <SessionCommandsContext.Provider value={value}>{children}</SessionCommandsContext.Provider>;
}
