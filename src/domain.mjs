import { toolById } from "./catalog.mjs";
import { validUnicode, validatePassword } from "./native-options.mjs";

export const MiB = 1024 * 1024;
export const LIMITS = Object.freeze({ fileBytes: 25 * MiB, inputBytes: 50 * MiB, files: 20, pages: 200, pageSide: 14400, imageSide: 12000, imagePixels: 20_000_000, renderSide: 3000, renderPixels: 6_000_000, thumbnailSide: 280, thumbnailPixels: 40_000_000, resultBytes: 50 * MiB, entries: 100, textUnits: 1_000_000, textItems: 100_000, docxLines: 10_000, deadline: 60_000 });
export class PdfError extends Error { constructor(code, message) { super(message); this.name = "PdfError"; this.code = code; } }
export const reject = (message, code = "invalid_input") => { throw new PdfError(code, message); };
export function requireInteger(value, minimum, maximum, label = "Nilai") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) reject(label + " harus bilangan bulat " + minimum + "–" + maximum + ".");
  return value;
}
export function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) reject("Kolom pengaturan tidak lengkap atau tidak dikenal.");
}
export function validateOptions(id, raw) {
  const schema = toolById(id).options;
  exactKeys(raw, Object.keys(schema));
  const options = {};
  for (const [key, field] of Object.entries(schema)) {
    const value = raw[key];
    if (field.kind === "select") {
      if (!field.values.includes(value)) reject("Pilihan " + field.label + " tidak valid.");
      options[key] = value;
    } else if (field.kind === "integer") options[key] = requireInteger(value, field.minimum, field.maximum, field.label);
    else {
      if (!validUnicode(value) || (!field.password && /[\u0000-\u001f\u007f-\u009f]/u.test(value)) || (field.maximum !== undefined && [...value].length > field.maximum)) reject(field.label + " tidak valid atau terlalu panjang.");
      if (field.password) {
        try { options[key] = validatePassword(value, id === "protect"); } catch (error) { reject(error.message); }
      } else options[key] = value;
    }
  }
  if (["watermark", "add-text", "sign", "rename"].includes(id)) {
    const value = options.text ?? options.name;
    if (!value.trim()) reject("Isi teks atau nama terlebih dahulu.");
  }
  return Object.freeze(options);
}
export function optionsFromStrings(id, raw) {
  exactKeys(raw, Object.keys(toolById(id).options));
  const options = {};
  for (const [key, field] of Object.entries(toolById(id).options)) {
    const value = raw[key];
    if (field.kind === "integer" || (field.kind === "select" && typeof field.fallback === "number")) {
      if (typeof value !== "string" || !/^(0|[1-9][0-9]*)([.][0-9]+)?$/.test(value)) reject(field.label + " belum diisi dengan angka yang valid.");
      options[key] = Number(value);
    } else options[key] = value;
  }
  return validateOptions(id, options);
}
export function validateSelection(id, records, final = false) {
  toolById(id);
  if (!Array.isArray(records) || records.length > LIMITS.files || new Set(records.map((record) => record.id)).size !== records.length) reject("Pilih paling banyak 20 file dengan identitas yang berbeda.");
  let total = 0;
  for (const { id: fileId, file } of records) {
    if (typeof fileId !== "string" || !fileId || !file || typeof file.name !== "string" || !validUnicode(file.name) || typeof file.arrayBuffer !== "function" || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > LIMITS.fileBytes) reject("Setiap file harus berisi data dan berukuran maksimal 25 MiB.");
    total += file.size;
  }
  if (total > LIMITS.inputBytes) reject("Total file maksimal 50 MiB.");
  const multiple = ["merge", "compare", "scan-pdf", "image-pdf"].includes(id);
  if (!multiple && records.length > 1) reject("Alat ini menerima satu file.");
  if (id === "compare" && records.length > 2) reject("Perbandingan menerima tepat dua PDF.");
  if (final && records.length < (["merge", "compare"].includes(id) ? 2 : 1)) reject(id === "compare" ? "Pilih tepat dua PDF." : "Pilih file sesuai kebutuhan alat.");
  return records;
}
export function pdfHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || !new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) reject("Header PDF tidak ditemukan. Pilih file PDF yang dapat dibaca.");
}
export function pageRanges(raw, count, emptyAll = false) {
  requireInteger(count, 1, LIMITS.pages, "Jumlah halaman");
  if (typeof raw !== "string" || raw.length > 2000 || !/^[0-9,\-\s]*$/.test(raw)) reject("Rentang halaman hanya memakai angka, koma, dan tanda hubung.");
  if (!raw.trim()) {
    if (emptyAll) return Array.from({ length: count }, (_, index) => index);
    reject("Isi rentang halaman terlebih dahulu.");
  }
  const selected = new Set();
  for (const token of raw.split(",")) {
    const match = /^\s*([1-9][0-9]*)\s*(?:-\s*([1-9][0-9]*)\s*)?$/.exec(token);
    if (!match) reject("Rentang halaman tidak valid.");
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    if (start > end || end > count) reject("Rentang halaman melewati dokumen atau terbalik.");
    for (let page = start; page <= end; page++) selected.add(page - 1);
  }
  return [...selected];
}
export function pagePermutation(order, count) {
  requireInteger(count, 1, LIMITS.pages, "Jumlah halaman");
  if (!Array.isArray(order) || order.length !== count || new Set(order).size !== count || order.some((value) => !Number.isSafeInteger(value) || value < 0 || value >= count)) reject("Susunan halaman harus memuat setiap halaman tepat satu kali.");
  return Object.freeze([...order]);
}
export function pageGeometry(width, height) {
  if (![width, height].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= LIMITS.pageSide)) reject("Ukuran halaman PDF tidak didukung. Batas sisi 14400 pt.");
  return { width, height };
}
export function renderGeometry(width, height) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0 && value <= LIMITS.renderSide) || Math.ceil(width) * Math.ceil(height) > LIMITS.renderPixels) reject("Render melewati 3000 piksel/sisi atau 6 juta piksel. Pilih skala lebih rendah.");
  return { width: Math.ceil(width), height: Math.ceil(height) };
}
export function safeFilename(raw, fallback = "hasil") {
  if (!validUnicode(raw)) reject("Nama file memakai Unicode yang tidak lengkap.");
  let base = raw.replace(/\.pdf$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, "-").replace(/[. ]+$/g, "").trim();
  if (!base) base = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])([.]|$)/i.test(base)) base = "_" + base;
  return [...base].slice(0, 90).join("");
}
export function outputName(id, inputName, options, extension) {
  const base = id === "rename" ? safeFilename(options.name) : safeFilename(inputName) + "-" + id;
  return base + "." + extension;
}
export function textPages(pages, allowBlank = false) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > LIMITS.pages || pages.some((page) => typeof page !== "string" || !validUnicode(page))) reject("Hasil teks halaman tidak valid.");
  if (pages.reduce((total, page) => total + page.length, 0) > LIMITS.textUnits) reject("Teks melampaui batas satu juta karakter. Hasil tidak dipotong.");
  if (!allowBlank && pages.every((page) => !page.trim())) reject("Tidak ada teks yang dapat dipilih. Alat ini tidak menjalankan OCR.", "missing_text");
  return pages;
}
export function comparePages(left, right) {
  textPages(left, true); textPages(right, true);
  const lines = ["Perbandingan teks dan keberadaan halaman", "A: " + left.length + " halaman; B: " + right.length + " halaman", ""];
  let differences = 0;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = index < left.length, b = index < right.length;
    const same = a === b && left[index] === right[index];
    if (!same) differences++;
    lines.push("Halaman " + (index + 1) + ": " + (same ? "sama" : !a || !b ? "berbeda, halaman " + (!a ? "A" : "B") + " tidak ada" : "teks berbeda"));
    if (!same && a) lines.push("A:\n" + left[index]);
    if (!same && b) lines.push("B:\n" + right[index]);
    lines.push("");
  }
  const result = lines.join("\n");
  if (result.length > 2 * LIMITS.textUnits + 50_000) reject("Laporan perbandingan melampaui batas.");
  return { text: result, differences };
}
