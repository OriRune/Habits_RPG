// Renders the generated relic sprites (plan 4.1 / DUN-14) from the SVG art in
// ./art.mjs into src/assets/sprites/relics/, where the sprite registry seam
// auto-registers them as `relic:<key>`. Pipeline: rasterize each SVG at its
// native pixel size (32 unless overridden) with @resvg/resvg-js, then
// nearest-neighbor upscale to 128px so the result keeps the same visible pixel
// steps as the hand-drawn relics. Usage:
//   node scripts/relic-sprites/gen.mjs            # all sprites
//   node scripts/relic-sprites/gen.mjs key1,key2  # a subset
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { SPRITES } from './art.mjs';

const OUT_DIR = new URL('../../src/assets/sprites/relics/', import.meta.url);

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(pixels, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function upscaleNN(pixels, w, h, k) {
  const out = Buffer.alloc(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < w * k; x++) {
      const sx = Math.floor(x / k);
      pixels.copy(out, (y * w * k + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
    }
  }
  return out;
}

const only = process.argv[2] ? process.argv[2].split(',') : null;
for (const [key, def] of Object.entries(SPRITES)) {
  if (only && !only.includes(key)) continue;
  const native = def.native ?? 32;
  const scale = Math.round(128 / native);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${def.grid ?? 32} ${def.grid ?? 32}" width="${native}" height="${native}">${def.svg}</svg>`;
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: native } }).render();
  const pixels = Buffer.from(img.pixels);
  // Kill faint AA fringe so the transparent edge stays crisp like the hand-drawn art.
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 48) pixels[i] = 0;
  const up = upscaleNN(pixels, img.width, img.height, scale);
  writeFileSync(new URL(`${key}.png`, OUT_DIR), encodePng(up, img.width * scale, img.height * scale));
  console.log(`${key}.png — native ${native}, x${scale}`);
}
