import { LIMITS, PdfError } from "./domain.mjs";

export class JobResources {
  #cleanups = []; #closed = false; #timer; #abort = new AbortController();
  constructor(milliseconds = LIMITS.deadline) {
    this.reason = null;
    this.#timer = setTimeout(() => { this.reason = new PdfError("timeout", "Proses melewati batas 60 detik. Coba dokumen lebih kecil."); this.close(); }, milliseconds);
  }
  get signal() { return this.#abort.signal; }
  settle() { clearTimeout(this.#timer); this.check(); }
  check() { if (this.#closed) throw this.reason || new DOMException("Pekerjaan dibatalkan.", "AbortError"); }
  wait(pending) {
    const source = Promise.resolve(pending);
    return new Promise((resolve, reject) => {
      let finished = false;
      const complete = (succeeded, value) => {
        if (finished) return;
        finished = true;
        try { this.signal.removeEventListener("abort", aborted); }
        catch { console.warn("Pengamat pembatalan PDF belum dapat dilepas."); }
        if (succeeded) resolve(value); else reject(value);
      };
      const aborted = () => complete(false, this.reason || new DOMException("Pekerjaan dibatalkan.", "AbortError"));
      source.then((value) => {
        try { this.check(); complete(true, value); } catch (error) { complete(false, error); }
      }, (error) => complete(false, error));
      if (this.signal.aborted) aborted();
      else this.signal.addEventListener("abort", aborted, { once: true });
    });
  }
  own(cleanup) {
    if (typeof cleanup !== "function") throw new Error("Pembersih sumber daya tidak valid.");
    if (this.#closed) {
      try {
        const result = cleanup();
        if (result?.catch) void result.catch(() => console.warn("Pembersihan sumber daya PDF belum terkonfirmasi."));
      } catch { console.warn("Pembersihan sumber daya PDF belum terkonfirmasi."); }
      this.check();
    }
    this.#cleanups.push(cleanup);
    return cleanup;
  }
  release(cleanup) { const index = this.#cleanups.indexOf(cleanup); if (index >= 0) this.#cleanups.splice(index, 1); }
  close() {
    if (this.#closed) return [];
    this.#closed = true; clearTimeout(this.#timer); this.#abort.abort();
    const warnings = [];
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      try {
        const result = cleanup();
        if (result?.catch) void result.catch(() => console.warn("Pembersihan sumber daya PDF belum terkonfirmasi."));
      } catch { warnings.push("Sebagian sumber daya belum dapat dilepas."); }
    }
    return warnings;
  }
}

export class FileAcceptance {
  #current = null; #create;
  constructor(createResources = () => new JobResources()) { this.#create = createResources; }
  get busy() { return this.#current !== null; }
  begin(assertCurrent = () => {}) {
    this.cancel();
    const job = Object.freeze({ resources: this.#create(), assertCurrent });
    this.#current = job;
    return job;
  }
  check(job) {
    if (this.#current !== job) throw new DOMException("Pemeriksaan file sudah dibatalkan atau berubah.", "AbortError");
    job.resources.check(); job.assertCurrent();
  }
  async read(job, read) {
    this.check(job);
    const value = await job.resources.wait(read());
    this.check(job);
    return value;
  }
  finish(job) {
    job.resources.close();
    if (this.#current !== job) return false;
    this.#current = null;
    return true;
  }
  cancel() { const job = this.#current; this.#current = null; job?.resources.close(); }
}

export class ResultUrl {
  #url = ""; #port;
  constructor(port = URL) { this.#port = port; }
  get value() { return this.#url; }
  replace(blob) {
    const next = this.#port.createObjectURL(blob);
    const old = this.#url; this.#url = next;
    if (old) { try { this.#port.revokeObjectURL(old); } catch { console.warn("Tautan hasil lama belum dapat dilepas."); } }
    return next;
  }
  clear() {
    const old = this.#url; this.#url = "";
    if (old) { try { this.#port.revokeObjectURL(old); } catch { console.warn("Tautan hasil belum dapat dilepas."); } }
  }
}

export function requestDownload(documentPort, href, filename, defer = (callback) => setTimeout(callback, 1000)) {
  const anchor = documentPort.createElement("a");
  let requested = false, warning = false;
  try {
    anchor.href = href; anchor.download = filename; anchor.rel = "noopener";
    documentPort.body.append(anchor); anchor.click(); requested = true;
  } finally {
    try { defer(() => { try { anchor.remove(); } catch { console.warn("Tautan unduhan belum dapat dibersihkan."); } }); } catch { warning = true; }
  }
  return { requested, warning };
}
