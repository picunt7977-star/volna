// Телефон: правки поверх общего интерфейса (ui.js/player.js те же, что на ПК).
// Нижние вкладки, мини-плеер → полноэкранный плеер, «назад» на Android, без Web Audio.
const Mobile = {
  stack: [],     // история экранов для кнопки «назад»
  npOpen: false,
  TABS: ['wave', 'search', 'likes', 'library', 'more'],

  patch() {
    // Анализатор звука (Web Audio) на телефоне не нужен: батарея и фон важнее.
    // Анимации волны «дышат» сами, пока играет музыка.
    Player.ensureAnalyser = () => {};
    Player.sampleEnergy = function () {
      const t = performance.now() / 1000;
      const target = this.audio && !this.audio.paused ? 0.2 + 0.1 * Math.sin(t * 2.1) + 0.06 * Math.sin(t * 5.3) : 0;
      this.energy += (target - this.energy) * 0.08;
      return this.energy;
    };

    // Покадровый цикл для телефона. На ПК цикл ставит --energy и плавно ведёт --accent-rgb
    // на корне страницы каждый кадр — это пересчёт стилей всего документа 60–120 раз в секунду.
    // Здесь: акцент — сразу, энергия — только на тех двух элементах, что от неё зависят.
    UI.heroDpr = () => Math.min(1.5, window.devicePixelRatio || 1);
    UI.loop = function () {
      let lastE = -1, lastAccent = '';
      const step = (t) => {
        requestAnimationFrame(step);
        if (document.hidden) return;
        if (this.accentTarget) {
          const s = this.accentTarget.map(Math.round).join(',');
          if (s !== lastAccent) {
            lastAccent = s;
            this.accent = this.accentTarget.slice();
            document.documentElement.style.setProperty('--accent-rgb', s);
            this.drawSeek();
          }
        }
        this.updateLyrics();
        const e = Player.sampleEnergy();
        if (Math.abs(e - lastE) > 0.004) {
          lastE = e;
          const v = e.toFixed(3);
          for (const el of [$('#hero-play'), Mobile.npOpen && $('#np-art')]) if (el) el.style.setProperty('--energy', v);
        }
        if (this.view === 'wave' && this.heroCanvas && this.heroCanvas.isConnected) this.drawHero(t / 1000, e);
      };
      requestAnimationFrame(step);
    };

    // размытый фон из обложки: крошечная картинка + маленький blur, растянутые трансформом.
    // Растр стоит копейки, вместо blur(90px) на весь экран с плотностью 2.8
    UI.setAccentFrom = ((orig) => function (url) {
      orig.call(this, url);
      const small = Player.cur ? SC.art(Player.cur, 't67x67') : '';
      $('#bg .bg-art').style.backgroundImage = small ? `url("${small}")` : '';
    })(UI.setAccentFrom);

    // «Что включим?»: строится один раз и дальше только выезжает (как плеер) —
    // иначе каждый раз заново рисуются 12 SVG-обложек и первый кадр шторки рвётся
    const openPicker = UI.openWavePicker;
    UI.openWavePicker = function () {
      let p = $('#picker');
      if (!p) {
        openPicker.call(this);
        p = $('#picker');
        p.classList.add('closed');
        Mobile.dragToClose($('.pk-sheet'), () => this.closeWavePicker());
        void p.offsetWidth;
      }
      const all = this.waveChoices();
      $$('.pk-item', p).forEach((el, i) => el.classList.toggle('active', !!(all[i] && all[i].active)));
      $('.pk-list', p).scrollTop = 0;
      p.classList.remove('closed');
    };
    UI.closeWavePicker = function () {
      const p = $('#picker');
      if (!p || p.classList.contains('closed')) return false;
      const sh = $('.pk-sheet', p);
      sh.style.transition = '';
      sh.style.transform = '';
      p.classList.add('closed');
      return true;
    };

    UI.navItems = () => [
      ['wave', 'Волна', I.wave],
      ['search', 'Поиск', I.search],
      ['likes', 'Лайки', I.heart],
      ['library', 'Плейлисты', I.library, true],
      ['more', 'Ещё', I.more],
    ];

    const go = UI.go;
    UI.go = function (view, params = {}, back = false) {
      // повторный рендер того же экрана (после входа и т.п.) — не шаг истории
      if (!back && this.view && (this.view !== view || this.params !== params)) {
        Mobile.stack.push([this.view, this.params]);
        if (Mobile.stack.length > 40) Mobile.stack.shift();
      }
      if (Mobile.npOpen && view !== this.view) Mobile.closeNp();
      const changed = view !== this.view;
      go.call(this, view, params);
      // новый экран мягко выплывает (повторный рендер того же — без анимации)
      const root = $('#view');
      if (changed) {
        root.classList.remove('v-in');
        void root.offsetWidth;
        root.classList.add('v-in');
      }
      Mobile.syncTabs();
    };

    // стеклянная «линза» под активной вкладкой, как в iOS 26
    const renderNav = UI.renderNav;
    UI.renderNav = function () {
      renderNav.call(this);
      $('#nav').prepend(h('span', { class: 'nav-pill' }));
      Mobile.syncTabs(true);
    };

    // лайк — сердце «подпрыгивает»
    document.addEventListener('likes-changed', (e) => {
      if (!e.detail || !e.detail.on) return;
      for (const b of [...$$(`[data-like="${e.detail.id}"]`), $('#p-like')]) {
        if (!b) continue;
        b.classList.remove('pop');
        void b.offsetWidth;
        b.classList.add('pop');
      }
    });

    UI.view_more = function (root) {
      root.append(this.pageHead('Ещё', ''));
      const acc = h('div', { class: 'm-acc' });
      if (SC.me) {
        acc.append(
          h('img', { class: 'acc-ava', src: SC.art(SC.me, 't120x120') }),
          h('div', { class: 'acc-meta' },
            h('div', { class: 'acc-name' }, SC.me.username),
            h('div', { class: 'acc-sub' }, `${fmtNum(SC.me.followers_count) || 0} подписчиков · ${SC.liked.size} лайков`)),
          h('button', {
            class: 'icon-btn', title: 'Выйти', html: I.logout,
            onclick: async () => { await window.volna.logout(); toast('Вышел из аккаунта'); },
          }));
      } else {
        const token = h('input', { class: 'token-input', placeholder: 'или вставь oauth_token: 2-123456-…' });
        acc.classList.add('out');
        acc.append(
          h('p', { class: 'muted' }, 'С аккаунтом SoundCloud работают лайки, лента, плейлисты, а волна подбирает точнее.'),
          h('button', {
            class: 'login-btn', onclick: async () => {
              if (await window.volna.login()) toast('Готово, ты в SoundCloud', 'ok');
            },
          }, h('span', { html: I.sc }), 'Войти через SoundCloud'),
          h('div', { class: 'm-token' }, token, h('button', {
            class: 'btn', onclick: async () => {
              toast('Проверяю токен…');
              try {
                if (!(await window.volna.loginToken(token.value))) toast('Токен не подошёл', 'err');
                else toast('Готово, ты в SoundCloud', 'ok');
              } catch (e) { toast('Не вышло: ' + e.message, 'err'); }
            },
          }, 'Ок')));
      }
      root.append(acc);
      const links = [
        ['feed', 'Лента', I.feed, 'Новое от тех, на кого подписан'],
        ['history', 'История', I.clock, 'Что недавно играло'],
        ['settings', 'Тема', I.palette, 'Цвет акцента'],
      ];
      root.append(h('div', { class: 'm-links' }, links.map(([id, name, ico, sub]) =>
        h('button', { class: 'm-link', onclick: () => this.go(id) },
          h('span', { class: 'm-ico', html: ico }),
          h('span', { class: 'm-text' }, h('b', {}, name), h('small', { class: 'muted' }, sub)),
          h('span', { class: 'm-chev', html: I.chevronRight })))));
      root.append(h('p', { class: 'muted small m-note' },
        'SoundCloud в России заблокирован — держи VPN на телефоне включённым.'));
    };

    // мини-плеер: тап по названию/исполнителю раскрывает плеер, а не уводит на сайт
    const initBar = UI.initPlayerBar;
    UI.initPlayerBar = function () {
      initBar.call(this);
      $('#p-title').onclick = null;
      $('#p-artist').onclick = null;
      Mobile.initNp();
    };

    const onTrack = UI.onTrack;
    UI.onTrack = function (t) {
      const changed = !Mobile.lastTrack || Mobile.lastTrack !== t.id;
      Mobile.lastTrack = t.id;
      onTrack.call(this, t);
      if (changed) Mobile.swipeEnter();
      Mobile.syncNp();
      Mobile.marquee($('#p-title'));
      Mobile.marquee($('#p-artist'));
    };

    // ты в шапке справа: аватар и имя → «Ещё»; без входа — кнопка «Войти»
    const renderAccount = UI.renderAccount;
    UI.renderAccount = function () {
      renderAccount.call(this);
      const b = $('#tb-acc');
      b.replaceChildren();
      if (SC.me) {
        b.append(h('span', { class: 'tb-name' }, SC.me.username), h('img', { src: SC.art(SC.me, 't120x120') }));
        b.onclick = () => this.go('more');
      } else {
        b.append(h('span', { class: 'tb-login' }, 'Войти'));
        b.onclick = async () => { if (await window.volna.login()) toast('Готово, ты в SoundCloud', 'ok'); };
      }
    };

    const onTime = UI.onTime;
    UI.onTime = function (cur, dur) {
      onTime.call(this, cur, dur);
      $('#player').style.setProperty('--prog', (dur ? (cur / dur) * 100 : 0) + '%');
    };

    const onWave = UI.onWaveChanged;
    UI.onWaveChanged = function (busy) {
      onWave.call(this, busy);
      Mobile.syncNp();
    };

    // тексты: пальцем листаешь — автопрокрутка ждёт
    document.addEventListener('DOMContentLoaded', () => {
      $('#view').addEventListener('touchmove', () => { if (UI.view === 'lyrics') UI.lyUserScroll = Date.now() + 4000; }, { passive: true });
    });
  },

  // --- полноэкранный плеер ---------------------------------------------------
  initNp() {
    $('#np-close').innerHTML = I.chevronDown;
    $('#np-queue').innerHTML = I.queue;
    $('#np-wave').innerHTML = I.wave;
    $('#np-lyrics').innerHTML = I.lyrics;
    $('#np-share').innerHTML = I.ext;
    $('#np-close').onclick = () => this.closeNp();
    $('#np-queue').onclick = () => UI.toggleQueue(true);
    $('#np-lyrics').onclick = () => { this.closeNp(); if (UI.view !== 'lyrics') UI.toggleLyrics(); };
    $('#np-share').onclick = () => Player.cur && window.volna.openExternal(Player.cur.permalink_url);
    $('#np-wave').onclick = () => {
      const t = Player.cur;
      if (t) Wave.start(Wave.mode, { seeds: [t], label: 'Волна по «' + t.title + '»' });
    };
    $('#np-artist').onclick = () => {
      const t = Player.cur;
      if (t) { this.closeNp(); UI.go('artist', { id: t.user_id || t.user.id }); }
    };
    $('#player').addEventListener('click', (e) => {
      if (Date.now() < this.noClickUntil) return;
      if (!e.target.closest('button') && Player.cur) this.openNp();
    });

    // обложка в плеере: влево — следующий, вправо — предыдущий, вниз — свернуть
    this.swipe($('.np-art-wrap'), {
      x: $('#np-art'),
      y: $('#np'),
      left: () => Player.next(true),
      right: () => Player.prev(),
      down: () => this.closeNp(),
    });
    // шапка плеера тоже тянется вниз
    this.swipe($('.np-head'), { y: $('#np'), down: () => this.closeNp() });
    // мини-плеер: влево/вправо — переключить, вверх — развернуть
    this.swipe($('#player .p-left'), {
      x: $('#player .p-left'),
      left: () => Player.next(true),
      right: () => Player.prev(),
      up: () => this.openNp(),
    });
  },

  noClickUntil: 0,
  enterFrom: null,   // откуда въедет новая обложка после свайпа

  // Жест с «живым» откликом: элемент едет за пальцем, отпустил — либо действие, либо назад на место
  swipe(zone, o) {
    let x0, y0, dx, dy, axis;
    const reset = (el, ms = 380) => {
      if (!el) return;
      el.style.transition = `transform ${ms}ms cubic-bezier(.3,1.3,.5,1), opacity ${ms}ms`;
      el.style.transform = '';
      el.style.opacity = '';
    };
    zone.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || !Player.cur) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = dy = 0; axis = null;
    }, { passive: true });
    zone.addEventListener('touchmove', (e) => {
      if (x0 == null) return;
      dx = e.touches[0].clientX - x0; dy = e.touches[0].clientY - y0;
      if (!axis && Math.hypot(dx, dy) > 10) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'x' && o.x && (o.left || o.right)) {
        o.x.style.transition = 'none';
        o.x.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
        o.x.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 600));
      } else if (axis === 'y' && o.y && dy > 0 && o.down) {
        o.y.style.transition = 'none';
        o.y.style.transform = `translateY(${dy}px)`;
      }
    }, { passive: true });
    zone.addEventListener('touchend', () => {
      if (x0 == null) return;
      x0 = null;
      if (axis) this.noClickUntil = Date.now() + 350;
      const w = window.innerWidth;
      if (axis === 'x' && Math.abs(dx) > Math.min(90, w * 0.22) && (dx < 0 ? o.left : o.right)) {
        const dir = dx < 0 ? -1 : 1;
        if (o.x) {
          o.x.style.transition = 'transform .22s ease-in, opacity .22s';
          o.x.style.transform = `translateX(${dir * w}px) rotate(${dir * 8}deg)`;
          o.x.style.opacity = '0';
        }
        this.enterFrom = { dir: -dir, at: Date.now() };
        setTimeout(() => {
          (dir < 0 ? o.left : o.right)();
          // «назад» после 4 секунд просто перематывает в начало — трек тот же, обложку возвращаем
          if (dir > 0) setTimeout(() => { if (this.enterFrom) this.swipeEnter(); }, 450);
        }, 180);
        return;
      }
      if (axis === 'y' && dy > 110 && o.down) { this.closeNp(true); return; }
      if (axis === 'y' && dy < -50 && o.up) { this.openNp(); return; }
      reset(o.x);
      if (axis === 'y') reset(o.y);
    }, { passive: true });
  },

  // шторка тянется пальцем вниз; дотянул — закрылась, нет — вернулась
  dragToClose(sheet, close) {
    let y0 = null, dy = 0;
    sheet.addEventListener('touchstart', (e) => {
      // за список тянем, только если он прокручен в самый верх
      const list = e.target.closest('.pk-list');
      y0 = list && list.scrollTop > 0 ? null : e.touches[0].clientY;
      dy = 0;
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    sheet.addEventListener('touchend', () => {
      if (y0 == null) return;
      y0 = null;
      sheet.style.transition = '';
      if (dy > 110) close();
      else sheet.style.transform = '';
    }, { passive: true });
  },

  // новая обложка въезжает с той стороны, куда «ушла» старая
  swipeEnter() {
    const e = this.enterFrom;
    this.enterFrom = null;
    if (!e || Date.now() - e.at > 2000) return;
    for (const el of [$('#np-art'), $('#player .p-left')]) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${e.dir * 60}%)`;
      el.style.opacity = '0';
      void el.offsetWidth;
      el.style.transition = 'transform .5s cubic-bezier(.2,1.2,.4,1), opacity .35s';
      el.style.transform = '';
      el.style.opacity = '';
    }
  },

  // вкладки: подсветить активную и подвинуть под неё стеклянную линзу
  syncTabs(instant) {
    const view = UI.view;
    const tab = this.TABS.includes(view) ? view : ['feed', 'history', 'settings'].includes(view) ? 'more' : null;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === tab));
    const pill = $('.nav-pill');
    const b = $(`.nav-item[data-view="${tab}"]`);
    if (!pill) return;
    if (!b) { pill.style.opacity = '0'; return; }
    if (instant) pill.style.transition = 'none';
    pill.style.opacity = '1';
    pill.style.width = b.offsetWidth + 'px';
    pill.style.transform = `translateX(${b.offsetLeft}px)`;
    if (instant) { void pill.offsetWidth; pill.style.transition = ''; }
  },

  // Бегущая строка: длинное название/исполнитель медленно уезжает влево и обратно
  marquee(el) {
    if (!el) return;
    const text = el.textContent;
    el.classList.remove('marq');
    el.replaceChildren(h('span', { class: 'marq-in' }, text));
    requestAnimationFrame(() => {
      const span = el.firstChild;
      if (!span || !el.clientWidth) return;
      const d = span.scrollWidth - el.clientWidth;
      if (d <= 2) return;
      span.style.setProperty('--d', -(d + 12) + 'px');
      span.style.setProperty('--t', (3 + d / 28).toFixed(1) + 's');
      el.classList.add('marq');
    });
  },

  // кнопки и волноформа одни и те же: переносим их между мини-плеером и полным
  openNp() {
    if (this.npOpen) return;
    this.npOpen = true;
    $('.np-acts').append($('#p-dislike'), $('#p-like'));
    $('.np-seek').append($('.p-seek'));
    $('.np-controls').append($('.p-controls'));
    const np = $('#np');
    this.syncNp();
    UI.drawSeek();
    this.marquee($('#np-title'));
    this.marquee($('#np-artist'));
    // тяжёлое (перенос кнопок, волноформа) — в этом кадре, а сам выезд — со следующего
    requestAnimationFrame(() => {
      np.style.transition = '';
      np.style.transform = '';
      np.classList.add('open');
    });
  },

  // уезжает вниз (из того места, куда дотянули пальцем), потом прячется
  closeNp() {
    if (!this.npOpen) return;
    this.npOpen = false;
    const np = $('#np');
    // из того места, куда дотянули пальцем, — плавно вниз
    np.style.transition = '';
    np.style.transform = '';
    np.classList.remove('open');
    setTimeout(() => {
      if (this.npOpen) return;
      $('.p-left').append($('#p-like'), $('#p-dislike'));
      $('.p-center').append($('.p-controls'), $('.p-seek'));
    }, 420);
  },

  syncNp() {
    const t = Player.cur;
    if (!t) return;
    const art = SC.art(t, 't500x500');
    if ($('#np-art').getAttribute('src') !== art) $('#np-art').src = art;
    const small = SC.art(t, 't67x67');
    $('.np-bg').style.backgroundImage = small ? `url("${small}")` : '';
    $('#np-title').textContent = t.title;
    $('#np-artist').textContent = (t.user && t.user.username) || '';
    if (this.npOpen) { this.marquee($('#np-title')); this.marquee($('#np-artist')); }
    $('#np-src').textContent = Player.source === 'wave' && Wave.active
      ? (Wave.label || 'Моя волна · ' + Wave.modes[Wave.mode].name)
      : 'SoundCloud';
  },

  // --- кнопка «назад» Android ----------------------------------------------
  back() {
    if (UI.closeWavePicker()) return;
    if (!$('#queue').classList.contains('hidden')) return UI.toggleQueue(false);
    if (this.npOpen) return this.closeNp();
    const prev = this.stack.pop();
    if (prev) return UI.go(prev[0], prev[1], true);
    // дальше некуда — сворачиваем, музыка играет дальше
    window.volna.minimize();
  },
};

Mobile.patch();
window.Capacitor.registerPlugin('App').addListener('backButton', () => Mobile.back());
