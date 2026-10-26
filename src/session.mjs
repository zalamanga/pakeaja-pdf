import { defaultsFor, toolById } from "./catalog.mjs";
import { pagePermutation, validateOptions, validateSelection } from "./domain.mjs";

export class PdfSession {
  #epoch = 0; #job = null; #stop; #changed; #id;
  constructor({ stop = () => {}, changed = () => {}, id = () => crypto.randomUUID() } = {}) {
    this.#stop = stop; this.#changed = changed; this.#id = id;
    this.tool = null; this.files = []; this.pageOrder = []; this.result = null;
  }
  get busy() { return this.#job !== null; }
  get epoch() { return this.#epoch; }
  invalidate() {
    this.#epoch++;
    this.#job = null; this.result = null;
    this.#stop();
    this.#changed();
  }
  open(id) { toolById(id); this.invalidate(); this.tool = id; this.files = []; this.pageOrder = []; this.#changed(); return defaultsFor(id); }
  close() { this.invalidate(); this.tool = null; this.files = []; this.pageOrder = []; this.#changed(); }
  add(files) {
    const added = files.map((file) => Object.freeze({ id: this.#id(), file }));
    const selection = [...this.files, ...added];
    validateSelection(this.tool, selection);
    this.invalidate(); this.files = selection; this.pageOrder = []; this.#changed();
  }
  remove(id) { const next = this.files.filter((record) => record.id !== id); if (next.length === this.files.length) return; this.invalidate(); this.files = next; this.pageOrder = []; this.#changed(); }
  move(id, offset) {
    const from = this.files.findIndex((record) => record.id === id), to = from + offset;
    if (from < 0 || to < 0 || to >= this.files.length || ![-1, 1].includes(offset)) return;
    const next = [...this.files]; [next[from], next[to]] = [next[to], next[from]];
    this.invalidate(); this.files = next; this.pageOrder = []; this.#changed();
  }
  order(order, count) { const next = pagePermutation(order, count); this.invalidate(); this.pageOrder = [...next]; this.#changed(); }
  begin(kind, options = defaultsFor(this.tool)) {
    if (!["preview", "process"].includes(kind)) throw new Error("Jenis pekerjaan tidak dikenal.");
    validateSelection(this.tool, this.files, true);
    const validated = validateOptions(this.tool, options);
    this.invalidate();
    const job = Object.freeze({ id: this.#id(), epoch: this.#epoch, kind, toolId: this.tool, files: Object.freeze([...this.files]), options: validated, pageOrder: Object.freeze([...this.pageOrder]) });
    this.#job = job; this.#changed();
    return job;
  }
  isCurrent(job) { return this.#job === job && job.epoch === this.#epoch && job.toolId === this.tool; }
  assertCurrent(job) { if (!this.isCurrent(job)) throw new DOMException("Pekerjaan sudah dibatalkan atau berubah.", "AbortError"); }
  finish(job, result) { this.assertCurrent(job); this.#job = null; this.result = result; this.#changed(); }
  finishPreview(job, order) { this.assertCurrent(job); this.pageOrder = [...pagePermutation(order, order.length)]; this.#job = null; this.#changed(); }
  fail(job) { if (this.isCurrent(job)) { this.#job = null; this.result = null; this.#changed(); return true; } return false; }
}
