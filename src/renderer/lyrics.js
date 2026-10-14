// Тексты песен с LRCLIB — порт LyricsFetcher из ~/lol/sadnes (NewerWin).
//
// Почему так: LRCLIB без ключа и отдаёт синхронизированный LRC — строки встают ровно под
// музыку. Сначала точный /get (исполнитель + название + длительность), потом /search.
// У каждого слова есть время: из пословных меток LRC, а если их нет — оценка по слогам
// и местному темпу пения (иначе караоке-заливка бежит равномерно и не попадает в голос).
const Lyrics = {
  API: 'https://lrclib.net/api/',
  RETRY_MS: 60e3,          // «не найдено» не долбим чаще раза в минуту
  ERROR_RETRY_MS: 10e3,    // сетевую ошибку повторяем быстрее — VPN могли включить позже
  REQUEST_MS: 9e3,
  MIN_RATE: 2, MAX_RATE: 9, DEFAULT_RATE: 4.5, // слогов в секунду
  cache: new Map(),        // ключ → результат (найдено/инструментал)
  failed: new Map(),       // ключ → { res, at }
  manual: new Map(),       // id трека → результат ручного поиска

  // Хвосты, которые клеят к названию. LRCLIB ищет по точному имени, и
  // "Song (Official Video)" для него — другая песня.
  TITLE_NOISE: /\s*[(\[][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|clip|remaster(ed)?|hd|hq|4k|live|explicit|prod\.|free\s?d(own)?l(oad)?|перевод|премьера|клип)[^)\]]*[)\]]/giu,
  // \b обязателен: без него "ft" находится внутри "Daft Punk" и съедает всё название
  FEAT: /\s*[(\[]?\s*\b(feat\.?|ft\.|ft|featuring)(?=[\s.])\.?\s+[^)\]]*[)\]]?/gi,
  ARTIST_NOISE: /\s*(-\s*topic|vevo|official)\s*$/i,
  // Ускоренные/замедленные версии: текст берём от оригинала и растягиваем по времени
  VERSION: /[(\[]?[^()\[\]]*\b(sped\s?up|speed\s?up|speedup|slowed|nightcore|daycore|reverb|reverd|rewerb|bass\s?boost(ed)?)\b[^()\[\]]*[)\]]?/gi,

  cleanTitle(t) {
    return t.replace(this.TITLE_NOISE, '').replace(this.FEAT, '').replace(this.VERSION, '')
      .replace(/\.mp3\b/gi, '').replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '')
      .replace(/\s{2,}/g, ' ').replace(/[\s\-–—|]+$/, '').trim();
  },

  cleanArtist(a) {
    const r = a.trim().replace(this.ARTIST_NOISE, '');
    // «A, B & C» — LRCLIB обычно знает трек под первым исполнителем
    const low = r.toLowerCase();
    let cut = -1;
    for (const n of [', ', ' & ', ' x ', ' feat', ' ft.']) {
      const i = low.indexOf(n);
      if (i > 0 && (cut < 0 || i < cut)) cut = i;
    }
    return (cut > 0 ? r.slice(0, cut) : r).trim();
  },

  dash(t) {
    for (const d of [' - ', ' – ', ' — ']) { const i = t.indexOf(d); if (i >= 0) return i; }
    return -1;
  },

  isVersion(t) { this.VERSION.lastIndex = 0; return this.VERSION.test(t); },

  // Что показывать в шапке: исполнитель и название без мусора
  guess(t) {
    const raw = t.title || '';
    const d = this.dash(raw);
    const artist = (t.publisher_metadata && t.publisher_metadata.artist) || (t.user && t.user.username) || '';
    if (d > 0) return { artist: this.cleanArtist(raw.slice(0, d)), title: this.cleanTitle(raw.slice(d + 3)) || raw };
    return { artist: this.cleanArtist(artist), title: this.cleanTitle(raw) || raw };
  },

  // LRCLIB под нагрузкой иногда отвечает 503 — одна-две повторные попытки почти всегда проходят
  async request(url, tries = 3) {
    for (let i = 1; ; i++) {
      try { return await this.requestOnce(url); } catch (e) {
        if (i >= tries || e.status && e.status < 500) throw e;
        await new Promise((r) => setTimeout(r, 400 * i));
      }
    }
  },

  async requestOnce(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.REQUEST_MS); // срок на весь ответ, вместе с телом
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (r.status === 404) return null;
      if (!r.ok) throw Object.assign(new Error('LRCLIB ответил ' + r.status), { status: r.status });
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('LRCLIB не ответил за 9 с');
      throw e;
    } finally { clearTimeout(timer); }
  },

  // → { status: 'found'|'instrumental'|'not_found'|'error', lines, synced, source, scale }
  async get(t) {
    if (this.manual.has(t.id)) return this.manual.get(t.id);
    const durMs = t.full_duration || t.duration || 0;
    const key = `${t.id}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const f = this.failed.get(key);
    if (f && Date.now() - f.at < (f.res.status === 'error' ? this.ERROR_RETRY_MS : this.RETRY_MS)) return f.res;

    let res;
    try {
      res = await this.lookup(t, durMs);
    } catch (e) {
      console.warn('[Lyrics]', e);
      res = { status: 'error', lines: [], error: e.message };
    }
    if (res.status === 'found' || res.status === 'instrumental') {
      this.cache.set(key, res);
      this.failed.delete(key);
    } else this.failed.set(key, { res, at: Date.now() });
    return res;
  },

  async lookup(t, durMs) {
    const raw = t.title || '';
    const version = this.isVersion(raw);
    const title = this.cleanTitle(raw);
    const artist = this.cleanArtist((t.publisher_metadata && t.publisher_metadata.artist) || (t.user && t.user.username) || '');
    // В SoundCloud исполнитель — это чаще имя канала, а настоящий сидит в названии
    // через тире: «Artist - Song». Такое разбиение пробуем первым.
    const cands = [];
    const d = this.dash(title);
    if (d > 0) cands.push([this.cleanArtist(title.slice(0, d)), this.cleanTitle(title.slice(d + 3))]);
    cands.push([artist, title]);

    const durSec = durMs > 0 ? Math.round(durMs / 1000) : 0;
    let lastErr = null;
    // упавший запрос не рушит весь поиск — пробуем остальные варианты
    const attempt = async (fn) => { try { return await fn(); } catch (e) { lastErr = e; return null; } };
    for (const [a, ti] of cands) {
      if (!ti) continue;
      if (a && !version) {
        const exact = await attempt(() => this.request(`${this.API}get?` + new URLSearchParams({ artist_name: a, track_name: ti, ...(durSec ? { duration: durSec } : {}) })));
        const r = exact && this.parse(exact, durMs);
        if (r) return r;
      }
      const list = await attempt(() => this.request(`${this.API}search?q=` + encodeURIComponent(a ? `${a} ${ti}` : ti)));
      const r = Array.isArray(list) && this.best(list, durSec, durMs, version);
      if (r) return r;
    }
    if (lastErr) throw lastErr; // не нашли и были ошибки сети — это «ошибка», а не «нет текста»
    return { status: 'not_found', lines: [] };
  },

  // Ручной поиск: любая строка запроса, длительность не проверяем, но берём ближайшую
  async search(t, query) {
    const durMs = t.full_duration || t.duration || 0;
    const list = await this.request(`${this.API}search?q=` + encodeURIComponent(query));
    const res = (Array.isArray(list) && this.best(list, Math.round(durMs / 1000), durMs, true)) || { status: 'not_found', lines: [] };
    if (res.status === 'found') this.manual.set(t.id, res);
    return res;
  },

  // Из выдачи — синхронный текст с ближайшей длительностью. Сильно другая длительность —
  // почти наверняка другая версия (ремикс, live), и тайминги поплывут: лучше ничего.
  best(items, durSec, durMs, anyDuration) {
    let best = null, bestScore = Infinity;
    for (const it of items) {
      const synced = !!(it.syncedLyrics && it.syncedLyrics.trim());
      const plain = !!(it.plainLyrics && it.plainLyrics.trim());
      if (!synced && !plain && !it.instrumental) continue;
      const diff = durSec && it.duration ? Math.abs(it.duration - durSec) : 0;
      if (!anyDuration && durSec && diff > 8) continue;
      const score = (anyDuration ? diff / 20 : diff) + (synced ? 0 : 30) + (it.instrumental ? 50 : 0);
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best ? this.parse(best, durMs) : null;
  },

  parse(it, durMs) {
    if (it.instrumental) return { status: 'instrumental', lines: [], source: it };
    const source = { artist: it.artistName, title: it.trackName };
    // speed up / slowed: растягиваем время текста под длину нашего трека
    const scale = durMs && it.duration && Math.abs(it.duration * 1000 - durMs) > 4000 ? durMs / (it.duration * 1000) : 1;
    if (it.syncedLyrics && it.syncedLyrics.trim()) {
      const lines = this.parseLrc(it.syncedLyrics, scale);
      if (lines.length) return { status: 'found', lines, synced: true, source, scale };
    }
    if (it.plainLyrics && it.plainLyrics.trim()) {
      const lines = this.spread(it.plainLyrics, durMs || (it.duration || 0) * 1000);
      if (lines.length) return { status: 'found', lines, synced: false, source, scale: 1 };
    }
    return null;
  },

  TIME_TAG: /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/y,
  WORD_TAG: /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g,

  ms(m, s, frac) {
    // ".5" — полсекунды, ".05" — 50 мс, ".005" — 5 мс: длина дроби важна
    const f = frac ? +frac * (frac.length === 1 ? 100 : frac.length === 2 ? 10 : 1) : 0;
    return +m * 60000 + +s * 1000 + f;
  },

  // Несколько меток на строку (припев на несколько мест), пустая строка — проигрыш:
  // её оставляем, по ней гасится прошлая строка, а не висит весь проигрыш
  parseLrc(lrc, scale = 1) {
    let lines = [];
    let offset = 0;
    for (const raw of lrc.split(/\r?\n/)) {
      const row = raw.trim();
      const om = row.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
      if (om) { offset = +om[1]; continue; } // положительный offset — «текст раньше»
      const times = [];
      let end = 0, m;
      this.TIME_TAG.lastIndex = 0;
      while ((m = this.TIME_TAG.exec(row))) { times.push(this.ms(m[1], m[2], m[3])); end = this.TIME_TAG.lastIndex; }
      if (!times.length) continue;
      const text = row.slice(end).trim();
      // пословные метки абсолютные — годятся только строке с одной меткой
      const exact = times.length === 1 ? this.exactWords(text, times[0], offset) : null;
      if (exact) lines.push(exact);
      else {
        const clean = text.replace(this.WORD_TAG, '').replace(/\s{2,}/g, ' ').trim();
        for (const tm of times) lines.push({ time: Math.max(0, tm - offset), text: clean, words: null });
      }
    }
    lines.sort((a, b) => a.time - b.time);
    while (lines.length && !lines[lines.length - 1].text) lines.pop();
    lines = this.timeWords(lines);
    if (scale !== 1) {
      for (const l of lines) {
        l.time *= scale;
        for (const w of l.words || []) { w.start *= scale; w.end *= scale; }
      }
    }
    return lines;
  },

  exactWords(raw, lineTime, offset) {
    const tags = [...raw.matchAll(this.WORD_TAG)];
    if (!tags.length) return null;
    const chunks = [];
    const before = raw.slice(0, tags[0].index).trim();
    if (before) chunks.push([lineTime, before]);
    tags.forEach((m, i) => {
      const stop = i + 1 < tags.length ? tags[i + 1].index : raw.length;
      chunks.push([this.ms(m[1], m[2], m[3]), raw.slice(m.index + m[0].length, stop)]);
    });
    let text = '';
    const words = [];
    let endMark = -1;
    chunks.forEach(([tm, chunk], i) => {
      chunk = chunk.trim();
      const time = Math.max(0, tm - offset);
      if (!chunk) { if (i === chunks.length - 1) endMark = time; return; }
      // в одном куске может быть несколько слов — делим его время по слогам
      const parts = chunk.split(/\s+/);
      const chunkEnd = i + 1 < chunks.length ? Math.max(0, chunks[i + 1][0] - offset) : -1;
      const total = parts.reduce((s, p) => s + this.syllables(p), 0);
      const span = chunkEnd > time ? chunkEnd - time : total / this.DEFAULT_RATE * 1000;
      let done = 0;
      for (const p of parts) {
        if (text) text += ' ';
        const from = text.length;
        text += p;
        const start = time + span * done / total;
        done += this.syllables(p);
        words.push({ from, to: text.length, start, end: time + span * done / total, exact: true });
      }
    });
    if (!words.length) return null;
    // последнее слово без закрывающей метки тянем по темпу, а не до следующей строки
    const last = words[words.length - 1];
    if (endMark > last.start) last.end = endMark;
    return { time: Math.max(0, lineTime - offset), text, words };
  },

  // Оценка времени слов, когда LRC даёт только начало строки. Темп местный: сколько слогов
  // в секунду поют соседние строки (верхняя четверть окна — после паузы отношение занижено).
  timeWords(lines) {
    const n = lines.length;
    const syll = [], gap = [], rate = [];
    for (let i = 0; i < n; i++) {
      syll[i] = this.weight(lines[i].text);
      gap[i] = i + 1 < n ? lines[i + 1].time - lines[i].time : 5000;
      rate[i] = syll[i] > 0 && gap[i] >= 600 && gap[i] <= 10000 ? syll[i] / (gap[i] / 1000) : NaN;
    }
    return lines.map((l, i) => {
      if (l.words) return l;
      if (!l.text) return { ...l, words: [] };
      const local = this.localRate(rate, i);
      let sing = syll[i] / local * 1000 * 1.08;
      // проигрыш обычно отмечают пустой строкой; если её нет, а до следующей пара секунд —
      // строку почти наверняка тянут
      const held = i + 1 < n && lines[i + 1].text && gap[i] <= 7000;
      if (held) sing = Math.max(sing, gap[i] * 0.6);
      const span = Math.max(Math.min(gap[i], 600), Math.min(gap[i] * 0.97, sing));
      return { ...l, words: this.spreadWords(l.text, l.time, span) };
    });
  },

  localRate(rate, i) {
    const win = [];
    for (let k = Math.max(0, i - 4); k <= Math.min(rate.length - 1, i + 4); k++) if (!isNaN(rate[k])) win.push(rate[k]);
    if (!win.length) return this.DEFAULT_RATE;
    win.sort((a, b) => a - b);
    const upper = win[Math.min(win.length - 1, Math.floor(win.length * 0.75))];
    return Math.max(this.MIN_RATE, Math.min(this.MAX_RATE, upper));
  },

  spreadWords(text, start, span) {
    const ranges = [...text.matchAll(/\S+/g)].map((m) => [m.index, m.index + m[0].length]);
    const weights = [], pauses = [];
    let total = 0;
    ranges.forEach(([a, b], k) => {
      const w = text.slice(a, b);
      weights[k] = this.syllables(w);
      // после запятой/точки певец берёт дыхание — оставляем полслога
      pauses[k] = k + 1 < ranges.length && this.endsWithPause(w) ? 0.5 : 0;
      total += weights[k] + pauses[k];
    });
    let done = 0;
    return ranges.map(([a, b], k) => {
      const from = start + span * done / total;
      done += weights[k];
      const to = start + span * done / total;
      done += pauses[k];
      return { from: a, to: b, start: from, end: to, exact: false };
    });
  },

  weight(text) {
    let t = 0;
    for (const w of text.trim().split(/\s+/)) if (w) t += this.syllables(w) + (this.endsWithPause(w) ? 0.5 : 0);
    return t;
  },

  // Слоги по группам гласных (латиница и кириллица); иероглиф/кана/хангыль — слог на знак
  syllables(word) {
    let count = 0, vowel = false;
    for (const ch of word.toLowerCase()) {
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)) { count++; vowel = false; continue; }
      const isV = 'aeiouyаеёиоуыэюяіїєäöüéèêëáàâíìîóòôúùûœæøåąęő'.includes(ch);
      if (isV && !vowel) count++;
      vowel = isV;
    }
    return Math.max(1, count);
  },

  endsWithPause: (w) => ',.;:!?…—'.includes(w[w.length - 1]),

  // Голый текст без времени: строки равномерно, отступив вступление и концовку
  spread(plain, durMs) {
    const rows = plain.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    if (!rows.length) return [];
    const dur = durMs > 0 ? durMs : rows.length * 3500;
    const start = dur * 0.08, span = dur * 0.84;
    return this.timeWords(rows.map((text, i) => ({ time: start + span * i / rows.length, text, words: null })));
  },
};
