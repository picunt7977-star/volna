// Обёртка над api-v2 SoundCloud
const SC = {
  me: null,
  liked: new Set(),

  api: (path, query, method) => window.volna.api(path, query, method),

  art(o, size = 't500x500') {
    const u = (o && (o.artwork_url || o.avatar_url || (o.user && o.user.avatar_url))) || '';
    return u ? u.replace(/-(large|t\d+x\d+|crop|small|tiny|badge|mini)(?=\.\w+$)/, '-' + size) : '';
  },

  // Можно ли вообще это проиграть
  playable(t) {
    return !!t && t.kind !== 'playlist' && t.streamable !== false && t.policy !== 'BLOCK';
  },

  slim(t) {
    const u = t.user || {};
    return {
      kind: 'track', id: t.id, title: t.title, duration: t.duration, artwork_url: t.artwork_url,
      permalink_url: t.permalink_url, waveform_url: t.waveform_url, user_id: t.user_id || u.id,
      policy: t.policy, playback_count: t.playback_count, likes_count: t.likes_count,
      created_at: t.created_at, genre: t.genre, tag_list: t.tag_list, full_duration: t.full_duration,
      user: { id: u.id, username: u.username, avatar_url: u.avatar_url, permalink_url: u.permalink_url },
    };
  },

  // В плейлистах/истории треки бывают «огрызками» без media — догружаем пачками по 50
  async hydrate(tracks) {
    const need = [...new Set(tracks.filter((t) => t && !t.media).map((t) => t.id))];
    const full = new Map();
    for (let i = 0; i < need.length; i += 50) {
      try {
        const r = await this.api('/tracks', { ids: need.slice(i, i + 50).join(',') });
        for (const t of Array.isArray(r) ? r : r.collection || []) full.set(t.id, t);
      } catch {}
    }
    return tracks.map((t) => (t && t.media ? t : full.get(t && t.id))).filter(Boolean);
  },

  // Страницы с next_href → один массив
  async paged(path, query, max = 200) {
    const out = [];
    let r = await this.api(path, { linked_partitioning: 1, ...query });
    while (r) {
      out.push(...(r.collection || []));
      if (!r.next_href || out.length >= max) break;
      r = await this.api(r.next_href);
    }
    return out.slice(0, max);
  },

  async loadMe() {
    try { this.me = await this.api('/me'); } catch { this.me = null; }
    return this.me;
  },

  // Лайки живут на устройстве (Store.data.likes, новые сверху). С SoundCloud их можно
  // подгрузить: при первом входе — сами, потом — кнопкой. Лайк в Volna в аккаунт SoundCloud
  // не отправляется.
  async loadLikedIds() {
    this.liked = new Set(Store.data.likes.map((t) => t.id));
    if (this.me && !Store.data.likesImported) this.importLikes(true);
  },

  importing: null,
  importLikes(quiet = false) {
    if (!this.me) { toast('Войди через SoundCloud, чтобы подгрузить лайки'); return Promise.resolve(0); }
    if (this.importing) return this.importing;
    if (!quiet) toast('Подгружаю лайки из SoundCloud…');
    this.importing = (async () => {
      const items = await this.paged(`/users/${this.me.id}/track_likes`, { limit: 50 }, 2000);
      const have = new Set(Store.data.likes.map((t) => t.id));
      const skip = new Set(Store.data.unliked); // убранные в Volna обратно не возвращаем
      const add = items.filter((x) => x.track && !have.has(x.track.id) && !skip.has(x.track.id))
        .map((x) => ({ ...this.slim(x.track), liked_at: Date.parse(x.created_at) || 0 }));
      Store.data.likes = [...Store.data.likes, ...add].sort((a, b) => (b.liked_at || 0) - (a.liked_at || 0));
      Store.data.likesImported = true;
      Store.save();
      this.liked = new Set(Store.data.likes.map((t) => t.id));
      document.dispatchEvent(new CustomEvent('likes-changed', { detail: { imported: add.length } }));
      toast(add.length ? `Подгрузил ${add.length} ${plural(add.length, 'лайк', 'лайка', 'лайков')} из SoundCloud` : 'Новых лайков в SoundCloud нет', 'ok');
      return add.length;
    })().catch((e) => { toast('Не получилось подгрузить лайки: ' + e.message, 'err'); return 0; })
      .finally(() => { this.importing = null; });
    return this.importing;
  },

  async toggleLike(t) {
    const on = !this.liked.has(t.id);
    const d = Store.data;
    d.likes = d.likes.filter((x) => x.id !== t.id);
    d.unliked = d.unliked.filter((id) => id !== t.id);
    if (on) d.likes.unshift({ ...this.slim(t), liked_at: Date.now() });
    else d.unliked.push(t.id);
    on ? this.liked.add(t.id) : this.liked.delete(t.id);
    Store.save();
    document.dispatchEvent(new CustomEvent('likes-changed', { detail: { id: t.id, on } }));
    return on;
  },

  // Ссылка на поток: hq AAC → progressive mp3 → HLS mp3 → прочее
  async stream(t) {
    if (!t.media) [t] = await this.hydrate([t]);
    if (!t) throw new Error('Трек недоступен');
    const list = (t.media.transcodings || []).filter((x) =>
      x.format && !/encrypted/.test(x.format.protocol) && !/ogg|opus/.test(x.format.mime_type));
    const rank = (x) =>
      (x.quality === 'hq' ? 0 : 4) +
      (x.format.protocol === 'progressive' ? 0 : 1) +
      (x.format.mime_type.includes('mpeg') ? 0 : 1) +
      (x.snipped ? 50 : 0);
    list.sort((a, b) => rank(a) - rank(b));
    let lastErr = new Error('Нет доступного потока');
    for (const x of list) {
      try {
        const r = await this.api(x.url, { track_authorization: t.track_authorization });
        if (r && r.url) return { url: r.url, hls: x.format.protocol === 'hls', snipped: !!x.snipped, track: t };
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  },

  async waveform(t) {
    if (!t.waveform_url) return null;
    const url = t.waveform_url.replace(/\.png$/, '.json');
    try {
      const r = await fetch(url);
      const j = await r.json();
      return j.samples && j.samples.length ? { samples: j.samples, height: j.height || 140 } : null;
    } catch { return null; }
  },
};
