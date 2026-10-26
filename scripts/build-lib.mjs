import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { digest, inside, sourceManifest } from "./files.mjs";

export class BuildError extends Error {
  constructor(message, details) { super(message); this.name = "BuildError"; this.details = details; }
}
function ownedDirectory(root, target) {
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== path.resolve(root) || !/^(dist|[.]build-(stage|backup)-[a-f0-9-]{36})$/.test(path.basename(resolved))) throw new Error("Target direktori build tidak berada di ruang proyek.");
  return resolved;
}
async function exists(driver, target) { try { return await driver.lstat(target); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
export async function publishBuild(root, manifest, driver = fs, id = randomUUID()) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Identitas build tidak valid.");
  const stage = ownedDirectory(root, path.join(root, ".build-stage-" + id)), previous = ownedDirectory(root, path.join(root, ".build-backup-" + id)), destination = ownedDirectory(root, path.join(root, "dist"));
  const warnings = [];
  let published = false, movedPrevious = false, uncertain = false;
  const unknownPublication = () => {
    uncertain = true;
    return new BuildError("Status perpindahan output belum terkonfirmasi. Periksa dist, staging dan cadangan; jangan hapus salah satunya sebelum diperiksa.", { published: "unknown", previousRestored: "unknown", recoveryDirectory: path.basename(previous), stagingDirectory: path.basename(stage) });
  };
  const remove = async (target) => {
    ownedDirectory(root, target);
    const stat = await exists(driver, target);
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error("Target cleanup bukan direktori build biasa.");
    if (stat) await driver.rm(target, { recursive: true });
  };
  if (await exists(driver, stage) || await exists(driver, previous)) throw new Error("Direktori build sementara sudah ada. Tidak ditimpa otomatis.");
  const old = await exists(driver, destination);
  if (old?.isSymbolicLink() || (old && !old.isDirectory())) throw new Error("dist harus berupa direktori biasa di proyek ini.");
  try {
    await driver.mkdir(stage);
    for (const file of manifest.files) {
      const bytes = await driver.readFile(inside(root, file.source));
      if (bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256) throw new Error("Sumber berubah saat staging; output lama dipertahankan.");
      const target = inside(stage, file.path);
      await driver.mkdir(path.dirname(target), { recursive: true });
      await driver.writeFile(target, bytes, { flag: "wx" });
      const copied = await driver.readFile(target);
      if (digest(copied) !== file.sha256) throw new Error("Hash staging tidak cocok.");
    }
    const deployment = { format: 1, files: manifest.files.map(({ path: filePath, sha256, bytes }) => ({ path: filePath, sha256, bytes })) };
    await driver.writeFile(inside(stage, "asset-manifest.json"), JSON.stringify(deployment, null, 2) + "\n", { flag: "wx" });
    if (old) {
      try { await driver.rename(destination, previous); movedPrevious = true; }
      catch { throw unknownPublication(); }
    }
    try { await driver.rename(stage, destination); published = true; }
    catch (error) {
      let sourceStillPresent, destinationPresent;
      try { sourceStillPresent = await exists(driver, stage); destinationPresent = await exists(driver, destination); }
      catch { throw unknownPublication(); }
      if (!sourceStillPresent || destinationPresent) throw unknownPublication();
      let restored = !movedPrevious;
      if (movedPrevious) {
        try { await driver.rename(previous, destination); restored = true; movedPrevious = false; }
        catch { throw unknownPublication(); }
      }
      throw new BuildError("Publikasi gagal sebelum output baru aktif; output sebelumnya dipertahankan.", { published: false, previousRestored: restored, cause: error.code || "publish_failed" });
    }
    if (movedPrevious) { try { await remove(previous); movedPrevious = false; } catch { warnings.push("Output baru sudah aktif; direktori cadangan lama belum dapat dibersihkan."); } }
    return { published: true, files: deployment.files.length, warnings };
  } catch (error) {
    if (!published && !uncertain) { try { await remove(stage); } catch { warnings.push("Staging belum dapat dibersihkan; output aktif tidak dihapus."); } }
    if (error instanceof BuildError) { error.details.cleanupWarnings = warnings; throw error; }
    throw new BuildError("Build gagal sebelum publikasi. Periksa sumber dan direktori sementara.", { published, previousRestored: !movedPrevious, cleanupWarnings: warnings, cause: error.code || "source_or_staging_failed" });
  }
}
export async function build(root) {
  const lock = inside(root, ".build.lock"), token = randomUUID();
  let handle, published = false, result;
  try {
    handle = await fs.open(lock, "wx");
    await handle.writeFile(token);
    const manifest = await sourceManifest(root);
    result = await publishBuild(root, manifest); published = result.published;
  } catch (error) {
    if (!handle && error.code === "EEXIST") throw new BuildError("Build lain atau lock lama masih ada. Periksa prosesnya sebelum menghapus .build.lock.", { published: false });
    throw error;
  } finally {
    const cleanupWarnings = [];
    if (handle) {
      try { await handle.close(); } catch { cleanupWarnings.push("Handle lock build belum dapat ditutup."); }
      try { if ((await fs.readFile(lock, "utf8")) === token) await fs.unlink(lock); else cleanupWarnings.push("Lock build berubah; tidak dihapus."); }
      catch { cleanupWarnings.push("Lock build belum dapat dilepas."); }
    }
    if (result && published) result.warnings.push(...cleanupWarnings);
    else if (cleanupWarnings.length) console.warn("Pembersihan lock belum lengkap; hasil build sebelumnya tetap sesuai pesan utama.");
  }
  return result;
}
