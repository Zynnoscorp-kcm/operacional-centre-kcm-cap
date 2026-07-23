#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const roots = ["src", "scripts", "tests"];
const required = [
  "AGENTS.md", "README.md", "PROMPT_MAESTRO.xml", "src/apps-script/appsscript.json",
  "src/shared/contracts.js", "docs/ARQUITECTURA.md", "docs/DICCIONARIO_MATRIZ.md"
];

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? walk(child) : [child];
  }));
  return nested.flat();
}

const files = (await Promise.all(roots.map((root) => walk(root)))).flat();
const failures = [];

for (const file of required) {
  try {
    await readFile(file);
  } catch {
    failures.push(`Falta archivo requerido: ${file}`);
  }
}

for (const file of files.filter((item) => item.endsWith(".js"))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) failures.push(`Sintaxis invalida en ${file}: ${result.stderr.trim()}`);
}

for (const file of files.filter((item) => item.endsWith(".gs"))) {
  const source = await readFile(file, "utf8");
  const result = spawnSync(process.execPath, ["--check", "-"], { input: source, encoding: "utf8" });
  if (result.status !== 0) failures.push(`Sintaxis invalida en ${file}: ${result.stderr.trim()}`);
}

const trackedPrivate = spawnSync("git", ["ls-files", "referencias/privado"], { encoding: "utf8" });
if (trackedPrivate.stdout.trim()) failures.push("Git rastrea material bajo referencias/privado");

const suspicious = [];
for (const file of files.filter((item) => /\.(js|gs|html|json|md)$/.test(item))) {
  const source = await readFile(file, "utf8");
  if (/\bemployeeId\s*[:=]\s*[0-9]{5}\b/.test(source)) suspicious.push(file);
}
if (suspicious.length) failures.push(`ID posiblemente numerico (debe ser texto): ${suspicious.join(", ")}`);

if (failures.length) {
  failures.forEach((failure) => process.stderr.write(`ERROR: ${failure}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(`OK: ${files.length} archivos revisados; sintaxis y guardas basicas validas.\n`);
}

