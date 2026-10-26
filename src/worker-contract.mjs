import { LIMITS, PdfError, exactKeys, pdfHeader, reject, requireInteger, validateOptions } from "./domain.mjs";
import { toolById } from "./catalog.mjs";

export const FORMATS = Object.freeze({ pdf: ["application/pdf", "pdf"], zip: ["application/zip", "zip"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"], jpg: ["image/jpeg", "jpg"], png: ["image/png", "png"], txt: ["text/plain;charset=utf-8", "txt"], md: ["text/markdown;charset=utf-8", "md"] });
const ERROR_CODES = Object.freeze(["invalid_input", "engine_unavailable", "engine_failure", "password_required", "wrong_password", "unreadable_pdf", "page_limit", "result_limit", "invalid_result", "native_failure", "missing_text", "unsupported_tool"]);
export function workerFailure(error, jobId) {
  const safe = error instanceof PdfError && ERROR_CODES.includes(error.code) && typeof error.message === "string" && error.message.length > 0 && error.message.length <= 1000;
  return { kind: "error", jobId, code: safe ? error.code : "engine_failure", message: safe ? error.message : "Mesin belum dapat menyelesaikan file ini. Tidak ada hasil parsial yang diterbitkan." };
}
export function validateCommand(value) {
  exactKeys(value, ["kind", "jobId", "toolId", "options", "files", "pageOrder", "payload"]);
  if (value.kind !== "process" || typeof value.jobId !== "string" || !/^[a-zA-Z0-9-]{1,96}$/.test(value.jobId)) reject("Identitas pekerjaan tidak valid.");
  toolById(value.toolId); validateOptions(value.toolId, value.options);
  if (!Array.isArray(value.files) || value.files.length > LIMITS.files || new Set(value.files.map((file) => file.id)).size !== value.files.length || !Array.isArray(value.pageOrder)) reject("Daftar file pekerjaan tidak valid.");
  let total = 0;
  for (const file of value.files) {
    exactKeys(file, ["id", "bytes"]);
    if (typeof file.id !== "string" || !/^[a-zA-Z0-9-]{1,96}$/.test(file.id) || !(file.bytes instanceof ArrayBuffer) || !file.bytes.byteLength || file.bytes.byteLength > LIMITS.fileBytes) reject("Data file pekerjaan tidak valid.");
    total += file.bytes.byteLength;
  }
  if (total > LIMITS.inputBytes) reject("Data file pekerjaan melampaui 50 MiB.");
  if (value.payload === null) {
    const count = value.files.length;
    if ((["merge", "compare"].includes(value.toolId) && count < 2) || (value.toolId === "compare" && count !== 2) || (!["merge", "compare", "image-pdf", "scan-pdf"].includes(value.toolId) && count !== 1) || !count) reject("Jumlah file pekerjaan tidak cocok dengan alat.");
    if (value.toolId !== "organize-pages" && value.pageOrder.length) reject("Susunan halaman tidak digunakan oleh alat ini.");
  } else if (value.files.length || value.pageOrder.length) reject("Data antara tidak boleh dicampur dengan file mentah.");
  return value;
}
export function resultMessage(jobId, format, raw, counts, warnings = [], toolId) {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = { kind: "result", jobId, format, bytes: buffer, counts, warnings };
  validateResult(result, jobId, toolId);
  return result;
}
export function validateResult(value, jobId, toolId) {
  exactKeys(value, ["kind", "jobId", "format", "bytes", "counts", "warnings"]);
  if (value.kind !== "result" || value.jobId !== jobId || !Object.hasOwn(FORMATS, value.format) || !(value.bytes instanceof ArrayBuffer) || value.bytes.byteLength < 1 || value.bytes.byteLength > LIMITS.resultBytes) reject("Hasil pekerjaan tidak lengkap.", "invalid_result");
  const bytes = new Uint8Array(value.bytes);
  if (value.format === "pdf" && toolId !== "rename") pdfHeader(bytes);
  if (["zip", "docx"].includes(value.format) && !(bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4)) reject("Header hasil arsip tidak valid.", "invalid_result");
  if (value.format === "jpg" && !(bytes[0] === 255 && bytes[1] === 216)) reject("Header hasil gambar tidak valid.", "invalid_result");
  if (value.format === "png" && !(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) reject("Header hasil gambar tidak valid.", "invalid_result");
  exactKeys(value.counts, ["sourcePages", "outputPages", "entries"]);
  requireInteger(value.counts.sourcePages, 0, LIMITS.pages, "Jumlah halaman sumber");
  requireInteger(value.counts.outputPages, 0, LIMITS.pages, "Jumlah halaman hasil");
  requireInteger(value.counts.entries, 1, LIMITS.entries, "Jumlah berkas hasil");
  if (!Array.isArray(value.warnings) || value.warnings.length > 6 || value.warnings.some((warning) => typeof warning !== "string" || warning.length > 500)) reject("Catatan hasil tidak valid.", "invalid_result");
  if (toolId) {
    const expected = toolById(toolId).output;
    if (!(expected === value.format || (expected === "image-or-zip" && ["jpg", "png", "zip"].includes(value.format)))) reject("Format hasil tidak cocok dengan alat.", "invalid_result");
    if (toolId !== "rename" && (value.counts.sourcePages < 1 || (value.format === "pdf" && value.counts.outputPages < 1))) reject("Jumlah halaman hasil tidak valid.", "invalid_result");
  }
  return value;
}
