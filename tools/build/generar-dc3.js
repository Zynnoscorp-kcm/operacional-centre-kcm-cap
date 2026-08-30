#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runDc3Generator } from "../../packages/dc3/runner.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DEFAULT_CONFIG = "config/dc3-generator.example.json";

function parseArguments(argv) {
  const options = {
    configPath: DEFAULT_CONFIG,
    generate: false,
    allowPartial: false,
    report: false,
    check: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--generate") options.generate = true;
    else if (argument === "--allow-partial") options.allowPartial = true;
    else if (argument === "--report") options.report = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--config") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Falta valor para --config");
      options.configPath = value;
      index += 1;
    } else if (argument === "--help") options.help = true;
    else throw new Error(`Argumento desconocido: ${argument}`);
  }
  return options;
}

function printHelp() {
  process.stderr.write(
    "Uso: npm run dc3:plan -- [--config archivo.json] [--generate] [--allow-partial]\n" +
    "                                       [--report] [--check]\n" +
    "Sin --generate solo detecta y publica conteos agregados; nunca crea DC-3.\n" +
    "  --check          falla con salida 3 mientras falten metadatos legales por aprobar.\n" +
    "  --report         escribe el detalle de bloqueos en referencias/privado/ (0600).\n" +
    "  --allow-partial  permite emitir los cursos ya aprobados dejando el resto bloqueado.\n" +
    "Salidas: 0 correcto, 1 error, 2 conflictos sin sobrescribir, 3 metadatos pendientes.\n"
  );
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const summary = runDc3Generator({
      projectRoot: PROJECT_ROOT,
      configPath: options.configPath,
      generate: options.generate,
      allowPartial: options.allowPartial,
      report: options.report
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (summary.execution.mode === "GENERATE" && summary.execution.conflicts > 0) {
      process.exitCode = 2;
    } else if (options.check && !summary.readiness.metadataApproved) {
      process.stderr.write(
        "DC-3 sin metadatos legales aprobados en: " +
        `${summary.readiness.coursesPendingMetadata.map(({ courseId }) => courseId).join(", ")}\n`
      );
      process.exitCode = 3;
    }
  } catch (error) {
    process.stderr.write(`No se completo el proceso DC-3: ${error.message}\n`);
    process.exitCode = error?.code === "DC3_NOT_READY" ? 3 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) main();
