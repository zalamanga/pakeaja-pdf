import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { publishBuild } from "../scripts/build-lib.mjs";
import { digest, inside } from "../scripts/files.mjs";

const root = path.resolve("D:/synthetic-pakeaja-pdf");
const id = "11111111-1111-4111-8111-111111111111";
const missing = () => Object.assign(new Error("synthetic absent"), { code: "ENOENT" });
function fixture(fault) {
  const old = Buffer.from("old-output"), fresh = Buffer.from("new-source");
  const files = new Map([[inside(root, "src/index.html"), fresh], [inside(root, "dist"), null], [inside(root, "dist/index.html"), old]]);
  const calls = [];
  let publishFailed = false;
  const driver = {
    async lstat(name) {
      if (!files.has(name)) throw missing();
      return { isDirectory: () => files.get(name) === null, isFile: () => files.get(name) !== null, isSymbolicLink: () => false };
    },
    async mkdir(name) { if (!files.has(name)) files.set(name, null); },
    async readFile(name) { if (!files.has(name) || files.get(name) === null) throw missing(); return files.get(name); },
    async writeFile(name, bytes, options) {
      if (options.flag === "wx" && files.has(name)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      files.set(name, Buffer.from(bytes));
    },
    async rename(from, to) {
      calls.push(["rename", from, to]);
      const publishing = path.basename(from).startsWith(".build-stage-");
      const oldMove = from === inside(root, "dist");
      const rollback = path.basename(from).startsWith(".build-backup-");
      if (publishing && ["before-publish", "rollback-ack"].includes(fault)) { publishFailed = true; throw new Error("synthetic before rename"); }
      if (!files.has(from)) throw missing();
      if (files.has(to)) throw new Error("synthetic destination exists");
      const moving = [...files].filter(([name]) => name === from || name.startsWith(from + path.sep));
      for (const [name] of moving) files.delete(name);
      for (const [name, value] of moving) files.set(to + name.slice(from.length), value);
      if ((publishing && fault === "publish-ack") || (oldMove && fault === "old-move-ack") || (rollback && publishFailed && fault === "rollback-ack")) throw new Error("synthetic acknowledgement lost after rename");
    },
    async rm(name) {
      calls.push(["remove", name]);
      if (fault === "cleanup" && path.basename(name).startsWith(".build-backup-")) throw new Error("synthetic cleanup");
      for (const key of [...files.keys()]) if (key === name || key.startsWith(name + path.sep)) files.delete(key);
    },
  };
  const manifest = { format: 1, files: [{ source: "src/index.html", path: "index.html", bytes: fresh.length, sha256: digest(fresh) }] };
  return { files, driver, manifest, calls, old, fresh };
}
test("staging publish replaces output only after verified source and cleans old owned directory", async () => {
  const f = fixture();
  const result = await publishBuild(root, f.manifest, f.driver, id);
  assert.equal(result.published, true); assert.deepEqual(result.warnings, []);
  assert.deepEqual(f.files.get(inside(root, "dist/index.html")), f.fresh);
  assert.equal([...f.files.keys()].some((name) => name.includes(".build-backup-")), false);
});
test("source drift before publish leaves old output intact without partial success", async () => {
  const f = fixture(); f.files.set(inside(root, "src/index.html"), Buffer.from("changed"));
  await assert.rejects(publishBuild(root, f.manifest, f.driver, id), (error) => error.details.published === false);
  assert.deepEqual(f.files.get(inside(root, "dist/index.html")), f.old); assert.equal(f.calls.some(([kind]) => kind === "rename"), false);
});
test("definite pre-publish rename failure restores old directory and reports no publication", async () => {
  const f = fixture("before-publish");
  await assert.rejects(publishBuild(root, f.manifest, f.driver, id), (error) => error.details.published === false && error.details.previousRestored === true);
  assert.deepEqual(f.files.get(inside(root, "dist/index.html")), f.old);
});
test("known publication remains successful if deleting old backup fails", async () => {
  const f = fixture("cleanup");
  const result = await publishBuild(root, f.manifest, f.driver, id);
  assert.equal(result.published, true); assert.equal(result.warnings.length, 1);
  assert.deepEqual(f.files.get(inside(root, "dist/index.html")), f.fresh);
  assert.deepEqual(f.files.get(inside(root, ".build-backup-" + id + "/index.html")), f.old);
});
test("lost rename acknowledgement preserves all recovery candidates and never falsely claims old output unchanged", async () => {
  for (const fault of ["publish-ack", "old-move-ack", "rollback-ack"]) {
    const f = fixture(fault);
    await assert.rejects(publishBuild(root, f.manifest, f.driver, id), (error) => error.details.published === "unknown" && error.details.previousRestored === "unknown");
    assert.equal(f.calls.some(([kind]) => kind === "remove"), false);
    const contents = [...f.files.values()].filter((value) => value !== null).map((value) => value.toString());
    assert.ok(contents.includes("old-output")); assert.ok(contents.includes("new-source"));
  }
});
test("path validation prevents source/deployment traversal or unrelated recursive cleanup", async () => {
  for (const value of ["../outside", "/../outside", "src/../../private", "src\\..\\private", "."]) assert.throws(() => inside(root, value));
  const f = fixture();
  await assert.rejects(publishBuild(root, f.manifest, f.driver, "../outside"));
  assert.equal(f.calls.length, 0);
});
