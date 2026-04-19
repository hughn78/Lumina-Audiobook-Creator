import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { getLuminaServerUrl, startLuminaServer, stopLuminaServer } from '../server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow: BrowserWindow | null = null;
let luminaServer: Server | null = null;

function resolveStaticDir() {
  return path.resolve(__dirname, '../../dist');
}

async function createMainWindow() {
  if (!luminaServer) {
    luminaServer = startLuminaServer(0, {
      staticDir: resolveStaticDir(),
      corsEnabled: false,
    });
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    title: 'Lumina Audiobook Creator',
    backgroundColor: '#0a0502',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await new Promise<void>((resolve, reject) => {
    if (!luminaServer) {
      reject(new Error('Lumina server failed to start'));
      return;
    }

    if (luminaServer.listening) {
      resolve();
      return;
    }

    luminaServer.once('listening', () => resolve());
    luminaServer.once('error', reject);
  });

  await mainWindow.loadURL(getLuminaServerUrl(luminaServer));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  void createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (!luminaServer) return;

  event.preventDefault();
  void stopLuminaServer(luminaServer)
    .catch((error) => {
      console.error('Failed to stop Lumina server cleanly', error);
    })
    .finally(() => {
      luminaServer = null;
      app.exit(0);
    });
});
