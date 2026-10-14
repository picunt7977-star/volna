// Volna — главный процесс: окно, вход через SoundCloud, прокси к api-v2
const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const netMod = require('net');

// Обычный Chrome UA: с «Electron/…» в UA гугл/эппл-вход и часть страниц SoundCloud капризничают
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
app.userAgentFallback = UA;
app.setName('Volna');

// отдельный профиль (для тестов): VOLNA_PROFILE=/путь volna
if (process.env.VOLNA_PROFILE) app.setPath('userData', process.env.VOLNA_PROFILE);

const API = 'https://api-v2.soundcloud.com';
const dataDir = app.getPath('userData');
const authPath = path.join(dataDir, 'auth.json');
const storePath = path.join(dataDir, 'store.json');

let mainWin = null;
let scSession = null; // отдельная сессия под сайт SoundCloud (логин, куки)

// --- маленькое хранилище авторизации --------------------------------------
function readJson(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p + '.tmp', JSON.stringify(data));
  fs.renameSync(p + '.tmp', p);
}
let auth = readJson(authPath, { clientId: null, token: null });
const saveAuth = () => writeJson(authPath, auth);

function emitAuth() {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('auth:changed', { loggedIn: !!auth.token });
}

// --- client_id: берём из запросов, которые делает сам soundcloud.com в нашей сессии ---
function hookSession(s) {
  s.webRequest.onBeforeSendHeaders({ urls: ['https://api-v2.soundcloud.com/*'] }, (d, cb) => {
    try {
      const cid = new URL(d.url).searchParams.get('client_id');
      if (cid && cid !== auth.clientId && d.webContentsId) { auth.clientId = cid; saveAuth(); }
    } catch {}
    // наши собственные запросы (не со страницы) — оформляем как запросы сайта,
    // иначе запись (лайки) SoundCloud может отклонять
    if (!d.webContentsId) {
      d.requestHeaders.Origin = 'https://soundcloud.com';
      d.requestHeaders.Referer = 'https://soundcloud.com/';
    }
    cb({ requestHeaders: d.requestHeaders });
  });
}

let cidPromise = null;
function ensureClientId(force = false) {
  if (force) auth.clientId = null;
  if (auth.clientId) return Promise.resolve();
  if (cidPromise) return cidPromise;
  cidPromise = new Promise((resolve, reject) => {
    // Невидимое окно открывает сайт — его же скрипты сходят в api-v2 с актуальным client_id
    const w = new BrowserWindow({ show: false, webPreferences: { session: scSession } });
    w.webContents.setAudioMuted(true);
    const poll = setInterval(() => auth.clientId && done(), 250);
    const timer = setTimeout(() => done(new Error('SoundCloud не ответил — проверь интернет/VPN')), 30000);
    function done(err) {
      clearInterval(poll); clearTimeout(timer);
      if (!w.isDestroyed()) w.destroy();
      cidPromise = null;
      err ? reject(err) : resolve();
    }
    w.loadURL('https://soundcloud.com/discover').catch(() => {});
  });
  return cidPromise;
}

// --- datadome: кука «не бот», без неё SoundCloud требует капчу на любую запись ----
// Её выдаёт скрипт защиты на самом сайте, поэтому открываем сайт в невидимом окне
// и ждём, пока кука появится (или обновится, если старую забраковали).
let ddPromise = null;
async function ddCookie() {
  const [c] = await scSession.cookies.get({ name: 'datadome' }).catch(() => []);
  return c ? c.value : null;
}
function ensureDatadome(force = false) {
  if (ddPromise) return ddPromise;
  ddPromise = (async () => {
    const before = await ddCookie();
    if (before && !force) return true;
    const w = new BrowserWindow({ show: false, webPreferences: { session: scSession } });
    w.webContents.setAudioMuted(true);
    w.loadURL('https://soundcloud.com/discover').catch(() => {});
    try {
      for (let i = 0; i < 60; i++) { // до 15 секунд
        await new Promise((r) => setTimeout(r, 250));
        const now = await ddCookie();
        if (now && now !== before) return true;
      }
      return !!(await ddCookie());
    } finally {
      // ещё секунду даём скрипту защиты дописать всё, что он хочет
      setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 1000);
    }
  })().finally(() => { ddPromise = null; });
  return ddPromise;
}

// --- запрос к api-v2 -------------------------------------------------------
// Ошибки API пишем в ~/.config/Volna/volna.log (без токена) — чтобы было что разбирать
function logLine(msg) {
  try { fs.appendFileSync(path.join(dataDir, 'volna.log'), `${new Date().toISOString()} ${msg}\n`); } catch {}
}

async function scApi(p, query = {}, method = 'GET', attempt = 0) {
  await ensureClientId();
  if (method !== 'GET') await ensureDatadome();
  const url = new URL(p.startsWith('http') ? p : API + p);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
  url.searchParams.set('client_id', auth.clientId);
  // Origin/Referer как у сайта подставляет hookSession — напрямую Electron их не пускает
  const headers = { Accept: 'application/json, text/javascript, */*; q=0.01' };
  if (auth.token) headers.Authorization = 'OAuth ' + auth.token;
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; }

  // credentials: 'include' — без этого Electron не шлёт куки сессии, в том числе datadome
  // («не бот»), и любую запись (лайк) SoundCloud заворачивает в капчу
  const res = await scSession.fetch(url.toString(), {
    method, headers, credentials: 'include',
    body: method === 'PUT' || method === 'POST' ? '{}' : undefined,
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 900);
    logLine(`${method} ${url.pathname} → ${res.status} ${body}`);
    // запись упёрлась в капчу DataDome — освежаем куку «не бот» и пробуем ещё раз
    if (res.status === 403 && method !== 'GET' && body.includes('captcha-delivery')) {
      if (attempt === 0) {
        await ensureDatadome(true);
        return scApi(p, query, method, 1);
      }
      if (attempt === 1) {
        // свежая кука не помогла (на VPN-адресах так бывает) — нужна живая капча
        let cap = null;
        try { cap = JSON.parse(body).url; } catch {}
        if (cap && (await solveCaptcha(cap))) return scApi(p, query, method, 2);
        const e = new Error('SoundCloud просит капчу — без неё лайк не пройдёт');
        e.status = 403;
        throw e;
      }
    }
    if ((res.status === 401 || res.status === 403) && method === 'GET' && attempt === 0) {
      // для чтения чаще всего протух client_id — обновляем и пробуем ещё раз
      await ensureClientId(true);
      return scApi(p, query, method, 1);
    }
    // разлогиниваем только если сам SoundCloud говорит, что токен невалиден
    if (res.status === 401 && url.pathname === '/me' && auth.token) {
      auth.token = null; saveAuth(); emitAuth();
    }
    const e = new Error(`SoundCloud ответил ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

// --- вход ------------------------------------------------------------------
// Сайт SoundCloud открывается прямо внутри окна Volna (WebContentsView поверх интерфейса),
// а не отдельным окном — в тайлинге Hyprland оно терялось сбоку.
let login = null; // { view, finish }
const LOGIN_TOP = 44 + 64; // титлбар + шапка «Вход в SoundCloud / Отмена» в renderer

function layoutLogin() {
  if (!login || !login.view || !mainWin) return;
  const [w, h] = mainWin.getContentSize();
  const pad = 16;
  login.view.setBounds({ x: pad, y: LOGIN_TOP, width: Math.max(100, w - pad * 2), height: Math.max(100, h - LOGIN_TOP - pad) });
}

// --- вход по готовому токену (скопирован из обычного браузера) -------------------
// Токен SoundCloud выглядит как 2-123456-123456789-AbCdEf…
const TOKEN_RE = /\b(2-\d{4,}-\d{3,}-[A-Za-z0-9]{8,})\b/;
let lastClip = '';

async function tryToken(text) {
  const m = String(text || '').match(TOKEN_RE);
  if (!m) return false;
  const prev = auth.token;
  auth.token = m[1];
  try {
    const me = await scApi('/me');
    if (!me || !me.id) throw new Error('no user');
    saveAuth();
    return true;
  } catch {
    auth.token = prev;
    return false;
  }
}

// Пока открыт экран входа — следим за буфером: скопировал токен → вошли
async function checkClipboard() {
  const txt = clipboard.readText();
  if (!txt || txt === lastClip) return false;
  lastClip = txt;
  return tryToken(txt);
}

// Вход через твой обычный браузер: он открывает soundcloud.com, ты копируешь свой
// oauth_token (F12 → Application → Cookies), а Volna ловит его из буфера обмена.
// Встроенный/управляемый браузер SoundCloud режет как бота, а Google туда не пускает.
function openBrowserLogin() {
  if (login) return Promise.resolve(false);
  return new Promise((resolve) => {
    let poll, done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      clearInterval(poll);
      login = null;
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('login:open', false);
        if (ok) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
      }
      emitAuth();
      resolve(ok);
    };
    login = { finish };
    mainWin.webContents.send('login:open', 'browser');
    shell.openExternal('https://soundcloud.com/signin');
    lastClip = clipboard.readText();
    poll = setInterval(async () => { if (await checkClipboard()) finish(true); }, 700);
  });
}

// Сайт SoundCloud поверх интерфейса (WebContentsView): вход или капча DataDome.
// check() опрашивается раз в 800 мс; вернула true — готово, вид закрывается.
function openEmbedded(url, mode, check) {
  if (login) return Promise.resolve(false);
  return new Promise((resolve) => {
    const view = new WebContentsView({ webPreferences: { session: scSession } });
    view.setBackgroundColor('#121212');
    view.setBorderRadius?.(14);
    // всплывашки Google/Apple — отдельными окнами, но в той же сессии, чтобы кука долетела
    view.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, webPreferences: { session: scSession } },
    }));
    view.webContents.loadURL(url).catch(() => {});
    mainWin.contentView.addChildView(view);

    let poll;
    const finish = (ok) => {
      if (!login) return;
      clearInterval(poll);
      mainWin.contentView.removeChildView(view);
      view.webContents.close();
      login = null;
      mainWin.webContents.send('login:open', false);
      emitAuth();
      resolve(ok);
    };
    login = { view, finish };
    layoutLogin();
    mainWin.webContents.send('login:open', mode);
    poll = setInterval(async () => { if (await check().catch(() => false)) finish(true); }, 800);
  });
}

function openLogin(mode = 'browser') {
  if (mode === 'browser') {
    const p = openBrowserLogin();
    if (p) return p;
  }
  return openEmbedded('https://soundcloud.com/signin', 'embedded', async () => {
    const [c] = await scSession.cookies.get({ name: 'oauth_token' });
    if (!c || !c.value) return false;
    auth.token = c.value; saveAuth();
    return true;
  });
}

// Капча DataDome: показываем её как есть, человек решает — кука datadome меняется
async function solveCaptcha(url) {
  const before = await ddCookie();
  return openEmbedded(url, 'captcha', async () => {
    const now = await ddCookie();
    return !!now && now !== before;
  });
}

async function logout() {
  auth.token = null; saveAuth();
  await scSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers'] }).catch(() => {});
  emitAuth();
}

// --- прокси: через VPN ходит только Volna ---------------------------------------
// Ищем локальный прокси VPN-клиента: Throne/Nekoray (2080), Clash (7890), 1080, v2rayN (10808).
// Нашли — весь трафик Volna идёт через него, а системный TUN можно выключить.
// VOLNA_PROXY=direct или VOLNA_PROXY=socks5://host:port — задать вручную.
const PROXY_PORTS = [2080, 7890, 1080, 10808];
let proxyRule = null;

function portOpen(port) {
  return new Promise((resolve) => {
    const s = netMod.connect({ host: '127.0.0.1', port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(400);
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.once('timeout', () => done(false));
  });
}

async function applyProxy() {
  let rule = process.env.VOLNA_PROXY || 'direct';
  if (!process.env.VOLNA_PROXY) {
    for (const p of PROXY_PORTS) if (await portOpen(p)) { rule = `socks5://127.0.0.1:${p}`; break; }
  }
  if (rule === proxyRule) return;
  proxyRule = rule;
  // socks5 у Chromium резолвит имена на стороне прокси — DNS провайдера не участвует
  const cfg = rule === 'direct' ? { mode: 'direct' } : { proxyRules: rule, proxyBypassRules: '<local>' };
  for (const s of [session.defaultSession, scSession]) {
    await s.setProxy(cfg);
    await s.closeAllConnections?.();
  }
  logLine(`proxy → ${rule}`);
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('net:proxy', rule);
}

// --- окно --------------------------------------------------------------------
function createWindow() {
  mainWin = new BrowserWindow({
    width: 1320, height: 840, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#09090d', title: 'Volna',
    show: !process.env.VOLNA_HIDDEN, // VOLNA_HIDDEN=1 — окно не показывается (для тестов)
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: !process.env.VOLNA_HIDDEN,
      offscreen: !!process.env.VOLNA_HIDDEN,
    },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // ссылки наружу — в обычный браузер
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWin.on('maximize', () => mainWin.webContents.send('win:state', true));
  mainWin.on('unmaximize', () => mainWin.webContents.send('win:state', false));
  mainWin.on('resize', layoutLogin);
}

// второй запуск — просто показываем уже открытое окно
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });

app.whenReady().then(() => {
  scSession = session.fromPartition('persist:soundcloud');
  scSession.setUserAgent(UA);
  hookSession(scSession);

  // Окно плеера грузит локальные файлы, а аудио/картинки/волноформы — с CDN SoundCloud.
  // Добавляем CORS-заголовок, чтобы работали hls.js, анализатор звука и цвет из обложки.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (d, cb) => {
    const h = d.responseHeaders || {};
    for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('access-control-allow-')) delete h[k];
    h['Access-Control-Allow-Origin'] = ['*'];
    h['Access-Control-Allow-Headers'] = ['*'];
    cb({ responseHeaders: h });
  });

  ipcMain.handle('sc:api', async (_e, p, q, m) => {
    try { return { data: await scApi(p, q, m) }; } catch (err) { return { error: err.message, status: err.status || 0 }; }
  });
  ipcMain.handle('auth:state', () => ({ loggedIn: !!auth.token }));
  ipcMain.handle('auth:login', (_e, mode) => openLogin(mode));
  ipcMain.handle('auth:token', async (_e, text) => {
    const ok = await tryToken(text);
    if (ok) { if (login) login.finish(true); else emitAuth(); }
    return ok;
  });
  ipcMain.on('open:signin', () => shell.openExternal('https://soundcloud.com/signin'));
  ipcMain.on('login:cancel', () => login && login.finish(!!auth.token));
  ipcMain.handle('auth:logout', () => logout());
  ipcMain.handle('store:load', () => readJson(storePath, {}));
  ipcMain.handle('store:save', (_e, data) => { writeJson(storePath, data); });
  ipcMain.on('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.on('win', (_e, cmd) => {
    if (!mainWin) return;
    if (cmd === 'min') mainWin.minimize();
    else if (cmd === 'max') mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize();
    else if (cmd === 'close') mainWin.close();
  });

  ipcMain.handle('net:proxy', () => proxyRule);

  // прокси выставляем до первого запроса; Throne могут включить/выключить — проверяем каждые 15 с
  applyProxy().catch(() => {}).finally(() => createWindow());
  setInterval(() => applyProxy().catch(() => {}), 15000);
});

app.on('window-all-closed', () => app.quit());
