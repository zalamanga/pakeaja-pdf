import assert from "node:assert/strict";
import test from "node:test";
import { PdfSession } from "../src/session.mjs";
import { FileAcceptance, JobResources, ResultUrl, requestDownload } from "../src/resources.mjs";
import { LIMITS, PdfError } from "../src/domain.mjs";

const file = (name, size = 100) => ({ name, size, arrayBuffer() {} });
function session() { let index = 0; const stopped = []; const value = new PdfSession({ stop: () => stopped.push("stop"), id: () => "id-" + (++index) }); return { value, stopped }; }
test("accepted edit cancels previous job/result and immutable snapshot never adopts late completion", () => {
  const { value } = session(); value.open("merge"); value.add([file("a.pdf"), file("b.pdf")]);
  const first = value.begin("process", {}), ids = first.files.map((record) => record.id);
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.files));
  value.move(ids[1], -1);
  assert.throws(() => value.finish(first, { old: true }), (error) => error.name === "AbortError");
  assert.equal(value.result, null); assert.deepEqual(first.files.map((record) => record.id), ids);
  const current = value.begin("process", {}); value.finish(current, { ready: true });
  assert.equal(value.result.ready, true); value.invalidate(); assert.equal(value.result, null);
});
test("invalid whole addition preserves original selection and completed result", () => {
  const { value } = session(); value.open("repair"); value.add([file("a.pdf")]);
  const job = value.begin("process", {}); value.finish(job, { ready: true });
  const before = value.files;
  assert.throws(() => value.add([file("too-big.pdf", LIMITS.fileBytes + 1)]));
  assert.equal(value.files, before); assert.equal(value.result.ready, true);
});
test("preview and process cannot both be current and close invalidates callbacks from both", () => {
  const { value } = session(); value.open("organize-pages"); value.add([file("a.pdf")]);
  const preview = value.begin("preview", {}), process = value.begin("process", {});
  assert.equal(value.isCurrent(preview), false); assert.equal(value.isCurrent(process), true);
  value.close(); assert.equal(value.isCurrent(process), false); assert.equal(value.tool, null);
});
test("resource cleanup is reverse order/idempotent and one failing cleanup does not suppress the rest", () => {
  const resources = new JobResources(), calls = [];
  resources.own(() => calls.push("one")); resources.own(() => { calls.push("two"); throw new Error("injected"); }); resources.own(() => calls.push("three"));
  assert.equal(resources.close().length, 1); assert.deepEqual(calls, ["three", "two", "one"]);
  assert.deepEqual(resources.close(), []); assert.equal(resources.signal.aborted, true); assert.throws(() => resources.check());
});
test("owned wait rejects a stalled host operation at the one job deadline", async () => {
  const resources = new JobResources(5);
  await assert.rejects(resources.wait(new Promise(() => {})), (error) => error instanceof PdfError && error.code === "timeout");
  assert.equal(resources.signal.aborted, true);
});
test("cancelled host wait cannot adopt a late value and handles a late rejection", async () => {
  const resources = new JobResources();
  let resolveHost, rejectHost;
  const successfulHost = new Promise((resolve) => { resolveHost = resolve; });
  const failingHost = new Promise((_, reject) => { rejectHost = reject; });
  let adopted = false;
  const first = resources.wait(successfulHost).then(() => { adopted = true; });
  const second = resources.wait(failingHost);
  resources.close();
  await assert.rejects(first, (error) => error.name === "AbortError");
  await assert.rejects(second, (error) => error.name === "AbortError");
  resolveHost("late private value"); rejectHost(new Error("late private failure"));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(adopted, false);
});
test("owned wait preserves original failures including falsy rejection values", async () => {
  const resources = new JobResources();
  const primary = new Error("original host failure");
  try {
    await assert.rejects(resources.wait(Promise.reject(primary)), (error) => error === primary);
    const outcome = await resources.wait(Promise.reject(undefined)).then(() => "wrongly-resolved", (error) => ({ rejected: true, error }));
    assert.deepEqual(outcome, { rejected: true, error: undefined });
    assert.equal(await resources.wait(Promise.resolve("ready")), "ready");
  } finally { resources.close(); }
});
test("already closed wait still observes its source without adopting it", async () => {
  const resources = new JobResources(); resources.close();
  await assert.rejects(resources.wait(Promise.reject(new Error("late source"))), (error) => error.name === "AbortError");
  await Promise.resolve();
});
test("cleanup registered after cancellation handles its asynchronous rejection", async (context) => {
  const warnings = [];
  context.mock.method(console, "warn", (message) => warnings.push(message));
  const resources = new JobResources(); resources.close();
  assert.throws(() => resources.own(() => Promise.reject(new Error("private cleanup diagnostic"))), (error) => error.name === "AbortError");
  await Promise.resolve();
  assert.deepEqual(warnings, ["Pembersihan sumber daya PDF belum terkonfirmasi."]);
});
test("closing file acceptance rejects a stalled read and cannot adopt its late files", async () => {
  const owner = new FileAcceptance(), { value } = session(); value.open("merge"); value.add([file("existing.pdf")]);
  const original = value.files;
  const job = owner.begin(); let resolveRead;
  const pending = owner.read(job, () => new Promise((resolve) => { resolveRead = resolve; })).then((files) => value.add(files));
  owner.cancel();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(owner.busy, false); assert.equal(owner.finish(job), false);
  resolveRead([file("late.pdf")]); await Promise.resolve();
  assert.equal(value.files, original);
});
test("replacing an acceptance aborts the old read and old finally cannot clear the new owner", async () => {
  const owner = new FileAcceptance(); let resolveOld;
  const old = owner.begin(), pending = owner.read(old, () => new Promise((resolve) => { resolveOld = resolve; }));
  const current = owner.begin();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(owner.finish(old), false); assert.equal(owner.busy, true);
  assert.equal(await owner.read(current, () => Promise.resolve("current header")), "current header");
  resolveOld("old header"); await Promise.resolve();
  assert.equal(owner.finish(current), true); assert.equal(owner.busy, false);
});
test("acceptance deadline and changed source context preserve old selection and allow a fresh retry", async () => {
  const owner = new FileAcceptance(() => new JobResources(5));
  const { value } = session(); value.open("merge"); value.add([file("existing.pdf")]);
  const original = value.files;
  const job = owner.begin();
  const stalled = owner.read(job, () => new Promise(() => {})).then((files) => value.add(files));
  await assert.rejects(stalled, (error) => error instanceof PdfError && error.code === "timeout");
  assert.equal(value.files, original);
  assert.equal(owner.finish(job), true); assert.equal(owner.busy, false);
  let epoch = 1, resolveRead;
  const next = owner.begin(() => { if (epoch !== 1) throw new DOMException("changed context", "AbortError"); });
  const pending = owner.read(next, () => new Promise((resolve) => { resolveRead = resolve; }));
  epoch = 2; resolveRead("stale header");
  await assert.rejects(pending, (error) => error.name === "AbortError");
  owner.finish(next);
  let reads = 0;
  const retry = owner.begin();
  assert.equal(await owner.read(retry, () => { reads++; return Promise.resolve("fresh header"); }), "fresh header");
  assert.equal(reads, 1); owner.finish(retry);
});
test("result URL replacement preserves previous URL if new allocation fails", () => {
  let fail = false; const revoked = [], port = { createObjectURL() { if (fail) throw new Error("injected"); return "blob:owned"; }, revokeObjectURL(value) { revoked.push(value); } };
  const owned = new ResultUrl(port); owned.replace(new Blob(["first"])); fail = true;
  assert.throws(() => owned.replace(new Blob(["second"]))); assert.equal(owned.value, "blob:owned"); assert.deepEqual(revoked, []);
  owned.clear(); assert.deepEqual(revoked, ["blob:owned"]); assert.equal(owned.value, "");
});
function documentPort(click, remove = () => {}) {
  const anchor = { click, remove };
  return { createElement() { return anchor; }, body: { append() {} } };
}
test("download requested stays requested when postclick scheduling fails and never claims disk save", () => {
  let clicks = 0;
  const outcome = requestDownload(documentPort(() => clicks++), "blob:owned", "test.pdf", () => { throw new Error("cleanup"); });
  assert.equal(clicks, 1); assert.deepEqual(outcome, { requested: true, warning: true });
});
test("download click failure retains original error despite cleanup failure", () => {
  const primary = new Error("click failed");
  assert.throws(() => requestDownload(documentPort(() => { throw primary; }), "blob:owned", "test.pdf", () => { throw new Error("cleanup"); }), (error) => error === primary);
});
