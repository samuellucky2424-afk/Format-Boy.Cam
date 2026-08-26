
import electronPkg from 'electron';
const { app, BrowserWindow, systemPreferences, ipcMain, shell } = electronPkg;
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import { spawn, execFile } from 'child_process';
import { registerUpdaterIpc, scheduleBackgroundUpdateCheck } from './updater.js';

// ---------------------------------------------------------------------------
// Virtual Camera — pipe publisher process + registration
// ---------------------------------------------------------------------------
let vcamPublisher         = null;
let vcamPublisherReady    = false;
let vcamPublisherWritable = true;
const PIPE_FRAME_MAGIC    = 0x484E5348; // "HNSH"
const PIPE_PROTOCOL_VER   = 1;
const VCAM_FRAME_WIDTH    = 1280;
const VCAM_FRAME_HEIGHT   = 720;
const VCAM_FPS            = 30;
const VCAM_FRAME_STRIDE   = VCAM_FRAME_WIDTH * 4;
const VCAM_FRAME_BYTES    = VCAM_FRAME_STRIDE * VCAM_FRAME_HEIGHT;
const WINDOWS_BUILD       = process.platform === 'win32'
  ? Number.parseInt(os.release().split('.')[2] || '0', 10)
  : 0;
const USE_AKVCAM_BACKEND  = process.platform === 'win32' && WINDOWS_BUILD < 22000;

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

  if (process.env.HENSHIN_VCAM_TEST_PATTERN === '1') {
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
    return path.join(process.resourcesPath, 'henshin-cam');
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
  return path.join(getNativeBinDir(), 'henshin_cam_registrar.exe');
}

function getPublisherPath() {
  return path.join(getNativeBinDir(), 'henshin_cam_pipe_publisher.exe');
}

function getAkVCamManagerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'akvirtualcamera', 'x64', 'AkVCamManager.exe');
  }
  const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return path.join(appDir, 'vendor', 'akvirtualcamera', 'x64', 'AkVCamManager.exe');
}

// Run the registrar probe; if unhealthy, run install.
// Only attempts repair in the packaged app (installer already ran elevated).
function ensureVCamRegistration() {
  if (!app.isPackaged || USE_AKVCAM_BACKEND) return; // dev/Windows 10 — skip
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
  const publisherPath = USE_AKVCAM_BACKEND ? getAkVCamManagerPath() : getPublisherPath();
  if (!fs.existsSync(publisherPath)) {
    console.error('[vcam-publisher] executable not found at', publisherPath);
    return;
  }

  if (vcamPublisher) return; // already running

  const publisherArgs = USE_AKVCAM_BACKEND
    ? ['stream', 'HenshinCamera', 'BGRA', String(VCAM_FRAME_WIDTH), String(VCAM_FRAME_HEIGHT), '-f', String(VCAM_FPS)]
    : [];
  vcamPublisher = spawn(publisherPath, publisherArgs, {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  });

  vcamPublisher.stderr.on('data', (d) =>
    console.error('[vcam-publisher]', d.toString().trim()));

  vcamPublisher.on('exit', (code) => {
    console.warn('[vcam-publisher] exited with code', code);
    vcamPublisher      = null;
    vcamPublisherReady = false;
    vcamPublisherWritable = true;
    // Auto-restart after 2 s if the app is still running
    setTimeout(() => { if (!app.isQuitting) startVCamPublisher(); }, 2000);
  });

  vcamPublisher.stdin.on('error', (err) => {
    if (err.code === 'EPIPE') {
      console.warn('[vcam-publisher] stdin EPIPE — restarting');
      vcamPublisher.kill();
    }
  });
  vcamPublisher.stdin.on('drain', () => {
    vcamPublisherWritable = true;
  });

  vcamPublisherReady = true;
  vcamPublisherWritable = true;
  console.log(`[vcam-publisher] using ${USE_AKVCAM_BACKEND ? 'akvirtualcamera DirectShow' : 'Henshin Media Foundation'} backend`);
}

function stopVCamPublisher() {
  if (vcamPublisher) {
    vcamPublisher.removeAllListeners('exit');
    vcamPublisher.kill();
    vcamPublisher      = null;
    vcamPublisherReady = false;
    vcamPublisherWritable = true;
  }
}

// Build and write the 40-byte PipeFrameHeader followed by the BGRA payload.
// The renderer sends RGBA (browser-native); we swap R↔B here so the DLL
// receives BGRA as it expects.
function writeFrameToPublisher(rgbaBuffer, width, height) {
  if (!vcamPublisher || !vcamPublisherReady || !vcamPublisherWritable) return;

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
    vcamPublisherWritable = USE_AKVCAM_BACKEND
      ? vcamPublisher.stdin.write(bgra)
      : vcamPublisher.stdin.write(Buffer.concat([header, bgra]));
  } catch (e) {
    // Ignore EPIPE here — the 'error' handler on stdin will trigger restart
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
let pendingAppRoute = null;

function parseAppCallbackUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('henshin://')) return null;

  try {
    const callbackUrl = new URL(value);
    if (callbackUrl.protocol !== 'henshin:' || callbackUrl.username || callbackUrl.password) return null;

    if (callbackUrl.hostname === 'auth-callback') {
      const code = callbackUrl.searchParams.get('code') || '';
      const error = callbackUrl.searchParams.get('error') || '';
      const errorDescription = callbackUrl.searchParams.get('error_description') || '';
      if ((!code && !error) || code.length > 2048 || error.length > 200 || errorDescription.length > 500) {
        return null;
      }

      const routeParams = new URLSearchParams();
      if (code) routeParams.set('code', code);
      if (error) routeParams.set('error', error);
      if (errorDescription) routeParams.set('error_description', errorDescription);
      return `/auth-callback?${routeParams.toString()}`;
    }

    if (callbackUrl.hostname !== 'payment-success') return null;

    const paymentId = callbackUrl.searchParams.get('ref') || '';
    const transId = callbackUrl.searchParams.get('transId') || '';
    const status = callbackUrl.searchParams.get('status') || '';
    if (!paymentId && !transId) return null;

    const routeParams = new URLSearchParams();
    if (paymentId) routeParams.set('ref', paymentId);
    if (transId) routeParams.set('transId', transId);
    if (status) routeParams.set('status', status);
    return `/payment-success?${routeParams.toString()}`;
  } catch {
    return null;
  }
}

function loadRendererRoute(route = null) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (app.isPackaged) {
    const options = route ? { hash: route } : undefined;
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), options);
    return;
  }

  const baseUrl = (process.env.HENSHIN_DEV_SERVER_URL || 'http://localhost:5173').replace(/\/+$/, '');
  void mainWindow.loadURL(route ? `${baseUrl}/#${route}` : baseUrl);
}

function handleAppCallback(value) {
  const route = parseAppCallbackUrl(value);
  if (!route) return false;

  pendingAppRoute = route;
  if (mainWindow && !mainWindow.isDestroyed()) {
    loadRendererRoute(route);
    pendingAppRoute = null;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  return true;
}

function getAllowedPaymentHosts() {
  const hosts = new Set(['fapshi.com']);
  try {
    const configuredUrl = new URL(process.env.FAPSHI_BASE_URL || 'https://sandbox.fapshi.com');
    if (configuredUrl.protocol === 'https:') hosts.add(configuredUrl.hostname.toLowerCase());
  } catch {
    // Invalid optional configuration must not broaden the payment URL allowlist.
  }
  return hosts;
}

function parsePaymentUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2048 ||
    value !== value.trim()
  ) {
    return null;
  }

  try {
    const paymentUrl = new URL(value);
    const hostname = paymentUrl.hostname.toLowerCase();
    const configuredHosts = getAllowedPaymentHosts();
    const isFapshiHost =
      hostname === 'fapshi.com' ||
      hostname.endsWith('.fapshi.com') ||
      configuredHosts.has(hostname);
    if (
      paymentUrl.protocol !== 'https:' ||
      paymentUrl.username ||
      paymentUrl.password ||
      (paymentUrl.port && paymentUrl.port !== '443') ||
      !isFapshiHost
    ) {
      return null;
    }
    return paymentUrl;
  } catch {
    return null;
  }
}

function parseAuthUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;

  try {
    const authUrl = new URL(value);
    const hostname = authUrl.hostname.toLowerCase();
    if (
      authUrl.protocol !== 'https:' ||
      authUrl.username ||
      authUrl.password ||
      (authUrl.port && authUrl.port !== '443') ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(hostname) ||
      authUrl.pathname !== '/auth/v1/authorize' ||
      authUrl.searchParams.get('provider') !== 'google'
    ) {
      return null;
    }
    return authUrl;
  } catch {
    return null;
  }
}

async function openPaymentLink(value) {
  const paymentUrl = parsePaymentUrl(value);
  if (!paymentUrl) throw new Error('Invalid Fapshi payment URL.');
  await shell.openExternal(paymentUrl.href);
  return { opened: true };
}

async function openAuthLink(value) {
  const authUrl = parseAuthUrl(value);
  if (!authUrl) throw new Error('Invalid Google authentication URL.');
  await shell.openExternal(authUrl.href);
  return { opened: true };
}

// Keep the WebRTC encoder on the safer software path. The receive/decode side
// still benefits from normal Chromium GPU acceleration in Electron.
app.commandLine.appendSwitch('disable-webrtc-hw-encoding');

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient('henshin', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('henshin');
}

// Enforce single instance so authentication and payment callbacks focus the existing window.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const callbackUrl = commandLine.find((argument) => argument.startsWith('henshin://'));
    if (callbackUrl) handleAppCallback(callbackUrl);
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
    minWidth: 800,
    minHeight: 600,
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

  const rendererSession = mainWindow.webContents.session;
  const isMainRenderer = (webContents) =>
    Boolean(webContents && mainWindow && webContents.id === mainWindow.webContents.id);

  // Electron permissions and Windows camera privacy are separate layers. Grant
  // video access to our own renderer so getUserMedia can reveal every physical
  // camera consistently; Windows still enforces the user's OS privacy choice.
  rendererSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    const isVideoRequest = !details?.mediaType || details.mediaType !== 'audio';
    return permission === 'media' && isVideoRequest && isMainRenderer(webContents);
  });
  rendererSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestedMediaTypes = details?.mediaTypes || [];
    const isVideoOnlyRequest =
      requestedMediaTypes.length === 0 ||
      (requestedMediaTypes.includes('video') && !requestedMediaTypes.includes('audio'));
    callback(permission === 'media' && isVideoOnlyRequest && isMainRenderer(webContents));
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('#/preview')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 720,
          title: 'Henshin 変身 preview',
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

    if (parsePaymentUrl(url)) {
      void openPaymentLink(url).catch((error) => {
        console.error('[payment] Could not open external checkout:', error);
      });
      return { action: 'deny' };
    }

    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!parsePaymentUrl(url)) return;
    event.preventDefault();
    void openPaymentLink(url).catch((error) => {
      console.error('[payment] Could not open external checkout:', error);
    });
  });

  const initialRoute = pendingAppRoute;
  pendingAppRoute = null;
  loadRendererRoute(initialRoute);

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

ipcMain.handle('open-payment-link', (event, url) => {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('Payment links can only be opened by the main window.');
  }
  return openPaymentLink(url);
});

ipcMain.handle('open-auth-link', (event, url) => {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    throw new Error('Authentication links can only be opened by the main window.');
  }
  return openAuthLink(url);
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

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAppCallback(url);
});

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

  const initialAppCallback = process.argv.find((argument) => argument.startsWith('henshin://'));
  if (initialAppCallback) handleAppCallback(initialAppCallback);

  createWindow();
  scheduleBackgroundUpdateCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
