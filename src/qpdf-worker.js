(() => {
  let used = false;
  const quiet = () => {};
  for (const name of ["log", "info", "warn", "error", "debug"]) console[name] = quiet;
  self.onmessage = async ({ data }) => {
    if (used) return;
    used = true;
    let engine, result, failure, warning = false, stage = "", digits = "", invalidPassword = false;
    let stdoutLine = "", stderrTail = "", stdoutBytes = 0, stderrBytes = 0;
    const finishCountLine = () => {
      const line = stdoutLine.trim(); stdoutLine = "";
      if (line) digits = digits === "" && /^[0-9]+$/.test(line) ? line : "invalid";
    };
    const stdout = (byte) => {
      if (byte === null || byte === undefined) return;
      if (!Number.isInteger(byte) || byte < 0 || byte > 255 || ++stdoutBytes > 1024) throw new Error("Native output limit.");
      if (stage !== "count") return;
      if (byte === 10) { finishCountLine(); return; }
      if (stdoutLine.length >= 32) { digits = "invalid"; return; }
      stdoutLine += String.fromCharCode(byte);
    };
    const stderr = (byte) => {
      if (byte === null || byte === undefined) return;
      if (!Number.isInteger(byte) || byte < 0 || byte > 255 || ++stderrBytes > 8192) throw new Error("Native error output limit.");
      stderrTail = (stderrTail + String.fromCharCode(byte)).slice(-256);
      invalidPassword ||= stderrTail.toLowerCase().includes("invalid password");
    };
    const jobId = typeof data?.jobId === "string" ? data.jobId : "";
    try {
      const { validateCommand, resultMessage } = await import("./worker-contract.mjs");
      const { LIMITS, pdfHeader, reject } = await import("./domain.mjs");
      const { ownerSecret, qpdfArguments, validatePassword } = await import("./native-options.mjs");
      validateCommand(data);
      if (!["protect", "unlock"].includes(data.toolId) || data.payload !== null || data.files.length !== 1 || data.pageOrder.length) reject("Pekerjaan native tidak valid.");
      const password = validatePassword(data.options.password, data.toolId === "protect");
      pdfHeader(new Uint8Array(data.files[0].bytes));
      try {
        importScripts("./vendor/qpdf.js");
        if (typeof self.Module !== "function") throw new Error();
        engine = await self.Module({
          noInitialRun: true, noExitRuntime: true, noFSInit: true,
          locateFile: (path) => {
            if (path !== "qpdf.wasm") throw new Error("Unexpected native resource.");
            return new URL("./vendor/qpdf.wasm", self.location.href).href;
          },
        });
        engine.FS.init(null, stdout, stderr);
      } catch { throw { safeCode: "engine_unavailable" }; }
      const run = (args, nextStage) => {
        stage = nextStage; digits = ""; invalidPassword = false;
        stdoutLine = ""; stderrTail = ""; stdoutBytes = 0; stderrBytes = 0;
        let code;
        try { code = engine.callMain(args); }
        catch (error) { if (Number.isInteger(error?.status)) code = error.status; else throw { safeCode: "native_failure" }; }
        if (stage === "count") finishCountLine();
        if (!Number.isInteger(code)) throw { safeCode: "native_failure" };
        return code;
      };
      const count = (path, protectedInput) => {
        const code = run([...(protectedInput ? ["--password=" + password] : []), "--show-npages", path], "count");
        if (![0, 3].includes(code) || !/^[1-9][0-9]{0,2}$/.test(digits)) throw { safeCode: invalidPassword ? "wrong_password" : "unreadable_pdf" };
        const pages = Number(digits);
        if (pages > LIMITS.pages) throw { safeCode: "page_limit" };
        if (code === 3) warning = true;
        return pages;
      };
      engine.FS.writeFile("/input.pdf", new Uint8Array(data.files[0].bytes));
      new Uint8Array(data.files[0].bytes).fill(0);
      const before = count("/input.pdf", data.toolId === "unlock");
      if (data.toolId === "protect") {
        const encrypted = run(["--is-encrypted", "/input.pdf"], "probe");
        if (encrypted === 0) throw { safeCode: "password_required" };
        if (encrypted !== 2) throw { safeCode: "unreadable_pdf" };
      }
      const args = qpdfArguments(data.toolId, password, data.toolId === "protect" ? ownerSecret(password) : undefined);
      const code = run(args, "transform");
      if (![0, 3].includes(code)) throw { safeCode: invalidPassword ? "wrong_password" : "native_failure" };
      if (code === 3) warning = true;
      const size = engine.FS.stat("/output.pdf").size;
      if (!Number.isSafeInteger(size) || size < 1 || size > LIMITS.resultBytes) throw { safeCode: "result_limit" };
      const after = count("/output.pdf", data.toolId === "protect");
      if (after !== before) throw { safeCode: "invalid_result" };
      if (data.toolId === "protect" && run(["--password=" + password, "--is-encrypted", "/output.pdf"], "probe") !== 0) throw { safeCode: "invalid_result" };
      if (data.toolId === "unlock" && run(["--is-encrypted", "/output.pdf"], "probe") !== 2) throw { safeCode: "invalid_result" };
      result = resultMessage(jobId, "pdf", engine.FS.readFile("/output.pdf"), { sourcePages: before, outputPages: after, entries: 1 }, warning ? ["Mesin mengembalikan peringatan; hasil tersedia setelah pemeriksaan jumlah halaman. Periksa tampilannya sebelum digunakan."] : []);
    } catch (error) {
      const code = error?.safeCode;
      const messages = {
        engine_unavailable: "Mesin proteksi belum dapat dimuat. Muat ulang halaman dan coba lagi.",
        wrong_password: "Kata sandi tidak membuka PDF ini. Tidak ada hasil yang diterbitkan.",
        password_required: "PDF sumber masih dilindungi. Buka proteksinya terlebih dahulu.",
        unreadable_pdf: "PDF tidak dapat dibaca oleh mesin. Periksa file sumber.",
        page_limit: "Dokumen maksimal 200 halaman.",
        result_limit: "Hasil native kosong atau melampaui 50 MiB.",
        invalid_result: "Hasil native tidak lolos pemeriksaan jumlah halaman.",
        native_failure: "Mesin native belum dapat menyelesaikan PDF ini.",
      };
      failure = { kind: "error", jobId, code: Object.hasOwn(messages, code) ? code : "invalid_input", message: Object.hasOwn(messages, code) ? messages[code] : "File atau kata sandi tidak sesuai batas alat. Hasil tidak diterbitkan." };
    } finally {
      for (const path of ["/input.pdf", "/output.pdf"]) {
        try { if (engine?.FS.analyzePath(path).exists) engine.FS.unlink(path); }
        catch { if (result) result.warnings.push("Pembersihan memori kerja belum terkonfirmasi; worker akan ditutup."); }
      }
      if (data?.options) data.options.password = "";
      stdoutLine = ""; stderrTail = "";
      if (result) self.postMessage(result, [result.bytes]);
      else self.postMessage(failure || { kind: "error", jobId, code: "native_failure", message: "Pekerjaan native belum selesai." });
    }
  };
})();
