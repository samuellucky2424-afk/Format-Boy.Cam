import { app, BrowserWindow, systemPreferences, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { registerUpdaterIpc, scheduleBackgroundUpdateCheck } from './updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;

// Register custom protocol for OAuth deep links (must be before app.ready)
app.setAsDefaultProtocolClient('formatboy');

// Enforce single instance so deep link callbacks work on Windows
const gotTheLock = app.requestSingleInstanceLock();

function handleOAuthDeepLink(url) {
  if (!url || !url.startsWith('formatboy://')) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('oauth-callback', url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

if (!gotTheLock) {
  app.quit();
} else {
  // On Windows, deep link comes in as a second-instance commandLine arg
  app.on('second-instance', (_event, commandLine) => {
    const deepLink = commandLine.find(arg => arg.startsWith('formatboy://'));
    if (deepLink) handleOAuthDeepLink(deepLink);
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

// Resolve the app icon path — prefer .ico for Windows, fall back to .png
function resolveIconPath() {
  const icoPath = path.join(__dirname, '../public/icon.ico');
  const pngPath = path.join(__dirname, '../public/logo.png');

  // In packaged mode, the paths are relative to the asar
  const packedIco = path.join(__dirname, '../dist/icon.ico');
  const packedPng = path.join(__dirname, '../dist/logo.png');

  if (app.isPackaged) {
    if (fs.existsSync(packedIco)) return packedIco;
    if (fs.existsSync(packedPng)) return packedPng;
  }

  if (fs.existsSync(icoPath)) return icoPath;
  if (fs.existsSync(pngPath)) return pngPath;

  return undefined;
}

function createWindow() {
  const iconPath = resolveIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    icon: iconPath,
    show: false, // Prevent white flash — show after ready-to-show
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nativeWindowOpen: true
    }
  });

  mainWindow.removeMenu();

  // Show window when content is ready — fixes "first click blank" issue
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Fallback: if ready-to-show never fires, force show after 3 seconds
  const showTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 3000);

  mainWindow.once('show', () => clearTimeout(showTimeout));

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
          icon: iconPath,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            nativeWindowOpen: true
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

// Open a URL in the system default browser (used for generic links)
ipcMain.on('open-external', (_event, url) => {
  shell.openExternal(url);
});

// Open a custom popup for Google OAuth authentication
ipcMain.on('open-auth-popup', (_event, authUrl) => {
  const authWindow = new BrowserWindow({
    width: 600,
    height: 750,
    parent: mainWindow,
    modal: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Spoof the User-Agent to bypass Google's "disallowed_useragent" block for Electron
  const userAgent = authWindow.webContents.userAgent.replace(/\sElectron\/.+?(\s|$)/, ' ');
  authWindow.loadURL(authUrl, { userAgent });

  authWindow.once('ready-to-show', () => {
    authWindow.show();
  });

  // Intercept deep links or web callbacks eagerly to complete the sign-in process
  const filterDeepLink = (event, url) => {
    if (url.startsWith('formatboy://')) {
      event.preventDefault();
      handleOAuthDeepLink(url);
      authWindow.close();
      return;
    }

    // Fallback: Aggressively intercept the Vercal callback url to prevent blank screen hangs
    if ((url.includes('format-boy-cam.vercel.app') || url.includes('localhost')) && (url.includes('code=') || url.includes('access_token='))) {
      event.preventDefault();

      let code = null;
      const codeMatch = url.match(/[?&#]code=([^&#]+)/);
      if (codeMatch) code = codeMatch[1];

      if (code) {
        const nextMatch = url.match(/[?&#]next=([^&#]+)/);
        const next = nextMatch ? nextMatch[1] : '/dashboard';
        const deepLink = `formatboy://auth/callback?code=${code}&next=${next}`;
        handleOAuthDeepLink(deepLink);
      }
      authWindow.close();
    }
  };

  authWindow.webContents.on('will-navigate', filterDeepLink);
  authWindow.webContents.on('will-redirect', filterDeepLink);
});

// macOS: deep link comes via open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleOAuthDeepLink(url);
});

registerUpdaterIpc();

app.whenReady().then(async () => {
  // Request camera access inherently for WebRTC dependencies
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('camera');
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
