import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.resolve('assets/icons');

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lenSq));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const margin = 0.06;
  const radius = 0.24;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Normalized [0, 1] coordinates
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;

      // Rounded rectangle SDF
      const rx = Math.max(Math.abs(u - 0.5) - (0.5 - margin - radius), 0);
      const ry = Math.max(Math.abs(v - 0.5) - (0.5 - margin - radius), 0);
      const boxDist = Math.hypot(rx, ry) - radius;

      const aa = Math.max(0, Math.min(1, 0.5 - boxDist * size));
      if (aa <= 0) continue;

      // Gradient cobalt (#1D4ED8 -> #1E3A8A) with subtle top-right HUJI crimson dot (#991B1B)
      let r = Math.round(29 + v * 1);
      let g = Math.round(78 - v * 20);
      let b = Math.round(216 - v * 78);

      // Minimalist key glyph in white: head ring at (0.37, 0.44), shaft to (0.74, 0.65), teeth
      const ringDist = Math.abs(Math.hypot(u - 0.37, v - 0.44) - 0.13);
      const shaftDist = distToSegment(u, v, 0.48, 0.51, 0.75, 0.67);
      const tooth1 = distToSegment(u, v, 0.64, 0.61, 0.64, 0.72);
      const tooth2 = distToSegment(u, v, 0.74, 0.67, 0.74, 0.76);
      const keyStroke = Math.min(ringDist, shaftDist, tooth1, tooth2);
      const keyAlpha = Math.max(0, Math.min(1, (0.048 - keyStroke) * size));

      // Small crimson accent badge in upper right
      const dotDist = Math.hypot(u - 0.73, v - 0.27);
      const dotRing = Math.max(0, Math.min(1, (0.085 - dotDist) * size));
      const dotCore = Math.max(0, Math.min(1, (0.062 - dotDist) * size));

      if (dotRing > 0) {
        r = Math.round(r * (1 - dotRing) + 255 * dotRing);
        g = Math.round(g * (1 - dotRing) + 255 * dotRing);
        b = Math.round(b * (1 - dotRing) + 255 * dotRing);
      }
      if (dotCore > 0) {
        r = Math.round(r * (1 - dotCore) + 153 * dotCore);
        g = Math.round(g * (1 - dotCore) + 27 * dotCore);
        b = Math.round(b * (1 - dotCore) + 27 * dotCore);
      }

      if (keyAlpha > 0) {
        r = Math.round(r * (1 - keyAlpha) + 255 * keyAlpha);
        g = Math.round(g * (1 - keyAlpha) + 255 * keyAlpha);
        b = Math.round(b * (1 - keyAlpha) + 255 * keyAlpha);
      }

      const idx = (y * size + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = Math.round(aa * 255);
    }
  }
  return encodePng(size, size, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  fs.writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), renderIcon(size));
}
