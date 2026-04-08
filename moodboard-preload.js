// Preload du webview Moodboard.
// Expose la même API que le preload original de Gesturo Moodboard
// (window.electronAPI), mais via des channels IPC préfixés "mb:"
// pour éviter les collisions avec les handlers de l'app parent.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  pickImages: () => ipcRenderer.invoke('mb:pick-images'),
  readFileAsDataUrl: (path) => ipcRenderer.invoke('mb:read-file-as-dataurl', path),
  openExternal: (url) => ipcRenderer.invoke('mb:open-external', url),
  listProjects: () => ipcRenderer.invoke('mb:list-projects'),
  createProject: (name) => ipcRenderer.invoke('mb:create-project', name),
  loadProject: (file) => ipcRenderer.invoke('mb:load-project', file),
  saveProject: (file, data) => ipcRenderer.invoke('mb:save-project', file, data),
  deleteProject: (file) => ipcRenderer.invoke('mb:delete-project', file),
  renameProject: (file, name) => ipcRenderer.invoke('mb:rename-project', file, name),
  duplicateProject: (file) => ipcRenderer.invoke('mb:duplicate-project', file),
  savePng: (name, dataUrl) => ipcRenderer.invoke('mb:save-png', name, dataUrl),
  savePdf: (name, jpegDataUrl, w, h) => ipcRenderer.invoke('mb:save-pdf', name, jpegDataUrl, w, h),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('mb:set-always-on-top', flag),
  setWindowOpacity: (opacity) => ipcRenderer.invoke('mb:set-window-opacity', opacity),
})
