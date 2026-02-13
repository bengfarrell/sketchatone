/**
 * Electron Preload Script
 * 
 * Exposes a safe IPC API to the renderer process using contextBridge.
 * This is the bridge between the web app and the Node.js main process.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * API exposed to the renderer process via window.electronBridge
 */
const electronBridge = {
  // Connection management
  connect: (configPath?: string) => ipcRenderer.invoke('bridge:connect', configPath),
  disconnect: () => ipcRenderer.invoke('bridge:disconnect'),
  getConnectionState: () => ipcRenderer.invoke('bridge:getConnectionState'),
  
  // Config management
  getConfig: () => ipcRenderer.invoke('bridge:getConfig'),
  updateConfig: (path: string, value: unknown) => ipcRenderer.invoke('bridge:updateConfig', path, value),
  saveConfig: () => ipcRenderer.invoke('bridge:saveConfig'),
  setThrottle: (throttleMs: number) => ipcRenderer.invoke('bridge:setThrottle', throttleMs),
  
  // MIDI input management
  getMidiInputStatus: () => ipcRenderer.invoke('bridge:getMidiInputStatus'),
  connectMidiInput: (portId: number) => ipcRenderer.invoke('bridge:connectMidiInput', portId),
  disconnectMidiInput: () => ipcRenderer.invoke('bridge:disconnectMidiInput'),
  
  // Event subscriptions
  onCombinedEvent: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('bridge:combined', listener);
    return () => ipcRenderer.removeListener('bridge:combined', listener);
  },
  
  onConfig: (callback: (config: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, config: unknown) => callback(config);
    ipcRenderer.on('bridge:config', listener);
    return () => ipcRenderer.removeListener('bridge:config', listener);
  },
  
  onConnectionState: (callback: (state: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: string) => callback(state);
    ipcRenderer.on('bridge:connectionState', listener);
    return () => ipcRenderer.removeListener('bridge:connectionState', listener);
  },
  
  onDeviceStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('bridge:deviceStatus', listener);
    return () => ipcRenderer.removeListener('bridge:deviceStatus', listener);
  },
  
  onMidiInput: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on('bridge:midiInput', listener);
    return () => ipcRenderer.removeListener('bridge:midiInput', listener);
  },
  
  onMidiInputStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('bridge:midiInputStatus', listener);
    return () => ipcRenderer.removeListener('bridge:midiInputStatus', listener);
  },
  
  onError: (callback: (error: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('bridge:error', listener);
    return () => ipcRenderer.removeListener('bridge:error', listener);
  },
  
  // Platform info
  platform: process.platform,
  isElectron: true,
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronBridge', electronBridge);

// Type declaration for the exposed API
export type ElectronBridgeAPI = typeof electronBridge;
