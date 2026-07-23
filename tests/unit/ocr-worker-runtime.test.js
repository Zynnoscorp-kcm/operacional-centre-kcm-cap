import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { publicError } from "../../deploy/ocr-worker/contract.js";
import {
  rasterizePdfWithPdftoppm,
  validateSinglePagePdfInfo
} from "../../deploy/ocr-worker/pipeline-recognizer.js";
import {
  IMAGE_PIPELINE_VERSION,
  inspectOcrRuntime
} from "../../deploy/ocr-worker/runtime-metadata.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function runtimeRunner(calls, overrides = {}) {
  return (command, args, options) => {
    calls.push({ command, args: [...args], options });
    if (overrides[command]) return overrides[command];
    if (command.endsWith("/tesseract")) return { status: 0, stdout: "tesseract 5.3.0\n", stderr: "" };
    if (command.endsWith("/pdfinfo")) return { status: 0, stdout: "", stderr: "pdfinfo version 22.12.0\n" };
    if (command.endsWith("/pdftoppm")) return { status: 0, stdout: "", stderr: "pdftoppm version 22.12.0\n" };
    return { status: 127, stdout: "", stderr: "" };
  };
}

test("inspecciona versiones efectivas sin serializar rutas, entorno ni diagnosticos", () => {
  const calls = [];
  const inspected = inspectOcrRuntime({
    containerBuildId: "git-0123456789abcdef",
    nodeVersion: "22.17.0",
    runner: runtimeRunner(calls)
  });
  assert.deepEqual(inspected.metadata, {
    nodeVersion: "22.17.0",
    ocrEngineName: "tesseract",
    ocrEngineVersion: "5.3.0",
    pdfInfoVersion: "22.12.0",
    pdfToPpmVersion: "22.12.0",
    imagePipelineVersion: IMAGE_PIPELINE_VERSION,
    containerBuildId: "git-0123456789abcdef"
  });
  assert.equal(inspected.commands.tesseract, "/usr/bin/tesseract");
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.options.shell === false));
  assert.ok(calls.every((call) => Object.keys(call.options.env).sort().join(",") === "LANG,LC_ALL,PATH"));
  const publicJson = JSON.stringify(inspected);
  assert.doesNotMatch(publicJson, /\/usr\/|PATH|--version|secret|token/i);
});

test("rechaza build IDs y salidas de version no verificables sin propagarlas", () => {
  assert.throws(
    () => inspectOcrRuntime({ containerBuildId: "../../secret", runner: runtimeRunner([]) }),
    /BUILD_ID/
  );
  const privateDiagnostic = "private-path-/tmp/worker-secret";
  assert.throws(() => inspectOcrRuntime({
    containerBuildId: "local-unversioned",
    runner: runtimeRunner([], {
      "/usr/bin/tesseract": { status: 0, stdout: privateDiagnostic, stderr: "" }
    })
  }), (error) => {
    assert.doesNotMatch(error.message, /private-path|worker-secret/);
    return true;
  });
});

test("pdfinfo exige exactamente una pagina no cifrada", () => {
  assert.deepEqual(validateSinglePagePdfInfo("Pages: 1\nEncrypted: no\n"), { pageCount: 1, encrypted: false });
  for (const output of [
    "Pages: 2\nEncrypted: no\n",
    "Pages: 1\nEncrypted: yes\n",
    "Pages: unknown\nEncrypted: no\n",
    "private diagnostic without structure"
  ]) {
    assert.throws(
      () => validateSinglePagePdfInfo(output),
      (error) => error?.code === "PDF_STRUCTURE_INVALID" && !error.message.includes(output)
    );
  }
});

test("rasteriza solo despues de validar pdfinfo y elimina el temporal", () => {
  const calls = [];
  let inputPath = "";
  const execFile = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    if (command === "/usr/bin/pdfinfo") {
      inputPath = args[0];
      assert.equal(existsSync(inputPath), true);
      return "Pages: 1\nEncrypted: no\n";
    }
    const outputPrefix = args.at(-1);
    writeFileSync(`${outputPrefix}.png`, TINY_PNG, { mode: 0o600 });
    return "";
  };
  const result = rasterizePdfWithPdftoppm(Buffer.from("%PDF-1.4\nsynthetic\n", "ascii"), { execFile });
  assert.deepEqual(result, TINY_PNG);
  assert.deepEqual(calls.map((call) => call.command), ["/usr/bin/pdfinfo", "/usr/bin/pdftoppm"]);
  assert.ok(calls.every((call) => call.options.shell === false));
  assert.equal(existsSync(inputPath), false);
});

test("un PDF multipagina no alcanza pdftoppm y produce error publico sanitizado", () => {
  const calls = [];
  assert.throws(() => rasterizePdfWithPdftoppm(Buffer.from("%PDF-1.4\nsynthetic\n", "ascii"), {
    execFile(command) {
      calls.push(command);
      return "Pages: 2\nEncrypted: no\nprivate payload";
    }
  }), (error) => {
    assert.equal(error.code, "PDF_STRUCTURE_INVALID");
    const sanitized = publicError(error);
    assert.equal(sanitized.status, 422);
    assert.equal(sanitized.payload.error.code, "INVALID_DOCUMENT");
    assert.doesNotMatch(JSON.stringify(sanitized), /private payload|Pages:/);
    return true;
  });
  assert.deepEqual(calls, ["/usr/bin/pdfinfo"]);
});

test("un fallo de pdfinfo se trata como documento invalido sin propagar stderr", () => {
  assert.throws(() => rasterizePdfWithPdftoppm(Buffer.from("%PDF-1.4\nsynthetic\n", "ascii"), {
    execFile() {
      throw new Error("private pdfinfo stderr /tmp/document.pdf");
    }
  }), (error) => {
    assert.equal(error.code, "PDF_STRUCTURE_INVALID");
    assert.doesNotMatch(error.message, /private|stderr|\/tmp/);
    const sanitized = publicError(error);
    assert.equal(sanitized.status, 422);
    return true;
  });
});

test("Docker fija la base por digest e inyecta un build ID sin afirmar apt reproducible", async () => {
  const dockerfile = await readFile("deploy/ocr-worker/Dockerfile", "utf8");
  assert.match(
    dockerfile,
    /^FROM node:22\.17\.0-bookworm-slim@sha256:[a-f0-9]{64}$/m
  );
  assert.match(dockerfile, /ARG KCM_OCR_WORKER_BUILD_ID=local-unversioned/);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision/);
  assert.match(dockerfile, /apt sigue una fuente Bookworm mutable/);
  assert.doesNotMatch(readFileSync("deploy/ocr-worker/Dockerfile", "utf8"), /KCM_OCR_WORKER_SECRET/);
});
