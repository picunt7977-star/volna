// Обложки для «Что включим?»: режимы и настроения волны (статичные SVG-строки)
const COVERS = (() => {
  // фон: диагональный градиент + мягкий блик сверху слева
  const cover = (id, c1, c2, art) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="cv-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
<radialGradient id="cv-${id}-hl" cx=".25" cy=".15" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="64" height="64" fill="url(#cv-${id})"/><rect width="64" height="64" fill="url(#cv-${id}-hl)"/>
${art}</svg>`;

  return {
    // --- подбор ---
    mix: cover('mix', '#ff8a2a', '#e8205a', `
<g fill="none" stroke="#fff" stroke-linecap="round" stroke-width="3.6">
<path d="M10 32c5-9 10-9 15 0s10 9 15 0 10-9 14-4"/>
<path d="M10 43c5-6 10-6 15 0s10 6 15 0 10-6 14-3" opacity=".5"/>
<path d="M10 21c5-6 10-6 15 0s10 6 15 0 10-6 14-3" opacity=".5"/></g>`),

    fav: cover('fav', '#ff6b9a', '#9c1240', `
<path d="M32 49 18 35.5c-4-4-4-10.5 0-14.3s9.8-3.6 13.1.3l.9 1 .9-1c3.3-3.9 9.1-4.1 13.1-.3s4 10.3 0 14.3Z" fill="#fff"/>
<path d="M32 49 18 35.5c-4-4-4-10.5 0-14.3" fill="none" stroke="#ffd1e0" stroke-width="2" stroke-linecap="round" opacity=".6"/>
<circle cx="49" cy="15" r="2.2" fill="#fff" opacity=".7"/><circle cx="14" cy="49" r="1.6" fill="#fff" opacity=".5"/>`),

    discover: cover('discover', '#3cc8ff', '#2a2fb8', `
<circle cx="32" cy="33" r="16" fill="none" stroke="#fff" stroke-width="3" opacity=".9"/>
<path d="m38.5 26.5-4 10.6-10.5 3.4 4-10.6Z" fill="#fff"/>
<circle cx="32" cy="33" r="2" fill="#2a2fb8"/>
<path d="M50 10l1.3 3.2 3.2 1.3-3.2 1.3L50 19l-1.3-3.2-3.2-1.3 3.2-1.3Z" fill="#fff"/>
<circle cx="13" cy="15" r="1.5" fill="#fff" opacity=".7"/>`),

    fresh: cover('fresh', '#ffe066', '#f76707', `
<path d="M32 52V31" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>
<path d="M32 34c-1-8-7-12-15-11 0 8 6 12 15 11Z" fill="#fff"/>
<path d="M32 30c1-9 8-13 17-12-1 9-8 13-17 12Z" fill="#fff" opacity=".85"/>
<path d="M20 52h24" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>`),

    // --- настроения ---
    sad: cover('sad', '#4a63c9', '#141c3f', `
<path d="M20 34a8 8 0 0 1 1.5-15.8A11 11 0 0 1 42.6 20 7 7 0 0 1 44 34Z" fill="#dfe7ff"/>
<g stroke="#9fb4ff" stroke-width="2.6" stroke-linecap="round">
<path d="M22 40l-2.5 6"/><path d="M31 40l-2.5 6"/><path d="M40 40l-2.5 6"/>
<path d="M26.5 48l-2 5" opacity=".6"/><path d="M35.5 48l-2 5" opacity=".6"/></g>`),

    happy: cover('happy', '#ffd43b', '#ff7a1a', `
<circle cx="32" cy="32" r="10" fill="#fff"/>
<g stroke="#fff" stroke-width="3.2" stroke-linecap="round">
<path d="M32 12v5"/><path d="M32 47v5"/><path d="M12 32h5"/><path d="M47 32h5"/>
<path d="m17.9 17.9 3.5 3.5"/><path d="m42.6 42.6 3.5 3.5"/><path d="m17.9 46.1 3.5-3.5"/><path d="m42.6 21.4 3.5-3.5"/></g>`),

    energy: cover('energy', '#ff4d4d', '#6b0019', `
<path d="M36 9 18 36h12l-3 19 19-28H34Z" fill="#fff"/>
<path d="M36 9 18 36h12" fill="none" stroke="#ffd0d0" stroke-width="1.5" stroke-linejoin="round" opacity=".6"/>
<circle cx="50" cy="44" r="2" fill="#fff" opacity=".6"/><circle cx="13" cy="20" r="1.6" fill="#fff" opacity=".5"/>`),

    chill: cover('chill', '#38d9a9', '#0b4a45', `
<circle cx="32" cy="30" r="10" fill="#fff" opacity=".95"/>
<rect x="0" y="34" width="64" height="30" fill="#0b4a45" opacity=".55"/>
<g fill="none" stroke="#fff" stroke-linecap="round" stroke-width="2.8">
<path d="M8 38c4-2.5 8-2.5 12 0s8 2.5 12 0 8-2.5 12 0 8 2.5 12 0"/>
<path d="M14 46c3-2 6-2 9 0s6 2 9 0 6-2 9 0 6 2 9 0" opacity=".6"/>
<path d="M22 53c2.5-1.5 5-1.5 7.5 0s5 1.5 7.5 0" opacity=".35"/></g>`),

    focus: cover('focus', '#b07cff', '#2e0f6b', `
<path d="M16 38v-5a16 16 0 0 1 32 0v5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>
<rect x="12" y="35" width="9" height="15" rx="4" fill="#fff"/>
<rect x="43" y="35" width="9" height="15" rx="4" fill="#fff"/>
<g stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".55"><path d="M28 44v4"/><path d="M32 41v10"/><path d="M36 44v4"/></g>`),

    love: cover('love', '#ff7ac6', '#7a1150', `
<path d="M26 46 15 35.5c-3.2-3.2-3.2-8.3 0-11.4s7.8-2.8 10.4.3l.6.7.6-.7c2.6-3.1 7.2-3.3 10.4-.3s3.2 8.2 0 11.4Z" fill="#fff" opacity=".55"/>
<path d="M38 50 27 39.5c-3.2-3.2-3.2-8.3 0-11.4s7.8-2.8 10.4.3l.6.7.6-.7c2.6-3.1 7.2-3.3 10.4-.3s3.2 8.2 0 11.4Z" fill="#fff"/>`),

    night: cover('night', '#4c5bd4', '#090b26', `
<path d="M38 12a13 13 0 1 0 12.5 17A10.5 10.5 0 0 1 38 12Z" fill="#fff"/>
<g fill="#fff"><circle cx="14" cy="14" r="1.4"/><circle cx="22" cy="24" r="1"/><circle cx="54" cy="11" r="1.2"/><circle cx="12" cy="30" r=".9"/></g>
<path d="M0 64V50h7v-6h6v9h5V45h8v8h4v-5h7v-7h6v12h6v-6h6v4h9v14Z" fill="#05061a"/>
<g fill="#ffd56b" opacity=".85"><rect x="21" y="48" width="2" height="2"/><rect x="40" y="45" width="2" height="2"/><rect x="40" y="50" width="2" height="2"/><rect x="9" y="52" width="2" height="2"/></g>`),

    party: cover('party', '#ff9f43', '#c2185b', `
<path d="M32 8v8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
<circle cx="32" cy="32" r="15" fill="#fff"/>
<g fill="none" stroke="#c2185b" stroke-width="1.6" opacity=".35">
<path d="M17 32h30"/><path d="M19 24.5h26"/><path d="M19 39.5h26"/>
<path d="M32 17c-6 4-6 26 0 30"/><path d="M32 17c6 4 6 26 0 30"/></g>
<g fill="#fff"><path d="M51 44l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1Z"/><path d="M12 12l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z"/>
<rect x="10" y="46" width="3" height="3" rx=".6" transform="rotate(20 11.5 47.5)" opacity=".8"/><rect x="50" y="17" width="3" height="3" rx=".6" transform="rotate(-25 51.5 18.5)" opacity=".8"/></g>`),
  };
})();
