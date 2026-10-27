import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from '../../../../packages/core/contracts';

const bridge: DesktopBridge = {
  openRepository: () => ipcRenderer.invoke('repository:open'),
  readSource: (path) => ipcRenderer.invoke('repository:source', path),
  readAudio: (path) => ipcRenderer.invoke('repository:audio', path),
  openLesson: () => ipcRenderer.invoke('lesson:open'),
  listAgents: () => ipcRenderer.invoke('agents:list'),
  generationFiles: () => ipcRenderer.invoke('agents:files'),
  generateLesson: (request) => ipcRenderer.invoke('agents:generate', request),
  cancelLessonGeneration: () => ipcRenderer.invoke('agents:cancel'),
  onGenerationProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
      listener(progress);
    ipcRenderer.on('agents:progress', handler);
    return () => {
      ipcRenderer.removeListener('agents:progress', handler);
    };
  },
  speechStatus: () => ipcRenderer.invoke('speech:status'),
  prepareSpeech: () => ipcRenderer.invoke('speech:prepare'),
  generateSpeech: (request) => ipcRenderer.invoke('speech:generate', request),
  cancelSpeech: () => ipcRenderer.invoke('speech:cancel'),
  readSpeechAudio: (cacheKey) => ipcRenderer.invoke('speech:audio', cacheKey),
  onSpeechProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) =>
      listener(progress);
    ipcRenderer.on('speech:progress', handler);
    return () => {
      ipcRenderer.removeListener('speech:progress', handler);
    };
  },
};

contextBridge.exposeInMainWorld('codecast', bridge);
