import { app, BrowserWindow, systemPreferences, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { spawn, execFile } from 'child_process';
import { registerUpdaterIpc, scheduleBackgroundUpdateCheck } from './updater.js';

// ---------------------------------------------------------------------------
// Virtual Camera — pipe publisher process + registration
// ---------------------------------------------------------------------------
let vcamPublisher         = null;
let vcamPublisherReady    = false;
const PIPE_FRAME_MAGIC    = 0x4642434D; // "FBCM"
const PIPE_PROTOCOL_VER   = 1;
const VCAM_FRAME_WIDTH    = 1280;
const VCAM_FRAME_HEIGHT   = 720;
const VCAM_FPS            = 15;
const VCAM_FRAME_STRIDE   = VCAM_FRAME_WIDTH * 4;
const VCAM_FRAME_BYTES    = VCAM_FRAME_STRIDE * VCAM_FRAME_HEIGHT;

function makeSolidRgbaFrame(r = 0, g = 0, b = 0, a = 255) {
  const frame = Buffer.alloc(VCAM_FRAME_BYTES);
  for (let i = 0; i < frame.length; i += 4) {
    frame[i] = r;
    frame[i + 1] = g;
    frame[i + 2] = b;
    frame[i + 3] = a;
  }
  return frame;
}

const SOLID_BLACK_RGBA = makeSolidRgbaFrame(0, 0, 0, 255);
const SOLID_GREEN_RGBA = makeSolidRgbaFrame(0, 255, 0, 255);

function normalizeRendererFrame(rgbaBuffer, width, height) {
  if (width !== VCAM_FRAME_WIDTH || height !== VCAM_FRAME_HEIGHT) {
    return Buffer.from(SOLID_BLACK_RGBA);
  }

  if (process.env.FORMATBOY_VCAM_TEST_PATTERN === '1') {
    return Buffer.from(SOLID_GREEN_RGBA);
  }

  try {
    const normalized = Buffer.from(rgbaBuffer);
    if (normalized.length !== VCAM_FRAME_BYTES) {
      return Buffer.from(SOLID_BLACK_RGBA);
    }
    return normalized;
  } catch {
    return Buffer.from(SOLID_BLACK_RGBA);
  }
}

function getNativeBinDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'formatboy-cam');
  }
  // Dev: support both app-local and repo-root native-camera layouts.
  const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = [
    path.join(appDir, 'native-camera', 'build', 'Release'),
    path.join(appDir, '..', 'native-camera', 'build', 'Release'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function getRegistrarPath() {
  return path.join(getNativeBinDir(), 'formatboy_cam_registrar.exe');
}

function getPublisherPath() {
  return path.join(getNativeBinDir(), 'formatboy_cam_pipe_publisher.exe');
}

// Run the registrar probe; if unhealthy, run install.
// Only attempts repair in the packaged app (installer already ran elevated).
function ensureVCamRegistration() {
  if (!app.isPackaged) return; // dev build — skip
  const registrar = getRegistrarPath();
  if (!fs.existsSync(registrar)) return;

  execFile(registrar, ['probe'], { timeout: 10000 }, (err) => {
    if (err) {
      // Probe failed — attempt repair (installer set the exe to run elevated)
      execFile(registrar, ['install', '--all-users'], { timeout: 30000 }, (err2) => {
        if (err2) {
          // Fall back to current-user install
          execFile(registrar, ['install'], { timeout: 30000 }, () => {});
        }
      });
    }
  });
}

// Spawn the frame-publisher child process.
function startVCamPublisher() {
  const publisherPath = getPublisherPath();
  if (!fs.existsSync(publisherPath)) {
    console.error('[vcam-publisher] executable not found at', publisherPath);
    return;
  }

  if (vcamPublisher) return; // already running

  vcamPublisher = spawn(publisherPath, [], {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  });

  vcamPublisher.stderr.on('data', (d) =>
    console.error('[vcam-publisher]', d.toString().trim()));

  vcamPublisher.on('exit', (code) => {
    console.warn('[vcam-publisher] exited with code', code);
    vcamPublisher      = null;
    vcamPublisherReady = false;
    // Auto-restart after 2 s if the app is still running
    setTimeout(() => { if (!app.isQuitting) startVCamPublisher(); }, 2000);
  });

  vcamPublisher.stdin.on('error', (err) => {
    if (err.code === 'EPIPE') {
      console.warn('[vcam-publisher] stdin EPIPE — restarting');
      vcamPublisher.kill();
    }
  });

  vcamPublisherReady = true;
}

function stopVCamPublisher() {
  if (vcamPublisher) {
    vcamPublisher.removeAllListeners('exit');
    vcamPublisher.kill();
    vcamPublisher      = null;
    vcamPublisherReady = false;
  }
}

// Build and write the 40-byte PipeFrameHeader followed by the BGRA payload.
// The renderer sends RGBA (browser-native); we swap R↔B here so the DLL
// receives BGRA as it expects.
function writeFrameToPublisher(rgbaBuffer, width, height) {
  if (!vcamPublisher || !vcamPublisherReady) return;

  const stride       = VCAM_FRAME_STRIDE;
  const payloadBytes = VCAM_FRAME_BYTES;
  const safeRgba     = normalizeRendererFrame(rgbaBuffer, width, height);

  // R↔B swap (RGBA → BGRA) in-place on a copy
  const bgra = Buffer.from(safeRgba);
  for (let i = 0; i < bgra.length; i += 4) {
    const r = bgra[i];
    bgra[i]     = bgra[i + 2]; // B ← R
    bgra[i + 2] = r;           // R ← B
  }

  const timestampHns = BigInt(Date.now()) * 10000n; // ms → 100ns units

  // 40-byte header (all little-endian)
  const header = Buffer.allocUnsafe(40);
  header.writeUInt32LE(PIPE_FRAME_MAGIC,  0);
  header.writeUInt32LE(PIPE_PROTOCOL_VER, 4);
  header.writeUInt32LE(VCAM_FRAME_WIDTH,  8);
  header.writeUInt32LE(VCAM_FRAME_HEIGHT, 12);
  header.writeUInt32LE(stride,           16);
  header.writeUInt32LE(VCAM_FPS,         20);
  header.writeUInt32LE(1,                24); // flags
  header.writeUInt32LE(payloadBytes,     28);
  header.writeBigInt64LE(timestampHns,   32);

  try {
    vcamPublisher.stdin.write(header);
    vcamPublisher.stdin.write(bgra);
  } catch (e) {
    // Ignore EPIPE here — the 'error' handler on stdin will trigger restart
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
let authWindow = null;
let authCallbackHandled = false;

// Keep the WebRTC encoder on the safer software path. The receive/decode side
// still benefits from normal Chromium GPU acceleration in Electron.
app.commandLine.appendSwitch('disable-webrtc-hw-encoding');

// Register custom protocol for OAuth deep links (must be before app.ready)
app.setAsDefaultProtocolClient('formatboy');

// Enforce single instance so deep link callbacks work on Windows
const gotTheLock = app.requestSingleInstanceLock();

function isOAuthCallbackUrl(url) {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'formatboy:') {
      return true;
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    }

    return false;
  } catch {
    return url.startsWith('formatboy://');
  }
}

function closeAuthWindow() {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.destroy();
  }
  authWindow = null;
}

function handleOAuthCallback(url) {
  if (!isOAuthCallbackUrl(url)) return;
  if (authCallbackHandled) return;

  authCallbackHandled = true;

  closeAuthWindow();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('oauth-callback', url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

function createAuthWindow(url) {
  if (!url) return;

  authCallbackHandled = false;
  closeAuthWindow();

  authWindow = new BrowserWindow({
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    width: 520,
    height: 720,
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    title: 'Continue with Google',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      nativeWindowOpen: false,
    },
  });

  authWindow.removeMenu();

  const handleNavigation = (event, nextUrl) => {
    if (!isOAuthCallbackUrl(nextUrl)) {
      return;
    }

    event.preventDefault();
    handleOAuthCallback(nextUrl);
  };

  authWindow.webContents.on('will-navigate', handleNavigation);
  authWindow.webContents.on('will-redirect', handleNavigation);
  authWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (isOAuthCallbackUrl(nextUrl)) {
      handleOAuthCallback(nextUrl);
      return { action: 'deny' };
    }

    shell.openExternal(nextUrl);
    return { action: 'deny' };
  });

  authWindow.on('closed', () => {
    authWindow = null;
  });

  authWindow.loadURL(url);
}

if (!gotTheLock) {
  app.quit();
} else {
  // On Windows, deep link comes in as a second-instance commandLine arg
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = commandLine.find(arg => arg.startsWith('formatboy://'));
    if (deepLink) handleOAuthCallback(deepLink);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Explicitly load the .env file as requested
const envPath = app.isPackaged 
    ? path.join(process.resourcesPath, '.env') 
    : path.join(__dirname, '../.env');

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nativeWindowOpen: true,
      // CRITICAL for the virtual camera: keep the renderer's setTimeout /
      // requestAnimationFrame loops running at full speed even when the
      // window is minimized, occluded, or backgrounded (e.g. when the user
      // switches focus to WhatsApp during a call). Without this, Chromium
      // throttles the 30 Hz capture loop in VirtualCameraService to ~1 Hz
      // and frames stop reaching the publisher / file bridge.
      backgroundThrottling: false
    }
  });

  mainWindow.removeMenu();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('#/preview')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 720,
          title: 'Format-Boy preview',
          autoHideMenuBar: true,
          backgroundColor: '#000000',
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            nativeWindowOpen: true,
            backgroundThrottling: false
          }
        }
      };
    }

    return { action: 'allow' };
  });

  if (app.isPackaged) {
    // Ensure routing works for nested paths if hash router isn't used
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

// Open a URL in the system default browser (used for Google OAuth)
ipcMain.on('open-external', (_event, url) => {
  shell.openExternal(url);
});

// Open the native Google auth popup inside the app.
ipcMain.on('open-auth-popup', (_event, url) => {
  createAuthWindow(url);
});

// Toggle window ghost mode (exclude from screen capture)
ipcMain.on('toggle-capture-protection', (_event, { isProtected }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setContentProtection(isProtected);
  }
});

ipcMain.on('renderer-log', (_event, { level = 'log', message, data }) => {
  const writer = typeof console[level] === 'function' ? console[level] : console.log;
  if (data === undefined) {
    writer(`[renderer] ${message}`);
  } else {
    writer(`[renderer] ${message}`, data);
  }
});

// macOS: deep link comes via open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleOAuthCallback(url);
});

// ---------------------------------------------------------------------------
// Virtual Camera IPC handler
// Renderer calls ipcRenderer.send('sendVirtualCameraFrame', { buffer, width, height })
// Main forwards to the publisher's stdin. buffer is a Uint8Array of raw RGBA
// pixels (canvas getImageData format).
let vcamFrameCount = 0;
let vcamLastReportAt = 0;
ipcMain.on('sendVirtualCameraFrame', (_event, { buffer, width, height }) => {
  writeFrameToPublisher(buffer, width, height);
  vcamFrameCount++;
  const now = Date.now();
  if (vcamLastReportAt === 0) vcamLastReportAt = now;
  if (now - vcamLastReportAt >= 5000) {
    const fps = (vcamFrameCount * 1000) / (now - vcamLastReportAt);
    console.log(`[vcam] ${vcamFrameCount} frames in last ${now - vcamLastReportAt} ms (${fps.toFixed(1)} fps)`);
    vcamFrameCount = 0;
    vcamLastReportAt = now;
  }
});

// Query whether the publisher is alive
ipcMain.handle('vcam-status', () => ({ ready: vcamPublisherReady }));

registerUpdaterIpc();

app.isQuitting = false;
app.on('before-quit', () => { app.isQuitting = true; stopVCamPublisher(); });

app.whenReady().then(async () => {
  // Request camera access inherently for WebRTC dependencies
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('camera');
  }

  // Virtual camera setup (Windows only)
  if (process.platform === 'win32') {
    ensureVCamRegistration();
    startVCamPublisher();
  }

  createWindow();
  scheduleBackgroundUpdateCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
