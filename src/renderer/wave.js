// «Моя волна» — бесконечный поток, который подстраивается под лайки, дослушивания и пропуски.
//
// Как работает:
//  * зёрна — твои лайки (свежие весят больше), история и то, что ты дослушал/лайкнул прямо в этой волне;
//  * от случайного зерна берём «похожие» (/tracks/{id}/related), выкидываем уже звучавшее,
//    дизлайкнутое и артистов, которых ты часто скипаешь;
//  * оставшееся оцениваем (немного рандома + популярность + штрафы) и подкидываем в очередь;
//  * дослушал/лайкнул → трек становится сильным зерном; скип в первые 30 с → штраф артисту;
//    «не нравится» → трек больше не всплывёт, артисту большой штраф.
const Wave = {
  active: false,
  mode: 'mix',
  label: null,           // «Волна по треку X» и т.п.
  upcoming: [],
  seeds: [],
  seedsAt: 0,
  likedArtists: new Set(),
  likedTracks: [],
  session: [],           // зёрна из текущей сессии
  pinned: null,          // явные зёрна (волна по треку/артисту)
  filling: null,
  RECENT_LIKES: 40,
  allLikes: [],
  mood: null,            // id настроения или null — «любое»
  moodSeeds: {},         // id → { at, tracks } — кэш треков по настроению

  // Настроение: запросы для поиска «эталонных» треков (зёрна) и слова, по которым
  // узнаём трек нужного настроения в жанре/тегах/названии (бонус в оценке, отбор лайков)
  moods: {
    sad: { name: 'Грустное', hint: 'Медленное и меланхоличное', c: ['#4c6ef5', '#1b2550'], q: ['грустный рэп', 'sad songs', 'грустные песни', 'sad lofi'],
      kw: /sad|грус|печал|melanchol|depress|lonely|одино|сл[её]з|cry|тоск|broken|heartbreak|emo\b|pain|боль/i },
    happy: { name: 'Весёлое', hint: 'Лёгкое и светлое', c: ['#ffd43b', '#f76707'], q: ['весёлые песни', 'happy songs', 'feel good', 'позитив'],
      kw: /happy|вес[её]л|\bfun\b|feel ?good|summer|лет[оа]|позитив|smile|улыб|sunshine/i },
    energy: { name: 'Энергичное', hint: 'Быстрое и громкое', c: ['#ff3b5c', '#7a0019'], q: ['phonk', 'энергичная музыка', 'hype', 'drill'],
      kw: /phonk|drill|hype|energy|энерг|hard|rage|bass|workout|gym|кач/i },
    chill: { name: 'Спокойное', hint: 'Тихое, чтобы расслабиться', c: ['#20c997', '#0b3d3a'], q: ['chill', 'спокойная музыка', 'chillhop', 'lofi chill'],
      kw: /chill|lo-?fi|спокой|relax|calm|ambient|soft|мягк|sleep|сон/i },
    focus: { name: 'Для учёбы', hint: 'Ровный фон, чтобы сосредоточиться', c: ['#a259ff', '#2b0d55'], q: ['lofi study', 'study beats', 'ambient focus', 'музыка для учебы'],
      kw: /study|focus|lo-?fi|ambient|instrumental|piano|уч[её]б|concentrat|beats/i },
    love: { name: 'Про любовь', hint: 'Песни о чувствах', c: ['#ff6ec7', '#6a0f4b'], q: ['про любовь', 'love songs', 'romantic', 'r&b love'],
      kw: /love|люб|romantic|романт|r&b|rnb|heart|сердц|поцел|kiss|влюб/i },
    night: { name: 'Ночное', hint: 'Атмосферное для позднего вечера', c: ['#3d5afe', '#0a0a2e'], q: ['night drive', 'ночной вайб', 'synthwave', 'dark night'],
      kw: /night|ноч|midnight|drive|synthwave|dark|т[её]мн|moon|лун|neon/i },
    party: { name: 'Для вечеринки', hint: 'Танцевальное', c: ['#ff922b', '#c2255c'], q: ['вечеринка', 'party hits', 'club', 'дискотека'],
      kw: /party|вечерин|club|клуб|disco|диско|dance|танц|house|tusa|туса/i },
  },

  modes: {
    mix: { name: 'Как обычно', hint: 'Знакомое вперемешку с новым' },
    fav: { name: 'Любимое', hint: 'Больше твоих лайков' },
    discover: { name: 'Незнакомое', hint: 'Только новые для тебя артисты' },
    fresh: { name: 'Свежее', hint: 'Треки последних полутора лет' },
  },

  // opts.mood: id настроения / null — «любое»; не передан — остаётся прежнее
  // (волна по треку/артисту/плейлисту настроение сбрасывает)
  async start(mode = this.mode, opts = {}) {
    this.mode = mode;
    this.mood = 'mood' in opts ? opts.mood : opts.seeds ? null : this.mood;
    if (this.mood && !this.moods[this.mood]) this.mood = null;
    Store.data.waveMode = mode;
    Store.data.waveMood = this.mood;
    Store.save();
    this.upcoming = [];
    this.session = [];
    this.pinned = opts.seeds && opts.seeds.length ? opts.seeds : null;
    this.label = opts.label || null;
    this.active = true;
    document.dispatchEvent(new Event('wave-busy'));
    try {
      await this.loadSeeds();
      if (this.mood && !this.pinned) this.pinned = await this.loadMood(this.mood);
      await this.refill(3);
      const t = this.upcoming.shift();
      if (!t) throw new Error(SC.me
        ? 'Волне не за что зацепиться — лайкни пару треков'
        : 'Войди через SoundCloud или включи пару треков из поиска — волна оттолкнётся от них');
      await Player.startWave(t);
      this.refill();
    } catch (e) {
      this.active = false;
      toast(e.message, 'err');
    } finally {
      document.dispatchEvent(new Event('wave-changed'));
    }
  },

  stop() {
    this.active = false;
    this.upcoming = [];
    document.dispatchEvent(new Event('wave-changed'));
  },

  async loadSeeds(force = false) {
    if (!force && this.seeds.length && Date.now() - this.seedsAt < 10 * 60e3) return;
    // Подбор держится за свежий вкус: зёрна — последние ~40 лайков (старые стили не всплывают).
    // Артисты — из всех лайков: «Незнакомое» должно быть действительно незнакомым.
    const all = Store.data.likes.filter(SC.playable);
    const likes = all.slice(0, this.RECENT_LIKES);
    this.likedTracks = likes;
    this.allLikes = all;
    this.likedArtists = new Set(all.map((t) => t.user_id || (t.user && t.user.id)));
    const hist = Store.data.history.slice(0, 60);
    const seen = new Set();
    this.seeds = [...likes, ...hist].filter((t) => !seen.has(t.id) && seen.add(t.id) && !Store.disliked.has(t.id));
    this.seedsAt = Date.now();
  },

  // Трек подходит под настроение по жанру, тегам или названию
  moodMatch(t, mood = this.mood) {
    const m = mood && this.moods[mood];
    return !!m && m.kw.test(`${t.genre || ''} ${t.tag_list || ''} ${t.title || ''}`);
  },

  // Зёрна настроения: твои подходящие лайки + популярное по запросам настроения
  async loadMood(id) {
    const m = this.moods[id];
    const cached = this.moodSeeds[id];
    let found = cached && Date.now() - cached.at < 30 * 60e3 ? cached.tracks : null;
    if (!found) {
      const res = await Promise.all(m.q.map((q) =>
        SC.api('/search/tracks', { q, limit: 30 }).then((r) => r.collection || []).catch(() => [])));
      // из каждого запроса — самое слушаемое, чтобы зёрна были «эталонными»
      // из каждого запроса — самое слушаемое; сперва то, что по тегам/названию и правда
      // про это настроение (поиск SoundCloud любит подсовывать мусор)
      const pop = (a, b) => (b.playback_count || 0) - (a.playback_count || 0);
      found = res.flatMap((list) => {
        const ok = list.filter(SC.playable);
        const hit = ok.filter((t) => this.moodMatch(t, id)).sort(pop);
        return [...hit, ...ok.filter((t) => !hit.includes(t)).sort(pop)].slice(0, Math.max(6, Math.min(12, hit.length)));
      });
      this.moodSeeds[id] = { at: Date.now(), tracks: found };
    }
    // В стиле твоих лайков: сперва лайки этого настроения (свежие — в приоритете),
    // если их мало — просто свежие лайки как «якорь вкуса»; общий поиск — в меньшинстве
    const mine = this.allLikes.slice(0, 200).filter((t) => this.moodMatch(t, id)).slice(0, 20);
    const anchors = mine.length >= 6 ? [] : shuffled(this.likedTracks).slice(0, 10 - mine.length);
    const seen = new Set();
    const all = [...mine, ...anchors, ...shuffled(found).slice(0, mine.length >= 6 ? 8 : 14)]
      .filter((t) => !seen.has(t.id) && seen.add(t.id) && !Store.disliked.has(t.id));
    if (!all.length) throw new Error('Не нашёл треков под это настроение — проверь интернет/VPN');
    return all.slice(0, 40);
  },

  // Взвешенный случайный выбор зерна
  pickSeed() {
    const pool = [];
    this.session.slice(-12).forEach((t) => pool.push([t, 5]));
    (this.pinned || []).forEach((t) => pool.push([t, 4]));
    if (!this.pinned || this.session.length > 4) {
      // с настроением — только те лайки/история, что ему подходят, иначе волну уносит
      this.seeds.forEach((t, i) => {
        if (!this.mood || this.moodMatch(t)) pool.push([t, 1.6 / (1 + i / 25)]);
      });
    }
    if (!pool.length) return null;
    let r = Math.random() * pool.reduce((s, [, w]) => s + w, 0);
    for (const [t, w] of pool) if ((r -= w) <= 0) return t;
    return pool[pool.length - 1][0];
  },

  ok(t, relaxed) {
    if (!SC.playable(t) || t.policy === 'SNIP') return false;
    if (Store.disliked.has(t.id)) return false;
    if (this.upcoming.some((x) => x.id === t.id)) return false;
    if (Player.cur && Player.cur.id === t.id) return false;
    const dur = t.full_duration || t.duration || 0;
    if (dur < 60e3 || dur > 20 * 60e3) return false;
    const pen = Store.data.penalty[t.user_id] || 0;
    if (pen >= 3) return false;
    if (relaxed) return !Player.queue.some((x) => x.id === t.id);
    if (Store.seen.has(t.id)) return false;
    if (this.mode === 'discover' && this.likedArtists.has(t.user_id)) return false;
    if (this.mode === 'fresh') {
      const d = new Date(t.display_date || t.created_at).getTime();
      if (!d || Date.now() - d > 540 * 864e5) return false;
    }
    return true;
  },

  score(t) {
    const pen = Store.data.penalty[t.user_id] || 0;
    const sameArtistInQueue = this.upcoming.filter((x) => x.user_id === t.user_id).length;
    return Math.random() * 1.2
      + Math.log10(1 + (t.likes_count || 0)) * 0.12
      - pen * 0.6
      - sameArtistInQueue * 0.8
      + (this.mode === 'mix' && this.likedArtists.has(t.user_id) ? 0.15 : 0)
      + (this.mood && this.moodMatch(t) ? 0.9 : 0)
      + (this.mood && this.likedArtists.has(t.user_id) ? 0.3 : 0);
  },

  refill(min = 5) {
    if (this.filling) return this.filling;
    this.filling = (async () => {
      let tries = 0;
      while (this.active && this.upcoming.length < min && tries++ < 10) {
        // «Любимое» — иногда возвращаем трек прямо из лайков
        if (this.mode === 'fav' && this.likedTracks.length && Math.random() < 0.4) {
          const cand = shuffled(this.likedTracks).find((t) =>
            this.ok(t, true) && !this.recentlyPlayed(t.id) && (!this.mood || this.moodMatch(t)));
          if (cand) { this.upcoming.push(cand); continue; }
        }
        const seed = this.pickSeed();
        if (!seed) break;
        let rel;
        try { rel = await SC.api(`/tracks/${seed.id}/related`, { limit: 40 }); } catch { continue; }
        const all = (rel && rel.collection) || [];
        let cands = all.filter((t) => this.ok(t, false));
        if (!cands.length && tries > 5) cands = all.filter((t) => this.ok(t, true)); // строгий режим всё отсеял
        cands = cands.map((t) => [t, this.score(t)]).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0]);
        for (const t of shuffled(cands).slice(0, 2)) this.upcoming.push(t);
      }
      document.dispatchEvent(new Event('wave-changed'));
    })().finally(() => { this.filling = null; });
    return this.filling;
  },

  recentlyPlayed(id) {
    return Store.data.history.slice(0, 40).some((x) => x.id === id);
  },

  async next() {
    if (!this.upcoming.length) await this.refill(2);
    const t = this.upcoming.shift();
    this.refill();
    document.dispatchEvent(new Event('wave-changed'));
    return t || null;
  },

  // kind: finish | skip | like | dislike
  feedback(t, kind) {
    if (!t) return;
    const p = Store.data.penalty;
    const uid = t.user_id || (t.user && t.user.id);
    if (kind === 'finish' || kind === 'like') {
      this.session.push(t);
      if (p[uid]) p[uid] = Math.max(0, p[uid] - 0.5);
    } else if (kind === 'skip') {
      p[uid] = (p[uid] || 0) + 0.35;
    } else if (kind === 'dislike') {
      Store.disliked.add(t.id);
      p[uid] = (p[uid] || 0) + 1.5;
      this.upcoming = this.upcoming.filter((x) => x.user_id !== uid || p[uid] < 3);
    }
    Store.save();
  },
};
