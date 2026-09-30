import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hojaDeEstilos } from "../../src/web/estaticos.ts";
import { html } from "../../src/web/kit/html.ts";
import { renderLayout } from "../../src/web/layout.ts";

const RUTAS_DEL_MENU: readonly string[] = [
  "/",
  "/sesiones",
  "/salas",
  "/preliberacion",
  "/liberacion",
  "/auditoria",
  "/auditoria/sesiones",
  "/auditoria/salas",
  "/auditoria/liberaciones",
  "/trabajadores",
  "/trabajadores/cursos",
  "/trabajadores/cobertura",
  "/trabajadores/departamentos",
  "/matriz",
  "/padron",
  "/sincronia",
  "/cargas",
  "/ocupaciones",
  "/dc3",
  "/excel",
  "/base",
  "/campos",
];

function pantalla(rutaActiva: string): string {
  return renderLayout({
    titulo: "Pantalla",
    subtitulo: "Prueba",
    entorno: "development",
    contenido: html`<p>Contenido</p>`,
    rutaActiva,
  });
}

function encendidos(documento: string, clase: "lateral-enlace" | "subpestana"): number {
  const patron = new RegExp(`class="${clase}"[\\s\\S]{0,140}?aria-current="page"`, "g");
  return [...documento.matchAll(patron)].length;
}

describe("Recorrido entre pantallas", () => {
  it("ningún documento enciende dos veces la píldora del lateral", () => {
    for (const ruta of RUTAS_DEL_MENU) {
      const cuantas = encendidos(pantalla(ruta), "lateral-enlace");
      assert.equal(cuantas, 1, `${ruta} encendió ${cuantas} entradas del lateral, y debe ser 1`);
    }
  });

  it("ningún documento enciende dos sub-pestañas del armazón", () => {
    for (const ruta of RUTAS_DEL_MENU) {
      const cuantas = encendidos(pantalla(ruta), "subpestana");
      assert.ok(cuantas <= 1, `${ruta} encendió ${cuantas} sub-pestañas del armazón`);
    }
  });

  it("la hoja declara el recorrido y nombra las cuatro piezas del armazón", () => {
    const hoja = hojaDeEstilos.contenido;

    assert.match(hoja, /@view-transition\s*\{\s*navigation:\s*auto;/u);
    for (const nombre of ["kcm-rail", "kcm-barra", "kcm-pestanas", "kcm-lienzo"]) {
      assert.match(hoja, new RegExp(`view-transition-name:\\s*${nombre};`, "u"));
    }
  });

  it("la sub-pestaña activa se nombra sólo dentro del armazón, no en la del plan DC-3", () => {
    assert.match(
      hojaDeEstilos.contenido,
      /\.lienzo > \.subpestanas > \.subpestana\[aria-current="page"\]/u,
    );
  });

  it("quien pide menos movimiento no ve el recorrido", () => {
    const hoja = hojaDeEstilos.contenido;
    const bloque = hoja.slice(hoja.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(bloque, /::view-transition-group\(\*\)/u);
    assert.match(bloque, /animation:\s*none\s*!important;/u);
  });
});
