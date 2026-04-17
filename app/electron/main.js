import { app, BrowserWindow, systemPreferences, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { registerUpdaterIpc, scheduleBackgroundUpdateCheck } from './updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
let authWindow = null;
let authCallbackHandled = false;

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
      nativeWindowOpen: true
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

// macOS: deep link comes via open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleOAuthCallback(url);
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
