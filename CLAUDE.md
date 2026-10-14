# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Volna — неофициальный клиент SoundCloud с «Моей волной» (бесконечный подбор треков). Две оболочки над **одним** интерфейсом: Electron для Linux и Capacitor-приложение для Android. Комментарии, тексты интерфейса и общение — по-русски.

## Команды

ПК (Electron):
- `npm start` или `volna` (`~/.local/bin/volna`) — запуск.
- `VOLNA_PROFILE=/путь` — отдельный профиль (не трогать `~/.config/Volna` пользователя), `VOLNA_HIDDEN=1` — окно offscreen, без показа (для снимков `capturePage`), `VOLNA_PROXY=direct|socks5://…` — ручной выбор прокси.
- Лог ошибок API: `~/.config/Volna/volna.log`.

Android (`mobile/`):
- `cd mobile && npm run install-phone` — собрать `www/`, `cap sync`, `gradlew assembleDebug`, поставить по adb и запустить. `npm run apk` — только APK (`mobile/android/app/build/outputs/apk/debug/app-debug.apk`).
- `node mobile/build.mjs` — только пересобрать `mobile/www/` (папку руками не править — она перезаписывается).
- Нужен `ANDROID_HOME=~/Android/Sdk` (путь также в `mobile/android/local.properties`). Платформа 36 и build-tools 36.0.0 распакованы вручную: новый cmdline-tools — это «Android CLI», его `sdkmanager` зависает на самозагрузке.

Тестов и линтера нет. Проверка синтаксиса — `node --check файл.js`. Проверка вёрстки — Electron offscreen-окно 412×900, грузящее `mobile/www/index.html` с заглушкой `capacitor.js`, и `capturePage()`. На телефоне — DevTools-протокол WebView: `adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof app.volna.mobile)`, затем `Runtime.evaluate` через `ws://localhost:9333/devtools/page/…` (debug-сборка).

## Архитектура

**Общий интерфейс — `src/renderer/`**, обычные скрипты без сборщика и модулей, порядок подключения важен (`index.html`): `icons.js` → `covers.js` → `util.js` (`h()`, `Store`, `toast`) → `sc.js` (обёртка api-v2: `SC.api`, `SC.stream`, `SC.hydrate`) → `lyrics.js` (LRCLIB, караоке) → `wave.js` (алгоритм волны) → `player.js` → `ui.js`. `UI.init()` стартует на `DOMContentLoaded`, чтобы мобильные правки успели подмениться.

Интерфейс ничего не знает о платформе: весь доступ наружу — через объект **`window.volna`** (`api`, `login`, `loginToken`, `logout`, `storeLoad/Save`, `openExternal`, `onAuthChanged`, …). Его реализуют:
- ПК: `src/preload.js` (IPC) + `src/main.js` (главный процесс).
- Android: `mobile/web/bridge.js` поверх нативного плагина `VolnaPlugin.java`, `Preferences` и `MediaSession`; там же подмена `navigator.mediaSession` → уведомление в шторке.

Меняешь контракт `window.volna` — меняй обе реализации.

**Работа с SoundCloud (одинаковая логика в `main.js` и `bridge.js`):**
- `client_id` не хардкодится и не скачивается заранее: невидимая вкладка открывает soundcloud.com, id ловится из запросов самого сайта к `api-v2`.
- Токен — кука `oauth_token` после входа на сайте или вставленный вручную (`TOKEN_RE`).
- Запись (PUT/POST) требует куку DataDome «не бот»: при 403 с `captcha-delivery` — освежить куку невидимой вкладкой, потом показать живую капчу. Сейчас лайки в SoundCloud не пишутся (см. «Хранилище»), механизм остался для записи вообще.
- 401/403 на GET → `client_id` протух, обновить и повторить. Разлогин — только на 401 от `/me`.
- Запросы оформляются как запросы сайта (`Origin`/`Referer: https://soundcloud.com`).
- CDN (`*.sndcdn.com`, `lrclib.net`) не даёт CORS для нашего origin: на ПК `onHeadersReceived` дописывает `Access-Control-Allow-Origin: *`, на Android `MainActivity.CorsClient` проксирует эти GET через себя.

**Android-особенности (`mobile/`):**
- Везде **десктопный User-Agent** (`VolnaPlugin.DESKTOP_UA`): с мобильным soundcloud.com уводит на m.soundcloud.com, который не ходит в api-v2, и `client_id` не ловится; кука DataDome тоже привязана к UA.
- `mobile/web/mobile.js` патчит `UI`/`Player` поверх общего кода: нижние вкладки, стек «назад» (кнопка Android), полноэкранный плеер (`#np` — кнопки и волноформа **переносятся** туда из мини-плеера, а не дублируются), бегущая строка, без Web Audio-анализатора (энергия анимаций синтетическая).
- `mobile/web/mobile.css` перекрывает `styles.css`. Десктопное правило `@media (max-width: 1100px)` срабатывает на телефоне и прячет подписи (`.login-btn`, `.acc-meta`, `.nav-item`) — перекрывать с `body.mobile`.
- Отступы под вырезы: CSS-переменные `--safe-area-inset-*`, их ставит плагин SystemBars Capacitor 8.
- Плавность (замерялась через CDP: кадры rAF + `Performance.getMetrics`): на телефоне свой `UI.loop` — не трогать корень документа каждый кадр (`--energy` ставится только на `#hero-play`/`#np-art`, акцент — сразу); `#np` и шторка «Что включим?» всегда в DOM и только сдвигаются трансформом; размытые фоны — картинка 67px в блоке 10% с `blur(4px)`, растянутая `scale(10.5)`, а не `blur(70px)` на весь экран; длинные списки — порциями + `content-visibility: auto`. hover-правила в `styles.css` — только внутри `@media (hover: hover)` (на тач-экране hover «залипает»).
- 120 Гц: `MainActivity.preferHighRefreshRate()`; в энергосбережении Samsung всё равно держит 60.
- Фон: сервис `@capgo/capacitor-media-session` (foreground `mediaPlayback`).

**Волна (`wave.js`):** зёрна — последние `RECENT_LIKES` (40) локальных лайков, история и треки, дослушанные/лайкнутые в текущей сессии; от случайного зерна берутся `/tracks/{id}/related`, фильтруются (`ok`) и оцениваются (`score`). Скип в первые 30 с — штраф артисту, «не нравится» — трек в бан и большой штраф. Режимы (`modes`) и настроения (`moods`: поисковые запросы для эталонных зёрен + регэксп `kw` по жанру/тегам/названию) выбираются в панели «Что включим?» (`UI.openWavePicker`). Настроение работает поверх режима `mix`.

**Хранилище:** `Store.data` (история, `seen`, дизлайки, штрафы, громкость, `accent`, `waveMode`, `waveMood`, лайки) — на ПК `store.json` в userData, на Android — Preferences. Авторизация отдельно (`auth.json` / ключ `auth`).

**Лайки — локальные:** `Store.data.likes` (slim-треки с `liked_at`, новые сверху) — источник правды для `SC.liked`, экрана «Лайки» и волны. `SC.toggleLike` в аккаунт SoundCloud не пишет. `SC.importLikes()` подтягивает лайки из SoundCloud (сам — при первом входе, флаг `likesImported`), снятые в Volna (`unliked`) обратно не возвращает.

## Тонкости

- `h(tag, attrs, …kids)` — текст всегда через `textContent`; `html:` только для статичных иконок/обложек из `icons.js`/`covers.js`. CSS-переменные в `style: {'--x': …}` ставятся через `setProperty`.
- Позицию внутри прокручиваемого блока считать через `getBoundingClientRect()`, не `offsetTop` (тот от `body`, с шапкой — из-за этого текущая строка текста уезжала за экран на телефоне).
- SoundCloud заблокирован в РФ: на ПК `main.js` сам ищет локальный прокси VPN (2080/7890/1080/10808), на телефоне нужен включённый системный VPN. «Не ответил / ERR_NAME_NOT_RESOLVED» чаще всего значит упавший VPN, а не баг.
- Тестовые запуски Electron убивать по PID: `pkill -f` с шаблоном из командной строки убивает и собственную оболочку.
