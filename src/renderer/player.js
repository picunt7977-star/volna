// Плеер: очередь, HLS, анализатор для анимаций, волноформа-перемотка, MPRIS через MediaSession
const Player = {
  audio: null,
  hls: null,
  queue: [],
  index: -1,
  source: 'list',      // list | wave
  cur: null,
  loadId: 0,
  errors: 0,
  wf: null,            // сэмплы волноформы
  analyser: null,
  freq: null,
  energy: 0,

  init() {
    const a = (this.audio = $('#audio'));
    a.volume = Store.data.volume;
    a.addEventListener('timeupdate', () => this.onTime());
    a.addEventListener('play', () => this.onPlayState());
    a.addEventListener('pause', () => this.onPlayState());
    a.addEventListener('ended', () => this.onEnded());
    a.addEventListener('error', () => this.onError());
    a.addEventListener('loadedmetadata', () => this.onTime());

    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => this.toggle(true));
    ms.setActionHandler('pause', () => this.toggle(false));
    ms.setActionHandler('nexttrack', () => this.next(true));
    ms.setActionHandler('previoustrack', () => this.prev());
    ms.setActionHandler('seekto', (d) => { a.currentTime = d.seekTime; });
    ms.setActionHandler('seekforward', () => { a.currentTime += 10; });
    ms.setActionHandler('seekbackward', () => { a.currentTime -= 10; });
  },

  // Web Audio подключаем лениво: после первого запуска
  ensureAnalyser() {
    if (this.analyser) return;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(this.audio);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.8;
      src.connect(an);
      an.connect(ctx.destination);
      this.ctx = ctx;
      this.analyser = an;
      this.freq = new Uint8Array(an.frequencyBinCount);
    } catch (e) { console.warn('analyser', e); }
  },

  // Сглаженная «громкость» с упором на бас — для анимаций
  sampleEnergy() {
    if (!this.analyser || this.audio.paused) { this.energy *= 0.93; return this.energy; }
    this.analyser.getByteFrequencyData(this.freq);
    let s = 0;
    const n = 48;
    for (let i = 2; i < n; i++) s += this.freq[i] * (1.4 - i / n);
    const e = Math.min(1, s / (n * 255) * 1.6);
    this.energy += (e - this.energy) * (e > this.energy ? 0.35 : 0.08);
    return this.energy;
  },

  async playList(tracks, i, source = 'list') {
    if (source !== 'wave' && Wave.active) Wave.stop();
    this.source = source;
    let list = tracks.filter(SC.playable);
    const start = tracks[i];
    if (Store.data.shuffle && source === 'list') {
      list = [start, ...shuffled(list.filter((t) => t !== start))];
      i = 0;
    } else {
      i = Math.max(0, list.indexOf(start));
    }
    this.queue = list;
    this.index = i;
    await this.load(list[i]);
  },

  async startWave(t) {
    this.source = 'wave';
    this.queue = [t];
    this.index = 0;
    await this.load(t);
  },

  async load(track, autoplay = true) {
    if (!track) return;
    const id = ++this.loadId;
    this.ensureAnalyser();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    this.cur = track;
    this.wf = null;
    UI.onTrack(track);
    let s;
    try {
      s = await SC.stream(track);
    } catch (e) {
      if (id !== this.loadId) return;
      toast(`«${track.title}» не играет: ${e.message}`, 'err');
      return this.skipBroken();
    }
    if (id !== this.loadId) return;
    this.cur = s.track;
    if (this.queue[this.index] && this.queue[this.index].id === s.track.id) this.queue[this.index] = s.track;
    if (s.snipped) toast('Это превью на 30 секунд (трек для Go+)');

    if (this.hls) { this.hls.destroy(); this.hls = null; }
    const a = this.audio;
    if (s.hls && window.Hls && Hls.isSupported()) {
      const hls = (this.hls = new Hls({ enableWorker: false, maxBufferLength: 60 }));
      hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal && id === this.loadId) this.onError(); });
      hls.loadSource(s.url);
      hls.attachMedia(a);
    } else {
      a.src = s.url;
    }
    if (autoplay) a.play().catch(() => {});
    this.errors = 0;

    Store.addHistory(s.track);
    if (this.source === 'wave') Store.addSeen(s.track.id);
    this.setMediaSession(s.track);
    UI.onTrack(s.track);
    SC.waveform(s.track).then((wf) => { if (id === this.loadId) { this.wf = wf; UI.drawSeek(); } });
  },

  skipBroken() {
    if (++this.errors > 5) { this.errors = 0; toast('Слишком много ошибок подряд — остановился', 'err'); return; }
    setTimeout(() => this.next(false), 800);
  },

  onError() {
    if (!this.cur) return;
    toast('Поток оборвался, переключаю…', 'err');
    this.skipBroken();
  },

  toggle(force) {
    const a = this.audio;
    if (!this.cur) {
      // ничего не выбрано — включаем волну
      Wave.start();
      return;
    }
    const play = force != null ? force : a.paused;
    if (play) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      a.play().catch(() => {});
    } else a.pause();
  },

  progress() {
    const a = this.audio;
    return a.duration ? a.currentTime / a.duration : 0;
  },

  async next(byUser = true) {
    if (this.source === 'wave' && this.cur) {
      const p = this.progress();
      if (byUser && p < 0.4 && this.audio.currentTime < 30) Wave.feedback(this.cur, 'skip');
      else if (!byUser || p > 0.8) Wave.feedback(this.cur, 'finish');
    }
    if (this.index < this.queue.length - 1) {
      this.index++;
      return this.load(this.queue[this.index]);
    }
    if (this.source === 'wave' && Wave.active) {
      const t = await Wave.next();
      if (!t) return toast('Волна выдохлась — попробуй другой режим');
      this.queue.push(t);
      this.index = this.queue.length - 1;
      return this.load(t);
    }
    if (Store.data.repeat === 'all' && this.queue.length) {
      this.index = 0;
      return this.load(this.queue[0]);
    }
    if (!byUser) this.audio.pause();
  },

  prev() {
    if (this.audio.currentTime > 4 || this.index <= 0) { this.audio.currentTime = 0; return; }
    this.index--;
    this.load(this.queue[this.index]);
  },

  onEnded() {
    if (Store.data.repeat === 'one') { this.audio.currentTime = 0; this.audio.play(); return; }
    this.next(false);
  },

  onTime() {
    UI.onTime(this.audio.currentTime, this.audio.duration);
    const ms = navigator.mediaSession;
    if (ms.setPositionState && isFinite(this.audio.duration)) {
      try { ms.setPositionState({ duration: this.audio.duration, position: this.audio.currentTime, playbackRate: 1 }); } catch {}
    }
  },

  onPlayState() {
    navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
    UI.onPlayState(!this.audio.paused);
  },

  setMediaSession(t) {
    const art = SC.art(t, 't500x500');
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: (t.user && t.user.username) || '',
      album: this.source === 'wave' ? 'Моя волна' : 'SoundCloud',
      artwork: art ? [{ src: art, sizes: '500x500', type: 'image/jpeg' }] : [],
    });
  },

  setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    this.audio.volume = v;
    this.audio.muted = false;
    Store.data.volume = v;
    Store.save();
    UI.onVolume();
  },
};
