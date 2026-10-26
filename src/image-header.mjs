import { LIMITS, reject } from "./domain.mjs";

const bytesEqual = (bytes, values, offset = 0) => values.every((value, index) => bytes[offset + index] === value);
function dimensions(format, width, height) {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= LIMITS.imageSide) || width * height > LIMITS.imagePixels) reject("Gambar maksimal 12000 piksel/sisi dan 20 juta piksel.");
  return { format, width, height, pixels: width * height };
}
export function imageHeader(bytes) {
  if (!(bytes instanceof Uint8Array)) reject("Data gambar tidak tersedia.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytesEqual(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    if (bytes.length < 45 || view.getUint32(8) !== 13 || !bytesEqual(bytes, [73, 72, 68, 82], 12)) reject("Header PNG terpotong atau tidak didukung.");
    const result = dimensions("png", view.getUint32(16), view.getUint32(20));
    const depth = bytes[24], color = bytes[25];
    const allowed = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!allowed[color]?.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) reject("Format header PNG tidak didukung.");
    let offset = 8, ended = false, imageData = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset), end = offset + 12 + size;
      if (end > bytes.length) reject("Chunk PNG terpotong.");
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (["acTL", "fcTL", "fdAT"].includes(type)) reject("PNG animasi tidak didukung. Pilih PNG biasa.");
      if (type === "IDAT") imageData = true;
      if (type === "IEND") {
        if (size !== 0 || end !== bytes.length) reject("Penutup PNG tidak valid.");
        ended = true; break;
      }
      offset = end;
    }
    if (!ended || !imageData) reject("Data PNG belum lengkap.");
    return result;
  }
  if (bytesEqual(bytes, [255, 216])) {
    if (bytes.length < 12 || !bytesEqual(bytes, [255, 217], bytes.length - 2)) reject("Data JPEG terpotong.");
    let offset = 2;
    while (offset < bytes.length - 2) {
      if (bytes[offset++] !== 255) reject("Penanda JPEG tidak valid.");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0 || marker === 216 || marker === 217) reject("Susunan header JPEG tidak valid.");
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) reject("Header JPEG terpotong.");
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) reject("Segmen JPEG terpotong.");
      if ([192, 193, 194].includes(marker)) {
        if (size < 8 || bytes[offset + 2] !== 8) reject("JPEG harus memakai sampel 8 bit.");
        return dimensions("jpg", view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      if (marker === 218 || (marker >= 195 && marker <= 207 && ![196, 200, 204].includes(marker))) reject("Format JPEG tidak didukung.");
      offset += size;
    }
    reject("Ukuran JPEG tidak ditemukan.");
  }
  reject("Gambar harus berupa PNG atau JPEG dengan header yang sesuai.");
}
export function imageHeaders(files) {
  const headers = files.map((file) => imageHeader(file.bytes));
  if (headers.reduce((sum, header) => sum + header.pixels, 0) > LIMITS.imagePixels) reject("Jumlah piksel semua gambar maksimal 20 juta.");
  return headers;
}
