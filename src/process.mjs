import { LIMITS, PdfError, outputName, reject, safeFilename, validateSelection } from "./domain.mjs";
import { extractText, renderPages } from "./pdfjs.mjs";
import { FORMATS, resultMessage, validateCommand, validateResult } from "./worker-contract.mjs";

function check(resources, assertCurrent) { resources.check(); assertCurrent(); }
async function fileBytes(records, resources, assertCurrent) {
  const files = [];
  for (const record of records) {
    const bytes = await resources.wait(record.file.arrayBuffer()); check(resources, assertCurrent);
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== record.file.size || bytes.byteLength < 1 || bytes.byteLength > LIMITS.fileBytes) reject("Isi file berubah atau tidak dapat dibaca sesuai ukuran pilihan.");
    files.push({ id: record.id, bytes });
  }
  return files;
}
function runWorker(command, native, resources, assertCurrent, progress) {
  validateCommand(command); check(resources, assertCurrent);
  return new Promise((resolve, rejectPromise) => {
    const worker = new Worker(new URL(native ? "./qpdf-worker.js" : "./transform-worker.js", import.meta.url));
    let settled = false;
    const terminate = resources.own(() => worker.terminate());
    const cancel = () => finish(resources.reason || new DOMException("Pekerjaan dibatalkan.", "AbortError"));
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      resources.signal.removeEventListener("abort", cancel);
      resources.release(terminate);
      try { worker.terminate(); }
      catch {
        if (value?.warnings?.length < 6) value.warnings.push("Penutupan worker belum terkonfirmasi.");
        else console.warn("Penutupan worker PDF belum terkonfirmasi.");
      }
      if (error) rejectPromise(error); else resolve(value);
    };
    resources.signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => finish(new PdfError("engine_unavailable", "Mesin alat belum dapat dimuat. Muat ulang halaman dan coba lagi."));
    worker.onmessageerror = () => finish(new PdfError("invalid_result", "Pesan hasil alat tidak dapat dibaca."));
    worker.onmessage = ({ data }) => {
      try {
        check(resources, assertCurrent);
        if (!data || data.jobId !== command.jobId) reject("Identitas hasil alat tidak cocok.", "invalid_result");
        if (data.kind === "progress") {
          if (Object.keys(data).sort().join(",") !== "current,jobId,kind,stage,total" || !["image", "merge", "split", "save"].includes(data.stage)
            || !Number.isSafeInteger(data.current) || !Number.isSafeInteger(data.total) || data.current < 0 || data.current > data.total || data.total < 1 || data.total > LIMITS.pages) reject("Status pekerjaan alat tidak valid.", "invalid_result");
          progress({ stage: data.stage, current: data.current, total: data.total }); return;
        }
        if (data.kind === "error") {
          if (Object.keys(data).sort().join(",") !== "code,jobId,kind,message" || typeof data.message !== "string" || data.message.length > 1000) reject("Pesan kegagalan alat tidak valid.", "invalid_result");
          const safe = ["invalid_input", "engine_unavailable", "engine_failure", "password_required", "wrong_password", "unreadable_pdf", "page_limit", "result_limit", "invalid_result", "native_failure", "missing_text", "unsupported_tool"];
          finish(new PdfError(safe.includes(data.code) ? data.code : "engine_failure", data.message)); return;
        }
        finish(null, validateResult(data, command.jobId, command.toolId));
      } catch (error) { finish(error); }
    };
    const transfers = [...command.files.map((file) => file.bytes), ...(command.payload?.kind === "images" ? command.payload.images.map((image) => image.bytes) : [])];
    try { worker.postMessage(command, transfers); }
    catch { finish(new PdfError("engine_failure", "Data pekerjaan belum dapat dikirim ke worker.")); }
  });
}

export async function processJob(job, resources, assertCurrent, progress = () => {}) {
  validateSelection(job.toolId, job.files, true);
  check(resources, assertCurrent);
  let files = [], payload = null, result;
  const { toolId, options } = job;
  if (toolId === "rename") {
    const bytes = (await fileBytes(job.files, resources, assertCurrent))[0].bytes;
    result = resultMessage(job.id, "pdf", bytes, { sourcePages: 0, outputPages: 0, entries: 1 }, ["Isi file disalin persis. Struktur atau jumlah halaman PDF tidak diperiksa."], "rename");
  } else {
    if (["pdf-word", "pdf-text", "pdf-markdown"].includes(toolId)) {
      const pages = await extractText(job.files[0], resources, assertCurrent, progress);
      check(resources, assertCurrent);
      payload = { kind: "text", pages, sourceName: safeFilename(job.files[0].file.name) };
    } else if (toolId === "compare") {
      const left = await extractText(job.files[0], resources, assertCurrent, progress, true); check(resources, assertCurrent);
      const right = await extractText(job.files[1], resources, assertCurrent, progress, true); check(resources, assertCurrent);
      if (left.length + right.length > LIMITS.pages || [...left, ...right].reduce((sum, text) => sum + text.length, 0) > LIMITS.textUnits) reject("Total kedua dokumen maksimal 200 halaman dan satu juta karakter teks.");
      payload = { kind: "compare", left, right };
    } else if (["pdf-image", "compress"].includes(toolId)) {
      const qualities = { small: [1, 0.48], balanced: [1.45, 0.66], clear: [1.95, 0.82] };
      const [scale, quality] = toolId === "compress" ? qualities[options.quality] : [options.scale, 0.88];
      const images = await renderPages(job.files[0], { scale, quality, type: toolId === "pdf-image" && options.format === "png" ? "image/png" : "image/jpeg", imageOutput: toolId === "pdf-image" }, resources, assertCurrent, progress);
      check(resources, assertCurrent);
      payload = { kind: "images", images, sourcePages: images.length };
    } else files = await fileBytes(job.files, resources, assertCurrent);
    check(resources, assertCurrent);
    const command = { kind: "process", jobId: job.id, toolId, options, files, pageOrder: [...job.pageOrder], payload };
    result = await runWorker(command, ["protect", "unlock"].includes(toolId), resources, assertCurrent, progress);
  }
  check(resources, assertCurrent);
  validateResult(result, job.id, toolId);
  return Object.freeze({ blob: new Blob([result.bytes], { type: FORMATS[result.format][0] }), filename: outputName(toolId, job.files[0].file.name, options, FORMATS[result.format][1]), counts: Object.freeze({ ...result.counts }), warnings: Object.freeze([...result.warnings]), inputBytes: job.files.reduce((sum, file) => sum + file.file.size, 0) });
}
