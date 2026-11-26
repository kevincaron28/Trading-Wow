/**
 * A small line chart as a PNG, with no dependency: the Ledger 100 over a recap's period, attached to the Discord post
 * (collector/discord-recap.ts). Plain pixels: a dark background, grid lines, the area under the line and the line
 * itself (anti-aliased), green when the period ended up, red when it ended down. Text stays in the embed.
 */
import { deflateSync } from "node:zlib";

type RGB = [number, number, number];
const BG: RGB = [0x14, 0x16, 0x1b];
const GRID: RGB = [0x2a, 0x2e, 0x36];
const UP: RGB = [0x3f, 0xb9, 0x50];
const DOWN: RGB = [0xf8, 0x51, 0x49];
const BASE: RGB = [0x8b, 0x94, 0x9e];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode RGB pixels (width x height x 3) as a PNG file. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.subarray(y * width * 3, (y + 1) * width * 3)).copy(raw, y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

/** Distance from point (px, py) to the segment (ax, ay)-(bx, by). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * A line chart of `values` (at least 2), with a dashed reference line at `reference` when given (the value at the
 * period start). Returns null with fewer than 2 values.
 */
export function lineChartPng(values: readonly number[], width = 800, height = 260, reference?: number): Buffer | null {
  if (values.length < 2) return null;
  const pad = 14;
  let min = Math.min(...values, reference ?? Infinity);
  let max = Math.max(...values, reference ?? -Infinity);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const X = (i: number) => pad + (i / (values.length - 1)) * (width - 2 * pad);
  const Y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - 2 * pad);
  const color = values.at(-1)! >= values[0]! ? UP : DOWN;
  const px = new Uint8Array(width * height * 3);
  const set = (x: number, y: number, c: RGB, a = 1) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 3;
    for (let k = 0; k < 3; k++) px[o + k] = Math.round(px[o + k]! * (1 - a) + c[k]! * a);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, BG);
  for (let g = 0; g <= 4; g++) {
    const y = Math.round(pad + (g / 4) * (height - 2 * pad));
    for (let x = pad; x < width - pad; x++) set(x, y, GRID);
  }
  if (reference != null) {
    const y = Math.round(Y(reference));
    for (let x = pad; x < width - pad; x++) if (Math.floor(x / 6) % 2 === 0) set(x, y, BASE, 0.7);
  }
  // Area under the line: a faint fill that fades towards the bottom.
  for (let x = pad; x < width - pad; x++) {
    const f = ((x - pad) / (width - 2 * pad)) * (values.length - 1);
    const i = Math.min(values.length - 2, Math.floor(f));
    const v = values[i]! + (values[i + 1]! - values[i]!) * (f - i);
    const top = Math.round(Y(v));
    for (let y = top; y < height - pad; y++) set(x, y, color, 0.22 * (1 - (y - top) / Math.max(1, height - pad - top)));
  }
  // The line, 2.5 px wide, anti-aliased.
  const half = 1.25;
  for (let i = 0; i < values.length - 1; i++) {
    const ax = X(i), ay = Y(values[i]!), bx = X(i + 1), by = Y(values[i + 1]!);
    for (let y = Math.floor(Math.min(ay, by) - 3); y <= Math.ceil(Math.max(ay, by) + 3); y++) {
      for (let x = Math.floor(Math.min(ax, bx) - 3); x <= Math.ceil(Math.max(ax, bx) + 3); x++) {
        const d = segDist(x + 0.5, y + 0.5, ax, ay, bx, by);
        if (d < half + 1) set(x, y, color, Math.min(1, half + 1 - d));
      }
    }
  }
  return encodePng(width, height, px);
}
