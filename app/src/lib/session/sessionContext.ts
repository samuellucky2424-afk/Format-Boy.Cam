import { createContext, useContext } from 'react';
import type { FileRef } from '@reactor-models/x2';

export type SessionStatus = 'disconnected' | 'connecting' | 'waiting' | 'ready';
export type SessionKind = 'fast' | 'pro';

export interface SessionConnectOptions {
  stream?: MediaStream | null;
  prompt?: string;
  image?: Blob;
  billingSessionId?: string;
}

export interface SessionMetadata {
  generating: boolean;
  activePrompt: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  hasReference: boolean;
  keepBacklog: boolean;
  referenceAccepted: { width: number; height: number } | null;
}

export const EMPTY_SESSION_METADATA: SessionMetadata = {
  generating: false,
  activePrompt: null,
  outputWidth: null,
  outputHeight: null,
  hasReference: false,
  keepBacklog: false,
  referenceAccepted: null,
};

export interface SessionCommands {
  kind: SessionKind;
  status: SessionStatus;
  providerSessionId?: string | null;
  providerSessionExpiration?: number | null;
  metadata: SessionMetadata;
  lastError?: { message: string } | null;
  remoteStream?: MediaStream | null;
  remotePlayNonce?: number;
  connect: (opts?: SessionConnectOptions) => Promise<void>;
  disconnect: () => Promise<void>;
  reset: () => Promise<void>;
  setPrompt: (params: { prompt?: string }) => Promise<void>;
  setPointer: (params: { x?: number; y?: number; active?: boolean }) => Promise<boolean>;
  setKeepBacklog: (params: { keep_backlog?: boolean }) => Promise<void>;
  setReferenceImage: (params: { reference_image?: FileRef; blob?: Blob }) => Promise<void>;
  uploadFile?: (blob: Blob, opts?: { name?: string }) => Promise<FileRef>;
  hasReference?: () => boolean;
}

// Context and hook intentionally share this non-component module.
export const SessionCommandsContext = createContext<SessionCommands | null>(null);

export function useSessionCommands(): SessionCommands {
  const session = useContext(SessionCommandsContext);
  if (!session) throw new Error('useSessionCommands must be used within a session provider');
  return session;
}
