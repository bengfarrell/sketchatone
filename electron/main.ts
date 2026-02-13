/**
 * Electron Main Process
 *
 * Entry point for the Electron app. Creates the main window and sets up
 * IPC communication for HID reading, strummer processing, and MIDI output.
 */

import { app, BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the IPC bridge dynamically at runtime
// This is needed because the IPC bridge is compiled separately from the Electron files
let setupIPCBridge: (window: BrowserWindow) => void;
let cleanupIPCBridge: () => void;

async function loadIPCBridge(): Promise<void> {
  const bridgePath = path.join(__dirname, '../cli/electron-ipc-bridge.js');
  const bridgeModule = await import(pathToFileURL(bridgePath).href);
  setupIPCBridge = bridgeModule.setupIPCBridge;
  cleanupIPCBridge = bridgeModule.cleanupIPCBridge;
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for node-hid access via preload
    },
    // Use default title bar for proper drag and resize behavior
    // titleBarStyle: 'hiddenInset',
    // trafficLightPosition: { x: 15, y: 15 },
  });

  // In development, load from Vite dev server
  // In production, load from built files
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // Load the built app from dist/public
    const indexPath = path.join(__dirname, '../dist/public/index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Set up IPC bridge for HID/strummer/MIDI communication
  setupIPCBridge(mainWindow);
}

// Handle macOS Input Monitoring permission
async function checkInputMonitoringPermission(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true; // Not needed on other platforms
  }

  // On macOS, we can't programmatically check Input Monitoring permission
  // The system will prompt when we try to access HID devices
  // We'll handle errors gracefully when they occur
  return true;
}

app.whenReady().then(async () => {
  // Load the IPC bridge module first
  await loadIPCBridge();

  await checkInputMonitoringPermission();
  createWindow();

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (cleanupIPCBridge) {
    cleanupIPCBridge();
  }

  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (cleanupIPCBridge) {
    cleanupIPCBridge();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  dialog.showErrorBox('Error', `An unexpected error occurred: ${error.message}`);
});
