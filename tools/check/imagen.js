#!/usr/bin/env node
/**
 * Comprueba que la imagen de producción contendría todo lo que el proceso
 * importa en ejecución.
 *
 * `infra/docker/Dockerfile` enumera archivo por archivo lo que entra a la
 * imagen. Eso es deliberado —un `COPY packages ./packages` a secas escondería
 * la dependencia— pero tiene un costo: agregar un import hacia un módulo nuevo
 * fuera de `plataforma/` rompe el contenedor en el primer arranque, con
 * `ERR_MODULE_NOT_FOUND`, y no antes.
 *
 * Este guion adelanta ese fallo al momento de la verificación. Recorre el
 * cierre de imports desde `plataforma/src/main.ts` y comprueba tres cosas:
 *
 *   1. Que cada ruta del `COPY` exista en el árbol.
 *   2. Que todo módulo alcanzable desde el punto de entrada quede cubierto por
 *      alguno de esos `COPY`.
 *   3. Que los paquetes externos importados en ejecución coincidan con las
 *      `dependencies` del `package.json`, en ambos sentidos.
 */
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
      if (!especificador.startsWith("node:")) externos.add(especificador.split("/")[0]);
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

for (const usado of externos) {
  if (!declaradas.has(usado)) fallos.push(`Importado en ejecución y no declarado: ${usado}`);
}
for (const declarada of declaradas) {
  if (!externos.has(declarada)) fallos.push(`Declarada en dependencies y nunca importada: ${declarada}`);
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
