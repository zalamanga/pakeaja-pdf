import { CATEGORIES, TOOLS, defaultsFor, toolById } from "./catalog.mjs";
import { ICONS } from "./icons.mjs";
import { LIMITS, PdfError, optionsFromStrings, pagePermutation, pdfHeader, validateSelection } from "./domain.mjs";
import { imageHeader } from "./image-header.mjs";
import { PdfSession } from "./session.mjs";
import { FileAcceptance, JobResources, ResultUrl, requestDownload } from "./resources.mjs";
import { organizerPreview } from "./pdfjs.mjs";
import { processJob } from "./process.mjs";

const ids = ["search", "startup", "categories", "catalog", "empty", "dialog", "dialog-title", "dialog-category", "dialog-description", "controls", "files", "file-hint", "dropzone", "file-list", "options", "organizer", "preview", "page-list", "process", "cancel", "close", "status", "error", "result", "result-name", "result-size", "result-notes", "download"];
const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
if (Object.values(ui).some((value) => !value)) throw new Error("Antarmuka PDF belum lengkap.");
let filter = "Semua alat", query = "", active = null, accepting = false, acceptNonce = 0, previews = [], previewFile = null, draggedPage = null;
const acceptance = new FileAcceptance(), resultUrl = new ResultUrl(), imageHeaders = new WeakMap(), downloadUrls = new Set();
const bytesLabel = (bytes) => bytes < 1024 * 1024 ? (bytes / 1024).toLocaleString("id-ID", { maximumFractionDigits: 1 }) + " KiB" : (bytes / 1024 / 1024).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + " MiB";
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
const status = (text) => { ui.status.textContent = text; };
const error = (value) => {
  ui.error.textContent = value instanceof PdfError ? value.message : "File atau mesin belum dapat menyelesaikan proses ini. Periksa file/pengaturan, lalu coba lagi.";
  ui.error.hidden = false;
};
function clearPreviews() {
  for (const item of previews) { try { URL.revokeObjectURL(item.url); } catch { console.warn("Tautan pratinjau belum dapat dilepas."); } }
  previews = []; previewFile = null; ui["page-list"].replaceChildren();
}
function stopActive() {
  active?.resources.close(); active = null; resultUrl.clear();
}
function stopAcceptance() { acceptNonce++; acceptance.cancel(); accepting = false; }
const session = new PdfSession({ stop: stopActive, changed: renderSession });
function clearMessages() { ui.error.hidden = true; ui.error.textContent = ""; status(""); }
function action(label, handler, disabled = false) {
  const button = node("button", label); button.type = "button"; button.disabled = disabled; button.addEventListener("click", handler); return button;
}
function icon(name) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.setAttribute("viewBox", "0 0 24 24"); element.setAttribute("fill", "none"); element.setAttribute("stroke", "currentColor"); element.setAttribute("stroke-width", "1.7"); element.setAttribute("stroke-linecap", "round"); element.setAttribute("stroke-linejoin", "round"); element.setAttribute("aria-hidden", "true"); element.classList.add("tool-icon");
  element.innerHTML = ICONS[name] || ICONS.pdf;
  return element;
}
function renderCatalog() {
  ui.categories.replaceChildren(...CATEGORIES.map((category) => {
    const button = action(category, () => { filter = category; renderCatalog(); });
    button.setAttribute("aria-pressed", String(filter === category)); return button;
  }));
  const shown = TOOLS.filter((tool) => (filter === "Semua alat" || tool.category === filter) && (tool.title + " " + tool.description).toLocaleLowerCase("id-ID").includes(query));
  ui.catalog.replaceChildren();
  for (const category of CATEGORIES.slice(1)) {
    const tools = shown.filter((tool) => tool.category === category); if (!tools.length) continue;
    const section = node("section", undefined, "group"), heading = node("h3", category), cards = node("div", undefined, "cards");
    for (const tool of tools) {
      const card = action("", () => openTool(tool.id)); card.className = "tool-card";
      const mapping = { "split-page": "split", "split-size": "size", rotate: "resize", crop: "resize", "page-numbers": "text", watermark: "text", "add-text": "text", sign: "text", "pdf-image": "image", "pdf-word": "word", "pdf-text": "text", "pdf-markdown": "text", compare: "text", "organize-pages": "organize", "scan-pdf": "image-pdf", repair: "optimize" };
      card.append(icon(mapping[tool.id] || tool.id), node("strong", tool.title), node("p", tool.description)); cards.append(card);
    }
    section.append(heading, cards); ui.catalog.append(section);
  }
  ui.empty.hidden = shown.length > 0;
}
function renderOptions(tool) {
  const defaults = defaultsFor(tool.id);
  ui.options.replaceChildren();
  for (const [key, field] of Object.entries(tool.options)) {
    const label = node("label", undefined, "option" + (field.kind === "text" ? " option-text" : ""));
    label.append(node("span", field.label));
    const input = field.kind === "select" ? node("select") : node("input");
    input.dataset.option = key;
    if (field.kind === "select") for (const value of field.values) {
      const option = node("option", String(value)); option.value = String(value); input.append(option);
    } else {
      input.type = field.password ? "password" : field.kind === "integer" ? "number" : "text";
      if (field.kind === "integer") { input.min = String(field.minimum); input.max = String(field.maximum); input.step = "1"; input.inputMode = "numeric"; }
      if (field.password) { input.autocomplete = tool.id === "protect" ? "new-password" : "off"; input.spellcheck = false; }
    }
    input.value = String(defaults[key]); label.append(input);
    if (field.maximum !== undefined && field.kind === "text" && !field.password) label.append(node("small", "Maksimal " + field.maximum + " karakter.", "muted"));
    ui.options.append(label);
  }
}
function openTool(id) {
  stopAcceptance(); clearPreviews(); clearMessages(); session.open(id);
  const tool = toolById(id);
  ui["dialog-title"].textContent = tool.title; ui["dialog-category"].textContent = tool.category; ui["dialog-description"].textContent = tool.description;
  renderOptions(tool); ui.files.value = "";
  ui.files.accept = tool.input === "image" ? ".jpg,.jpeg,.png,image/jpeg,image/png" : ".pdf,application/pdf";
  ui.files.multiple = ["merge", "compare", "image-pdf", "scan-pdf"].includes(id);
  if (id === "scan-pdf") ui.files.setAttribute("capture", "environment"); else ui.files.removeAttribute("capture");
  ui["file-hint"].textContent = tool.input === "image" ? "PNG/JPEG: total maksimal 20 juta piksel. Batas file tetap 25 MiB/file dan 50 MiB total." : "PDF: 25 MiB/file, 50 MiB total, 200 halaman per pekerjaan.";
  ui.organizer.hidden = id !== "organize-pages"; ui.controls.disabled = false;
  renderSession(); if (!ui.dialog.open) ui.dialog.showModal();
  ui.files.focus();
}
function renderSession() {
  if (!session.tool) { ui.controls.disabled = true; return; }
  const disabled = session.busy || accepting;
  ui.controls.disabled = disabled; ui.cancel.hidden = !session.busy;
  ui.dialog.setAttribute("aria-busy", String(disabled));
  ui.process.disabled = disabled || !session.files.length || (session.tool === "organize-pages" && !session.pageOrder.length);
  ui.preview.disabled = disabled || session.files.length !== 1;
  ui["file-list"].replaceChildren(...session.files.map((record, index) => {
    const item = node("li", undefined, "file-row"), description = node("div"), actions = node("div", undefined, "row-actions");
    item.dataset.fileId = record.id;
    description.append(node("strong", (index + 1) + ". " + record.file.name, "file-name"), node("span", bytesLabel(record.file.size), "file-size"));
    const modify = (change) => {
      clearPreviews(); clearMessages(); change();
      const rows = [...ui["file-list"].children], row = rows.find((element) => element.dataset.fileId === record.id) || rows[Math.min(index, rows.length - 1)];
      (row?.querySelector("button:not(:disabled)") || ui.files).focus();
      status("Daftar file berubah. Periksa urutan dan proses ulang untuk membuat hasilnya.");
    };
    const up = action("Naik", () => modify(() => session.move(record.id, -1)), index === 0 || disabled), down = action("Turun", () => modify(() => session.move(record.id, 1)), index === session.files.length - 1 || disabled), remove = action("Hapus", () => modify(() => session.remove(record.id)), disabled);
    up.setAttribute("aria-label", "Naikkan file " + record.file.name); down.setAttribute("aria-label", "Turunkan file " + record.file.name); remove.setAttribute("aria-label", "Hapus file " + record.file.name);
    actions.append(up, down, remove); item.append(description, actions); return item;
  }));
  const result = session.result;
  ui.result.hidden = !result;
  if (result) {
    ui["result-name"].textContent = result.filename;
    ui["result-size"].textContent = "Sumber: " + bytesLabel(result.inputBytes) + " · Hasil: " + bytesLabel(result.blob.size) + (result.counts.outputPages ? " · " + result.counts.outputPages + " halaman PDF" : "") + (result.counts.entries > 1 ? " · " + result.counts.entries + " berkas dalam arsip" : "");
    ui["result-notes"].replaceChildren(...result.warnings.map((text) => node("li", text)));
  }
  renderPageOrder();
}
async function acceptFiles(list) {
  if (!session.tool || session.busy || accepting) return;
  const incoming = Array.from(list);
  if (!incoming.length) return;
  const nonce = ++acceptNonce, epoch = session.epoch, toolId = session.tool;
  const check = () => { if (nonce !== acceptNonce || epoch !== session.epoch || toolId !== session.tool || !ui.dialog.open) throw new DOMException("Pilihan berubah.", "AbortError"); };
  const owned = acceptance.begin(check);
  accepting = true; clearMessages(); status("Memeriksa file sebelum menambahkannya…"); renderSession();
  try {
    const candidate = [...session.files, ...incoming.map((file) => ({ id: crypto.randomUUID(), file }))];
    validateSelection(toolId, candidate);
    if (toolById(toolId).input === "image") {
      let pixels = 0;
      for (const record of candidate) {
        let header = imageHeaders.get(record.file);
        if (!header) { const bytes = await acceptance.read(owned, () => record.file.arrayBuffer()); header = imageHeader(new Uint8Array(bytes)); imageHeaders.set(record.file, header); }
        pixels += header.pixels;
        if (pixels > LIMITS.imagePixels) throw new PdfError("invalid_input", "Jumlah piksel semua gambar maksimal 20 juta. Pilihan lama tetap tersimpan.");
      }
    } else if (toolId !== "rename") for (const file of incoming) {
      const bytes = await acceptance.read(owned, () => file.slice(0, 1024).arrayBuffer()); pdfHeader(new Uint8Array(bytes));
    }
    check(); clearPreviews(); session.add(incoming); status(incoming.length + " file ditambahkan. Periksa urutan dan pengaturan sebelum memproses.");
  } catch (value) {
    if (value?.name !== "AbortError" && nonce === acceptNonce) error(value instanceof PdfError && value.code === "timeout"
      ? new PdfError("timeout", "Pemeriksaan file melewati batas 60 detik. Pilihan lama tetap tersedia; coba lagi atau pilih file lebih kecil.") : value);
  }
  finally { if (acceptance.finish(owned) && nonce === acceptNonce) { accepting = false; renderSession(); ui.files.value = ""; } }
}
function renderPageOrder() {
  ui["page-list"].replaceChildren();
  if (session.tool !== "organize-pages" || !previews.length || previewFile !== session.files[0]?.id) return;
  const byPage = new Map(previews.map((item) => [item.page, item]));
  session.pageOrder.forEach((page, index) => {
    const preview = byPage.get(page); if (!preview) return;
    const item = node("li", undefined, "page-card"), image = node("img"), actions = node("div", undefined, "row-actions");
    item.draggable = !session.busy; image.src = preview.url; image.alt = "Pratinjau halaman sumber " + (page + 1);
    item.append(image, node("strong", "Posisi " + (index + 1)), node("div", "Halaman sumber " + (page + 1)));
    const move = (offset) => {
      const order = [...session.pageOrder], to = index + offset;
      if (to < 0 || to >= order.length) return;
      [order[index], order[to]] = [order[to], order[index]]; session.order(order, order.length); status("Urutan berubah. Proses ulang untuk membuat hasilnya.");
      ui["page-list"].children[to]?.querySelector("button:not(:disabled)")?.focus();
    };
    actions.append(action("Naik", () => move(-1), index === 0 || session.busy), action("Turun", () => move(1), index === session.pageOrder.length - 1 || session.busy));
    item.addEventListener("dragstart", (event) => { if (session.busy) { event.preventDefault(); return; } draggedPage = page; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", "page"); });
    item.addEventListener("dragover", (event) => { if (!session.busy && draggedPage !== null) event.preventDefault(); });
    item.addEventListener("drop", (event) => {
      event.preventDefault(); event.stopPropagation();
      if (session.busy || draggedPage === null) return;
      const order = [...session.pageOrder], from = order.indexOf(draggedPage);
      if (from >= 0) { order.splice(from, 1); order.splice(index, 0, draggedPage); session.order(order, order.length); status("Urutan halaman berubah. Proses ulang untuk membuat hasilnya."); }
      draggedPage = null;
    });
    item.addEventListener("dragend", () => { draggedPage = null; });
    item.append(actions); ui["page-list"].append(item);
  });
}
function progress(value) {
  const stages = { text: "Membaca teks halaman", render: "Merender halaman", preview: "Membaca pratinjau halaman", image: "Menambahkan gambar", merge: "Menggabungkan file", split: "Membuat bagian PDF", save: "Menulis hasil" };
  status((stages[value.stage] || "Memproses") + " " + value.current + " dari " + value.total + "…");
}
function startJob(kind, options) {
  clearMessages();
  const job = session.begin(kind, options), resources = new JobResources();
  active = { job, resources }; return { job, resources, assertCurrent: () => session.assertCurrent(job) };
}
async function previewPages() {
  if (session.busy || accepting || session.files.length !== 1) return;
  let job, resources, local = [], urls = [];
  try {
    ({ job, resources } = startJob("preview", {}));
    local = await organizerPreview(job.files[0], resources, () => session.assertCurrent(job), progress);
    session.assertCurrent(job); resources.check();
    for (const item of local) {
      const blob = await resources.wait(new Promise((resolve) => item.canvas.toBlob(resolve, "image/png")));
      session.assertCurrent(job); resources.check();
      if (!blob || blob.size > LIMITS.resultBytes) throw new PdfError("invalid_result", "Pratinjau halaman belum dapat disimpan.");
      const url = URL.createObjectURL(blob); urls.push({ page: item.page, url }); item.release();
    }
    session.assertCurrent(job); resources.check(); clearPreviews(); previews = urls; urls = []; previewFile = job.files[0].id;
    session.finishPreview(job, local.map((item) => item.page));
    status(local.length + " halaman siap disusun. Gunakan tombol Naik/Turun atau seret.");
  } catch (value) { if ((!job || session.fail(job)) && value?.name !== "AbortError") error(value); }
  finally {
    for (const item of local) item.release();
    for (const item of urls) { try { URL.revokeObjectURL(item.url); } catch {} }
    resources?.close(); if (active?.job === job) active = null;
    if (job && session.epoch === job.epoch && session.tool === job.toolId) renderSession();
  }
}
async function processFiles() {
  if (session.busy || accepting) return;
  const capturedTool = session.tool, capturedEpoch = session.epoch;
  const passwordInputs = [...ui.options.querySelectorAll('input[type="password"]')];
  let job, resources;
  try {
    const raw = Object.fromEntries([...ui.options.querySelectorAll("[data-option]")].map((input) => [input.dataset.option, input.value]));
    const options = optionsFromStrings(session.tool, raw);
    if (session.tool === "organize-pages") pagePermutation(session.pageOrder, previews.length);
    ({ job, resources } = startJob("process", options));
    status("Membaca dan memeriksa file…");
    const result = await processJob(job, resources, () => session.assertCurrent(job), progress);
    session.assertCurrent(job); resources.check(); resultUrl.replace(result.blob);
    session.finish(job, result); status("Hasil selesai untuk pilihan ini. Periksa sebelum digunakan."); ui.download.focus();
  } catch (value) {
    if (!job || session.fail(job)) { if (value?.name !== "AbortError") error(value); }
  } finally {
    const same = session.tool === capturedTool && session.epoch === (job?.epoch ?? capturedEpoch);
    for (const input of passwordInputs) if (same || !input.isConnected) input.value = "";
    resources?.close(); if (active?.job === job) active = null;
    if (same) renderSession();
  }
}
ui.search.addEventListener("input", () => { query = ui.search.value.toLocaleLowerCase("id-ID").trim(); renderCatalog(); });
ui.files.addEventListener("change", () => void acceptFiles(ui.files.files));
for (const eventName of ["dragover", "dragenter"]) ui.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); if (!session.busy && !accepting) ui.dropzone.classList.add("drag-over"); });
for (const eventName of ["dragleave", "drop"]) ui.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); ui.dropzone.classList.remove("drag-over"); });
ui.dropzone.addEventListener("drop", (event) => void acceptFiles(event.dataTransfer.files));
ui.options.addEventListener("input", () => { session.invalidate(); clearMessages(); status("Pengaturan berubah. Proses ulang untuk membuat hasilnya."); });
ui.preview.addEventListener("click", () => void previewPages());
ui.process.addEventListener("click", () => void processFiles());
ui.cancel.addEventListener("click", () => { session.invalidate(); for (const input of ui.options.querySelectorAll('input[type="password"]')) input.value = ""; status("Proses dibatalkan. File pilihan tetap tersedia."); });
ui.close.addEventListener("click", () => { stopAcceptance(); ui.dialog.close(); });
ui.dialog.addEventListener("cancel", () => { stopAcceptance(); session.invalidate(); });
ui.dialog.addEventListener("close", () => { stopAcceptance(); session.close(); clearPreviews(); for (const input of ui.options.querySelectorAll('input[type="password"]')) input.value = ""; });
ui.download.addEventListener("click", () => {
  const result = session.result; if (!result) return;
  const url = URL.createObjectURL(result.blob); downloadUrls.add(url);
  try {
    const outcome = requestDownload(document, url, result.filename, (cleanup) => setTimeout(() => { cleanup(); try { URL.revokeObjectURL(url); downloadUrls.delete(url); } catch { console.warn("Tautan unduhan belum dapat dilepas."); } }, 1500));
    status(outcome.requested ? "Permintaan unduhan dikirim ke browser. Periksa lokasi unduhan atau dialog simpan." : "Permintaan unduhan belum dikirim.");
  } catch { try { URL.revokeObjectURL(url); downloadUrls.delete(url); } catch {} error(new PdfError("download_failed", "Browser belum dapat memulai unduhan. Hasil masih tersedia untuk dicoba lagi.")); }
});
document.addEventListener("keydown", (event) => { if (event.key === "/" && !ui.dialog.open && !event.target.closest("input,textarea,select")) { event.preventDefault(); ui.search.focus(); } });
window.addEventListener("pagehide", () => { stopAcceptance(); session.close(); clearPreviews(); for (const url of downloadUrls) { try { URL.revokeObjectURL(url); } catch {} } downloadUrls.clear(); });
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
renderCatalog(); ui.search.disabled = false; ui.startup.hidden = true;
