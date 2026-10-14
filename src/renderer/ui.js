// Интерфейс: навигация, экраны, плеер-бар, анимация волны
const UI = {
  view: null,
  params: {},
  accent: [255, 106, 31],

  async init() {
    await Store.load();
    this.applyAccentSetting(true);
    // режим и настроение волны — как в прошлый раз
    if (Wave.modes[Store.data.waveMode]) Wave.mode = Store.data.waveMode;
    if (Wave.moods[Store.data.waveMood]) Wave.mood = Store.data.waveMood;
    Player.init();
    this.initChrome();
    this.initPlayerBar();
    this.initKeys();
    this.loop();

    document.addEventListener('likes-changed', (e) => {
      this.syncLikes();
      Wave.seedsAt = 0; // волна сразу учтёт новый лайк
      if (e.detail && e.detail.imported && this.view === 'likes') this.go('likes', this.params);
    });
    document.addEventListener('wave-changed', () => this.onWaveChanged());
    document.addEventListener('wave-busy', () => this.onWaveChanged(true));
    window.volna.onAuthChanged(() => this.refreshAccount());
    window.volna.onLoginOpen((open) => this.loginOverlay(open));

    this.go('wave');
    await this.refreshAccount();
  },

  // --- аккаунт -------------------------------------------------------------
  async refreshAccount() {
    const st = await window.volna.authState();
    if (st.loggedIn) await SC.loadMe(); else SC.me = null;
    await SC.loadLikedIds();
    Wave.seedsAt = 0;
    this.renderAccount();
    this.renderNav();
    if (this.view && this.view !== 'search') this.go(this.view, this.params);
  },

  renderAccount() {
    const box = $('#account');
    box.replaceChildren();
    if (SC.me) {
      box.append(
        h('div', { class: 'acc' },
          h('img', { class: 'acc-ava', src: SC.art(SC.me, 't120x120') }),
          h('div', { class: 'acc-meta' },
            h('div', { class: 'acc-name' }, SC.me.username),
            h('div', { class: 'acc-sub' }, `${fmtNum(SC.me.followers_count) || 0} подписчиков`)),
          h('button', {
            class: 'icon-btn', title: 'Выйти', html: I.logout,
            onclick: async () => { await window.volna.logout(); toast('Вышел из аккаунта'); },
          })));
    } else {
      box.append(h('button', {
        class: 'login-btn', onclick: async () => {
          const ok = await window.volna.login();
          if (ok) toast('Готово, ты в SoundCloud', 'ok');
        },
      }, h('span', { html: I.sc }), 'Войти через SoundCloud'));
    }
  },

  // Шапка над встроенной страницей входа (саму страницу рисует главный процесс)
  loginOverlay(open) {
    $('#login-overlay')?.remove();
    if (!open) return;
    if (open === 'browser') {
      document.body.append(h('div', { id: 'login-overlay', class: 'center' },
        h('div', { class: 'login-card' },
          h('div', { class: 'login-pulse', html: I.sc }),
          h('h2', {}, 'Вход через браузер'),
          h('ol', { class: 'login-steps' },
            h('li', {}, 'В открывшемся браузере войди в SoundCloud (можно через Google).'),
            h('li', {}, 'Нажми F12 → вкладка Application (Приложение) → Cookies → https://soundcloud.com.'),
            h('li', {}, 'Найди строку oauth_token, дважды кликни по значению и скопируй (Ctrl+C).')),
          h('p', {}, 'Volna сама поймает токен из буфера обмена. Или вставь его сюда:'),
          h('input', {
            class: 'token-input', placeholder: '2-123456-…', onkeydown: async (e) => {
              if (e.key !== 'Enter') return;
              const ok = await window.volna.loginToken(e.target.value);
              if (!ok) toast('Токен не подошёл', 'err');
            },
          }),
          h('div', { class: 'head-actions' },
            h('button', { class: 'btn', onclick: () => window.volna.openSignin() }, 'Открыть браузер снова'),
            h('button', { class: 'btn', onclick: () => window.volna.cancelLogin() }, 'Отмена'),
            h('button', {
              class: 'btn ghost', onclick: async () => {
                window.volna.cancelLogin();
                setTimeout(() => window.volna.login('embedded'), 400);
              },
            }, 'Войти внутри приложения')))));
      return;
    }
    document.body.append(h('div', { id: 'login-overlay' },
      h('div', { class: 'login-head' },
        h('span', { class: 'sc', html: I.sc }),
        open === 'captcha'
          ? h('h3', {}, 'SoundCloud просит капчу', h('span', { class: 'muted' }, 'пройди её — и лайк отправится сам'))
          : h('h3', {}, 'Вход в SoundCloud', h('span', { class: 'muted' }, 'войди как обычно — окно закроется само')),
        h('button', { class: 'btn', onclick: () => window.volna.cancelLogin() }, 'Отмена'))));
  },

  // --- каркас --------------------------------------------------------------
  initChrome() {
    for (const b of $$('.win-btns button')) {
      b.innerHTML = I[b.dataset.win === 'close' ? 'x' : b.dataset.win];
      b.onclick = () => window.volna.win(b.dataset.win);
    }
    $('.brand-logo').innerHTML = I.wave;
    $('#queue-close').innerHTML = I.x;
    $('#queue-close').onclick = () => this.toggleQueue(false);
    // через что Volna ходит в сеть
    $('#account').before(h('div', { id: 'net-state' }));
    window.volna.proxy().then((r) => this.onProxy(r));
    window.volna.onProxy((r) => {
      this.onProxy(r);
      toast(r === 'direct' ? 'Прокси пропал — Volna идёт напрямую' : 'Volna идёт через прокси ' + r.replace(/^\w+:\/\//, ''));
    });
  },

  onProxy(rule) {
    const el = $('#net-state');
    if (!el || !rule) return;
    const direct = rule === 'direct';
    el.className = direct ? 'direct' : 'proxy';
    el.title = direct
      ? 'Локальный прокси VPN не найден. Если SoundCloud не грузится — запусти Throne (TUN можно не включать).'
      : 'Весь трафик Volna идёт через локальный прокси VPN-клиента, остальной компьютер — как настроено в системе';
    el.replaceChildren(h('i'), direct ? 'Напрямую' : 'Через прокси ' + rule.replace(/^\w+:\/\/127\.0\.0\.1/, ''));
  },

  navItems() {
    return [
      ['wave', 'Моя волна', I.wave],
      ['feed', 'Лента', I.feed, true],
      ['search', 'Поиск', I.search],
      ['likes', 'Лайки', I.heart],
      ['library', 'Плейлисты', I.library, true],
      ['history', 'История', I.clock],
      ['settings', 'Тема', I.palette],
    ];
  },

  renderNav() {
    const nav = $('#nav');
    nav.replaceChildren(...this.navItems().map(([id, name, ico, needLogin]) =>
      h('button', {
        class: 'nav-item' + (this.view === id ? ' active' : '') + (needLogin && !SC.me ? ' dim' : ''),
        'data-view': id, onclick: () => this.go(id),
      }, h('span', { class: 'nav-ico', html: ico }), name)));
  },

  go(view, params = {}) {
    this.view = view;
    this.params = params;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('#p-lyrics').classList.toggle('on', view === 'lyrics');
    const root = $('#view');
    root.replaceChildren();
    root.scrollTop = 0;
    root.dataset.view = view;
    const fn = this['view_' + view];
    if (fn) fn.call(this, root, params);
  },

  needLogin(root, what) {
    root.append(h('div', { class: 'empty' },
      h('div', { class: 'empty-ico', html: I.sc }),
      h('h2', {}, what),
      h('p', {}, 'Для этого нужен вход в твой аккаунт SoundCloud.'),
      h('button', { class: 'btn primary', onclick: () => window.volna.login() }, 'Войти через SoundCloud')));
  },

  // --- Моя волна -----------------------------------------------------------
  view_wave(root) {
    const playing = Wave.active;
    const cur = Player.cur;
    const hero = h('section', { class: 'hero' },
      h('canvas', { id: 'hero-canvas' }),
      h('div', { class: 'hero-inner' },
        h('div', { class: 'hero-kicker' }, Wave.label || 'Персональный поток'),
        h('h1', { class: 'hero-title' }, 'Моя волна'),
        h('button', {
          class: 'hero-play' + (playing && !Player.audio.paused ? ' on' : ''), id: 'hero-play',
          html: playing && !Player.audio.paused ? I.pause : I.play,
          onclick: () => (Wave.active ? Player.toggle() : Wave.start()),
        }),
        h('div', { class: 'hero-now', id: 'hero-now' },
          playing && cur ? `${cur.user ? cur.user.username : ''} — ${cur.title}` : (SC.me ? 'Нажми, и поехали' : 'Работает и без входа, но с лайками — намного точнее')),
        h('button', { class: 'wave-pick', id: 'wave-pick', title: 'Выбрать, что включить', onclick: () => this.openWavePicker() },
          h('span', { class: 'wp-dot' }), h('span', { class: 'wp-name' }, this.waveChoice().name),
          h('span', { class: 'wp-chev', html: I.chevronDown }))));
    root.append(hero);
    this.syncWavePick();

    const up = h('section', { class: 'section' }, h('h2', {}, 'Дальше в волне'), h('div', { class: 'cards', id: 'wave-upcoming' }));
    root.append(up);
    this.renderUpcoming();

    const hist = Store.data.history.slice(0, 12);
    if (hist.length) {
      root.append(h('section', { class: 'section' },
        h('h2', {}, 'Недавно слушал'),
        this.trackList(hist)));
    }
    this.heroCanvas = $('#hero-canvas');
  },

  renderUpcoming() {
    const box = $('#wave-upcoming');
    if (!box) return;
    box.replaceChildren();
    if (!Wave.active) {
      box.append(h('div', { class: 'muted' }, 'Включи волну — здесь появятся следующие треки.'));
      return;
    }
    if (!Wave.upcoming.length) box.append(h('div', { class: 'muted' }, 'Подбираю…'));
    Wave.upcoming.slice(0, 6).forEach((t, i) => box.append(this.card(t, () => {
      Wave.upcoming.splice(i, 1);
      Player.queue.splice(Player.index + 1, 0, t);
      Player.next(true);
    })));
  },

  onWaveChanged(busy) {
    this.renderUpcoming();
    const badge = $('#p-wave-badge');
    badge.classList.toggle('hidden', !Wave.active);
    badge.textContent = Wave.active ? (busy ? 'настраиваю волну…' : 'Моя волна · ' + Wave.modes[Wave.mode].name) : '';
    $('#p-dislike').classList.toggle('hidden', !Wave.active);
    if (this.view === 'wave') {

      const k = $('.hero-kicker');
      if (k) k.textContent = Wave.label || 'Персональный поток';
      this.syncWavePick();
    }
    this.renderQueue();
  },

  // --- «Что включим?»: режим или настроение волны ---------------------------
  // Один список: режимы подбора и настроения. Настроение включается поверх «Как обычно».
  waveChoices() {
    const modeLook = {
      mix: ['#ff8a2a', '#ff2e5c', I.wave], fav: ['#ff5c8a', '#a3123f', I.heart],
      discover: ['#2fb8ff', '#1d3fbf', I.sparkle], fresh: ['#ffd02f', '#e8590c', I.clock],
    };
    return [
      ...Object.entries(Wave.modes).map(([id, m]) => ({
        id, group: 'Подбор', name: m.name, hint: m.hint, c: modeLook[id], icon: modeLook[id][2],
        active: !Wave.mood && Wave.mode === id, run: () => Wave.start(id, { mood: null }),
      })),
      ...Object.entries(Wave.moods).map(([id, m]) => ({
        id, group: 'Настроение', name: m.name, hint: m.hint, c: m.c,
        active: Wave.mood === id, run: () => Wave.start('mix', { mood: id }),
      })),
    ];
  },

  waveChoice() {
    const all = this.waveChoices();
    return all.find((c) => c.active) || all[0];
  },

  syncWavePick() {
    const b = $('#wave-pick');
    if (!b) return;
    const c = this.waveChoice();
    $('.wp-name', b).textContent = c.name;
    $('.wp-dot', b).innerHTML = COVERS[c.id] || '';
  },

  openWavePicker() {
    this.closeWavePicker();
    const close = () => this.closeWavePicker();
    const list = h('div', { class: 'pk-list' });
    let group = null;
    for (const c of this.waveChoices()) {
      if (c.group !== group) { group = c.group; list.append(h('div', { class: 'pk-group' }, group)); }
      list.append(h('button', {
        class: 'pk-item' + (c.active ? ' active' : ''),
        onclick: () => { close(); Wave.label = null; c.run(); },
      },
        h('span', { class: 'pk-ico', html: COVERS[c.id] || '' }),
        h('span', { class: 'pk-text' }, h('b', {}, c.name), h('small', {}, c.hint)),
        h('span', { class: 'pk-check', html: I.check })));
    }
    document.body.append(h('div', { id: 'picker', onclick: (e) => { if (e.target.id === 'picker') close(); } },
      h('div', { class: 'pk-sheet' },
        h('div', { class: 'pk-grip' }),
        h('div', { class: 'pk-head' },
          h('div', {}, h('h3', {}, 'Что включим?'), h('p', {}, 'Волна подберёт треки под выбор')),
          h('button', { class: 'icon-btn', html: I.x, onclick: close })),
        list)));
  },

  closeWavePicker() {
    const p = $('#picker');
    if (!p) return false;
    p.remove();
    return true;
  },

  // --- Лента ---------------------------------------------------------------
  async view_feed(root) {
    if (!SC.me) return this.needLogin(root, 'Лента подписок');
    root.append(this.pageHead('Лента', 'Новое от тех, на кого ты подписан'));
    const box = h('div', {});
    root.append(box);
    this.pager(box, '/stream', { limit: 40 }, (items) => items
      .map((x) => x.track && Object.assign(x.track, { _repost: x.type === 'track-repost' ? x.user : null }))
      .filter(Boolean));
  },

  // --- Поиск ---------------------------------------------------------------
  view_search(root, p) {
    const input = h('input', { class: 'search-input', placeholder: 'Треки, артисты, плейлисты…', value: p.q || '' });
    const res = h('div', { class: 'search-res' });
    root.append(h('div', { class: 'search-bar' }, h('span', { html: I.search }), input), res);
    const run = debounce(async () => {
      const q = input.value.trim();
      this.params.q = q;
      res.replaceChildren();
      if (!q) return;
      res.append(h('div', { class: 'muted' }, 'Ищу…'));
      try {
        const [users, tracks, lists] = await Promise.all([
          SC.api('/search/users', { q, limit: 8 }).catch(() => ({ collection: [] })),
          SC.api('/search/tracks', { q, limit: 40 }),
          SC.api('/search/playlists', { q, limit: 8 }).catch(() => ({ collection: [] })),
        ]);
        if (input.value.trim() !== q) return;
        res.replaceChildren();
        if (users.collection.length) {
          res.append(h('h2', {}, 'Артисты'), h('div', { class: 'artists' }, users.collection.map((u) =>
            h('button', { class: 'artist', onclick: () => this.go('artist', { id: u.id }) },
              h('img', { src: SC.art(u, 't300x300'), loading: 'lazy' }),
              h('div', { class: 'artist-name' }, u.username),
              h('div', { class: 'muted small' }, fmtNum(u.followers_count) + ' подп.')))));
        }
        res.append(h('h2', {}, 'Треки'), this.trackList(tracks.collection));
        if (lists.collection.length) {
          res.append(h('h2', {}, 'Плейлисты'), h('div', { class: 'cards' }, lists.collection.map((pl) =>
            this.card(pl, () => this.go('playlist', { pl })))));
        }
      } catch (e) {
        res.replaceChildren(h('div', { class: 'muted' }, 'Ошибка поиска: ' + e.message));
      }
    }, 350);
    input.addEventListener('input', run);
    setTimeout(() => input.focus(), 30);
    if (p.q) run();
  },

  // --- Лайки ---------------------------------------------------------------
  view_likes(root) {
    const list = Store.data.likes;
    const head = this.pageHead('Лайки', list.length
      ? `${list.length} ${plural(list.length, 'трек', 'трека', 'треков')} · хранятся на этом устройстве`
      : 'Лайкни трек — он появится здесь');
    root.append(head);
    head.append(h('div', { class: 'head-actions' },
      list.length ? h('button', { class: 'btn primary', onclick: () => Player.playList(list, 0) }, h('span', { html: I.play }), 'Слушать') : null,
      list.length ? h('button', {
        class: 'btn', onclick: () => { Wave.label = 'Волна по твоим лайкам'; Wave.start('fav', { mood: null }); },
      }, h('span', { html: I.wave }), 'Волна по лайкам') : null,
      h('button', {
        class: 'btn', title: 'Добавить сюда лайки из твоего аккаунта SoundCloud',
        onclick: async () => {
          // без входа — входим; после входа лайки подгрузятся сами
          if (!SC.me) return window.volna.login();
          if (await SC.importLikes() && this.view === 'likes') this.go('likes', this.params);
        },
      }, h('span', { html: I.sc }), SC.me ? 'Подгрузить из SoundCloud' : 'Войти и подгрузить из SoundCloud')));
    // длинный список — порциями, чтобы экран открывался сразу
    const box = h('div', {});
    root.append(box);
    let shown = 0;
    const more = (n = 200) => {
      const part = list.slice(shown, shown + n);
      box.append(...part.map((t, k) => this.trackRow(t, shown + k, list)));
      shown += part.length;
      btn.classList.toggle('hidden', shown >= list.length);
    };
    const btn = h('button', { class: 'btn more-btn', onclick: more }, 'Показать ещё');
    box.classList.add('tracks');
    root.append(btn);
    // сразу — первый экран, остальное дорисуем, когда отыграет анимация перехода
    more(40);
    // остальное — по 12 строк за кадр, чтобы ни один кадр не затянулся
    setTimeout(function drip() {
      if (!box.isConnected || shown >= Math.min(200, list.length)) return;
      more(12);
      requestAnimationFrame(drip);
    }, 450);
  },

  // --- Плейлисты -----------------------------------------------------------
  async view_library(root) {
    if (!SC.me) return this.needLogin(root, 'Твои плейлисты');
    root.append(this.pageHead('Плейлисты', 'Свои, лайкнутые и подборки SoundCloud'));
    const grid = h('div', { class: 'cards wrap' }, h('div', { class: 'muted' }, 'Загружаю…'));
    root.append(grid);
    let lists = [];
    try {
      const items = await SC.paged('/me/library/all', { limit: 50 }, 200);
      lists = items.map((x) => x.playlist || x.system_playlist).filter(Boolean);
    } catch {}
    if (!lists.length) {
      try { lists = await SC.paged(`/users/${SC.me.id}/playlists`, { limit: 50 }, 200); } catch {}
    }
    if (this.view !== 'library') return;
    grid.replaceChildren();
    if (!lists.length) grid.append(h('div', { class: 'muted' }, 'Пусто.'));
    for (const pl of lists) grid.append(this.card(pl, () => this.go('playlist', { pl })));
  },

  async view_playlist(root, { pl }) {
    const head = h('div', { class: 'pl-head' },
      h('img', { class: 'pl-art', src: SC.art(pl) }),
      h('div', { class: 'pl-meta' },
        h('div', { class: 'hero-kicker' }, pl.is_album ? 'Альбом' : 'Плейлист'),
        h('h1', {}, pl.title || pl.short_title || 'Без названия'),
        h('div', { class: 'muted' }, (pl.user ? pl.user.username + ' · ' : '') + (pl.track_count ? `${pl.track_count} ${plural(pl.track_count, 'трек', 'трека', 'треков')}` : ''))));
    root.append(head);
    const box = h('div', {}, h('div', { class: 'muted' }, 'Загружаю…'));
    root.append(box);
    let full = pl;
    try {
      const urn = pl.urn || '';
      full = urn.includes('system-playlists')
        ? await SC.api(`/system-playlists/${urn}`)
        : await SC.api(`/playlists/${pl.id}`);
    } catch {}
    const tracks = await SC.hydrate(full.tracks || []);
    box.replaceChildren(this.trackList(tracks));
    $('.pl-meta', head).append(h('div', { class: 'head-actions' },
      h('button', { class: 'btn primary', onclick: () => Player.playList(tracks, 0) }, h('span', { html: I.play }), 'Слушать'),
      h('button', {
        class: 'btn', onclick: () => {
          Wave.label = 'Волна по «' + (pl.title || 'плейлисту') + '»';
          Wave.start(Wave.mode, { seeds: shuffled(tracks).slice(0, 15), label: Wave.label });
        },
      }, h('span', { html: I.wave }), 'Волна по плейлисту')));
  },

  // --- Артист --------------------------------------------------------------
  async view_artist(root, { id }) {
    let u;
    try { u = await SC.api(`/users/${id}`); } catch (e) { root.append(h('div', { class: 'muted' }, e.message)); return; }
    const head = h('div', { class: 'pl-head' },
      h('img', { class: 'pl-art round', src: SC.art(u, 't500x500') }),
      h('div', { class: 'pl-meta' },
        h('div', { class: 'hero-kicker' }, 'Артист'),
        h('h1', {}, u.username),
        h('div', { class: 'muted' }, `${fmtNum(u.followers_count) || 0} подписчиков · ${u.track_count || 0} треков`)));
    root.append(head);
    const top = h('div', {}, h('div', { class: 'muted' }, 'Загружаю…'));
    root.append(h('section', { class: 'section' }, h('h2', {}, 'Популярное'), top));
    let topTracks = [];
    try { topTracks = (await SC.api(`/users/${id}/toptracks`, { limit: 10 })).collection; } catch {}
    top.replaceChildren(this.trackList(topTracks));
    $('.pl-meta', head).append(h('div', { class: 'head-actions' },
      h('button', { class: 'btn primary', onclick: () => {
        Wave.start(Wave.mode, { seeds: topTracks, label: 'Волна по ' + u.username });
      } }, h('span', { html: I.wave }), 'Волна по артисту'),
      h('button', { class: 'btn', onclick: () => window.volna.openExternal(u.permalink_url) }, h('span', { html: I.ext }), 'На SoundCloud')));
    const all = h('div', {});
    root.append(h('section', { class: 'section' }, h('h2', {}, 'Все треки'), all));
    this.pager(all, `/users/${id}/tracks`, { limit: 40 }, (c) => c);
  },

  // --- История -------------------------------------------------------------
  view_history(root) {
    const list = Store.data.history;
    root.append(this.pageHead('История', list.length ? `${list.length} ${plural(list.length, 'трек', 'трека', 'треков')}` : 'Пока пусто'));
    root.append(this.trackList(list));
  },

  // --- Текст песни (караоке, логика поиска — из Sadnes) --------------------
  LY_LEAD_MS: 250, // строку показываем чуть раньше, чем её поют: глаз успевает к первому слову

  async view_lyrics(root) {
    const t = Player.cur;
    this.lyLines = null;
    this.lyFor = t && t.id;
    if (!t) {
      root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-ico', html: I.lyrics }), h('h2', {}, 'Сначала включи трек')));
      return;
    }
    const g = Lyrics.guess(t);
    const body = h('div', { class: 'ly-body' }, h('div', { class: 'ly-status muted' }, 'Ищу текст…'));
    const input = h('input', {
      class: 'ly-search', placeholder: 'Найти другой текст…', title: 'Например: кино группа крови',
      onkeydown: async (e) => {
        const q = e.target.value.trim();
        if (e.key !== 'Enter' || !q) return;
        body.replaceChildren(h('div', { class: 'ly-status muted' }, 'Ищу…'));
        let res;
        try { res = await Lyrics.search(t, q); } catch (err) { res = { status: 'error', error: err.message }; }
        this.renderLyrics(body, res, t);
      },
    });
    const offLabel = h('span', { class: 'ly-off-val' });
    const showOff = () => {
      const v = (Store.data.lyricsOffset || 0) / 1000;
      offLabel.textContent = (v > 0 ? '+' : '') + v.toFixed(2).replace(/0$/, '') + ' с';
    };
    const shift = (d) => { Store.data.lyricsOffset = (Store.data.lyricsOffset || 0) + d; Store.save(); showOff(); this.lyActive = -2; };
    showOff();
    root.append(h('div', { class: 'lyrics' },
      h('div', { class: 'ly-head' },
        h('img', { class: 'ly-art', src: SC.art(t, 't300x300') }),
        h('div', { class: 'ly-meta' },
          h('div', { class: 'hero-kicker' }, 'Текст песни'),
          h('div', { class: 'ly-title' }, g.title),
          h('div', { class: 'muted' }, g.artist)),
        h('div', { class: 'ly-off', title: 'Сдвиг текста, если он спешит или отстаёт' },
          h('button', { class: 'icon-btn', onclick: () => shift(-250) }, '−'), offLabel,
          h('button', { class: 'icon-btn', onclick: () => shift(250) }, '+')),
        h('div', { class: 'ly-search-wrap' }, h('span', { html: I.search }), input)),
      body));
    const res = await Lyrics.get(t);
    if (this.view !== 'lyrics' || this.lyFor !== t.id) return;
    this.renderLyrics(body, res, t);
  },

  renderLyrics(body, res, t) {
    body.replaceChildren();
    body.classList.remove('plain');
    this.lyLines = null;
    this.lyEls = null;
    const status = (title, text, ...extra) => body.append(h('div', { class: 'ly-status' },
      h('h2', {}, title), text ? h('p', { class: 'muted' }, text) : null, ...extra));
    if (!res || res.status === 'not_found') {
      return status('Текст не нашёлся', 'В SoundCloud названия часто кривые — попробуй поиск сверху: «исполнитель название».');
    }
    if (res.status === 'instrumental') return status('Инструментал', 'Тут без слов — просто слушай 🎧');
    if (res.status === 'error') {
      return status('LRCLIB не отвечает', res.error || 'Проверь интернет/VPN.',
        h('button', { class: 'btn', onclick: () => { Lyrics.failed.delete(String(t.id)); this.go('lyrics'); } }, 'Повторить'));
    }

    this.lyLines = res.lines;
    this.lyEls = res.lines.map((l) => {
      if (!l.text) {
        // проигрыш — точки, которые «дышат», пока он идёт
        return h('div', { class: 'ly-line gap' }, h('i'), h('i'), h('i'));
      }
      const el = h('div', { class: 'ly-line', onclick: () => { Player.audio.currentTime = Math.max(0, (l.time - (Store.data.lyricsOffset || 0)) / 1000); this.lyUserScroll = 0; } });
      // слова — отдельными span, между ними исходные пробелы/знаки
      let pos = 0;
      l.wordEls = [];
      for (const w of l.words || []) {
        if (w.from > pos) el.append(l.text.slice(pos, w.from));
        const span = h('span', { class: 'w' }, l.text.slice(w.from, w.to));
        l.wordEls.push(span);
        el.append(span);
        pos = w.to;
      }
      if (pos < l.text.length) el.append(l.text.slice(pos));
      return el;
    });
    body.append(...this.lyEls);
    const src = res.source ? `${res.source.artist} — ${res.source.title}` : '';
    const notes = [!res.synced && 'без синхронизации — время примерное', res.scale && res.scale !== 1 && `подогнано под темп ×${res.scale.toFixed(2)}`].filter(Boolean);
    body.append(h('div', { class: 'ly-src' }, `Текст: LRCLIB · ${src}${notes.length ? ' · ' + notes.join(' · ') : ''}`));
    this.lyActive = -2;
    this.updateLyrics();
  },

  // Каждый кадр: текущая строка (с упреждением), заливка слов по настоящему времени
  updateLyrics() {
    if (this.view !== 'lyrics' || !this.lyLines) return;
    const now = Player.audio.currentTime * 1000 + (Store.data.lyricsOffset || 0);
    const L = this.lyLines;
    let i = -1;
    for (let k = 0; k < L.length && L[k].time <= now + this.LY_LEAD_MS; k++) i = k;
    if (i !== this.lyActive) {
      this.lyActive = i;
      this.lyEls.forEach((el, k) => {
        el.classList.toggle('active', k === i);
        el.classList.toggle('past', k < i);
      });
      const el = this.lyEls[Math.max(0, i)];
      if (el && Date.now() > (this.lyUserScroll || 0)) {
        // позиция строки внутри прокручиваемого блока (offsetTop считается от body — с шапкой,
        // и на телефоне текущая строка уезжала выше экрана)
        const v = el.parentElement;
        const y = el.getBoundingClientRect().top - v.getBoundingClientRect().top + v.scrollTop;
        v.scrollTo({ top: y - v.clientHeight * 0.36, behavior: 'smooth' });
      }
    }
    const line = L[i];
    if (line && line.wordEls) {
      line.words.forEach((w, k) => {
        const p = Math.max(0, Math.min(1, (now - w.start) / Math.max(1, w.end - w.start)));
        const val = (p * 100).toFixed(1) + '%';
        if (line.wordEls[k].dataset.p !== val) { line.wordEls[k].dataset.p = val; line.wordEls[k].style.setProperty('--p', val); }
      });
    }
  },

  toggleLyrics() {
    if (this.view === 'lyrics') this.go(this.prevView || 'wave', this.prevParams || {});
    else {
      this.prevView = this.view;
      this.prevParams = this.params;
      this.go('lyrics');
    }
  },

  // --- Тема: цвет акцента ---------------------------------------------------
  ACCENTS: [
    ['#ff6a1f', 'SoundCloud'], ['#ff3b5c', 'Малиновый'], ['#ff4fd8', 'Розовый'], ['#a259ff', 'Фиолетовый'],
    ['#5b6cff', 'Синий'], ['#2fb8ff', 'Голубой'], ['#1fd1b0', 'Бирюзовый'], ['#3ee06a', 'Зелёный'],
    ['#c6f432', 'Лаймовый'], ['#ffd02f', 'Жёлтый'], ['#ff2e2e', 'Красный'], ['#e8e8f0', 'Белый'],
  ],

  hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },

  // 'auto' — цвет из обложки; '#rrggbb' — свой, обложка на него не влияет.
  // instant — без плавного перехода (при запуске)
  applyAccentSetting(instant) {
    const v = Store.data.accent;
    if (v && v !== 'auto') {
      const rgb = this.hexToRgb(v);
      if (instant) {
        this.accent = rgb.slice();
        document.documentElement.style.setProperty('--accent-rgb', rgb.join(','));
      }
      this.setAccent(rgb);
    } else if (Player.cur) {
      this.setAccentFrom(SC.art(Player.cur, 't300x300'));
    } else {
      this.setAccent([255, 106, 31]);
    }
  },

  setAccentSetting(v) {
    Store.data.accent = v;
    Store.save();
    this.applyAccentSetting();
    for (const b of $$('.swatch')) b.classList.toggle('active', b.dataset.v === v);
    const custom = $('.swatch.custom');
    if (custom) custom.classList.toggle('active', v !== 'auto' && !this.ACCENTS.some(([c]) => c === v));
  },

  view_settings(root) {
    root.append(this.pageHead('Тема', 'Цвет кнопок, волны и подсветки'));
    const cur = Store.data.accent || 'auto';
    const isPreset = this.ACCENTS.some(([c]) => c === cur);
    const picker = h('input', {
      type: 'color', value: cur !== 'auto' ? cur : '#ff6a1f',
      oninput: (e) => this.setAccentSetting(e.target.value),
    });
    root.append(h('section', { class: 'section settings' },
      h('h2', {}, 'Цвет акцента'),
      h('div', { class: 'swatches' },
        h('button', {
          class: 'swatch auto' + (cur === 'auto' ? ' active' : ''), 'data-v': 'auto',
          title: 'Подстраивается под обложку трека', onclick: () => this.setAccentSetting('auto'),
        }, h('span', { class: 'sw-dot' }, h('i', { html: I.check })), 'Из обложки'),
        this.ACCENTS.map(([c, name]) => h('button', {
          class: 'swatch' + (cur === c ? ' active' : ''), 'data-v': c, title: name,
          onclick: () => this.setAccentSetting(c),
        }, h('span', { class: 'sw-dot', style: { background: c } }, h('i', { html: I.check })), name)),
        h('label', { class: 'swatch custom' + (cur !== 'auto' && !isPreset ? ' active' : ''), title: 'Любой цвет' },
          h('span', { class: 'sw-dot' }, h('i', { html: I.check })), 'Свой…', picker)),
      h('p', { class: 'muted small settings-note' },
        '«Из обложки» — цвет меняется под каждый трек. Свой цвет остаётся постоянным, а размытая обложка на фоне остаётся.')));
  },

  // --- общие кирпичики -----------------------------------------------------
  pageHead(title, sub) {
    return h('div', { class: 'page-head' }, h('h1', {}, title), h('div', { class: 'muted' }, sub));
  },

  // Список с подгрузкой при прокрутке
  pager(box, path, query, pick) {
    const state = { list: [], next: null, busy: false };
    const listEl = h('div', { class: 'tracks' });
    const sentinel = h('div', { class: 'sentinel muted' }, 'Загружаю…');
    box.append(listEl, sentinel);
    const view = this.view;
    const load = async () => {
      if (state.busy || state.done) return;
      state.busy = true;
      try {
        const r = state.next ? await SC.api(state.next) : await SC.api(path, { linked_partitioning: 1, ...query });
        if (this.view !== view) return;
        const items = pick(r.collection || []).filter((t) => t && t.kind === 'track');
        const from = state.list.length;
        state.list.push(...items);
        items.forEach((t, i) => listEl.append(this.trackRow(t, from + i, state.list)));
        state.next = r.next_href;
        if (!state.next) { state.done = true; sentinel.textContent = state.list.length ? '' : 'Пусто.'; }
      } catch (e) {
        sentinel.textContent = 'Ошибка: ' + e.message;
        state.done = true;
      } finally { state.busy = false; }
      // если экран ещё не заполнен — догружаем
      if (!state.done && sentinel.getBoundingClientRect().top < window.innerHeight + 300) load();
    };
    new IntersectionObserver((es) => es[0].isIntersecting && load(), { root: $('#view'), rootMargin: '400px' }).observe(sentinel);
    load();
    return state;
  },

  trackList(tracks) {
    const list = tracks.filter(Boolean);
    if (!list.length) return h('div', { class: 'muted' }, 'Ничего не нашлось.');
    return h('div', { class: 'tracks' }, list.map((t, i) => this.trackRow(t, i, list)));
  },

  trackRow(t, i, list) {
    const liked = SC.liked.has(t.id);
    const row = h('div', {
      class: 'row' + (Player.cur && Player.cur.id === t.id ? ' playing' : ''), 'data-id': t.id,
      onclick: () => Player.playList(list, i),
    },
      h('div', { class: 'row-idx' }, h('span', { class: 'num' }, i + 1), h('span', { class: 'ico', html: I.play }), h('span', { class: 'eq' }, h('i'), h('i'), h('i'))),
      h('img', { class: 'row-art', src: SC.art(t, 't120x120'), loading: 'lazy' }),
      h('div', { class: 'row-meta' },
        h('div', { class: 'row-title' }, t.title, t.policy === 'SNIP' ? h('span', { class: 'tag' }, 'превью') : null),
        h('div', { class: 'row-sub' },
          h('a', { class: 'link', onclick: (e) => { e.stopPropagation(); this.go('artist', { id: t.user_id || t.user.id }); } }, (t.user && t.user.username) || ''),
          t._repost ? h('span', { class: 'muted' }, ' · репост ' + t._repost.username) : null)),
      h('div', { class: 'row-stats' }, fmtNum(t.playback_count)),
      h('button', {
        class: 'icon-btn ghost', title: 'Волна по этому треку', html: I.wave,
        onclick: (e) => { e.stopPropagation(); Wave.start(Wave.mode, { seeds: [t], label: 'Волна по «' + t.title + '»' }); },
      }),
      h('button', {
        class: 'icon-btn like' + (liked ? ' on' : ''), 'data-like': t.id, title: 'Нравится', html: liked ? I.heartFill : I.heart,
        onclick: (e) => { e.stopPropagation(); SC.toggleLike(t); },
      }),
      h('div', { class: 'row-dur' }, fmtTime((t.full_duration || t.duration) / 1000)));
    return row;
  },

  card(o, onclick) {
    const sub = o.kind === 'track' ? (o.user && o.user.username) : (o.user ? o.user.username : (o.description || '').slice(0, 40));
    return h('button', { class: 'card', onclick },
      h('div', { class: 'card-art' },
        h('img', { src: SC.art(o, 't300x300'), loading: 'lazy' }),
        h('span', { class: 'card-play', html: I.play })),
      h('div', { class: 'card-title' }, o.title || o.short_title || ''),
      h('div', { class: 'card-sub' }, sub || ''));
  },

  syncLikes() {
    for (const b of $$('[data-like]')) {
      const on = SC.liked.has(+b.dataset.like);
      b.classList.toggle('on', on);
      b.innerHTML = on ? I.heartFill : I.heart;
    }
    const t = Player.cur;
    const on = t && SC.liked.has(t.id);
    $('#p-like').classList.toggle('on', !!on);
    $('#p-like').innerHTML = on ? I.heartFill : I.heart;
  },

  // --- плеер-бар -----------------------------------------------------------
  initPlayerBar() {
    const set = (id, ico) => { $(id).innerHTML = ico; };
    set('#p-play', I.play); set('#p-prev', I.prev); set('#p-next', I.next);
    set('#p-shuffle', I.shuffle); set('#p-like', I.heart); set('#p-dislike', I.dislike);
    set('#p-queue', I.queue); set('#p-lyrics', I.lyrics);
    $('#p-lyrics').onclick = () => this.toggleLyrics();
    $('#view').addEventListener('wheel', () => { if (this.view === 'lyrics') this.lyUserScroll = Date.now() + 4000; }, { passive: true });
    $('#p-dislike').classList.add('hidden');
    $('#p-play').onclick = () => Player.toggle();
    $('#p-next').onclick = () => Player.next(true);
    $('#p-prev').onclick = () => Player.prev();
    $('#p-like').onclick = async () => {
      if (!Player.cur) return;
      const on = await SC.toggleLike(Player.cur);
      if (on && Wave.active) Wave.feedback(Player.cur, 'like');
    };
    $('#p-dislike').onclick = () => {
      if (!Player.cur) return;
      Wave.feedback(Player.cur, 'dislike');
      toast('Понял, такого больше не будет');
      Player.next(false);
    };
    $('#p-shuffle').onclick = () => { Store.data.shuffle = !Store.data.shuffle; Store.save(); this.onModes(); };
    $('#p-repeat').onclick = () => {
      const order = ['off', 'all', 'one'];
      Store.data.repeat = order[(order.indexOf(Store.data.repeat) + 1) % 3];
      Store.save(); this.onModes();
    };
    $('#p-artist').onclick = () => Player.cur && this.go('artist', { id: Player.cur.user_id || Player.cur.user.id });
    $('#p-title').onclick = () => Player.cur && window.volna.openExternal(Player.cur.permalink_url);
    $('#p-queue').onclick = () => this.toggleQueue();

    const vol = $('#p-vol');
    vol.value = Store.data.volume;
    vol.oninput = () => Player.setVolume(+vol.value);
    $('#p-mute').onclick = () => { Player.audio.muted = !Player.audio.muted; this.onVolume(); };
    vol.addEventListener('wheel', (e) => { e.preventDefault(); Player.setVolume(Player.audio.volume - Math.sign(e.deltaY) * 0.05); }, { passive: false });
    this.onVolume();
    this.onModes();

    // перемотка по волноформе
    const c = $('#p-wave');
    const seekAt = (e) => {
      const r = c.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (Player.audio.duration) Player.audio.currentTime = f * Player.audio.duration;
    };
    let drag = false;
    c.addEventListener('pointerdown', (e) => { drag = true; c.setPointerCapture(e.pointerId); seekAt(e); });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      this.hoverF = (e.clientX - r.left) / r.width;
      if (drag) seekAt(e);
      this.drawSeek();
    });
    c.addEventListener('pointerup', () => { drag = false; });
    c.addEventListener('pointerleave', () => { this.hoverF = null; this.drawSeek(); });
    new ResizeObserver(() => this.drawSeek()).observe(c);
  },

  onModes() {
    $('#p-shuffle').classList.toggle('on', !!Store.data.shuffle);
    const r = Store.data.repeat;
    $('#p-repeat').innerHTML = r === 'one' ? I.repeatOne : I.repeat;
    $('#p-repeat').classList.toggle('on', r !== 'off');
  },

  onVolume() {
    const a = Player.audio;
    const v = a.muted ? 0 : a.volume;
    $('#p-mute').innerHTML = v === 0 ? I.mute : v < 0.5 ? I.volLow : I.vol;
    $('#p-vol').value = v;
    $('#p-vol').style.setProperty('--p', v * 100 + '%');
  },

  onTrack(t) {
    $('#player').classList.add('has-track');
    $('#p-art').src = SC.art(t, 't300x300');
    $('#p-title').textContent = t.title;
    $('#p-artist').textContent = (t.user && t.user.username) || '';
    document.title = `${t.title} — Volna`;
    this.syncLikes();
    for (const r of $$('.row')) r.classList.toggle('playing', +r.dataset.id === t.id);
    const now = $('#hero-now');
    if (now && Wave.active) now.textContent = `${t.user ? t.user.username : ''} — ${t.title}`;
    this.setAccentFrom(SC.art(t, 't300x300'));
    if (this.view === 'lyrics' && this.lyFor !== t.id) this.go('lyrics');
    this.drawSeek();
    this.renderQueue();
  },

  onPlayState(playing) {
    $('#p-play').innerHTML = playing ? I.pause : I.play;
    document.body.classList.toggle('is-playing', playing);
    const hp = $('#hero-play');
    if (hp) {
      const on = playing && Wave.active;
      hp.innerHTML = on ? I.pause : I.play;
      hp.classList.toggle('on', on);
    }
  },

  onTime(cur, dur) {
    $('#p-time').textContent = fmtTime(cur);
    $('#p-dur').textContent = fmtTime(dur);
    this.drawSeek();
  },

  drawSeek() {
    const c = $('#p-wave');
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, hgt = c.clientHeight;
    if (!w) return;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = hgt * dpr; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const prog = Player.progress();
    const bw = 2.5, gap = 1.5, n = Math.floor(w / (bw + gap));
    const wf = Player.wf;
    if (wf && !wf.lo) {
      const sorted = [...wf.samples].sort((a, b) => a - b);
      wf.lo = sorted[Math.floor(sorted.length * 0.05)] || 0;
      wf.hi = sorted[sorted.length - 1] || wf.height;
    }
    const [r, g, b] = this.accent;
    for (let i = 0; i < n; i++) {
      let v = 0.35;
      if (wf) {
        const s = wf.samples;
        const a0 = Math.floor((i / n) * s.length), a1 = Math.max(a0 + 1, Math.floor(((i + 1) / n) * s.length));
        let m = 0;
        for (let k = a0; k < a1; k += 1) m += s[k];
        m /= a1 - a0;
        const x = Math.max(0, (m - wf.lo) / Math.max(1, wf.hi - wf.lo));
        v = 0.18 + 0.82 * Math.pow(x, 1.6);
      }
      const bh = Math.max(3, v * hgt);
      const f = i / n;
      ctx.fillStyle = f < prog ? `rgb(${r},${g},${b})`
        : this.hoverF != null && f < this.hoverF ? `rgba(${r},${g},${b},.45)` : 'rgba(255,255,255,.18)';
      const x = i * (bw + gap);
      ctx.beginPath();
      ctx.roundRect(x, (hgt - bh) / 2, bw, bh, 1);
      ctx.fill();
    }
  },

  // Цвет акцента — самый «сочный» средний цвет обложки
  setAccentFrom(url) {
    $('#bg .bg-art').style.backgroundImage = url ? `url("${url}")` : '';
    if (!url || (Store.data.accent && Store.data.accent !== 'auto')) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let R = 0, G = 0, B = 0, W = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          const sat = mx ? (mx - mn) / mx : 0;
          const w = sat * sat * (mx > 60 ? 1 : 0.1) + 0.001;
          R += r * w; G += g * w; B += b * w; W += w;
        }
        let rgb = [R / W, G / W, B / W];
        // вытягиваем яркость и насыщенность, чтобы акцент не был грязным
        const mx = Math.max(...rgb), mn = Math.min(...rgb);
        if (mx - mn < 25) rgb = [255, 106, 31];
        else {
          const k = 235 / mx;
          rgb = rgb.map((v) => Math.min(255, mn + (v - mn) * 1.25) * k).map((v) => Math.round(Math.min(255, v)));
        }
        this.setAccent(rgb);
      } catch {}
    };
    img.src = url;
  },

  setAccent(rgb) {
    this.accentTarget = rgb;
  },

  // плавный переход цвета + анимация героя
  loop() {
    const step = (t) => {
      requestAnimationFrame(step);
      if (document.hidden) return;
      if (this.accentTarget) {
        const a = this.accent, tg = this.accentTarget;
        let moved = false;
        for (let i = 0; i < 3; i++) {
          const d = tg[i] - a[i];
          if (Math.abs(d) > 0.5) { a[i] += d * 0.06; moved = true; }
        }
        if (moved) {
          const s = a.map(Math.round).join(',');
          document.documentElement.style.setProperty('--accent-rgb', s);
          if (Math.random() < 0.2) this.drawSeek();
        }
      }
      this.updateLyrics();
      const e = Player.sampleEnergy();
      document.documentElement.style.setProperty('--energy', e.toFixed(3));
      if (this.view === 'wave' && this.heroCanvas && this.heroCanvas.isConnected) this.drawHero(t / 1000, e);
    };
    requestAnimationFrame(step);
  },

  // плотность холста героя: на телефоне ниже — линии мягкие, а кадр в разы дешевле
  heroDpr() { return window.devicePixelRatio || 1; },

  drawHero(t, e) {
    const c = this.heroCanvas;
    const dpr = this.heroDpr();
    const w = c.clientWidth, hh = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = w * dpr; c.height = hh * dpr; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    const [r, g, b] = this.accent.map(Math.round);
    const playing = Wave.active && !Player.audio.paused;
    const speed = playing ? 1 : 0.35;
    this.phase = (this.phase || 0) + 0.016 * speed * (1 + e * 1.5);
    const p = this.phase;

    // мягкое свечение в центре
    const glow = ctx.createRadialGradient(w / 2, hh * 0.52, 0, w / 2, hh * 0.52, Math.max(w, hh) * 0.55);
    glow.addColorStop(0, `rgba(${r},${g},${b},${0.20 + e * 0.25})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, hh);

    ctx.globalCompositeOperation = 'lighter';
    const lines = 7;
    for (let i = 0; i < lines; i++) {
      const k = i / (lines - 1);
      const amp = hh * (0.07 + 0.05 * Math.sin(p * 0.3 + i)) * (1 + e * 2.6) * (1 - k * 0.35);
      const fr = 1.1 + k * 0.9;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const u = x / w;
        const env = Math.pow(Math.sin(Math.PI * u), 1.6);
        const y = hh * 0.55
          + Math.sin(u * fr * Math.PI * 2 + p * (1 + k * 0.6) + i * 1.3) * amp * env
          + Math.sin(u * fr * 5.1 * Math.PI + p * 1.9 + i) * amp * 0.25 * env;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      const al = 0.10 + 0.5 * (1 - k) * (0.4 + e);
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
      grad.addColorStop(0.5, `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},${al})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5 + (1 - k) * 1.5;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  },

  // --- очередь -------------------------------------------------------------
  toggleQueue(force) {
    const q = $('#queue');
    const show = force != null ? force : q.classList.contains('hidden');
    q.classList.toggle('hidden', !show);
    $('#p-queue').classList.toggle('on', show);
    if (show) this.renderQueue();
  },

  renderQueue() {
    const box = $('#queue-list');
    if ($('#queue').classList.contains('hidden')) return;
    box.replaceChildren();
    const after = Player.queue.slice(Player.index + 1);
    const items = [
      ...(Player.cur ? [['Сейчас', [Player.cur]]] : []),
      ['Дальше', after.slice(0, 50)],
      ...(Wave.active ? [['Подберёт волна', Wave.upcoming]] : []),
    ];
    for (const [title, list] of items) {
      if (!list.length) continue;
      box.append(h('div', { class: 'q-title' }, title));
      for (const t of list) {
        box.append(h('div', {
          class: 'q-item', onclick: () => {
            const i = Player.queue.indexOf(t);
            if (i >= 0) { Player.index = i; Player.load(t); }
            else {
              Wave.upcoming = Wave.upcoming.filter((x) => x !== t);
              Player.queue.splice(Player.index + 1, 0, t);
              Player.next(true);
            }
          },
        },
          h('img', { src: SC.art(t, 'large') }),
          h('div', { class: 'q-meta' }, h('div', { class: 'q-t' }, t.title), h('div', { class: 'muted small' }, t.user ? t.user.username : ''))));
      }
    }
  },

  // --- клавиши -------------------------------------------------------------
  initKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.closeWavePicker()) return;
      if (e.target.tagName === 'INPUT') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      const a = Player.audio;
      if (e.code === 'Space') { e.preventDefault(); Player.toggle(); }
      else if (e.code === 'ArrowRight' && e.ctrlKey) Player.next(true);
      else if (e.code === 'ArrowLeft' && e.ctrlKey) Player.prev();
      else if (e.code === 'ArrowRight') a.currentTime += 5;
      else if (e.code === 'ArrowLeft') a.currentTime -= 5;
      else if (e.code === 'ArrowUp') { e.preventDefault(); Player.setVolume(a.volume + 0.05); }
      else if (e.code === 'ArrowDown') { e.preventDefault(); Player.setVolume(a.volume - 0.05); }
      else if (e.code === 'KeyL') $('#p-like').click();
      else if (e.code === 'KeyT') this.toggleLyrics();
      else if (e.code === 'KeyW') Wave.active ? Player.toggle() : Wave.start();
      else if (e.code === 'Slash' || (e.ctrlKey && e.code === 'KeyF')) { e.preventDefault(); this.go('search'); }
    });
  },
};

// запуск после всех скриптов: мобильная версия успевает подложить свои правки (mobile.js)
document.addEventListener('DOMContentLoaded', () => UI.init());
