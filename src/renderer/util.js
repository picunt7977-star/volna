// Мелкие помощники: DOM, форматирование, тосты, хранилище

// h('div', {class: 'x', onclick}, 'текст', child) — текст всегда через textContent,
// html: допускается только для наших статичных иконок
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      // CSS-переменные (--x) через Object.assign не ставятся
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

function fmtNum(n) {
  if (!n) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.0', '') + ' млн';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '') + ' тыс';
  return String(n);
}

function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toast(msg, kind = '') {
  const el = h('div', { class: 'toast ' + kind }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

// Локальное состояние: история, что уже звучало в волне, дизлайки, громкость
const Store = {
  data: { history: [], seen: [], disliked: [], penalty: {}, volume: 0.8, accent: 'auto', likes: [], unliked: [], likesImported: false, waveMode: 'mix', shuffle: false, repeat: 'off' },
  seen: new Set(),
  disliked: new Set(),
  async load() {
    try { Object.assign(this.data, (await window.volna.storeLoad()) || {}); } catch {}
    this.seen = new Set(this.data.seen);
    this.disliked = new Set(this.data.disliked);
  },
  save: debounce(function () {
    Store.data.seen = [...Store.seen].slice(-4000);
    Store.data.disliked = [...Store.disliked];
    window.volna.storeSave(Store.data);
  }, 700),
  addSeen(id) {
    this.seen.delete(id);
    this.seen.add(id);
    this.save();
  },
  addHistory(t) {
    const slim = SC.slim(t);
    this.data.history = [slim, ...this.data.history.filter((x) => x.id !== t.id)].slice(0, 300);
    this.save();
  },
};
