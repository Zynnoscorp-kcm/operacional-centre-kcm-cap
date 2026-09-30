#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();
const DOCKERFILE = "infra/docker/Dockerfile";
const ENTRADA = "plataforma/src/main.ts";

const dockerfile = await readFile(DOCKERFILE, "utf8");
const copiados = [...dockerfile.matchAll(/^COPY (?!--from)(\S+)\s+\S+\s*$/gm)].map((m) => m[1]);

const fallos = [];

for (const ruta of copiados) {
  if (!existsSync(ruta)) fallos.push(`El Dockerfile copia una ruta inexistente: ${ruta}`);
}

const IMPORT = /^\s*(?:import|export)[^"']*from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/gm;

const visitados = new Set();
const externos = new Set();
const pendientes = [ENTRADA];

while (pendientes.length > 0) {
  const actual = pendientes.pop();
  if (visitados.has(actual)) continue;
  visitados.add(actual);
  if (!existsSync(actual)) continue;

  const fuente = await readFile(actual, "utf8");
  for (const match of fuente.matchAll(IMPORT)) {
    const especificador = match[1] ?? match[2];
    if (!especificador.startsWith(".")) {
      const partes = especificador.split("/");
      const nombre = especificador.startsWith("@") ? partes.slice(0, 2).join("/") : partes[0];
      if (!especificador.startsWith("node:")) externos.add(nombre);
      continue;
    }
    const destino = path.resolve(path.dirname(actual), especificador);
    const relativa = path.relative(RAIZ, destino);
    if (!relativa.startsWith("..")) pendientes.push(relativa);
  }
}

const cubierto = (relativa) =>
  copiados.some((c) => relativa === c || relativa.startsWith(`${c.replace(/\/$/, "")}/`));

for (const modulo of [...visitados].sort()) {
  if (existsSync(modulo) && !cubierto(modulo)) {
    fallos.push(`Alcanzable desde ${ENTRADA} pero ausente de la imagen: ${modulo}`);
  }
}

const paquete = JSON.parse(await readFile("package.json", "utf8"));
const declaradas = new Set(Object.keys(paquete.dependencies ?? {}));

const pares = new Set();
for (const usado of externos) {
  const manifiesto = path.join("node_modules", usado, "package.json");
  if (!existsSync(manifiesto)) continue;
  const { peerDependencies = {}, peerDependenciesMeta = {} } = JSON.parse(
    await readFile(manifiesto, "utf8")
  );
  for (const par of Object.keys(peerDependencies)) {
    if (!peerDependenciesMeta[par]?.optional) pares.add(par);
  }
}

for (const usado of externos) {
  if (!declaradas.has(usado)) fallos.push(`Importado en ejecución y no declarado: ${usado}`);
}
for (const declarada of declaradas) {
  if (!externos.has(declarada) && !pares.has(declarada)) {
    fallos.push(`Declarada en dependencies y nunca importada: ${declarada}`);
  }
}

if (fallos.length > 0) {
  fallos.forEach((fallo) => process.stderr.write(`ERROR: ${fallo}\n`));
  process.exitCode = 1;
} else {
  process.stdout.write(
    `OK: ${visitados.size} módulos alcanzables desde ${ENTRADA}, todos presentes en la imagen; ` +
      `dependencias de ejecución: ${[...externos].sort().join(", ")}.\n`
  );
}
