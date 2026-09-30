import { spawnSync } from "node:child_process";

export const IMAGE_PIPELINE_VERSION = "raster-homography-1.0.0";

const TOOL_COMMANDS = Object.freeze({
  tesseract: "/usr/bin/tesseract",
  pdfinfo: "/usr/bin/pdfinfo",
  pdftoppm: "/usr/bin/pdftoppm"
});
const TOOL_ENVIRONMENT = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" });
const VERSION = /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+._a-z0-9]*)?$/i;
const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function probeVersion(runner, { name, command, args, pattern }) {
  const result = runner(command, args, {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
    shell: false,
    maxBuffer: 128 * 1024,
    env: TOOL_ENVIRONMENT
  });
  if (!result || result.status !== 0 || result.error || result.signal) {
    throw new Error(`La herramienta requerida ${name} no esta disponible`);
  }
  const output = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
  const version = output.match(pattern)?.[1] ?? "";
  if (!VERSION.test(version)) throw new Error(`La version efectiva de ${name} no es verificable`);
  return version;
}

export function inspectOcrRuntime({
  containerBuildId,
  runner = spawnSync,
  nodeVersion = process.versions.node
} = {}) {
  const buildId = String(containerBuildId ?? "");
  if (!BUILD_ID.test(buildId)) throw new TypeError("KCM_OCR_WORKER_BUILD_ID no es valido");
  const effectiveNodeVersion = String(nodeVersion ?? "");
  if (!VERSION.test(effectiveNodeVersion)) throw new TypeError("La version efectiva de Node no es valida");
  if (typeof runner !== "function") throw new TypeError("runner debe ser una funcion");

  const ocrEngineVersion = probeVersion(runner, {
    name: "tesseract",
    command: TOOL_COMMANDS.tesseract,
    args: ["--version"],
    pattern: /^tesseract\s+([^\s]+)$/mi
  });
  const pdfInfoVersion = probeVersion(runner, {
    name: "pdfinfo",
    command: TOOL_COMMANDS.pdfinfo,
    args: ["-v"],
    pattern: /^pdfinfo version\s+([^\s]+)$/mi
  });
  const pdfToPpmVersion = probeVersion(runner, {
    name: "pdftoppm",
    command: TOOL_COMMANDS.pdftoppm,
    args: ["-v"],
    pattern: /^pdftoppm version\s+([^\s]+)$/mi
  });
  const inspected = {
    metadata: Object.freeze({
      nodeVersion: effectiveNodeVersion,
      ocrEngineName: "tesseract",
      ocrEngineVersion,
      pdfInfoVersion,
      pdfToPpmVersion,
      imagePipelineVersion: IMAGE_PIPELINE_VERSION,
      containerBuildId: buildId
    })
  };
  Object.defineProperty(inspected, "commands", { value: TOOL_COMMANDS, enumerable: false });
  return Object.freeze(inspected);
}

export const OCR_RUNTIME_PATTERNS = Object.freeze({ VERSION, BUILD_ID });
