export interface MorphlySession {
  disconnect: () => Promise<void>;
  set: (config: { prompt?: string; enhance?: boolean; image?: string | Blob | File }) => Promise<void>;
  setPrompt: (text: string, options?: { enhance?: boolean }) => Promise<void>;
  on: (event: string, listener: (data: unknown) => void) => void;
  off: (event: string, listener: (data: unknown) => void) => void;
}

export type MorphlyPhase = 'idle' | 'starting' | 'live' | 'stopping' | 'stop-pending';

// Module lifetime deliberately survives route changes. A rejected stop must keep
// the exact SDK object (and its opaque credentials) available for Retry Stop.
export class MorphlySessionOwner {
  session: MorphlySession | null = null;
  cancelled = false;
  attempt = 0;
  private phase: MorphlyPhase = 'idle';
  private listeners = new Set<() => void>();
  private stream: MediaStream | null = null;
  private startFinished: Promise<void> = Promise.resolve();
  private finishStarting: (() => void) | null = null;
  private stopping: Promise<void> | null = null;
  private cleanup: (() => Promise<void>) | null = null;
  private balance: MorphlyBalance = {};

  getSnapshot = () => this.phase;
  getBalance = () => this.balance;
  updateBalance(value: unknown) {
    this.balance = { ...this.balance, ...readMorphlyBalance(value) };
    this.listeners.forEach((listener) => listener());
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(phase: MorphlyPhase) {
    this.phase = phase;
    this.listeners.forEach((listener) => listener());
  }
  begin() {
    if (this.phase !== 'idle') return false;
    this.cancelled = false;
    this.attempt++;
    this.balance = {};
    this.startFinished = new Promise((resolve) => { this.finishStarting = resolve; });
    this.publish('starting');
    return true;
  }
  own(stream: MediaStream) {
    this.stream = stream;
    if (this.cancelled) stream.getTracks().forEach((track) => track.stop());
  }
  onCleanup(cleanup: () => Promise<void>) { this.cleanup = cleanup; }
  attach(session: MorphlySession) { this.session = session; }
  finishStart(live: boolean) {
    this.finishStarting?.();
    this.finishStarting = null;
    if (live && !this.cancelled) this.publish('live');
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.phase === 'idle') return Promise.resolve();
    this.cancelled = true;
    this.publish('stopping');
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stopping = (async () => {
      await this.startFinished;
      try {
        await this.session?.disconnect();
        this.session = null; // Only a confirmed stop releases the SDK object.
        try {
          await this.cleanup?.();
        } catch {
          throw Object.assign(new Error(), { code: 'APP_SESSION_STOP_PENDING' });
        }
        this.cleanup = null;
        this.publish('idle');
      } catch (error) {
        this.publish('stop-pending');
        throw error;
      } finally {
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
        this.stopping = null;
      }
    })();
    return this.stopping;
  }
}

export const morphlySession = new MorphlySessionOwner();

const CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;

export function morphlyDiagnostic(error: unknown) {
  const value = error as { code?: unknown; name?: unknown; status?: unknown; cause?: { code?: unknown; name?: unknown } } | null;
  const candidates = [value?.code, value?.cause?.code, value?.name, value?.cause?.name];
  const rawCode = candidates.find((candidate) => typeof candidate === 'string' && CODE_PATTERN.test(candidate));
  return {
    code: typeof rawCode === 'string' ? rawCode : 'MORPHLY_ERROR',
    status: typeof value?.status === 'number' ? value.status : undefined,
  };
}

function safeErrorDetail(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message || message === 'Error') return undefined;
  if (/bearer|token|secret|api[_ -]?key|authorization/i.test(message)) return undefined;
  return message.slice(0, 180);
}

export function morphlyErrorMessage(error: unknown) {
  const { code, status } = morphlyDiagnostic(error);
  const messages: Record<string, string> = {
    REALTIME_SETUP_REQUIRED: 'Morphly needs a server update. Contact Morphly support with REALTIME_SETUP_REQUIRED.',
    SESSION_STOP_PENDING: 'Morphly stop is unconfirmed. Retry Stop; usage and refunds may remain pending.',
    APP_SESSION_STOP_PENDING: 'Morphly stopped, but your app session could not close. Use Retry Stop to finish.',
    SDK_LOAD_FAILED: 'Could not load the Morphly SDK. Check your network and browser content security policy.',
    OUTPUT_TIMEOUT: 'Morphly has not delivered a video frame. Check camera input and WebRTC network access.',
    APP_LOGIN_REQUIRED: 'Sign in again before starting Morphly.',
    APP_ORIGIN_MISSING: 'Configure the Morphly application origins in server settings.',
    MORPHLY_API_KEY_MISSING: 'Configure MORPHLY_API_KEY in the server settings.',
    MORPHLY_API_KEY_REJECTED: 'The Morphly key on the server was rejected. The server administrator needs to create a new live key and update the server settings.',
    RATE_LIMIT_UNAVAILABLE: 'Morphly rate limiting needs its server database migration.',
    VIDEO_PLAYBACK_BLOCKED: 'Morphly playback was blocked. Allow muted video playback and try again.',
    VIDEO_PLAYBACK_FAILED: 'The output video could not play. Check the video element and try again.',
    CAMERA_UNAVAILABLE: 'Morphly needs camera permission and HTTPS or localhost.',
    BILLING_UNAVAILABLE: 'Morphly stopped because billing could not be verified. Stop confirmation may be pending.',
    REALTIME_CONNECTION_FAILED: 'Morphly could not keep the live connection open. Try Start again.',
    INVALID_TOKEN_RESPONSE: 'Morphly returned an incomplete session. Try Start again.',
    MEDIA_STREAM_ENDED: 'The camera stopped before Morphly could connect.',
    SESSION_DISCONNECTED: 'Morphly disconnected. Start a new session.',
    IMAGE_UNAVAILABLE: 'The reference image could not be loaded.',
    PLAN_EXPIRED: 'Your access plan has expired. Choose a plan to keep streaming.',
  };
  const statuses: Record<number, string> = {
    400: 'Morphly rejected the model, origin, or session duration.',
    401: 'The Morphly key on the server was rejected. The server administrator needs to create a new live key and update the server settings.',
    402: 'Insufficient credits for Morphly. Check your app wallet and Morphly workspace balance.',
    403: 'Morphly access was denied. Check account access, realtime:create scope, and allowed origins.',
    409: 'The session request conflicts with an existing creation. Credentials cannot be replayed; do not retry automatically.',
    429: 'Morphly rate limit reached. Wait before trying again.',
    502: 'Morphly session creation failed. Check server diagnostics and Morphly availability.',
    503: 'Morphly sessions are currently unavailable. Check the Morphly error code before retrying.',
  };
  const known = messages[code] || (status ? statuses[status] : undefined);
  const text = known || safeErrorDetail(error) || 'Morphly could not complete the request.';
  return `${text} (${code}${status ? `, HTTP ${status}` : ''})`;
}

export type MorphlyBalance = Partial<Record<'available_credits' | 'reserved_credits' | 'charged_credits' | 'billable_seconds', number>>;
export function readMorphlyBalance(value: unknown): MorphlyBalance {
  const source = value as Record<string, unknown> | null;
  const result: MorphlyBalance = {};
  for (const key of ['available_credits', 'reserved_credits', 'charged_credits', 'billable_seconds'] as const) {
    if (typeof source?.[key] === 'number' && Number.isFinite(source[key])) result[key] = source[key];
  }
  return result;
}
