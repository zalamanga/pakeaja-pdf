import "./pdfjs-compat.js";
import { LIMITS, pageGeometry, pdfHeader, reject, renderGeometry, textPages } from "./domain.mjs";

let library;
async function pdfjs() {
  library ??= import("./vendor/pdfjs/build/pdf.mjs").then((module) => {
    module.GlobalWorkerOptions.workerSrc = new URL("./pdfjs-worker.mjs", import.meta.url).href;
    return module;
  }).catch((error) => { library = undefined; throw error; });
  return library;
}
function check(resources, assertCurrent) { resources.check(); assertCurrent(); }
export async function openPdf(record, resources, assertCurrent) {
  const module = await resources.wait(pdfjs()); check(resources, assertCurrent);
  const buffer = await resources.wait(record.file.arrayBuffer()); check(resources, assertCurrent);
  pdfHeader(new Uint8Array(buffer));
  const task = module.getDocument({ data: new Uint8Array(buffer),
    cMapUrl: new URL("./vendor/pdfjs/cmaps/", import.meta.url).href, cMapPacked: true,
    standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", import.meta.url).href,
    wasmUrl: new URL("./vendor/pdfjs/wasm/", import.meta.url).href,
    iccUrl: new URL("./vendor/pdfjs/iccs/", import.meta.url).href,
    isEvalSupported: false, useSystemFonts: false, enableXfa: false,
  });
  let destruction;
  const cleanup = resources.own(() => destruction ??= task.destroy());
  try {
    const pdf = await resources.wait(task.promise); check(resources, assertCurrent);
    if (!Number.isSafeInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > LIMITS.pages) reject("Dokumen maksimal 200 halaman.");
    return { pdf, async close() {
      resources.release(cleanup);
      try { await resources.wait(cleanup()); } catch { console.warn("Penutupan parser PDF belum terkonfirmasi."); }
    } };
  } catch (error) {
    resources.release(cleanup);
    try { await resources.wait(cleanup()); } catch { /* Preserve parsing/cancellation failure. */ }
    if (error?.name === "PasswordException") reject("PDF masih dilindungi. Gunakan Buka Proteksi PDF terlebih dahulu.", "password_required");
    throw error;
  }
}
async function pageFor(pdf, index, resources, assertCurrent) {
  const page = await resources.wait(pdf.getPage(index)); check(resources, assertCurrent);
  const view = page.getViewport({ scale: 1 });
  pageGeometry(view.width, view.height);
  return page;
}
export async function extractText(record, resources, assertCurrent, progress = () => {}, allowBlank = false) {
  const opened = await openPdf(record, resources, assertCurrent);
  const pages = [];
  let units = 0, items = 0;
  try {
    for (let index = 1; index <= opened.pdf.numPages; index++) {
      const page = await pageFor(opened.pdf, index, resources, assertCurrent);
      let reader, releaseReader, streamDone = false, cancelled = false;
      try {
        reader = page.streamTextContent().getReader();
        releaseReader = resources.own(() => { cancelled = true; return reader.cancel(); });
        const lines = [];
        let line = "", previous = null;
        while (true) {
          const part = await resources.wait(reader.read()); check(resources, assertCurrent);
          if (part.done) { streamDone = true; break; }
          if (!Array.isArray(part.value?.items)) reject("Bagian teks PDF tidak dapat dibaca.");
          for (const item of part.value.items) {
            if (++items > LIMITS.textItems) reject("Teks melampaui 100000 item. Hasil tidak dipotong.");
            if (typeof item.str !== "string") continue;
            if (previous && line && !line.endsWith(" ") && Array.isArray(item.transform) && Array.isArray(previous.transform)) {
              const gap = item.transform[4] - (previous.transform[4] + previous.width);
              if (Number.isFinite(gap) && gap > Math.max(2, previous.height * 0.22)) { line += " "; units++; }
            }
            units += item.str.length;
            if (units > LIMITS.textUnits) reject("Teks melampaui satu juta karakter. Hasil tidak dipotong.");
            line += item.str; previous = item;
            if (item.hasEOL) { lines.push(line); line = ""; previous = null; units++; }
          }
        }
        if (line) lines.push(line);
        pages.push(lines.join("\n"));
      } finally {
        if (releaseReader && !streamDone && !cancelled) {
          try { await resources.wait(releaseReader()); }
          catch { console.warn("Pembatalan pembaca teks PDF belum terkonfirmasi."); }
        }
        if (releaseReader) resources.release(releaseReader);
        try { reader?.releaseLock(); } catch {}
        try { page.cleanup(); } catch { console.warn("Pembersihan halaman teks belum terkonfirmasi."); }
      }
      progress({ stage: "text", current: index, total: opened.pdf.numPages });
    }
    check(resources, assertCurrent);
    return textPages(pages, allowBlank);
  } finally { await opened.close(); }
}

function canvasBlob(canvas, type, quality, resources, assertCurrent) {
  return resources.wait(new Promise((resolve, rejectPromise) => canvas.toBlob((blob) => {
    try {
      check(resources, assertCurrent);
      if (!blob || !blob.size || blob.size > LIMITS.resultBytes) reject("Gambar hasil tidak tersedia atau melewati 50 MiB.");
      resolve(blob);
    } catch (error) { rejectPromise(error); }
  }, type, quality)));
}
async function render(page, scale, resources, assertCurrent, documentPort) {
  const viewport = page.getViewport({ scale });
  const size = renderGeometry(viewport.width, viewport.height);
  const canvas = documentPort.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  const clearCanvas = resources.own(() => { canvas.width = 0; canvas.height = 0; });
  let cancel;
  try {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) reject("Canvas browser tidak tersedia.");
    const task = page.render({ canvasContext: context, canvas, viewport, background: "rgb(255,255,255)" });
    cancel = resources.own(() => task.cancel());
    await resources.wait(task.promise); check(resources, assertCurrent);
    return { canvas, clear() { resources.release(clearCanvas); canvas.width = 0; canvas.height = 0; } };
  } catch (error) {
    resources.release(clearCanvas); canvas.width = 0; canvas.height = 0; throw error;
  } finally { if (cancel) resources.release(cancel); }
}
export async function renderPages(record, settings, resources, assertCurrent, progress = () => {}, documentPort = document) {
  const opened = await openPdf(record, resources, assertCurrent);
  const images = [];
  let totalBytes = 0;
  try {
    if (settings.imageOutput && opened.pdf.numPages > LIMITS.entries) reject("Ekspor gambar ZIP maksimal 100 halaman.");
    for (let index = 1; index <= opened.pdf.numPages; index++) {
      const page = await pageFor(opened.pdf, index, resources, assertCurrent);
      let rendered;
      try {
        const displayed = page.getViewport({ scale: 1 });
        rendered = await render(page, settings.scale, resources, assertCurrent, documentPort);
        const blob = await canvasBlob(rendered.canvas, settings.type, settings.quality, resources, assertCurrent);
        const bytes = await resources.wait(blob.arrayBuffer()); check(resources, assertCurrent);
        totalBytes += bytes.byteLength;
        if (totalBytes > LIMITS.resultBytes) reject("Total gambar hasil melampaui 50 MiB. Pilih skala lebih rendah.");
        images.push({ bytes, width: rendered.canvas.width, height: rendered.canvas.height, pageWidth: displayed.width, pageHeight: displayed.height, format: settings.type === "image/png" ? "png" : "jpg" });
      } finally {
        rendered?.clear();
        try { page.cleanup(); } catch { console.warn("Pembersihan halaman render belum terkonfirmasi."); }
      }
      progress({ stage: "render", current: index, total: opened.pdf.numPages });
    }
    return images;
  } finally { await opened.close(); }
}
export async function organizerPreview(record, resources, assertCurrent, progress = () => {}, documentPort = document) {
  const opened = await openPdf(record, resources, assertCurrent);
  const previews = [];
  let pixels = 0;
  try {
    for (let index = 1; index <= opened.pdf.numPages; index++) {
      const page = await pageFor(opened.pdf, index, resources, assertCurrent);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = LIMITS.thumbnailSide / Math.max(base.width, base.height);
        const rendered = await render(page, scale, resources, assertCurrent, documentPort);
        pixels += rendered.canvas.width * rendered.canvas.height;
        if (pixels > LIMITS.thumbnailPixels) { rendered.clear(); reject("Pratinjau melampaui 40 juta piksel."); }
        previews.push({ page: index - 1, canvas: rendered.canvas, release: rendered.clear });
      } finally { try { page.cleanup(); } catch {} }
      check(resources, assertCurrent);
      progress({ stage: "preview", current: index, total: opened.pdf.numPages });
    }
    return previews;
  } catch (error) { for (const preview of previews) preview.release(); throw error; }
  finally { await opened.close(); }
}
