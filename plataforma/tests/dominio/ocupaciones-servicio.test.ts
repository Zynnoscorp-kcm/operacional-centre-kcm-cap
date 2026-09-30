import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DomainError } from "../../src/domain/comun/errores.ts";
import {
  ServicioDeOcupaciones,
  huellaDeConfiguracion,
  leerCaso,
} from "../../src/domain/ocupaciones/servicio.ts";

function rechaza(entrada: unknown, codigo: string): void {
  assert.throws(
    () => leerCaso(entrada),
    (error: unknown) => error instanceof DomainError && error.code === codigo,
  );
}

describe("Ocupaciones · la puerta del agente", () => {
  it("acepta puesto y centro de costos, y los limpia", () => {
    assert.deepEqual(
      leerCaso({ puesto: "  *OPERARIO   1° ", centroDeCostos: "TOALLAS (CONVERSION)" }),
      {
        puesto: "*OPERARIO 1°",
        centroDeCostos: "TOALLAS (CONVERSION)",
      },
    );
  });

  it("rechaza cualquier campo de más, aunque parezca inofensivo", () => {
    rechaza(
      { puesto: "*OPERADOR", centroDeCostos: "AGUA", numero: "28392" },
      "CASO_CON_CAMPOS_DE_MAS",
    );
    rechaza(
      { puesto: "*OPERADOR", centroDeCostos: "AGUA", area: "ECATEPEC I" },
      "CASO_CON_CAMPOS_DE_MAS",
    );
    rechaza(
      { puesto: "*OPERADOR", centroDeCostos: "AGUA", toString: "28392" },
      "CASO_CON_CAMPOS_DE_MAS",
    );
  });

  it("detiene lo que parece un dato personal: números largos, correos y nombres del padrón", () => {
    rechaza({ puesto: "28392", centroDeCostos: "AGUA" }, "CASO_CON_DATO_PERSONAL");
    rechaza({ puesto: "TODC680621HMCRLR04", centroDeCostos: "AGUA" }, "CASO_CON_DATO_PERSONAL");
    rechaza({ puesto: "*OPERADOR", centroDeCostos: "a@b.mx" }, "CASO_CON_DATO_PERSONAL");
    rechaza({ puesto: "TORRES,DELGADO,CARLOS", centroDeCostos: "AGUA" }, "CASO_CON_DATO_PERSONAL");
    rechaza({ puesto: "２８３９２", centroDeCostos: "AGUA" }, "CASO_CON_DATO_PERSONAL");
    for (const numero of ["1234-56-7890-1", "12 34 56 7890 1", "55 1234 5678", "283.92"]) {
      rechaza({ puesto: "*OPERADOR", centroDeCostos: numero }, "CASO_CON_DATO_PERSONAL");
    }
  });

  it("deja pasar números cortos, que son parte del nombre de una máquina o un nivel", () => {
    assert.equal(
      leerCaso({ puesto: "*OPERARIO 2°", centroDeCostos: "MAQUINA WADDING 05" }).centroDeCostos,
      "MAQUINA WADDING 05",
    );
    for (const centro of ["TURNO 1-2-3", "LINEA 1 Y 2", "SUPERINTENDENTE PROCESO WADDING 5"]) {
      assert.equal(
        leerCaso({ puesto: "*OPERARIO 3°", centroDeCostos: centro }).centroDeCostos,
        centro,
      );
    }
  });

  it("rechaza lo vacío, lo que no es texto y lo demasiado largo", () => {
    rechaza({ puesto: "", centroDeCostos: "AGUA" }, "CASO_INCOMPLETO");
    rechaza({ puesto: 5, centroDeCostos: "AGUA" }, "CASO_INCOMPLETO");
    rechaza({ centroDeCostos: "AGUA" }, "CASO_INCOMPLETO");
    rechaza(null, "CASO_INCOMPLETO");
    rechaza({ puesto: "X".repeat(121), centroDeCostos: "AGUA" }, "CASO_DEMASIADO_LARGO");
  });

  it("la huella cambia si cambia cualquier pieza de la configuración", () => {
    const base = {
      version: "1",
      modelos: ["principal:groq/a"],
      limites: { tope: 1 },
      catalogo: "abc",
    };
    const huella = huellaDeConfiguracion(base);
    assert.match(huella, /^[0-9a-f]{16}$/u);
    assert.equal(huellaDeConfiguracion({ ...base }), huella);
    assert.notEqual(huellaDeConfiguracion({ ...base, modelos: ["principal:groq/b"] }), huella);
    assert.notEqual(huellaDeConfiguracion({ ...base, limites: { tope: 2 } }), huella);
    assert.notEqual(huellaDeConfiguracion({ ...base, catalogo: "abd" }), huella);
  });

  it("el agente nunca recibe un caso que no pasó la puerta", async () => {
    const vistos: unknown[] = [];
    const servicio = new ServicioDeOcupaciones({
      agente: {
        clasificar: (caso) => {
          vistos.push(caso);
          return Promise.resolve({
            estado: "sin_respuesta",
            sugerencia: null,
            principal: null,
            verificador: null,
            razon: "prueba",
            traza: [],
          });
        },
      },
      version: "v",
      huella: "h",
    });
    await assert.rejects(
      servicio.sugerir({ puesto: "28392", centroDeCostos: "AGUA" }),
      DomainError,
    );
    const sugerencia = await servicio.sugerir({ puesto: "*OPERADOR", centroDeCostos: "AGUA" });
    assert.equal(vistos.length, 1);
    assert.equal(sugerencia.version, "v");
    assert.equal(sugerencia.huella, "h");
    assert.deepEqual(sugerencia.caso, { puesto: "*OPERADOR", centroDeCostos: "AGUA" });
  });
});
