// PWA 아이콘 생성 스크립트 (외부 의존성 없음)
// 실행: node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(OUT_DIR, { recursive: true });

// --- 최소 PNG 인코더 ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- 아이콘 그리기: 네이비 배경 + A 마크 ---
const BG = [14, 22, 34]; // #0e1622
const FG = [230, 236, 245];
const ACCENT = [96, 165, 250]; // 가로획

function drawIcon(size, { paddingRatio, rounded }) {
  const px = Buffer.alloc(size * size * 4);
  const radius = rounded ? size * 0.18 : 0;
  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  const inRoundedRect = (x, y) => {
    if (!rounded) return true;
    const cx = x < radius ? radius : x >= size - radius ? size - radius - 1 : x;
    const cy = y < radius ? radius : y >= size - radius ? size - radius - 1 : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  const rect = (x0, y0, w, h, color) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++)
        if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, color);
  };

  // 배경
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (inRoundedRect(x, y)) set(x, y, BG);

  // A 마크 — 작은 favicon에서도 알파가 바로 읽힘
  const p = size * paddingRatio;
  const gw = size - p * 2;
  const gx = p;
  const gy = p + gw * 0.04;
  const stroke = Math.max(2, Math.round(gw * 0.16));
  const half = stroke / 2;
  const line = (x0, y0, x1, y1, color = FG, w = half) => {
    const tdx = x1 - x0;
    const tdy = y1 - y0;
    const len = Math.hypot(tdx, tdy) || 1;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w - 1));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + w + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w - 1));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + w + 1));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = ((x - x0) * tdx + (y - y0) * tdy) / (len * len);
        if (t < 0 || t > 1) continue;
        if (Math.hypot(x - (x0 + t * tdx), y - (y0 + t * tdy)) <= w) set(x, y, color);
      }
    }
  };
  const apexX = gx + gw * 0.50;
  const apexY = gy + gw * 0.06;
  const leftX = gx + gw * 0.08;
  const rightX = gx + gw * 0.92;
  const baseY = gy + gw * 0.92;
  line(apexX, apexY, leftX, baseY);
  line(apexX, apexY, rightX, baseY);
  line(gx + gw * 0.28, gy + gw * 0.58, gx + gw * 0.72, gy + gw * 0.58, ACCENT, half * 0.9);

  return px;
}

const icons = [
  { file: "pwa-192x192.png", size: 192, paddingRatio: 0.2, rounded: false },
  { file: "pwa-512x512.png", size: 512, paddingRatio: 0.2, rounded: false },
  // maskable: 안전 영역(중앙 80%) 확보를 위해 패딩 확대, 전체 배경 채움
  { file: "maskable-512x512.png", size: 512, paddingRatio: 0.32, rounded: false },
  // iOS 홈 화면용 (불투명)
  { file: "apple-touch-icon.png", size: 180, paddingRatio: 0.2, rounded: false },
  // 파비콘 대용
  { file: "favicon-64.png", size: 64, paddingRatio: 0.16, rounded: true },
];

for (const { file, size, paddingRatio, rounded } of icons) {
  writeFileSync(join(OUT_DIR, file), encodePNG(size, drawIcon(size, { paddingRatio, rounded })));
  console.log(`✓ public/${file}`);
}
