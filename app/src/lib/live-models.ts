export const LIVE_MODEL_STORAGE_KEY = 'callme.live-model';

/** Exact session `model` values from https://morphly.fun/docs */
export const LIVE_MODELS = {
  m1: { id: 'm1' as const, label: 'M2.1', apiModel: 'M 2.1' },
  m2: { id: 'm2' as const, label: 'M2.5', apiModel: 'M2.5' },
};

export type LiveModelId = keyof typeof LIVE_MODELS;

export const DEFAULT_LIVE_MODEL: LiveModelId = 'm1';

export function isLiveModelId(value: unknown): value is LiveModelId {
  return value === 'm1' || value === 'm2';
}

export function loadLiveModel(): LiveModelId {
  try {
    const stored = localStorage.getItem(LIVE_MODEL_STORAGE_KEY);
    return isLiveModelId(stored) ? stored : DEFAULT_LIVE_MODEL;
  } catch {
    return DEFAULT_LIVE_MODEL;
  }
}

export function saveLiveModel(id: LiveModelId) {
  try {
    localStorage.setItem(LIVE_MODEL_STORAGE_KEY, id);
  } catch {
    // The choice still applies for this visit when storage is blocked.
  }
}
