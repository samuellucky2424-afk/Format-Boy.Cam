import { CURRENT_VERSION } from '@/lib/app-version';

export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'up-to-date'
  | 'error';

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  progress: number;
  message: string;
  checkedAt: string | null;
  downloadUrl: string | null;
  downloadedFilePath: string | null;
  downloadedFileName: string | null;
  artifactType: 'portable' | 'installer' | null;
  notes: string | null;
  error: string | null;
  isElectron: boolean;
  isPackaged: boolean;
  canAutoInstall: boolean;
}

const defaultState: DesktopUpdateState = {
  status: 'idle',
  currentVersion: CURRENT_VERSION,
  latestVersion: null,
  progress: 0,
  message: 'Desktop updates are only available in the Electron app.',
  checkedAt: null,
  downloadUrl: null,
  downloadedFilePath: null,
  downloadedFileName: null,
  artifactType: null,
  notes: null,
  error: null,
  isElectron: false,
  isPackaged: false,
  canAutoInstall: false,
};

function getIpcRenderer() {
  if (typeof window === 'undefined') {
    return null;
  }

  const electronRequire = (window as Window & { require?: (id: string) => unknown }).require;
  if (!electronRequire) {
    return null;
  }

  try {
    const electronModule = electronRequire('electron') as { ipcRenderer?: unknown };
    return electronModule.ipcRenderer as {
      invoke: (channel: string) => Promise<DesktopUpdateState>;
      on: (channel: string, listener: (_event: unknown, payload: DesktopUpdateState) => void) => void;
      removeListener: (channel: string, listener: (_event: unknown, payload: DesktopUpdateState) => void) => void;
    };
  } catch {
    return null;
  }
}

export function isDesktopUpdaterAvailable(): boolean {
  return Boolean(getIpcRenderer());
}

export async function getDesktopUpdateState(): Promise<DesktopUpdateState> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) {
    return defaultState;
  }

  return ipcRenderer.invoke('updater:get-state');
}

export async function checkForDesktopUpdates(): Promise<DesktopUpdateState> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) {
    return defaultState;
  }

  return ipcRenderer.invoke('updater:check');
}

export async function installDesktopUpdate(): Promise<DesktopUpdateState> {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) {
    return defaultState;
  }

  return ipcRenderer.invoke('updater:install');
}

export function subscribeToDesktopUpdateState(
  listener: (state: DesktopUpdateState) => void,
): () => void {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) {
    return () => {};
  }

  const handleUpdateState = (_event: unknown, payload: DesktopUpdateState) => {
    listener(payload);
  };

  ipcRenderer.on('updater:state', handleUpdateState);

  return () => {
    ipcRenderer.removeListener('updater:state', handleUpdateState);
  };
}
