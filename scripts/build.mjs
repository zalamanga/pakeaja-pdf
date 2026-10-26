import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "./build-lib.mjs";
export async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const result = await build(root);
    console.log("Build dipublikasikan ke dist: " + result.files + " berkas.");
    for (const warning of result.warnings) console.warn(warning);
  } catch (error) {
    console.error(error.message);
    if (error.details?.recoveryDirectory) console.error("Cadangan: " + error.details.recoveryDirectory);
    process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
