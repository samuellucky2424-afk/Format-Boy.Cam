import { app, BrowserWindow, ipcMain } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';

export const CURRENT_VERSION = '1.0.0';

const DEFAULT_VERSION_ENDPOINT = 'https://format-boy-cam.vercel.app/api/version';
const DEFAULT_DOWNLOAD_URL = 'https://mega.nz/file/yDZVDBQJ#jOM2bnxJuGUqBp3qri_8sCgFGJb3pbEiIv-4DI-WZA8';
const BACKGROUND_CHECK_DELAY_MS = 15_000;

let updateState = createInitialState();
let activeCheckPromise = null;
let activeDownloadPromise = null;
let activeInstallPromise = null;
let backgroundCheckTimer = null;

function createInitialState() {
  return {
    status: 'idle',
    currentVersion: getCurrentVersion(),
    latestVersion: null,
    progress: 0,
    message: 'Ready to check for updates.',
    checkedAt: null,
    downloadUrl: null,
    downloadedFilePath: null,
    downloadedFileName: null,
    artifactType: null,
    notes: null,
    error: null,
    isElectron: true,
    isPackaged: app.isPackaged,
    canAutoInstall: canAutoInstall(),
  };
}

function getCurrentVersion() {
  const packagedVersion = app.getVersion();
  return packagedVersion && packagedVersion !== '0.0.0' ? packagedVersion : CURRENT_VERSION;
}

function canAutoInstall() {
  return process.platform === 'win32' && app.isPackaged;
}

function normalizeApiBase(value) {
  if (!value) return null;

  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  return trimmed.replace(/\/api$/i, '') || null;
}

function getVersionManifestUrl() {
  const explicitManifestUrl = process.env.DESKTOP_UPDATE_MANIFEST_URL?.trim();
  if (explicitManifestUrl) return explicitManifestUrl;

  const apiBase = normalizeApiBase(process.env.DESKTOP_UPDATE_API_BASE_URL || process.env.VITE_API_BASE_URL);
  return apiBase ? `${apiBase}/api/version` : DEFAULT_VERSION_ENDPOINT;
}

function getUpdateDirectory() {
  const localAppData = process.env.LOCALAPPDATA || app.getPath('temp');
  return path.join(localAppData, 'FormatBoyCam', 'update');
}

function compareVersions(left, right) {
  const leftParts = String(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function inferArtifactType(manifest, fileName = '') {
  const explicitType = String(manifest.artifact_type || '').trim().toLowerCase();
  if (explicitType === 'installer' || explicitType === 'portable') {
    return explicitType;
  }

  const fileNameLower = fileName.toLowerCase();
  if (fileNameLower.includes('setup') || fileNameLower.includes('installer')) {
    return 'installer';
  }

  return 'portable';
}

function sanitizeFileName(fileName) {
  const fallbackName = `format-boy-cam-${Date.now()}.exe`;
  const candidate = String(fileName || '').trim();
  const normalized = candidate.replace(/["<>:|?*\\\/]+/g, '-');

  if (!normalized) {
    return fallbackName;
  }

  return normalized.toLowerCase().endsWith('.exe') ? normalized : `${normalized}.exe`;
}

function extractFileName(response, version) {
  const contentDisposition = response.headers.get('content-disposition') || '';
  const fileNameMatch =
    contentDisposition.match(/filename\*=UTF-8''([^;]+)/i) ||
    contentDisposition.match(/filename="?([^";]+)"?/i);

  if (fileNameMatch?.[1]) {
    return sanitizeFileName(decodeURIComponent(fileNameMatch[1]));
  }

  try {
    const responseUrl = new URL(response.url);
    const pathnameName = responseUrl.pathname.split('/').filter(Boolean).pop();
    if (pathnameName) return sanitizeFileName(pathnameName);
  } catch {
    // Ignore URL parsing errors and fall back to a generated file name.
  }

  return sanitizeFileName(`Format-Boy-CAM-${version}.exe`);
}

function isProbablyMegaShare(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.includes('mega.nz') && !parsedUrl.pathname.toLowerCase().endsWith('.exe');
  } catch {
    return false;
  }
}

function serializeState() {
  return {
    ...updateState,
    currentVersion: getCurrentVersion(),
    isPackaged: app.isPackaged,
    canAutoInstall: canAutoInstall(),
  };
}

function broadcastState() {
  const payload = serializeState();

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('updater:state', payload);
    }
  }

  return payload;
}

function setUpdateState(patch) {
  updateState = {
    ...updateState,
    ...patch,
    currentVersion: getCurrentVersion(),
    isPackaged: app.isPackaged,
    canAutoInstall: canAutoInstall(),
  };

  return broadcastState();
}

async function ensureUpdateDirectory() {
  const updateDirectory = getUpdateDirectory();
  await fs.promises.mkdir(updateDirectory, { recursive: true });
  return updateDirectory;
}

async function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function validateDownloadedExecutable(filePath, expectedSha256) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size < 1_024) {
    throw new Error('Downloaded update is incomplete or too small to be a valid desktop executable.');
  }

  const handle = await fs.promises.open(filePath, 'r');
  try {
    const signature = Buffer.alloc(2);
    await handle.read(signature, 0, signature.length, 0);

    if (signature[0] !== 0x4d || signature[1] !== 0x5a) {
      throw new Error('Downloaded file is not a valid Windows executable.');
    }
  } finally {
    await handle.close();
  }

  if (expectedSha256) {
    const actualSha256 = await computeSha256(filePath);
    if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error('Downloaded update checksum did not match the expected value.');
    }
  }
}

async function fetchVersionManifest() {
  const manifestUrl = getVersionManifestUrl();
  const response = await fetch(manifestUrl, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`Version server returned ${response.status}.`);
  }

  const payload = await response.json();
  const version = String(payload?.version || '').trim();
  const downloadUrl = String(payload?.download_url || DEFAULT_DOWNLOAD_URL).trim();

  if (!version) {
    throw new Error('Version server response is missing a version value.');
  }

  if (!downloadUrl) {
    throw new Error('Version server response is missing a download URL.');
  }

  return {
    version,
    download_url: downloadUrl,
    artifact_type: inferArtifactType(payload),
    sha256: String(payload?.sha256 || '').trim() || null,
    notes: String(payload?.notes || '').trim() || null,
  };
}

async function downloadUpdateArtifact(manifest) {
  if (isProbablyMegaShare(manifest.download_url)) {
    throw new Error(
      'MEGA share pages are not direct executable downloads. Point /api/version at a direct .exe asset or proxy the binary through your API.'
    );
  }

  const updateDirectory = await ensureUpdateDirectory();
  const response = await fetch(manifest.download_url, {
    headers: {
      Accept: 'application/octet-stream,application/x-msdownload,*/*',
      'Cache-Control': 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`Update download failed with status ${response.status}.`);
  }

  if (!response.body) {
    throw new Error('Update server did not return a downloadable file stream.');
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10) || 0;
  const fileName = extractFileName(response, manifest.version);
  const tempFilePath = path.join(updateDirectory, `${fileName}.download`);
  const finalFilePath = path.join(updateDirectory, fileName);

  await fs.promises.rm(tempFilePath, { force: true }).catch(() => {});

  const readable = Readable.fromWeb(response.body);
  const writable = fs.createWriteStream(tempFilePath, { flags: 'w' });
  let receivedBytes = 0;

  await new Promise((resolve, reject) => {
    readable.on('data', (chunk) => {
      receivedBytes += chunk.length;

      if (contentLength > 0) {
        const progress = Math.min(99, Math.round((receivedBytes / contentLength) * 100));
        setUpdateState({
          status: 'downloading',
          progress,
          message: `Downloading update ${manifest.version}... ${progress}%`,
        });
      } else {
        setUpdateState({
          status: 'downloading',
          progress: 0,
          message: `Downloading update ${manifest.version}...`,
        });
      }
    });

    readable.on('error', reject);
    writable.on('error', reject);
    writable.on('finish', resolve);
    readable.pipe(writable);
  });

  await validateDownloadedExecutable(tempFilePath, manifest.sha256);

  await fs.promises.rm(finalFilePath, { force: true }).catch(() => {});
  await fs.promises.rename(tempFilePath, finalFilePath);

  return {
    filePath: finalFilePath,
    fileName,
    artifactType: inferArtifactType(manifest, fileName),
  };
}

async function installDownloadedUpdate() {
  if (activeInstallPromise) {
    return activeInstallPromise;
  }

  if (!updateState.downloadedFilePath) {
    throw new Error('No downloaded update is ready to install.');
  }

  if (!canAutoInstall()) {
    throw new Error('Automatic install is only available in the packaged Windows desktop app.');
  }

  activeInstallPromise = (async () => {
    setUpdateState({
      status: 'installing',
      progress: 100,
      error: null,
      message: 'Installing update and restarting Format-Boy Cam...',
    });

    const spawnArguments = [];
    const updaterProcess = spawn(updateState.downloadedFilePath, spawnArguments, {
      detached: true,
      stdio: 'ignore',
    });

    updaterProcess.unref();

    setTimeout(() => {
      app.quit();
    }, 1500);

    return serializeState();
  })()
    .catch((error) => {
      setUpdateState({
        status: 'error',
        error: error.message || 'Failed to install the downloaded update.',
        message: error.message || 'Failed to install the downloaded update.',
      });

      throw error;
    })
    .finally(() => {
      activeInstallPromise = null;
    });

  return activeInstallPromise;
}



export async function checkForUpdates({ silent = false, autoDownload = true, autoInstall = false } = {}) {
  if (activeCheckPromise) {
    return activeCheckPromise;
  }

  activeCheckPromise = (async () => {
    const checkedAt = new Date().toISOString();

    setUpdateState({
      status: 'checking',
      progress: 0,
      error: null,
      checkedAt,
      message: silent ? 'Checking for updates in the background...' : 'Checking for updates...',
    });

    const manifest = await fetchVersionManifest();
    const currentVersion = getCurrentVersion();
    const comparison = compareVersions(manifest.version, currentVersion);

    if (comparison <= 0) {
      return setUpdateState({
        status: 'up-to-date',
        latestVersion: manifest.version,
        downloadUrl: manifest.download_url,
        notes: manifest.notes,
        checkedAt,
        progress: 100,
        message: `Format-Boy Cam ${currentVersion} is up to date.`,
      });
    }

    setUpdateState({
      status: 'available',
      latestVersion: manifest.version,
      downloadUrl: manifest.download_url,
      notes: manifest.notes,
      artifactType: manifest.artifact_type,
      checkedAt,
      progress: 0,
      message: `Version ${manifest.version} is available.`,
    });

    if (autoDownload) {
      return downloadUpdate(manifest, { autoInstall });
    }

    return serializeState();
  })()
    .catch((error) => {
      return setUpdateState({
        status: 'error',
        progress: 0,
        error: error.message || 'Failed to check for updates.',
        message: error.message || 'Failed to check for updates.',
      });
    })
    .finally(() => {
      activeCheckPromise = null;
    });

  return activeCheckPromise;
}

export async function downloadUpdate(manifestOverride = null, { autoInstall = false } = {}) {
  if (activeDownloadPromise) {
    return activeDownloadPromise;
  }

  activeDownloadPromise = (async () => {
    const manifest = manifestOverride || (await fetchVersionManifest());

    setUpdateState({
      status: 'downloading',
      progress: 0,
      error: null,
      latestVersion: manifest.version,
      downloadUrl: manifest.download_url,
      notes: manifest.notes,
      artifactType: manifest.artifact_type,
      message: `Downloading update ${manifest.version}...`,
    });

    const artifact = await downloadUpdateArtifact(manifest);
    const downloadedState = setUpdateState({
      status: 'downloaded',
      progress: 100,
      latestVersion: manifest.version,
      downloadUrl: manifest.download_url,
      notes: manifest.notes,
      artifactType: artifact.artifactType,
      downloadedFilePath: artifact.filePath,
      downloadedFileName: artifact.fileName,
      error: null,
      message: canAutoInstall()
        ? `Update ${manifest.version} is ready to install.`
        : `Update ${manifest.version} downloaded. Automatic install requires the packaged Windows desktop build.`,
    });

    if (autoInstall && canAutoInstall()) {
      return installDownloadedUpdate();
    }

    return downloadedState;
  })()
    .catch((error) => {
      return setUpdateState({
        status: 'error',
        progress: 0,
        error: error.message || 'Failed to download the update.',
        message: error.message || 'Failed to download the update.',
      });
    })
    .finally(() => {
      activeDownloadPromise = null;
    });

  return activeDownloadPromise;
}

export function registerUpdaterIpc() {
  ipcMain.handle('updater:get-state', async () => serializeState());
  ipcMain.handle('updater:check', async () => checkForUpdates({ silent: false, autoDownload: true, autoInstall: false }));
  ipcMain.handle('updater:install', async () => installDownloadedUpdate());
}

export function scheduleBackgroundUpdateCheck() {
  if (backgroundCheckTimer || !app.isPackaged) {
    return;
  }

  backgroundCheckTimer = setTimeout(() => {
    void checkForUpdates({ silent: true, autoDownload: true, autoInstall: false });
  }, BACKGROUND_CHECK_DELAY_MS);
}
