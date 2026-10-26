import assert from "node:assert/strict";
import test from "node:test";
import { CATEGORIES, TOOLS, defaultsFor } from "../src/catalog.mjs";
import { LIMITS, PdfError, comparePages, optionsFromStrings, pagePermutation, pageRanges, renderGeometry, safeFilename, textPages, validateOptions, validateSelection } from "../src/domain.mjs";
import { imageHeader, imageHeaders } from "../src/image-header.mjs";
import { croppedBox, displayPoint, rotatedBounds, visibleGeometry } from "../src/geometry.mjs";
import { ownerSecret, qpdfArguments, validatePassword } from "../src/native-options.mjs";
import { resultMessage, validateCommand, validateResult, workerFailure } from "../src/worker-contract.mjs";

const expected = ["merge", "extract", "split-page", "split-size", "delete", "organize-pages", "scan-pdf", "pdf-image", "pdf-word", "pdf-text", "image-pdf", "compress", "resize", "repair", "rotate", "page-numbers", "watermark", "crop", "add-text", "sign", "protect", "unlock", "compare", "rename", "pdf-markdown"];
test("worker forwards only own typed bounded errors, never name-spoofed engine diagnostics", () => {
  assert.deepEqual(workerFailure(new PdfError("invalid_input", "Pilihan halaman tidak valid."), "job-1"), { kind: "error", jobId: "job-1", code: "invalid_input", message: "Pilihan halaman tidak valid." });
  for (const error of [Object.assign(new Error("private diagnostic"), { name: "PdfError", code: "invalid_input" }), { name: "PdfError", code: "invalid_input", message: "private diagnostic" }, new PdfError("unrecognized", "private diagnostic"), new PdfError("invalid_input", "x".repeat(1001))]) {
    const failure = workerFailure(error, "job-1");
    assert.equal(failure.code, "engine_failure");
    assert.equal(failure.message, "Mesin belum dapat menyelesaikan file ini. Tidak ada hasil parsial yang diterbitkan.");
  }
});
test("all25 retained tools and categories remain exact with no duplicate route", () => {
  assert.deepEqual(TOOLS.map((tool) => tool.id), expected); assert.equal(new Set(expected).size, 25);
  assert.ok(CATEGORIES.includes("Keamanan")); assert.ok(CATEGORIES.includes("PDF Intelligence"));
  for (const tool of TOOLS) assert.deepEqual(Object.keys(defaultsFor(tool.id)), Object.keys(tool.options));
});
test("range order preserves first mention and rejects invalid, reversed, zero or out-of-range tokens", () => {
  assert.deepEqual(pageRanges("3,1-2,3, 5", 5), [2, 0, 1, 4]);
  assert.deepEqual(pageRanges("", 3, true), [0, 1, 2]);
  for (const raw of ["", "0", "-1", "2-1", "1,,2", "1-", "1.5", "01", "6", "1e2"]) assert.throws(() => pageRanges(raw, 5));
});
test("numeric zero survives exact option conversion while unknown and invalid options are rejected", () => {
  assert.deepEqual(optionsFromStrings("crop", { left: "0", right: "0", top: "0", bottom: "0" }), { left: 0, right: 0, top: 0, bottom: 0 });
  for (const raw of [{ left: "", right: "0", top: "0", bottom: "0" }, { left: "-1", right: "0", top: "0", bottom: "0" }, { left: "0", right: "0", top: "0", bottom: "0", hidden: "ignored?" }]) assert.throws(() => optionsFromStrings("crop", raw));
  assert.throws(() => validateOptions("rotate", { ranges: "", angle: "90" }));
  assert.throws(() => validateOptions("page-numbers", { start: 0, position: "bottom-center" }));
  assert.throws(() => validateOptions("sign", { name: " " }));
});
test("password values preserve deliberate whitespace, leadingdash/@ and exact Unicode byte boundary", () => {
  for (const value of ["  delapan huruf  ", "-rahasia-ku", "@sandi-baru", "漢字-cukup-lama"]) assert.equal(validatePassword(value, true), value);
  const boundary = "é".repeat(60) + "abcdefg";
  assert.equal(new TextEncoder().encode(boundary).byteLength, 127); assert.equal(validatePassword(boundary, true), boundary);
  assert.equal(validatePassword(""), "");
  for (const value of [boundary + "x", "abcdefgh\0", "abcdefgh\n", "abcdefgh\t", "abcdefgh\u0085", "abcdefgh\ud800", "abcdefgh\udfff"]) assert.throws(() => validatePassword(value));
  assert.throws(() => validatePassword("short", true));
});
test("native args use option-form passwords with distinct32byte random owner secret and never positional expansion", () => {
  const password = "@ leading password ";
  const secret = ownerSecret(password, { getRandomValues: (bytes) => bytes.fill(17) });
  assert.match(secret, /^[a-f0-9]{64}$/); assert.notEqual(secret, password);
  const args = qpdfArguments("protect", password, secret);
  assert.ok(args.includes("--user-password=" + password)); assert.ok(args.includes("--owner-password=" + secret)); assert.ok(args.includes("--bits=256")); assert.equal(args.includes(password), false);
  assert.deepEqual(qpdfArguments("unlock", "-pass", undefined), ["--password=-pass", "--decrypt", "/input.pdf", "/output.pdf"]);
  assert.throws(() => ownerSecret("password", {}));
});
test("file count/byte failures reject entire addition and total job bounds remain explicit", () => {
  const file = (name, size) => ({ name, size, arrayBuffer() {} });
  const first = { id: "a", file: file("one.pdf", 20 * 1024 * 1024) };
  assert.equal(validateSelection("merge", [first])[0], first);
  assert.throws(() => validateSelection("merge", [first, { id: "b", file: file("big.pdf", LIMITS.fileBytes + 1) }]));
  assert.throws(() => validateSelection("compare", [first], true));
  assert.throws(() => validateSelection("repair", [first, { ...first, id: "b" }]));
  assert.throws(() => validateSelection("merge", [first, first]));
});
test("page permutation is exact and filename sanitization retains visible Unicode without path/device names", () => {
  assert.deepEqual(pagePermutation([2, 0, 1], 3), [2, 0, 1]);
  for (const order of [[0, 0, 2], [0, 1], [0, 1, 3], [0, 1.2, 2]]) assert.throws(() => pagePermutation(order, 3));
  assert.throws(() => pagePermutation([], 0));
  assert.equal(safeFilename("CON.pdf"), "_CON"); assert.equal(safeFilename("Laporan 漢字.pdf"), "Laporan 漢字");
  assert.equal(/[<>:"/\\|?*]/.test(safeFilename("../a:b?.pdf")), false);
});
test("additional blank page is a real compare difference and equal blank pages remain equal", () => {
  assert.equal(comparePages([""], [""]).differences, 0);
  const difference = comparePages(["", ""], [""]);
  assert.equal(difference.differences, 1); assert.match(difference.text, /halaman B tidak ada/);
  assert.throws(() => textPages(["", "  "]));
  assert.throws(() => textPages(["x".repeat(LIMITS.textUnits + 1)]));
});
function png(width, height, animated = false) {
  const chunk = (type, body) => { const bytes = new Uint8Array(body.length + 12), view = new DataView(bytes.buffer); view.setUint32(0, body.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(body, 8); return bytes; };
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), ...(animated ? [chunk("acTL", new Uint8Array(8))] : []), chunk("IDAT", new Uint8Array([1])), chunk("IEND", new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0)); let offset = 0;
  for (const bytes of chunks) { result.set(bytes, offset); offset += bytes.length; } return result;
}
test("encoded image header bounds reject huge/APNG/truncated input before any decoder runs", () => {
  assert.deepEqual(imageHeader(png(100, 200)), { format: "png", width: 100, height: 200, pixels: 20_000 });
  for (const bytes of [png(12001, 1), png(5000, 5000), png(10, 10, true), png(100, 100).subarray(0, 30), new Uint8Array([1, 2, 3])]) assert.throws(() => imageHeader(bytes));
  assert.throws(() => imageHeaders([{ bytes: png(4000, 3000) }, { bytes: png(4000, 3000) }]));
  const jpeg = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 100, 0, 200, 1, 255, 217]);
  assert.deepEqual(imageHeader(jpeg), { format: "jpg", width: 200, height: 100, pixels: 20000 });
});
test("rotation/crop coordinates preserve displayed lower-left for allfour rotations and crop margins", () => {
  const source = { x: 10, y: 20, width: 100, height: 200 };
  const expectedOrigins = [[10, 20], [110, 20], [110, 220], [10, 220]];
  for (const [index, rotation] of [0, 90, 180, 270].entries()) {
    const box = visibleGeometry(source, source, rotation), point = displayPoint(box, 0, 0);
    assert.deepEqual([point.x, point.y], expectedOrigins[index]);
    assert.equal(box.displayWidth, rotation % 180 ? 200 : 100);
  }
  const rotated = visibleGeometry(source, source, 90), cropped = croppedBox(rotated, { left: 1, right: 2, top: 3, bottom: 4 });
  assert.ok(Math.abs(cropped.x - (10 + 3 * 72 / 25.4)) < 1e-8); assert.ok(Math.abs(cropped.y - (20 + 72 / 25.4)) < 1e-8);
  assert.throws(() => croppedBox(rotated, { left: 500, right: 0, top: 0, bottom: 0 }));
  assert.throws(() => visibleGeometry(source, source, 45)); assert.equal(rotatedBounds(100, 20, 0, -90).height, 100);
  assert.deepEqual(renderGeometry(280, 0.5), { width: 280, height: 1 });
});
test("worker input/result reject foreign shape/IDs/family and rename is the explicit parser exception", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\nsynthetic header only").buffer;
  const command = { kind: "process", jobId: "job-test", toolId: "repair", options: {}, files: [{ id: "file-test", bytes: pdf }], pageOrder: [], payload: null };
  assert.equal(validateCommand(command), command);
  assert.throws(() => validateCommand({ ...command, extra: true }));
  const result = resultMessage("job-test", "pdf", pdf, { sourcePages: 1, outputPages: 1, entries: 1 });
  assert.throws(() => validateResult(result, "other", "repair"));
  assert.throws(() => validateResult({ ...result, format: "txt" }, "job-test", "repair"));
  const copy = resultMessage("job-copy", "pdf", new Uint8Array([1, 2, 3]), { sourcePages: 0, outputPages: 0, entries: 1 }, [], "rename");
  assert.equal(validateResult(copy, "job-copy", "rename"), copy);
  assert.throws(() => validateResult(copy, "job-copy", "repair"));
});
