#!/usr/bin/env node

import { createRequire } from "node:module";
import { randomBytes, scryptSync } from "node:crypto";
import process from "node:process";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const FORMA_DE_USUARIO = /^[A-Za-z0-9._-]{3,120}$/;

async function main() {
  const [usuario, nombreVisible] = process.argv.slice(2);
  if (!usuario || !nombreVisible) {
    throw new Error('Uso: npm run db:cuenta -- <usuario> "<Nombre Visible>"');
  }
  if (!FORMA_DE_USUARIO.test(usuario)) {
    throw new Error(
      "El usuario admite letras, digitos, punto, guion y guion bajo, de 3 a 120 caracteres, sin espacios.",
    );
  }

  const url = process.env.KCM_ADMIN_DATABASE_URL;
  if (!url) throw new Error("Falta KCM_ADMIN_DATABASE_URL.");

  const clave = process.env.KCM_CLAVE_NUEVA;
  if (!clave) throw new Error("Falta KCM_CLAVE_NUEVA con la contraseña de la cuenta.");
  if (clave.length < 12) {
    throw new Error("La contraseña necesita al menos 12 caracteres.");
  }

  const sal = randomBytes(16).toString("hex");
  const hash = scryptSync(clave, Buffer.from(sal, "hex"), 32).toString("hex");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO seguridad.credencial_consola
         (usuario, nombre_visible, credencial_hash, sal, algoritmo, emitida_por)
       SELECT $1, $2, $3, $4, 'scrypt', a.actor_id
         FROM seguridad.actor a
        WHERE a.identificador = 'sistema.configuracion'
       RETURNING credencial_id, usuario;`,
      [usuario, nombreVisible, hash, sal],
    );
    if (!rows.length) {
      throw new Error(
        "No existe el actor 'sistema.configuracion'. La base no trae la semilla de 0022.",
      );
    }
    console.log(`Cuenta creada: ${rows[0].usuario} (${rows[0].credencial_id})`);
    console.log("La contraseña no se guarda en claro ni se vuelve a mostrar.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
