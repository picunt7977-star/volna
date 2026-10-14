// Собирает www/ для Capacitor: общий интерфейс из ../src/renderer + мобильные файлы из web/
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const www = join(here, 'www');
const renderer = join(here, '..', 'src', 'renderer');

rmSync(www, { recursive: true, force: true });
mkdirSync(www);
cpSync(join(renderer, 'fonts'), join(www, 'fonts'), { recursive: true });
for (const f of ['fonts.css', 'icons.js', 'covers.js', 'util.js', 'sc.js', 'lyrics.js', 'wave.js', 'player.js', 'ui.js', 'styles.css']) {
  cpSync(join(renderer, f), join(www, f));
}
cpSync(join(here, '..', 'node_modules', 'hls.js', 'dist', 'hls.min.js'), join(www, 'hls.min.js'));
cpSync(join(here, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js'), join(www, 'capacitor.js'));
cpSync(join(here, 'web'), www, { recursive: true });
console.log('www собран');
