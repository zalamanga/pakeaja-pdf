import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
export const SOURCE_FILES = Object.freeze(["index.html", "styles.css", "favicon.svg", "catalog.mjs", "native-options.mjs", "domain.mjs", "image-header.mjs", "session.mjs", "resources.mjs", "pdfjs.mjs", "pdfjs-compat.js", "pdfjs-worker.mjs", "geometry.mjs", "worker-contract.mjs", "transforms.mjs", "transform-worker.js", "qpdf-worker.js", "process.mjs", "icons.mjs", "app.mjs"]);
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function inside(root, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Jalur berkas build tidak valid.");
  const absolute = path.resolve(root, relative), prefix = path.resolve(root) + path.sep;
  if (!absolute.startsWith(prefix)) throw new Error("Jalur build keluar dari proyek.");
  return absolute;
}
async function walk(root, relative = "") {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? relative + "/" + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw new Error("Build menolak tautan simbolik di sumber.");
    if (entry.isDirectory()) result.push(...await walk(root, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error("Jenis berkas sumber tidak didukung.");
  }
  return result;
}
export async function sourceManifest(root) {
  const vendorBytes = await fs.readFile(inside(root, "vendor-manifest.json"));
  const vendor = JSON.parse(vendorBytes.toString("utf8"));
  if (vendor.format !== 1 || !Array.isArray(vendor.runtime_files) || vendor.runtime_files.length !== 205 || !vendor.source_companion || !vendor.notices) throw new Error("Manifest vendor tidak lengkap.");
  const pinned = [...vendor.runtime_files, { ...vendor.source_companion, path: vendor.source_companion.public_path }];
  if (pinned.some((file) => !file.path.startsWith("src/vendor/") || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1) || new Set(pinned.map((file) => file.path)).size !== 206) throw new Error("Daftar vendor tidak valid.");
  const sourceNames = [...SOURCE_FILES, ...pinned.map((file) => file.path.slice(4))].sort();
  const sourceStat = await fs.lstat(inside(root, "src"));
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) throw new Error("src harus berupa direktori biasa.");
  const actual = (await walk(inside(root, "src"))).sort();
  if (JSON.stringify(actual) !== JSON.stringify(sourceNames)) throw new Error("Ada sumber hilang atau berkas tambahan di src. Periksa daftar build sebelum melanjutkan.");
  const files = [];
  for (const name of SOURCE_FILES) {
    const source = "src/" + name, bytes = await fs.readFile(inside(root, source));
    files.push({ source, path: name, bytes: bytes.byteLength, sha256: digest(bytes) });
  }
  for (const file of pinned) {
    const bytes = await fs.readFile(inside(root, file.path));
    if (bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) throw new Error("Berkas vendor berubah dari manifest: " + file.path);
    files.push({ source: file.path, path: file.path.slice(4), bytes: file.bytes, sha256: file.sha256 });
  }
  const notices = await fs.readFile(inside(root, "THIRD_PARTY_LICENSES.md"));
  if (notices.byteLength !== vendor.notices.bytes || digest(notices) !== vendor.notices.sha256) throw new Error("Pemberitahuan lisensi berubah dari manifest.");
  files.push({ source: "THIRD_PARTY_LICENSES.md", path: "THIRD_PARTY_LICENSES.md", bytes: notices.byteLength, sha256: digest(notices) });
  files.push({ source: "vendor-manifest.json", path: "vendor-manifest.json", bytes: vendorBytes.byteLength, sha256: digest(vendorBytes) });
  return { format: 1, files };
}
