/**
 * Control de cambios: cada envío completo con su desenlace.
 *
 * Lo que se vigila es el emparejamiento, que es donde un aviso puede mentir:
 * un envío aplicado que se lea como pendiente manda a aprobar algo que ya
 * entró, y uno viejo que se lea como pendiente manda a una revisión que ya no
 * existe.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CargaRegistrada } from "../../src/domain/cargas/tipos.ts";
import { armarAvisos, renderChangeControlPage } from "../../src/web/pages/control-de-cambios.ts";

let secuencia = 0;
function asiento(
  parcial: Partial<CargaRegistrada> & Pick<CargaRegistrada, "tipo" | "hecho">,
): CargaRegistrada {
  secuencia += 1;
  return {
    asientoId: `a-${String(secuencia)}`,
    ocurridoEn: "2026-09-25T18:00:00.000Z",
    actor: "VBA_CLIENT_KCM-OFFICE-01",
    archivo: "Matriz.xlsb",
    sha256: "f".repeat(64),
    solicitudId: "s-1",
    resumen: {},
    ...parcial,
  };
}

const AHORA = new Date("2026-09-25T18:10:00.000Z");

describe("Control de cambios · emparejamiento", () => {
  it("un envío con su aplicación se lee como aplicado", () => {
    // Del más nuevo al más viejo, como los entrega la bitácora.
    const avisos = armarAvisos(
      [
        asiento({ tipo: "MATRIZ", hecho: "APLICADA", ocurridoEn: "2026-09-25T18:05:00.000Z" }),
        asiento({ tipo: "MATRIZ", hecho: "REVISADA" }),
      ],
      AHORA,
    );
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0]?.estado, "APLICADA");
  });

  it("sólo el envío más nuevo de cada fuente puede esperar aprobación", () => {
    const avisos = armarAvisos(
      [
        asiento({
          tipo: "MATRIZ",
          hecho: "REVISADA",
          solicitudId: "s-2",
          ocurridoEn: "2026-09-25T18:08:00.000Z",
        }),
        asiento({
          tipo: "PADRON",
          hecho: "REVISADA",
          solicitudId: "p-1",
          ocurridoEn: "2026-09-25T18:06:00.000Z",
        }),
        asiento({
          tipo: "MATRIZ",
          hecho: "REVISADA",
          solicitudId: "s-1",
          ocurridoEn: "2026-09-25T18:04:00.000Z",
        }),
      ],
      AHORA,
    );
    assert.deepEqual(
      avisos.map((aviso) => [aviso.envio.solicitudId, aviso.estado]),
      [
        ["s-2", "PENDIENTE"],
        ["p-1", "PENDIENTE"],
        ["s-1", "SIN_APLICAR"],
      ],
    );
  });

  it("pasada la vigencia de la revisión, el envío ya no espera", () => {
    const avisos = armarAvisos(
      [asiento({ tipo: "PADRON", hecho: "REVISADA", ocurridoEn: "2026-09-25T17:00:00.000Z" })],
      AHORA,
    );
    assert.equal(avisos[0]?.estado, "SIN_APLICAR");
  });

  it("la pantalla enseña cuántos entran y enlaza a la revisión pendiente", () => {
    const pagina = renderChangeControlPage({
      entorno: "development",
      avisos: armarAvisos(
        [
          asiento({
            tipo: "MATRIZ",
            hecho: "REVISADA",
            resumen: { trabajadoresNuevos: 3, muestraNuevos: "10234, 10876, 11002" },
          }),
        ],
        AHORA,
      ),
    });
    assert.match(pagina, /\+3/u);
    assert.match(pagina, /href="\/matriz"/u);
    assert.match(pagina, /Espera aprobación/u);
  });
});

describe("Panel de cambios · una persona, un renglón", () => {
  it("junta los datos y las fechas de una persona y no repite a quien entra", async () => {
    const { renderPanelDeCambios, personasConCambios } =
      await import("../../src/web/kit/panel-de-cambios.ts");
    const detalle = {
      altas: [{ nomina: "12001", nombre: "PERSONA NUEVA", adscripcion: ["OPERADOR"] }],
      bajas: [],
      movimientos: [
        {
          nomina: "10555",
          nombre: "LAURA GOMEZ",
          campo: "Puesto",
          antes: "AYUDANTE",
          ahora: "OPERADOR",
        },
        { nomina: "10555", nombre: "LAURA GOMEZ", campo: "Planta", antes: "P1", ahora: "P2" },
      ],
      fechas: [
        {
          nomina: "10555",
          nombre: "LAURA GOMEZ",
          curso: "SEGURIDAD",
          antes: null,
          ahora: "2026-09-22",
        },
        {
          nomina: "12001",
          nombre: "PERSONA NUEVA",
          curso: "INDUCCION",
          antes: null,
          ahora: "2026-09-22",
        },
      ],
      fechasOmitidas: 0,
    };
    const html = renderPanelDeCambios({
      titulo: "Matriz",
      cifras: [],
      detalle,
      rotuloAltas: "Entran",
      rotuloBajas: "Ya no están",
    }).__html;
    assert.equal(personasConCambios(detalle), 1);
    assert.equal(html.match(/LAURA GOMEZ/gu)?.length, 1);
    assert.equal(html.match(/PERSONA NUEVA/gu)?.length, 1);
    assert.match(html, /Planta/u);
    assert.match(html, /INDUCCION/u);
  });
});
