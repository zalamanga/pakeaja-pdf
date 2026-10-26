export function validUnicode(text) {
  return typeof text === "string" && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
}
export function validatePassword(value, protect = false) {
  if (!validUnicode(value) || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error("Kata sandi mengandung karakter kontrol atau Unicode yang tidak lengkap.");
  if (new TextEncoder().encode(value).byteLength > 127 || (protect && [...value].length < 8)) throw new Error(protect ? "Kata sandi baru perlu minimal 8 karakter dan maksimal 127 byte UTF-8." : "Kata sandi maksimal 127 byte UTF-8.");
  return value;
}
export function ownerSecret(password, cryptoPort = globalThis.crypto) {
  if (!cryptoPort?.getRandomValues) throw new Error("Sumber acak browser tidak tersedia; proteksi belum dijalankan.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const bytes = cryptoPort.getRandomValues(new Uint8Array(32));
    const secret = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (secret !== password) return secret;
  }
  throw new Error("Kunci pemilik belum dapat dibuat.");
}
export function qpdfArguments(tool, password, secret) {
  validatePassword(password, tool === "protect");
  if (tool === "protect") {
    if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret) || secret === password) throw new Error("Kunci pemilik tidak valid.");
    return ["--password-mode=unicode", "/input.pdf", "--encrypt", "--user-password=" + password, "--owner-password=" + secret, "--bits=256", "--", "/output.pdf"];
  }
  if (tool === "unlock") return ["--password=" + password, "--decrypt", "/input.pdf", "/output.pdf"];
  throw new Error("Operasi native tidak dikenal.");
}
