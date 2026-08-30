/**
 * Las dos pantallas de barrido, contra el sistema de diseño.
 *
 * `base.css` no tiene un solo color literal y todas las pantallas comparten los
 * mismos componentes; una clase inventada no rompe nada visible en la prueba de
 * ruta —el HTML sale igual de válido— y simplemente se ve sin estilo en la
 * consola. Esto lo convierte en falla: cada clase que una pantalla usa tiene que
 * existir en la hoja que se publica.
 *
 * Comprueba además lo que hace legible una tabla en esta consola: encabezado
 * declarado con `scope`, envoltura que permite el desplazamiento horizontal, y
 * el resumen en los mosaicos `kpi` que usan la auditoría, la consola interna y
 * los tableros de la Función 8.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { InformeDeBarrido } from "../../src/domain/barrido-matriz/tipos.ts";
import type { PlanDePadron } from "../../src/domain/padron/tipos.ts";
import type { CargaRegistrada } from "../../src/domain/cargas/tipos.ts";
import { renderLoadHistoryPage } from "../../src/web/pages/historial-cargas.ts";
import { renderMatrixScanPage } from "../../src/web/pages/barrido-matriz.ts";
import { renderRosterPage } from "../../src/web/pages/padron.ts";

const HOJAS = ["tokens.css", "base.css"] as const;

/** Las clases declaradas en la hoja concatenada, en el mismo orden que se sirve. */
const declaradas = new Set(
  [
    ...HOJAS.map((hoja) =>
      readFileSync(new URL(`../../src/web/assets/${hoja}`, import.meta.url), "utf8"),
    )
      .join("\n")
      .matchAll(/\.([a-zA-Z][\w-]*)/gu),
  ].map((coincidencia) => coincidencia[1]),
);

function clasesDe(documento: string): string[] {
  const usadas = new Set<string>();
  for (const coincidencia of documento.matchAll(/class="([^"]*)"/gu)) {
    for (const clase of (coincidencia[1] ?? "").split(/\s+/u).filter(Boolean)) usadas.add(clase);
  }
  return [...usadas];
}

// ------------------------------------------------------------------ fixtures

const INFORME: InformeDeBarrido = {
  barridoId: "b-1",
  recibidoEn: "2026-08-12T18:00:00.000Z",
  venceEn: "2026-08-12T18:30:00.000Z",
  fuente: {
    nombreArchivo: "Matriz_Sintetica.xlsb",
    hoja: "HC",
    sha256: "a".repeat(64),
    extraidoEn: "2026-08-12T17:55:00.000Z",
    cliente: "KCM-OFFICE-01",
  },
  columnas: [
    {
      columna: "K",
      nombre: "INDUCCION A LA EMPRESA",
      claveOrigen: "hc-course:induccion",
      fechas: 1642,
      estado: "COINCIDE",
    },
    {
      columna: "L",
      nombre: "QMS",
      claveOrigen: "hc-course:qms",
      fechas: 452,
      estado: "RENOMBRADA",
      nombreEnBase: "SISTEMA DE CALIDAD",
    },
    {
      columna: "M",
      nombre: "TRABAJO EN ALTURAS",
      claveOrigen: "hc-course:alturas",
      fechas: 38,
      estado: "NUEVA",
    },
  ],
  cuadre: {
    trabajadoresEnMatriz: 1686,
    trabajadoresEnBase: 1690,
    trabajadoresNuevos: 1,
    trabajadoresAusentes: 8,
    cambiosDePuesto: 12,
    cambiosDeArea: 3,
    cambiosDeDepartamento: 1,
    columnasEnMatriz: 3,
    columnasEnBase: 2,
    columnasNuevas: 1,
    columnasRenombradas: 1,
    columnasRetiradas: 0,
    fechasEnMatriz: 2132,
    fechasNuevas: 41,
    fechasCorregidas: 6,
    fechasRetiradas: 3,
    fechasReactivadas: 1,
    conflictos: 0,
    pendientesEnMaestro: 2,
  },
  muestras: {
    trabajadoresNuevos: ["10101"],
    trabajadoresAusentes: ["09001", "09002"],
    cambiosDeAdscripcion: [
      { numeroTrabajador: "10233", campo: "PUESTO", antes: "OPERADOR", ahora: "SUPERVISOR" },
      { numeroTrabajador: "10233", campo: "AREA", antes: "CONVERTIDORA", ahora: "EMPAQUE" },
    ],
    columnasNuevas: ["TRABAJO EN ALTURAS"],
    columnasRetiradas: [],
    conflictos: [],
  },
  sinCambios: false,
  bloqueado: false,
  incidencias: [],
};

const PLAN: PlanDePadron = {
  planId: "p-1",
  nombreArchivo: "sem 33 CAP.xlsx",
  sha256: "b".repeat(64),
  leidoEn: "2026-08-12T18:00:00.000Z",
  origen: { tipo: "PUENTE_VBA", actor: "KCM-OFFICE-01" },
  hojas: [
    {
      sheetName: "SND ACTIVOS",
      rowsWithIdentity: 1204,
      acceptedRows: 1204,
      columns: [
        { field: "employeeId", header: "NUMERO", columnName: "A", required: true, present: true },
        { field: "curp", header: "C.U.R.P.", columnName: "E", required: true, present: true },
        { field: "hireDate", header: "FEC ALTA", columnName: "G", required: true, present: true },
        { field: "cnoKey", header: "CLAVE CNO", columnName: "H", required: false, present: true },
      ],
    },
    {
      sheetName: "EMP ACTIVOS",
      rowsWithIdentity: 486,
      acceptedRows: 486,
      columns: [
        { field: "employeeId", header: "NUMERO", columnName: "A", required: true, present: true },
        { field: "cnoKey", header: "", columnName: "", required: false, present: false },
      ],
    },
  ],
  cuadre: {
    activosEnArchivo: 1690,
    sinIncidencias: 1602,
    reconocidos: 1686,
    desconocidos: 1,
    ausentes: 8,
    curpPorEscribir: 88,
    altasPorCorregir: 1,
    altasQueCoinciden: 1681,
    induccionesNuevas: 12,
    induccionesDivergentes: 1,
    puestosNuevos: 2,
    puestosCambiados: 14,
    traeColumnaCno: true,
    cnoPorEscribir: 9,
    cnoQueCoinciden: 61,
    cnoEnConflicto: 1,
    nominasDivergentes: 2,
    plantasDivergentes: 1,
    traeColumnaPlanta: true,
  },
  muestras: {
    desconocidos: ["10101"],
    ausentes: ["09001", "09002"],
    puestosNuevos: ["SUPERVISOR DE LINEA", "TECNICO A"],
    cnoEnConflicto: ["OPERADOR: 8121 / 7231"],
    nominasDivergentes: [{ numeroTrabajador: "00042", enPadron: "NS", enBase: "NQ" }],
    plantasDivergentes: [
      { numeroTrabajador: "00043", enPadron: "ECATEPEC I", enBase: "ECATEPEC II" },
    ],
    cambiosDePuesto: [
      { numeroTrabajador: "10233", antes: "OPERADOR", ahora: "SUPERVISOR", fueraDeCatalogo: false },
      { numeroTrabajador: "10990", antes: "AYUDANTE", ahora: "TECNICO A", fueraDeCatalogo: true },
    ],
    incidencias: { INVALID_OR_MISSING_CURP: 88 },
  },
  sinCambios: false,
};

/**
 * Dos asientos del historial: uno con efecto y uno rechazado, que son los dos
 * que pintan distinto. El historial es hermano de las dos revisiones y comparte
 * su hoja, así que se sujeta a las mismas reglas.
 */
const ASIENTOS: readonly CargaRegistrada[] = [
  {
    asientoId: "1",
    ocurridoEn: "2026-08-18T18:00:00.000Z",
    tipo: "MATRIZ",
    hecho: "APLICADA",
    actor: "Maricela0000",
    archivo: "Matriz de Competencias 03 Agosto.xlsb",
    sha256: "a".repeat(64),
    solicitudId: "req-1",
    resumen: { insertadas: 12, corregidas: 3, hoja: "HC" },
  },
  {
    asientoId: "2",
    ocurridoEn: "2026-08-17T18:00:00.000Z",
    tipo: "PADRON",
    hecho: "RECHAZADA",
    actor: "Antonio0000",
    archivo: "sem 33 CAP.xlsx",
    sha256: "b".repeat(64),
    resumen: { motivo: "ROSTER_PLAN_NOT_FOUND" },
  },
];

/** Las dos revisiones, que son las que llevan resumen y tablas. */
const REVISIONES: readonly (readonly [string, string])[] = [
  ["barrido de matriz", renderMatrixScanPage({ entorno: "development", informe: INFORME })],
  ["barrido de padrón", renderRosterPage({ entorno: "development", plan: PLAN })],
];

/** Todas, incluida la pantalla de encargo, que no tiene datos que presentar. */
const PANTALLAS: readonly (readonly [string, string])[] = [
  ...REVISIONES,
  ["padrón sin revisión", renderRosterPage({ entorno: "development" })],
  [
    "historial de cargas",
    renderLoadHistoryPage({ entorno: "development", asientos: ASIENTOS, enMemoria: false }),
  ],
  [
    "historial vacío",
    renderLoadHistoryPage({ entorno: "development", asientos: [], enMemoria: true }),
  ],
];

// -------------------------------------------------------------------- pruebas

describe("Barridos · estilo de la consola", () => {
  it("no usa ninguna clase que la hoja no declare", () => {
    for (const [nombre, documento] of PANTALLAS) {
      const huerfanas = clasesDe(documento)
        .filter((clase) => !declaradas.has(clase))
        .sort();
      assert.deepEqual(huerfanas, [], `${nombre} usa clases sin estilo: ${huerfanas.join(", ")}`);
    }
  });

  it("resume con los mosaicos del sistema y no con un componente propio", () => {
    for (const [nombre, documento] of REVISIONES) {
      assert.match(documento, /class="kpi-tira"/u, `${nombre} no usa la tira de mosaicos`);
      assert.match(documento, /class="kpi-etiqueta"/u, `${nombre} no rotula sus mosaicos`);
      assert.match(documento, /class="kpi-pista"/u, `${nombre} no dice de qué está hecha la cifra`);
    }
  });

  it("cada tabla declara encabezado con alcance y permite desplazarse", () => {
    for (const [nombre, documento] of PANTALLAS) {
      const tablas = documento.match(/<table\b/gu)?.length ?? 0;
      const envolturas = documento.match(/class="tabla-contenedor"/gu)?.length ?? 0;
      assert.equal(envolturas, tablas, `${nombre} tiene tablas sin envoltura desplazable`);

      const encabezados = documento.match(/<th\b[^>]*>/gu) ?? [];
      for (const th of encabezados) {
        assert.match(th, /scope="col"/u, `${nombre} tiene un <th> sin scope: ${th}`);
      }
      assert.equal(
        documento.match(/<thead\b/gu)?.length ?? 0,
        tablas,
        `${nombre} tiene tablas sin <thead>`,
      );
    }
  });

  it("no lleva estilo en línea: el diseño vive en la hoja", () => {
    for (const [nombre, documento] of PANTALLAS) {
      assert.doesNotMatch(documento, /\sstyle="/u, `${nombre} lleva estilo en línea`);
    }
  });

  it("no publica nombres de trabajador en ninguna de las dos", () => {
    for (const [nombre, documento] of PANTALLAS) {
      // Las dos fuentes traen nombre completo y ninguna pantalla lo necesita:
      // la nómina basta para ir a buscar a la persona en el libro.
      assert.doesNotMatch(documento, /nombre_completo|displayName/u, `${nombre} filtra el nombre`);
    }
  });
});
