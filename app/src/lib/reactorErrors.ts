import { REACTOR_DASHBOARD_URL } from './reactorConfig';

export { REACTOR_DASHBOARD_URL };

export function reactorErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err == null) return '';
  return String(err);
}

export function isBenignReactorError(err: unknown): boolean {
  return /already disconnected/i.test(reactorErrorText(err));
}

export function isReactorCreditsError(err: unknown): boolean {
  const text = reactorErrorText(err);
  return (
    /credits_depleted/i.test(text) ||
    /credits have been depleted/i.test(text) ||
    /create session:\s*402\b/i.test(text) ||
    (/\b402\b/.test(text) && !isReactorSessionLimitError(text))
  );
}

/** JWT max_sessions budget exhausted — remint, this is not a credits failure. */
export function isReactorSessionLimitError(err: unknown): boolean {
  const text = reactorErrorText(err);
  return /session limit reached/i.test(text) || /create session:\s*403\b/i.test(text);
}

export function shouldRemintReactorToken(err: unknown): boolean {
  return isReactorCreditsError(err) || isReactorSessionLimitError(err);
}

/** User-facing copy. Empty string means hide the banner. */
export function formatReactorFailure(err: unknown): string {
  const text = reactorErrorText(err).trim();
  if (!text || isBenignReactorError(text)) return '';
  if (isReactorSessionLimitError(text)) {
    return 'Reactor session limit on this token. Press Start again to mint a new one.';
  }
  if (isReactorCreditsError(text)) {
    return `Reactor credits are empty. Add credits at ${REACTOR_DASHBOARD_URL}, then press Start again.`;
  }
  return text.replace(/\s+/g, ' ');
}
