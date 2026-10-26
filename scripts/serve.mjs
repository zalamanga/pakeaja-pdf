import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { digest, inside } from "./files.mjs";
const MIME = { ".html": "text/html;charset=utf-8", ".css": "text/css;charset=utf-8", ".js": "text/javascript;charset=utf-8", ".mjs": "text/javascript;charset=utf-8", ".json": "application/json;charset=utf-8", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".ttf": "font/ttf", ".icc": "application/vnd.iccprofile", ".md": "text/plain;charset=utf-8", ".gz": "application/gzip" };
export async function createAppServer(root, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Port harus1024–65535.");
  const directory = inside(root, "dist"), stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("dist harus berupa direktori build biasa.");
  const realDirectory = await fs.realpath(directory);
  const manifest = JSON.parse(await fs.readFile(inside(directory, "asset-manifest.json"), "utf8"));
  if (manifest.format !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 300) throw new Error("Manifest deployment tidak valid.");
  const files = new Map();
  for (const file of manifest.files) {
    inside(directory, file.path);
    if (files.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1) throw new Error("Manifest deployment tidak konsisten.");
    const stat = await fs.lstat(inside(directory, file.path));
    const resolved = await fs.realpath(inside(directory, file.path));
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== file.bytes || !resolved.startsWith(realDirectory + path.sep)) throw new Error("Deployment menolak tautan simbolik, ukuran berubah atau jalur di luar dist.");
    files.set(file.path, file);
  }
  const origin = "http://127.0.0.1:" + port;
  const server = http.createServer(async (request, response) => {
    const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'" };
    const send = (code, message, extra = {}) => { response.writeHead(code, { ...headers, "content-type": "text/plain;charset=utf-8", ...extra }); response.end(request.method === "HEAD" ? undefined : message); };
    request.resume();
    if (!["127.0.0.1:" + port, "localhost:" + port].includes(request.headers.host)) return send(421, "Host tidak sesuai.");
    if (!["GET", "HEAD"].includes(request.method)) return send(405, "Server ini hanya menyajikan berkas aplikasi.", { allow: "GET, HEAD" });
    try {
      const raw = request.url || "";
      if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /%2e|%2f|%5c/i.test(raw) || raw.split("/").some((part) => part === ".." || part === ".")) return send(404, "Berkas tidak tersedia.");
      const url = new URL(raw, origin);
      if (url.origin !== origin || url.search || url.hash) return send(404, "Berkas tidak tersedia.");
      const name = decodeURIComponent(url.pathname).replace(/^\//, "") || "index.html", entry = files.get(name);
      if (!entry) return send(404, "Berkas tidak tersedia.");
      const resolved = await fs.realpath(inside(directory, name)), stat = await fs.lstat(inside(directory, name));
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== entry.bytes || !resolved.startsWith(realDirectory + path.sep)) return send(503, "Berkas deployment tidak lagi sesuai manifest.");
      const bytes = await fs.readFile(inside(directory, name));
      if (bytes.byteLength !== entry.bytes || digest(bytes) !== entry.sha256) return send(503, "Berkas deployment berubah. Jalankan build ulang.");
      response.writeHead(200, { ...headers, "content-type": MIME[path.extname(name)] || "application/octet-stream", "content-length": bytes.byteLength });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch { if (!response.headersSent) send(404, "Berkas tidak tersedia."); else response.destroy(); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return { server, origin, async listen() { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); return origin; }, async close() { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } };
}
export async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), raw = process.env.PORT || "8881";
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error("PORT tidak valid.");
  const app = await createAppServer(root, Number(raw));
  console.log(await app.listen());
  const stop = () => { app.server.closeIdleConnections(); void app.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
