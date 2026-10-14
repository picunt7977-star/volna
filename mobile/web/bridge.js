// Volna на телефоне: то же window.volna, что на ПК дают preload.js + главный процесс Electron.
// Запросы к api-v2, вход и капча — через нативный плагин Volna (VolnaPlugin.java),
// хранилище — Preferences, плеер в шторке — MediaSession.
(() => {
  const { registerPlugin } = window.Capacitor;
  const Native = registerPlugin('Volna');
  const Prefs = registerPlugin('Preferences');
  const MS = registerPlugin('MediaSession');

  const API = 'https://api-v2.soundcloud.com';
  // Токен SoundCloud выглядит как 2-123456-123456789-AbCdEf…
  const TOKEN_RE = /\b(2-\d{4,}-\d{3,}-[A-Za-z0-9]{8,})\b/;

  const on = { auth: [], login: [] };
  let auth = { clientId: null, token: null };
  const authReady = Prefs.get({ key: 'auth' })
    .then((r) => { try { Object.assign(auth, JSON.parse(r.value || '{}')); } catch {} })
    .catch(() => {});
  const saveAuth = () => Prefs.set({ key: 'auth', value: JSON.stringify(auth) });
  const emitAuth = () => on.auth.forEach((fn) => fn({ loggedIn: !!auth.token }));

  // --- client_id: невидимый soundcloud.com, ловим из запросов самого сайта ---------
  let cidPromise = null;
  async function ensureClientId(force = false) {
    await authReady;
    if (force) auth.clientId = null;
    if (auth.clientId) return;
    cidPromise ||= Native.visitSite({ want: 'clientId' })
      .then((r) => { auth.clientId = r.clientId; saveAuth(); })
      .finally(() => { cidPromise = null; });
    return cidPromise;
  }

  // --- datadome: кука «не бот», без неё любая запись (лайк) упирается в капчу ---------
  let ddPromise = null;
  async function ensureDatadome(force = false) {
    if (!force) {
      const { value } = await Native.getCookie({ name: 'datadome' }).catch(() => ({}));
      if (value) return;
    }
    ddPromise ||= Native.visitSite({ want: 'datadome', force }).finally(() => { ddPromise = null; });
    return ddPromise;
  }

  async function scApi(p, query = {}, method = 'GET', attempt = 0) {
    await ensureClientId();
    if (method !== 'GET') await ensureDatadome();
    const url = new URL(p.startsWith('http') ? p : API + p);
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
    url.searchParams.set('client_id', auth.clientId);
    const headers = { Accept: 'application/json, text/javascript, */*; q=0.01' };
    if (auth.token) headers.Authorization = 'OAuth ' + auth.token;
    if (method !== 'GET') headers['Content-Type'] = 'application/json';

    const res = await Native.request({
      url: url.toString(), method, headers,
      body: method === 'PUT' || method === 'POST' ? '{}' : undefined,
    });
    if (res.status >= 400) {
      const body = String(res.data || '').replace(/\s+/g, ' ').slice(0, 900);
      // запись упёрлась в капчу DataDome — освежаем куку «не бот» и пробуем ещё раз
      if (res.status === 403 && method !== 'GET' && body.includes('captcha-delivery')) {
        if (attempt === 0) {
          await ensureDatadome(true);
          return scApi(p, query, method, 1);
        }
        if (attempt === 1) {
          let cap = null;
          try { cap = JSON.parse(body).url; } catch {}
          if (cap) {
            const r = await Native.openSite({ url: cap, waitFor: 'datadome', title: 'Пройди капчу' });
            if (r.ok) return scApi(p, query, method, 2);
          }
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
      // разлогиниваем, только если сам SoundCloud говорит, что токен невалиден
      if (res.status === 401 && url.pathname === '/me' && auth.token) {
        auth.token = null; saveAuth(); emitAuth();
      }
      const e = new Error(`SoundCloud ответил ${res.status}`);
      e.status = res.status;
      throw e;
    }
    try { return res.data ? JSON.parse(res.data) : null; } catch { return null; }
  }

  async function tryToken(text) {
    const m = String(text || '').match(TOKEN_RE);
    if (!m) return false;
    const prev = auth.token;
    auth.token = m[1];
    try {
      const me = await scApi('/me');
      if (!me || !me.id) throw new Error('no user');
      await saveAuth();
      emitAuth();
      return true;
    } catch (e) {
      auth.token = prev;
      // «не подошёл» — только если SoundCloud сам отверг токен; сеть/VPN — другая ошибка
      if (e.status === 401 || e.message === 'no user') return false;
      throw new Error(e.message || String(e));
    }
  }

  // Вход: сайт SoundCloud во весь экран, токен забираем из его куки
  async function login() {
    const r = await Native.openSite({ url: 'https://soundcloud.com/signin', waitFor: 'token', title: 'Вход в SoundCloud' });
    if (!r.ok || !r.token) return false;
    auth.token = r.token;
    if (r.clientId) auth.clientId = r.clientId;
    await saveAuth();
    emitAuth();
    return true;
  }

  window.volna = {
    mobile: true,
    async api(path, query, method) {
      try { return await scApi(path, query, method); } catch (e) {
        const err = new Error(e.message || String(e));
        err.status = e.status || 0;
        throw err;
      }
    },
    authState: async () => { await authReady; return { loggedIn: !!auth.token }; },
    login,
    logout: async () => { auth.token = null; await saveAuth(); await Native.logout().catch(() => {}); emitAuth(); },
    cancelLogin: () => {},
    loginToken: tryToken,
    openSignin: login,
    onLoginOpen: (fn) => on.login.push(fn),
    onAuthChanged: (fn) => on.auth.push(fn),
    storeLoad: async () => {
      const r = await Prefs.get({ key: 'store' }).catch(() => ({}));
      try { return JSON.parse(r.value || '{}'); } catch { return {}; }
    },
    storeSave: (data) => Prefs.set({ key: 'store', value: JSON.stringify(data) }),
    openExternal: (url) => Native.openExternal({ url }),
    minimize: () => Native.minimize(),
    win: () => {},
    proxy: async () => null, // на телефоне трафик идёт через системный VPN
    onProxy: () => {},
    onWinState: () => {},
  };

  // --- navigator.mediaSession → плеер в шторке и на экране блокировки ---------------
  const handlers = {};
  let meta = null, state = 'none', lastPos = { at: 0, pos: 0 };
  const session = {
    setActionHandler(action, fn) {
      const first = !(action in handlers);
      handlers[action] = fn;
      if (first) MS.setActionHandler({ action }, (d) => handlers[action] && handlers[action](d || {})).catch(() => {});
    },
    get metadata() { return meta; },
    set metadata(m) {
      meta = m;
      if (!m) return;
      MS.setMetadata({
        title: m.title || '', artist: m.artist || '', album: m.album || '',
        artwork: [...(m.artwork || [])].map((a) => ({ src: a.src, sizes: a.sizes, type: a.type })),
      }).catch(() => {});
    },
    get playbackState() { return state; },
    set playbackState(s) {
      state = s;
      MS.setPlaybackState({ playbackState: s }).catch(() => {});
    },
    // timeupdate идёт 4 раза в секунду — в шторку хватит раза в пару секунд и при перемотке
    setPositionState(p) {
      const now = Date.now();
      const expected = lastPos.pos + (now - lastPos.at) / 1000;
      if (now - lastPos.at < 2500 && Math.abs(p.position - expected) < 2) return;
      lastPos = { at: now, pos: p.position };
      MS.setPositionState(p).catch(() => {});
    },
  };
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  if (!window.MediaMetadata) window.MediaMetadata = class { constructor(o) { Object.assign(this, o); } };
})();
