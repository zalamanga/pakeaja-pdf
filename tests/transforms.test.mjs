import assert from "node:assert/strict";
import test from "node:test";
import { defaultsFor } from "../src/catalog.mjs";
import { transform } from "../src/transforms.mjs";
import { imageHeader } from "../src/image-header.mjs";

// These models exercise our page selection/geometry/export decisions. They do not parse or create a real PDF, ZIP, image or DOCX.
const encoder = new TextEncoder(), decoder = new TextDecoder();
const pdfPrefix = "%PDF-1.7\nMODEL-ONLY\n";
const encodePages = (pages) => encoder.encode(pdfPrefix + JSON.stringify(pages));
const decodePages = (bytes) => JSON.parse(decoder.decode(bytes).slice(pdfPrefix.length));
const pageState = (tag, rotation = 0) => ({ tag, media: { x: 10, y: 20, width: 600, height: 800 }, crop: { x: 10, y: 20, width: 600, height: 800 }, rotation, draws: [] });
function modelPage(state) {
  const value = structuredClone(state);
  return {
    value, node: { Contents: () => value.tag !== "blank" },
    getMediaBox: () => value.media, getCropBox: () => value.crop, getRotation: () => ({ angle: value.rotation }),
    setRotation(angle) { value.rotation = angle; },
    setCropBox(x, y, width, height) { value.crop = { x, y, width, height }; },
    drawText(text, options) { value.draws.push({ kind: "text", text, ...options, font: undefined }); },
    drawImage(image, options) { value.draws.push({ kind: "image", image, ...options }); },
    drawPage(page, options) { value.draws.push({ kind: "page", tag: page.tag, ...options }); },
    drawLine(options) { value.draws.push({ kind: "line", ...options }); },
  };
}
function modelDocument(states = []) {
  const pages = states.map(modelPage);
  return {
    isEncrypted: false,
    getPages: () => pages, getPage: (index) => pages[index], getPageCount: () => pages.length, getPageIndices: () => pages.map((_, index) => index),
    async copyPages(source, indices) { return indices.map((index) => modelPage(source.getPage(index).value)); },
    addPage(input) {
      const page = Array.isArray(input) ? modelPage({ tag: "new", media: { x: 0, y: 0, width: input[0], height: input[1] }, crop: { x: 0, y: 0, width: input[0], height: input[1] }, rotation: 0, draws: [] }) : input;
      pages.push(page); return page;
    },
    async embedPage(page) { return { tag: page.value.tag }; },
    async embedJpg(bytes) { return imageHeader(new Uint8Array(bytes)); },
    async embedPng(bytes) { return imageHeader(new Uint8Array(bytes)); },
    async embedFont() { return { encodeText(text) { if (/[^\x20-\x7e]/u.test(text)) throw new Error("model unsupported font"); }, widthOfTextAtSize: (text, size) => text.length * size * 0.5, heightAtSize: (size, options) => size * (options?.descender === false ? 0.8 : 1) }; },
    async save() { return encodePages(pages.map((page) => page.value)); },
  };
}
class ZipModel {
  parts = [];
  file(name, bytes) { this.parts.push({ name, contents: [...bytes] }); }
  async generateAsync() { return new Uint8Array([80, 75, 3, 4, ...encoder.encode(JSON.stringify(this.parts))]); }
}
class DocxElement { constructor(options) { this.options = options; } }
const libraries = {
  pdf: { PDFDocument: { create: async () => modelDocument(), load: async (bytes) => modelDocument(decodePages(bytes)) }, StandardFonts: { Helvetica: "Helvetica", HelveticaBold: "HelveticaBold", TimesRomanItalic: "TimesRomanItalic" }, degrees: (value) => value, rgb: (...values) => values },
  zip: ZipModel,
  docx: { Document: DocxElement, Paragraph: DocxElement, TextRun: DocxElement, PageBreak: DocxElement, Packer: { toArrayBuffer: async (document) => new Uint8Array([80, 75, 3, 4, ...encoder.encode(JSON.stringify(document))]).buffer } },
};
const buffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const pdf = (tags) => buffer(encodePages(tags.map((tag) => typeof tag === "string" ? pageState(tag) : tag)));
const command = (toolId, files = [pdf(["A", "B", "C"])], options = {}, payload = null, pageOrder = []) => ({ kind: "process", jobId: "model-job", toolId, options: { ...defaultsFor(toolId), ...options }, files: files.map((bytes, index) => ({ id: "file-" + index, bytes })), pageOrder, payload });
const run = (toolId, files, options, payload, order) => transform(command(toolId, files, options, payload, order), libraries);
const tags = (result) => decodePages(result.bytes).map((page) => page.tag);
const parts = (result) => JSON.parse(decoder.decode(new Uint8Array(result.bytes).subarray(4)));
const jpeg = (width = 200, height = 100) => new Uint8Array([255, 216, 255, 192, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 255, 217]);

test("copying tools preserve requested page identity/order; split archives preserve every page exactly once", async () => {
  assert.deepEqual(tags(await run("merge", [pdf(["A", "B"]), pdf(["C"])])), ["A", "B", "C"]);
  assert.deepEqual(tags(await run("extract", undefined, { ranges: "3,1,3" })), ["C", "A"]);
  assert.deepEqual(tags(await run("delete", undefined, { ranges: "2" })), ["A", "C"]);
  assert.deepEqual(tags(await run("organize-pages", undefined, {}, null, [2, 0, 1])), ["C", "A", "B"]);
  assert.deepEqual(tags(await run("repair")), ["A", "B", "C"]);
  for (const id of ["split-page", "split-size"]) {
    const result = await run(id), archive = parts(result);
    assert.equal(result.counts.entries, id === "split-page" ? 3 : 1);
    assert.deepEqual(archive.flatMap((part) => decodePages(new Uint8Array(part.contents)).map((page) => page.tag)), ["A", "B", "C"]);
    assert.equal(new Set(archive.map((part) => part.name)).size, archive.length);
    assert.equal(result.warnings.length, id === "split-size" ? 1 : 0);
  }
});
test("rotation is additive and selected; crop retains content; resize retains blank pages and proportional placement", async () => {
  const source = [pdf([pageState("A", 90), pageState("blank")])];
  const rotated = decodePages((await run("rotate", source, { ranges: "1", angle: 180 })).bytes);
  assert.deepEqual(rotated.map((page) => page.rotation), [270, 0]);
  const cropped = decodePages((await run("crop", source, { left: 1, right: 2, top: 3, bottom: 4 })).bytes);
  assert.equal(cropped[0].tag, "A"); assert.equal(cropped[1].tag, "blank");
  assert.ok(Math.abs(cropped[0].crop.x - (10 + 3 * 72 / 25.4)) < 1e-7);
  const resized = decodePages((await run("resize", source, { paper: "Letter" })).bytes);
  assert.equal(resized.length, 2); assert.equal(resized[0].draws[0].tag, "A");
  assert.equal(resized[0].draws[0].xScale, resized[0].draws[0].yScale);
  assert.deepEqual(resized[1].draws, []);
});
test("text overlays honor target page, visible positions, consecutive numbering and last-page-only visual signature", async () => {
  const numbered = decodePages((await run("page-numbers", undefined, { start: 8, position: "top-right" })).bytes);
  assert.deepEqual(numbered.map((page) => page.draws[0].text), ["8", "9", "10"]);
  assert.ok(numbered.every((page) => page.draws[0].y > 700));
  const text = decodePages((await run("add-text", undefined, { text: "Invoice", page: 2, x: 10, y: 20 })).bytes);
  assert.deepEqual(text.map((page) => page.draws.length), [0, 1, 0]);
  assert.ok(Math.abs(text[1].draws[0].x - (10 + 10 * 72 / 25.4)) < 1e-7);
  const watermark = decodePages((await run("watermark", undefined, { text: "DRAFT" })).bytes);
  assert.ok(watermark.every((page) => page.draws[0].text === "DRAFT" && page.draws[0].rotate === -45 && page.draws[0].opacity === 0.28));
  const signature = decodePages((await run("sign", undefined, { name: "Dina" })).bytes);
  assert.deepEqual(signature.map((page) => page.draws.length), [0, 0, 2]);
  assert.equal(signature[2].draws[1].text, "Dina");
});
test("text exports preserve literal source text/page boundaries and DOCX declares text-only reconstruction", async () => {
  const payload = { kind: "text", pages: ["First & <line>\nSecond", "Third"], sourceName: "notes_[draft]" };
  const text = await run("pdf-text", [], {}, payload), markdown = await run("pdf-markdown", [], {}, payload);
  assert.match(decoder.decode(text.bytes), /=== Halaman 2 ===\nThird/);
  assert.ok(decoder.decode(markdown.bytes).startsWith("# notes\\_\\[draft\\]"));
  assert.ok(decoder.decode(markdown.bytes).includes("First & <line>"));
  const docx = await run("pdf-word", [], {}, payload), structure = parts(docx);
  assert.equal(structure.options.creator, ""); assert.equal(structure.options.sections[0].children.length, 4);
  assert.match(docx.warnings[0], /tata letak PDF asli tidak direkonstruksi/);
  const comparison = await run("compare", [], {}, { kind: "compare", left: ["same", ""], right: ["same"] });
  assert.match(decoder.decode(comparison.bytes), /halaman B tidak ada/);
});
test("image tools retain input order and page count; compression is explicitly a raster reconstruction", async () => {
  const first = buffer(jpeg(200, 100)), second = buffer(jpeg(300, 150));
  for (const id of ["image-pdf", "scan-pdf"]) {
    const result = await run(id, [first, second], { paper: "fit" });
    const output = decodePages(result.bytes);
    assert.deepEqual(output.map((page) => [page.media.width, page.media.height]), [[150, 75], [225, 112.5]]);
  }
  const image = { bytes: first, width: 200, height: 100, pageWidth: 600, pageHeight: 800, format: "jpg" };
  const one = await run("pdf-image", [], {}, { kind: "images", images: [image], sourcePages: 1 });
  assert.deepEqual(new Uint8Array(one.bytes), jpeg());
  const many = await run("pdf-image", [], {}, { kind: "images", images: [image, { ...image, bytes: second, width: 300, height: 150 }], sourcePages: 2 });
  assert.deepEqual(parts(many).map((part) => part.name), ["halaman-001.jpg", "halaman-002.jpg"]);
  const compressed = await run("compress", [], {}, { kind: "images", images: [image], sourcePages: 1 });
  assert.equal(decodePages(compressed.bytes)[0].draws[0].kind, "image");
  assert.match(compressed.warnings[0], /teks\/formulir tidak lagi interaktif/);
});
test("invalid destructive selection, unrepresentable text and impossible numbering produce no partial result", async () => {
  await assert.rejects(run("delete", undefined, { ranges: "1-3" }), /satu halaman harus tersisa/);
  await assert.rejects(run("page-numbers", undefined, { start: 9999 }), /terakhir maksimal 9999/);
  await assert.rejects(run("add-text", undefined, { text: "unsupported \u{1f512}" }), /WinAnsi/);
  await assert.rejects(run("pdf-word", [], {}, { kind: "text", pages: ["bad\u0001text"], sourceName: "test" }), /XML DOCX/);
});
