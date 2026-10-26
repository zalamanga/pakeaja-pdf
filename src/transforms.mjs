import { LIMITS, PdfError, comparePages, exactKeys, pageGeometry, pagePermutation, pageRanges, pdfHeader, reject, requireInteger, textPages } from "./domain.mjs";
import { imageHeader, imageHeaders } from "./image-header.mjs";
import { croppedBox, displayPoint, fitRectangle, mm, rotatedBounds, visibleGeometry } from "./geometry.mjs";
import { resultMessage, validateCommand } from "./worker-contract.mjs";

const paperSizes = { A4: [595.28, 841.89], A3: [841.89, 1190.55], Letter: [612, 792], Legal: [612, 1008] };
function geometry(page) { return visibleGeometry(page.getMediaBox(), page.getCropBox(), page.getRotation().angle); }
function textMetrics(font, text, size, angle = 0) {
  try {
    font.encodeText(text);
    const width = font.widthOfTextAtSize(text, size), ascent = font.heightAtSize(size, { descender: false }), height = font.heightAtSize(size);
    return { ...rotatedBounds(width, ascent, Math.max(0, height - ascent), angle), textWidth: width, ascent, descent: Math.max(0, height - ascent) };
  } catch { reject("Font standar tidak dapat menampilkan teks ini. Gunakan karakter yang didukung WinAnsi."); }
}
function drawText(page, box, text, font, size, x, y, lib, extra = {}) {
  const point = displayPoint(box, x, y);
  page.drawText(text, { ...point, font, size, color: lib.rgb(0.15, 0.2, 0.28), rotate: lib.degrees(box.rotation + (extra.angle || 0)), ...(extra.opacity === undefined ? {} : { opacity: extra.opacity }) });
}
async function loadSource(bytes, lib) {
  pdfHeader(new Uint8Array(bytes));
  let document;
  try { document = await lib.PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (error) {
    if (error?.name === "EncryptedPDFError") reject("PDF masih dilindungi. Buka proteksinya terlebih dahulu.", "password_required");
    reject("PDF tidak dapat dibaca parser. File sumber tidak diubah.", "unreadable_pdf");
  }
  if (document.isEncrypted) reject("PDF masih dilindungi. Buka proteksinya terlebih dahulu.", "password_required");
  requireInteger(document.getPageCount(), 1, LIMITS.pages, "Jumlah halaman");
  for (const page of document.getPages()) geometry(page);
  return document;
}
async function savedPdf(document, expected, lib) {
  const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false });
  if (bytes.byteLength > LIMITS.resultBytes) reject("Hasil PDF melebihi 50 MiB.");
  const opened = await loadSource(bytes, lib);
  if (opened.getPageCount() !== expected) reject("Jumlah halaman PDF hasil tidak cocok.", "invalid_result");
  return bytes;
}
async function zipParts(parts, zipLibrary) {
  if (!parts.length || parts.length > LIMITS.entries || new Set(parts.map((part) => part.name)).size !== parts.length) reject("Jumlah atau nama bagian ZIP tidak valid.");
  if (parts.reduce((sum, part) => sum + part.bytes.byteLength, 0) > LIMITS.resultBytes) reject("Total isi ZIP melebihi 50 MiB.");
  const zip = new zipLibrary();
  for (const part of parts) {
    if (!part.bytes.byteLength || part.bytes.byteLength > LIMITS.resultBytes) reject("Bagian ZIP kosong atau melebihi 50 MiB.");
    zip.file(part.name, part.bytes, { date: new Date("2000-01-01T00:00:00Z"), createFolders: false });
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (bytes.byteLength > LIMITS.resultBytes) reject("ZIP hasil melebihi 50 MiB.");
  return bytes;
}
function textPayload(payload, compare = false) {
  exactKeys(payload, compare ? ["kind", "left", "right"] : ["kind", "pages", "sourceName"]);
  if (payload.kind !== (compare ? "compare" : "text")) reject("Jenis data teks tidak cocok.");
  if (!compare && (typeof payload.sourceName !== "string" || !payload.sourceName || [...payload.sourceName].length > 90 || /[\r\n\u0000-\u001f]/u.test(payload.sourceName))) reject("Judul sumber teks tidak valid.");
  const pages = compare ? [textPages(payload.left, true), textPages(payload.right, true)] : [textPages(payload.pages)];
  if (pages.reduce((sum, list) => sum + list.length, 0) > LIMITS.pages || pages.flat().reduce((sum, page) => sum + page.length, 0) > LIMITS.textUnits) reject("Total halaman atau teks pekerjaan melewati batas.");
  return pages;
}
async function textResult(command, libraries) {
  const { toolId, payload } = command;
  const lists = textPayload(payload, toolId === "compare"), pages = lists[0];
  const count = lists.reduce((sum, list) => sum + list.length, 0);
  if (toolId === "compare") return resultMessage(command.jobId, "txt", new TextEncoder().encode(comparePages(...lists).text), { sourcePages: count, outputPages: 0, entries: 1 });
  if (toolId === "pdf-word") {
    const { Document, Paragraph, TextRun, PageBreak, Packer } = libraries.docx;
    const children = [];
    let lines = 0;
    pages.forEach((page, index) => {
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(page)) reject("Teks mengandung karakter yang tidak didukung XML DOCX.");
      if (index) children.push(new Paragraph({ children: [new PageBreak()] }));
      for (const line of page.split("\n")) {
        if (++lines > LIMITS.docxLines) reject("DOCX maksimal 10000 baris. Teks tidak dipotong.");
        children.push(new Paragraph({ children: [new TextRun({ text: line })] }));
      }
    });
    const document = new Document({ creator: "", lastModifiedBy: "", title: "", description: "", subject: "", sections: [{ children }] });
    const bytes = await Packer.toArrayBuffer(document);
    return resultMessage(command.jobId, "docx", bytes, { sourcePages: count, outputPages: 0, entries: 1 }, ["DOCX berisi teks dan pemisah halaman; tata letak PDF asli tidak direkonstruksi."]);
  }
  const markdown = toolId === "pdf-markdown";
  const text = pages.map((page, index) => (markdown ? "## Halaman " : "=== Halaman ") + (index + 1) + (markdown ? "\n\n" : " ===\n") + page).join("\n\n");
  const heading = payload.sourceName.replace(/[\\\x60*_{}[\]()#+.!|>\-]/g, "\\$&");
  return resultMessage(command.jobId, markdown ? "md" : "txt", new TextEncoder().encode((markdown ? "# " + heading + "\n\n" : "") + text), { sourcePages: count, outputPages: 0, entries: 1 });
}
async function imagePayloadResult(command, libraries) {
  const { payload, toolId, options } = command;
  exactKeys(payload, ["kind", "images", "sourcePages"]);
  if (payload.kind !== "images" || !Array.isArray(payload.images)) reject("Data render tidak valid.");
  requireInteger(payload.sourcePages, 1, LIMITS.pages, "Jumlah halaman");
  if (payload.images.length !== payload.sourcePages || (toolId === "pdf-image" && payload.images.length > LIMITS.entries)) reject("Jumlah gambar render tidak sesuai.");
  let bytesTotal = 0;
  for (const image of payload.images) {
    exactKeys(image, ["bytes", "width", "height", "pageWidth", "pageHeight", "format"]);
    if (!(image.bytes instanceof ArrayBuffer)) reject("Data gambar render tidak tersedia.");
    bytesTotal += image.bytes.byteLength;
    const header = imageHeader(new Uint8Array(image.bytes));
    if (header.width !== image.width || header.height !== image.height || header.format !== image.format || image.width > LIMITS.renderSide || image.height > LIMITS.renderSide || header.pixels > LIMITS.renderPixels) reject("Ukuran gambar render tidak sesuai batas.");
    pageGeometry(image.pageWidth, image.pageHeight);
  }
  if (bytesTotal > LIMITS.resultBytes) reject("Total gambar render melebihi 50 MiB.");
  if (toolId === "pdf-image") {
    const format = options.format;
    if (payload.images.some((image) => image.format !== format)) reject("Format gambar hasil tidak cocok.");
    if (payload.images.length === 1) return resultMessage(command.jobId, format, payload.images[0].bytes, { sourcePages: 1, outputPages: 0, entries: 1 });
    const bytes = await zipParts(payload.images.map((image, index) => ({ name: "halaman-" + String(index + 1).padStart(3, "0") + "." + format, bytes: new Uint8Array(image.bytes) })), libraries.zip);
    return resultMessage(command.jobId, "zip", bytes, { sourcePages: payload.sourcePages, outputPages: 0, entries: payload.images.length });
  }
  const output = await libraries.pdf.PDFDocument.create();
  for (const image of payload.images) {
    if (image.format !== "jpg") reject("Kompresi memerlukan render JPEG.");
    const embedded = await output.embedJpg(image.bytes);
    output.addPage([image.pageWidth, image.pageHeight]).drawImage(embedded, { x: 0, y: 0, width: image.pageWidth, height: image.pageHeight });
  }
  return resultMessage(command.jobId, "pdf", await savedPdf(output, payload.sourcePages, libraries.pdf), { sourcePages: payload.sourcePages, outputPages: payload.sourcePages, entries: 1 }, ["Hasil berupa gambar halaman; teks/formulir tidak lagi interaktif dan ukuran dapat bertambah."]);
}

export async function transform(command, libraries, progress = () => {}) {
  validateCommand(command);
  const { toolId, options, files } = command;
  if (["pdf-word", "pdf-text", "pdf-markdown", "compare"].includes(toolId)) return textResult(command, libraries);
  if (["pdf-image", "compress"].includes(toolId)) return imagePayloadResult(command, libraries);
  if (command.payload !== null) reject("Data antara tidak digunakan oleh alat ini.");
  const lib = libraries.pdf;
  if (["scan-pdf", "image-pdf"].includes(toolId)) {
    const headers = imageHeaders(files.map((file) => ({ bytes: new Uint8Array(file.bytes) })));
    const output = await lib.PDFDocument.create();
    for (let index = 0; index < files.length; index++) {
      const header = headers[index], embedded = header.format === "png" ? await output.embedPng(files[index].bytes) : await output.embedJpg(files[index].bytes);
      if (embedded.width !== header.width || embedded.height !== header.height) reject("Ukuran gambar setelah decode tidak sesuai header.");
      const size = options.paper === "fit" ? [header.width * 0.75, header.height * 0.75] : paperSizes[options.paper];
      pageGeometry(...size);
      const margin = options.paper === "fit" ? 0 : 30, scale = Math.min((size[0] - margin * 2) / header.width, (size[1] - margin * 2) / header.height);
      output.addPage(size).drawImage(embedded, { x: (size[0] - header.width * scale) / 2, y: (size[1] - header.height * scale) / 2, width: header.width * scale, height: header.height * scale });
      progress({ stage: "image", current: index + 1, total: files.length });
    }
    return resultMessage(command.jobId, "pdf", await savedPdf(output, files.length, lib), { sourcePages: files.length, outputPages: files.length, entries: 1 });
  }
  const documents = [];
  let sourcePages = 0;
  for (const file of files) {
    const document = await loadSource(file.bytes, lib);
    sourcePages += document.getPageCount();
    if (sourcePages > LIMITS.pages) reject("Jumlah halaman seluruh file maksimal 200.");
    documents.push(document);
  }
  let output = documents[0], expected = output.getPageCount();
  if (toolId === "merge") {
    output = await lib.PDFDocument.create();
    for (let index = 0; index < documents.length; index++) {
      const pages = await output.copyPages(documents[index], documents[index].getPageIndices());
      for (const page of pages) output.addPage(page);
      progress({ stage: "merge", current: index + 1, total: documents.length });
    }
    expected = sourcePages;
  } else if (["extract", "delete", "organize-pages"].includes(toolId)) {
    const indices = toolId === "organize-pages" ? pagePermutation(command.pageOrder, expected) : pageRanges(options.ranges, expected);
    const selected = toolId === "delete" ? output.getPageIndices().filter((index) => !indices.includes(index)) : indices;
    if (!selected.length) reject("Setidaknya satu halaman harus tersisa.");
    const source = output; output = await lib.PDFDocument.create();
    for (const page of await output.copyPages(source, selected)) output.addPage(page);
    expected = selected.length;
  } else if (["split-page", "split-size"].includes(toolId)) {
    const perPart = toolId === "split-page" ? 1 : Math.max(1, Math.floor(options.targetMiB * 1024 * 1024 / (files[0].bytes.byteLength / expected)));
    const entries = Math.ceil(expected / perPart);
    if (entries > LIMITS.entries) reject("Pemisahan menghasilkan lebih dari 100 berkas. Pilih dokumen lebih kecil.");
    const parts = []; let total = 0;
    for (let start = 0; start < expected; start += perPart) {
      const target = await lib.PDFDocument.create(), indices = Array.from({ length: Math.min(perPart, expected - start) }, (_, index) => start + index);
      for (const page of await target.copyPages(output, indices)) target.addPage(page);
      const bytes = await savedPdf(target, indices.length, lib); total += bytes.byteLength;
      if (total > LIMITS.resultBytes) reject("Total PDF bagian melebihi 50 MiB.");
      parts.push({ name: "bagian-" + String(parts.length + 1).padStart(3, "0") + ".pdf", bytes });
      progress({ stage: "split", current: parts.length, total: entries });
    }
    return resultMessage(command.jobId, "zip", await zipParts(parts, libraries.zip), { sourcePages, outputPages: expected, entries: parts.length }, toolId === "split-size" ? ["Target ukuran bersifat perkiraan; ukuran aktual tiap bagian dapat lebih besar."] : []);
  } else if (toolId === "resize") {
    const source = output; output = await lib.PDFDocument.create();
    for (const page of source.getPages()) {
      const box = geometry(page);
      let [width, height] = paperSizes[options.paper];
      if (options.orientation === "landscape" || (options.orientation === "auto" && box.displayWidth > box.displayHeight)) [width, height] = [height, width];
      const target = output.addPage([width, height]);
      if (!page.node.Contents()) continue;
      const embedded = await output.embedPage(page, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height });
      const scale = Math.min((width - 64) / box.displayWidth, (height - 64) / box.displayHeight);
      const bounds = rotatedBounds(box.width, box.height, 0, -box.rotation);
      target.drawPage(embedded, { x: (width - bounds.width * scale) / 2 - bounds.minX * scale, y: (height - bounds.height * scale) / 2 - bounds.minY * scale, xScale: scale, yScale: scale, rotate: lib.degrees(-box.rotation) });
    }
  } else if (toolId === "rotate") {
    for (const index of pageRanges(options.ranges, expected, true)) {
      const page = output.getPage(index); page.setRotation(lib.degrees((geometry(page).rotation + options.angle) % 360));
    }
  } else if (toolId === "crop") {
    for (const page of output.getPages()) { const box = croppedBox(geometry(page), options); page.setCropBox(box.x, box.y, box.width, box.height); }
  } else if (["page-numbers", "watermark", "add-text", "sign"].includes(toolId)) {
    const font = await output.embedFont(toolId === "sign" ? lib.StandardFonts.TimesRomanItalic : toolId === "watermark" ? lib.StandardFonts.HelveticaBold : lib.StandardFonts.Helvetica);
    if (toolId === "page-numbers" && options.start + expected - 1 > 9999) reject("Nomor halaman terakhir maksimal 9999.");
    if (toolId === "add-text") requireInteger(options.page, 1, expected, "Halaman teks");
    const pages = toolId === "add-text" ? [output.getPage(options.page - 1)] : toolId === "sign" ? [output.getPages().at(-1)] : output.getPages();
    for (const [index, page] of pages.entries()) {
      const box = geometry(page);
      let text, size, x, y, angle = 0;
      if (toolId === "page-numbers") {
        text = String(options.start + index); size = 10;
        const metrics = textMetrics(font, text, size);
        x = options.position.endsWith("left") ? 24 : options.position.endsWith("right") ? box.displayWidth - 24 - metrics.textWidth : (box.displayWidth - metrics.textWidth) / 2;
        y = options.position.startsWith("top") ? box.displayHeight - 24 - metrics.ascent : 24 + metrics.descent;
      } else if (toolId === "add-text") { text = options.text; size = options.size; x = mm(options.x); y = mm(options.y); }
      else if (toolId === "sign") {
        text = options.name;
        const base = textMetrics(font, text, 22);
        size = Math.min(22, 22 * (box.displayWidth - 80) / base.textWidth);
        if (size < 8) reject("Nama tidak muat untuk tanda tangan visual.");
        const metrics = textMetrics(font, text, size), lineWidth = Math.max(120, metrics.textWidth);
        x = box.displayWidth - 48 - lineWidth; y = 53;
        fitRectangle(box, x, 46, { minX: 0, minY: 0, maxX: lineWidth, maxY: 1 }, 24);
        page.drawLine({ start: displayPoint(box, x, 46), end: displayPoint(box, x + lineWidth, 46), thickness: 0.8, color: lib.rgb(0.28, 0.34, 0.42) });
      } else {
        text = options.text; angle = -45;
        const base = textMetrics(font, text, 58, angle);
        size = Math.min(58, 58 * (box.displayWidth - 24) / base.width, 58 * (box.displayHeight - 24) / base.height);
        if (size < 6) reject("Watermark tidak muat pada halaman.");
        const metrics = textMetrics(font, text, size, angle);
        x = (box.displayWidth - metrics.width) / 2 - metrics.minX; y = (box.displayHeight - metrics.height) / 2 - metrics.minY;
      }
      fitRectangle(box, x, y, textMetrics(font, text, size, angle), toolId === "watermark" ? 12 : 0);
      drawText(page, box, text, font, size, x, y, lib, { angle, ...(toolId === "watermark" ? { opacity: options.opacity } : {}) });
    }
  } else if (toolId !== "repair") throw new PdfError("unsupported_tool", "Alat belum memiliki jalur pemrosesan yang cocok.");
  return resultMessage(command.jobId, "pdf", await savedPdf(output, expected, lib), { sourcePages, outputPages: expected, entries: 1 }, toolId === "repair" ? ["PDF ditulis ulang; pemulihan isi yang rusak tidak dijamin."] : []);
}
