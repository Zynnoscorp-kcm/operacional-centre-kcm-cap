import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const vercel = JSON.parse(await readFile("vercel.json", "utf8"));

test("la nube sólo sirve como archivo la carpeta public/", () => {
  assert.equal(vercel.outputDirectory, "public");
});

test("public/ no trae nada más que robots.txt", async () => {
  const archivos = await readdir("public", { recursive: true });
  assert.deepEqual(archivos.filter((nombre) => nombre !== ".DS_Store").sort(), ["robots.txt"]);
});

test("la subida excluye las credenciales locales y el material con datos personales", async () => {
  const reglas = (await readFile(".vercelignore", "utf8"))
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea !== "" && !linea.startsWith("#"));
  for (const privado of [".env", ".env.*", ".mcp.json", "referencias", "referencias 2"]) {
    assert.ok(reglas.includes(privado), `falta excluir ${privado} de la subida`);
  }
});
