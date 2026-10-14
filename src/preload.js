// Мостик между окном и главным процессом
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('volna', {
  async api(path, query, method) {
    const r = await ipcRenderer.invoke('sc:api', path, query, method);
    if (r.error) {
      const e = new Error(r.error);
      e.status = r.status;
      throw e;
    }
    return r.data;
  },
  authState: () => ipcRenderer.invoke('auth:state'),
  login: (mode) => ipcRenderer.invoke('auth:login', mode),
  logout: () => ipcRenderer.invoke('auth:logout'),
  cancelLogin: () => ipcRenderer.send('login:cancel'),
  loginToken: (text) => ipcRenderer.invoke('auth:token', text),
  openSignin: () => ipcRenderer.send('open:signin'),
  onLoginOpen: (fn) => ipcRenderer.on('login:open', (_e, open) => fn(open)),
  onAuthChanged: (fn) => ipcRenderer.on('auth:changed', (_e, s) => fn(s)),
  storeLoad: () => ipcRenderer.invoke('store:load'),
  storeSave: (data) => ipcRenderer.invoke('store:save', data),
  openExternal: (url) => ipcRenderer.send('open:external', url),
  win: (cmd) => ipcRenderer.send('win', cmd),
  proxy: () => ipcRenderer.invoke('net:proxy'),
  onProxy: (fn) => ipcRenderer.on('net:proxy', (_e, rule) => fn(rule)),
  onWinState: (fn) => ipcRenderer.on('win:state', (_e, max) => fn(max)),
});
