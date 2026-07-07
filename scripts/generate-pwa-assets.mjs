// Renders the PWA icon set from public/logo.svg (npm run generate-pwa-assets).
// Uses @resvg/resvg-js rather than the usual sharp-based generators because
// sharp has no working win32-arm64 build. The maskable/apple variants get the
// app's body background (#160c06) instead of transparency; the logo's built-in
// margins keep the art inside the maskable 80% safe zone, so no extra padding.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8');
const BG = '#160c06';

const targets = [
  { file: 'pwa-192x192.png', size: 192 },
  { file: 'pwa-512x512.png', size: 512 },
  { file: 'maskable-icon-512x512.png', size: 512, background: BG },
  { file: 'apple-touch-icon-180x180.png', size: 180, background: BG },
];

for (const { file, size, background } of targets) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    ...(background ? { background } : {}),
  });
  writeFileSync(new URL(`../public/${file}`, import.meta.url), resvg.render().asPng());
  console.log(`public/${file} — ${size}x${size}${background ? ` on ${background}` : ' transparent'}`);
}
