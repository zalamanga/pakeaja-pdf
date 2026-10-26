import { pageGeometry, reject } from "./domain.mjs";
export const mm = (value) => value * 72 / 25.4;
export function visibleGeometry(media, crop, angle) {
  for (const box of [media, crop]) {
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) reject("Kotak halaman PDF tidak valid.");
    pageGeometry(box.width, box.height);
  }
  if (!Number.isInteger(angle) || angle % 90 !== 0) reject("Rotasi halaman hanya didukung pada kelipatan 90 derajat.");
  const rotation = ((angle % 360) + 360) % 360;
  const x = Math.max(media.x, crop.x), y = Math.max(media.y, crop.y);
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
  pageGeometry(width, height);
  return { x, y, width, height, rotation, displayWidth: rotation % 180 ? height : width, displayHeight: rotation % 180 ? width : height };
}
export function displayPoint(box, u, v) {
  const { x, y, width: w, height: h, rotation } = box;
  return rotation === 0 ? { x: x + u, y: y + v }
    : rotation === 90 ? { x: x + w - v, y: y + u }
    : rotation === 180 ? { x: x + w - u, y: y + h - v }
    : { x: x + v, y: y + h - u };
}
export function rotatedBounds(width, ascent, descent, angle) {
  const radians = angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  const points = [[0, -descent], [width, -descent], [width, ascent], [0, ascent]].map(([x, y]) => [x * cosine - y * sine, x * sine + y * cosine]);
  const minX = Math.min(...points.map(([x]) => x)), maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y)), maxY = Math.max(...points.map(([, y]) => y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
export function fitRectangle(box, x, y, bounds, margin = 0) {
  if (![x, y, bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)
    || x + bounds.minX < margin - 0.000001 || y + bounds.minY < margin - 0.000001
    || x + bounds.maxX > box.displayWidth - margin + 0.000001 || y + bounds.maxY > box.displayHeight - margin + 0.000001) reject("Teks atau elemen tidak muat pada batas tampilan halaman. Ubah ukuran, posisi, atau teks.");
}
export function croppedBox(box, options) {
  const l = mm(options.left), r = mm(options.right), t = mm(options.top), b = mm(options.bottom);
  if (box.displayWidth - l - r < 10 || box.displayHeight - t - b < 10) reject("Margin harus menyisakan minimal 10 pt pada setiap sisi tampilan halaman.");
  const shifts = box.rotation === 0 ? [l, b, l + r, t + b]
    : box.rotation === 90 ? [t, l, t + b, l + r]
    : box.rotation === 180 ? [r, t, l + r, t + b]
    : [b, r, t + b, l + r];
  return { x: box.x + shifts[0], y: box.y + shifts[1], width: box.width - shifts[2], height: box.height - shifts[3] };
}
