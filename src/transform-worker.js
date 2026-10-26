(() => {
  let used = false;
  const quiet = () => {};
  for (const name of ["log", "info", "warn", "error", "debug"]) console[name] = quiet;
  self.onmessage = async ({ data }) => {
    if (used) return;
    used = true;
    const jobId = typeof data?.jobId === "string" ? data.jobId : "";
    let failure;
    try {
      const contract = await import("./worker-contract.mjs");
      failure = contract.workerFailure;
      contract.validateCommand(data);
      const tool = data.toolId, libraries = {};
      if (!["pdf-word", "pdf-text", "pdf-markdown", "compare", "pdf-image"].includes(tool)) { importScripts("./vendor/pdf-lib.min.js"); libraries.pdf = self.PDFLib; }
      if (["split-page", "split-size", "pdf-image"].includes(tool)) { importScripts("./vendor/jszip.min.js"); libraries.zip = self.JSZip; }
      if (tool === "pdf-word") { importScripts("./vendor/docx.umd.js"); libraries.docx = self.docx; }
      const { transform } = await import("./transforms.mjs");
      const result = await transform(data, libraries, (counts) => self.postMessage({ kind: "progress", jobId, ...counts }));
      self.postMessage(result, [result.bytes]);
    } catch (error) {
      self.postMessage(failure ? failure(error, jobId) : { kind: "error", jobId, code: "engine_failure", message: "Mesin belum dapat menyelesaikan file ini. Tidak ada hasil parsial yang diterbitkan." });
    }
  };
})();
