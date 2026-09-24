const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'assets', 'app-icon.png');

// ---------------- PNG encoder ----------------
const CRC_TABLE = (() => {
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba, scale = 2) {
  const raw = Buffer.alloc(width * (height * 4 + 1));
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      raw[off++] = rgba[i * 4];
      raw[off++] = rgba[i * 4 + 1];
      raw[off++] = rgba[i * 4 + 2];
      raw[off++] = rgba[i * 4 + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------- drawing at 2x supersample ----------------
const SS = 2048; // 2x of 1024
const px = new Uint8Array(SS * SS * 4);

function blit(src, i, r, g, b, a) {
  // src-over
  const sa = a / 255;
  const da = src[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  src[i] = Math.round((r * sa + src[i] * da * (1 - sa)) / oa);
  src[i + 1] = Math.round((g * sa + src[i + 1] * da * (1 - sa)) / oa);
  src[i + 2] = Math.round((b * sa + src[i + 2] * da * (1 - sa)) / oa);
  src[i + 3] = Math.round(oa * 255);
}

function fillRoundedRect(cx, cy, hw, hh, r, color) {
  const x0 = Math.max(0, Math.floor(cx - hw));
  const y0 = Math.max(0, Math.floor(cy - hh));
  const x1 = Math.min(SS - 1, Math.ceil(cx + hw));
  const y1 = Math.min(SS - 1, Math.ceil(cy + hh));
  const [cr, cg, cb, ca] = color;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // rounded rect signed distance (negative inside)
      const qx = Math.abs(x - cx) - (hw - r);
      const qy = Math.abs(y - cy) - (hh - r);
      const ox = Math.max(0, qx), oy = Math.max(0, qy);
      const d = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
      if (d < 0) blit(px, (y * SS + x) * 4, cr, cg, cb, ca);
    }
  }
}

function fillTriangle(a, b, c, color) {
  function inside(x, y) {
    const s1 = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const s2 = (c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0]);
    const s3 = (a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0]);
    const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
    const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
    return !(hasNeg && hasPos);
  }
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(SS - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(SS - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const [cr, cg, cb, ca] = color;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (inside(x + 0.5, y + 0.5)) blit(px, (y * SS + x) * 4, cr, cg, cb, ca);
    }
  }
}

// background rounded square + vertical gradient
{
  const grad = (t) => [
    Math.round(99 + (67 - 99) * t),
    Math.round(102 + (56 - 102) * t),
    Math.round(241 + (202 - 241) * t),
  ];
  const r0 = 230, cx = SS / 2, cy = SS / 2, hw = 500, hh = 500;
  for (let y = 0; y < SS; y++) {
    const t = y / SS;
    const [gr, gg, gb] = grad(t);
    for (let x = 0; x < SS; x++) {
      const qx = Math.abs(x - cx) - (hw - r0);
      const qy = Math.abs(y - cy) - (hh - r0);
      const ox = Math.max(0, qx), oy = Math.max(0, qy);
      const d = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r0;
      if (d < 0) blit(px, (y * SS + x) * 4, gr, gg, gb, 255);
    }
  }
}

const white = [255, 255, 255, 255];
const ink = [67, 56, 202, 255];

// white chat bubble
fillRoundedRect(SS / 2, 490, 300, 175, 62, white);
// tail
fillTriangle([392, 600], [560, 600], [448, 700], white);
// chat lines (indigo bars)
fillRoundedRect(SS / 2, 400, 205, 20, 10, ink);
fillRoundedRect(SS / 2, 470, 205, 20, 10, ink);
fillRoundedRect(SS / 2, 540, 120, 20, 10, ink);

// ---------------- downsample 2048 -> 1024 ----------------
const W = 1024;
const out = new Uint8Array(W * W * 4);
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const acc = [0, 0, 0, 0];
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const i = ((y * 2 + dy) * SS + (x * 2 + dx)) * 4;
        acc[0] += px[i] * px[i + 3];
        acc[1] += px[i + 1] * px[i + 3];
        acc[2] += px[i + 2] * px[i + 3];
        acc[3] += px[i + 3];
      }
    }
    const oi = (y * W + x) * 4;
    if (acc[3] > 0) {
      out[oi] = Math.round(acc[0] / acc[3]);
      out[oi + 1] = Math.round(acc[1] / acc[3]);
      out[oi + 2] = Math.round(acc[2] / acc[3]);
      out[oi + 3] = Math.round(acc[3] / 4);
    }
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodePng(W, W, out));
console.log('Icon written:', OUT, fs.statSync(OUT).size, 'bytes');