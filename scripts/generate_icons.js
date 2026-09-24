/**
 * Renders the ABSL barcode mark (see favicon.svg) as PNGs for the web app
 * manifest and Apple touch icon, with no image-library dependency — this
 * writes a raw PNG (IHDR/IDAT/IEND chunks, zlib-deflated pixel rows) by hand
 * so `npm run build` never needs sharp/canvas installed.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BG = [0x0f, 0x17, 0x2a]; // #0f172a
const BAR = [0x0e, 0xa5, 0xe9]; // #0ea5e9

// Bars from favicon.svg's 64x64 viewBox: [x, width], all y=18, height=28.
const BARS_64 = [
  [14, 4],
  [21, 2],
  [26, 5],
  [34, 2],
  [39, 4],
  [46, 2]
];
const BAR_Y0 = 18;
const BAR_Y1 = 46;
const CORNER_RADIUS = 14; // out of 64

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function roundedRectContains(x, y, size, radius) {
  const cx = x < radius ? radius : x > size - 1 - radius ? size - 1 - radius : x;
  const cy = y < radius ? radius : y > size - 1 - radius ? size - 1 - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderPng(size) {
  const scale = size / 64;
  const radius = CORNER_RADIUS * scale;
  const bars = BARS_64.map(([x, w]) => [x * scale, w * scale]);
  const y0 = BAR_Y0 * scale;
  const y1 = BAR_Y1 * scale;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const inCorner = roundedRectContains(x + 0.5, y + 0.5, size, radius);
      let color = inCorner ? BG : [0, 0, 0];
      let alpha = inCorner ? 255 : 0;
      if (inCorner && y + 0.5 >= y0 && y + 0.5 < y1) {
        for (const [bx, bw] of bars) {
          if (x + 0.5 >= bx && x + 0.5 < bx + bw) {
            color = BAR;
            break;
          }
        }
      }
      const off = rowStart + 1 + x * 4;
      raw[off] = color[0];
      raw[off + 1] = color[1];
      raw[off + 2] = color[2];
      raw[off + 3] = alpha;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const root = path.join(__dirname, "..");
const iconsDir = path.join(root, "icons");
fs.mkdirSync(iconsDir, { recursive: true });

const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180]
];

for (const [name, size] of targets) {
  fs.writeFileSync(path.join(iconsDir, name), renderPng(size));
  console.log(`  icons/${name}  (${size}x${size})`);
}
