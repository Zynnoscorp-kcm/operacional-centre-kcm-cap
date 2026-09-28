/**
 * Consola interna: auditoría por secciones, campos declarados y explorador.
 *
 * Lo que estas pruebas cuidan no es que las pantallas pinten: es que las tres
 * piezas nuevas no puedan tocar lo que ya funciona. Por eso hay una prueba
 * que verifica que un repositorio falso registre cero escrituras, y otra que
 * comprueba que el previsualizador rechace una tabla que no salió del catálogo.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryInternalConsoleRepository } from "../../src/adapters/memoria/consola-interna.ts";
import { SupabaseInternalConsoleRepository } from "../../src/adapters/postgres/consola-interna.ts";
import type { SqlExecutor } from "../../src/adapters/postgres/matriz.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { InternalAuditService } from "../../src/domain/consola-interna/auditoria.ts";
import { DataPreviewService } from "../../src/domain/consola-interna/vista-de-datos.ts";
import { DeclaredFieldService } from "../../src/domain/consola-interna/campos-declarados.ts";
import {
  LIMITE_MAXIMO_DE_FILAS,
  TABLAS_VEDADAS,
  VENTANA_AUDITORIA_DIAS,
  type TablePreview,
} from "../../src/domain/consola-interna/tipos.ts";
import type { InternalConsolePort } from "../../src/ports/consola-interna.port.ts";
import { buildServer } from "../../src/server/build-server.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";

const clock: Clock = {
  now: () => new Date("2026-08-03T12:00:00.000Z"),
  nowIso: () => "2026-08-03T12:00:00.000Z",
};

const config = loadConfig({
  KCM_ENV: "development",
  KCM_HOST: "127.0.0.1",
  KCM_PORT: "8787",
  KCM_PILOT_OPEN_ACCESS: "true",
});

function repositorioEnMemoria(): MemoryInternalConsoleRepository {
  return new MemoryInternalConsoleRepository({ clock });
}

describe("consola interna · auditoría por secciones", () => {
  it("pide a la base la ventana de ocho días para sesiones y salas", async () => {
    const pedidos: string[] = [];
    const espia: Pick<InternalConsolePort, "listSessionAudit" | "listRoomAudit"> = {
      listSessionAudit: (dias) => {
        pedidos.push(`sesiones:${String(dias)}`);
        return Promise.resolve([]);
      },
      listRoomAudit: (dias) => {
        pedidos.push(`salas:${String(dias)}`);
        return Promise.resolve([]);
      },
    };

    const service = new InternalAuditService({
      repository: espia as InternalConsolePort,
      clock,
    });
    await service.sessions();
    await service.rooms();

    assert.deepEqual(pedidos, [
      `sesiones:${String(VENTANA_AUDITORIA_DIAS)}`,
      `salas:${String(VENTANA_AUDITORIA_DIAS)}`,
    ]);
  });

  it("publica la ventana con fechas y no con la frase «últimos ocho días»", () => {
    const service = new InternalAuditService({ repository: repositorioEnMemoria(), clock });
    assert.deepEqual(service.window(), {
      days: 8,
      from: "2026-07-26",
      to: "2026-08-03",
    });
  });

  it("las liberaciones no llevan ventana pero sí tope, y el tope se defiende", async () => {
    const service = new InternalAuditService({ repository: repositorioEnMemoria(), clock });
    await service.releases();
    assert.throws(() => service.releases(0), /entre 1 y/u);
    assert.throws(() => service.releases(5_000), /entre 1 y/u);
  });

  it("cuenta cuántas liberaciones sustituyeron una fecha previa", () => {
    const base = {
      releaseId: "l1",
      batchId: "b1",
      requestId: "r1",
      sessionCode: "KCM-1",
      workerNumber: "10001",
      workerName: "TRABAJADOR SINTETICO",
      course: "5S",
      effectiveDate: "2026-08-03",
      result: "APPLIED",
      appliedAt: "2026-08-03T12:00:00.000Z",
      batchState: "COMPLETADO",
      releasedBy: "OPERADOR",
    } as const;

    assert.equal(
      InternalAuditService.countOverwrites([
        base,
        { ...base, releaseId: "l2", previousDate: "2025-01-01" },
      ]),
      1,
    );
  });
});

describe("consola interna · campos declarados", () => {
  it("declara un campo y nace sin poder alimentar reglas", async () => {
    const service = new DeclaredFieldService({ repository: repositorioEnMemoria() });
    const campo = await service.declare(
      { name: "escolaridad_declarada", dataType: "texto", source: "plataforma" },
      "MARICELA",
    );

    assert.equal(campo.name, "escolaridad_declarada");
    assert.equal(campo.dataType, "TEXTO");
    assert.equal(campo.source, "PLATAFORMA");
    assert.equal(campo.approvedForRules, false);
  });

  it("normaliza la caja del nombre en vez de rechazarlo por escribirlo con mayúsculas", async () => {
    const service = new DeclaredFieldService({ repository: repositorioEnMemoria() });
    const campo = await service.declare(
      { name: " Escolaridad_Declarada ", dataType: "TEXTO", source: "PLATAFORMA" },
      "MARICELA",
    );
    assert.equal(campo.name, "escolaridad_declarada");
  });

  it("rechaza un nombre que no sirve como identificador", async () => {
    const service = new DeclaredFieldService({ repository: repositorioEnMemoria() });
    for (const nombre of ["con espacio", "ok", "3digitos", "con-guion", "acentuadó"]) {
      await assert.rejects(
        service.declare({ name: nombre, dataType: "TEXTO", source: "PLATAFORMA" }, "MARICELA"),
        /minúsculas/u,
        `debió rechazar «${nombre}»`,
      );
    }
  });

  it("rechaza tipo y origen fuera del enum del esquema", async () => {
    const service = new DeclaredFieldService({ repository: repositorioEnMemoria() });
    await assert.rejects(
      service.declare({ name: "campo_uno", dataType: "BLOB", source: "PLATAFORMA" }, "MARICELA"),
      /tipo de dato/u,
    );
    await assert.rejects(
      service.declare({ name: "campo_uno", dataType: "TEXTO", source: "INVENTADO" }, "MARICELA"),
      /origen/u,
    );
  });

  it("no admite declarar dos veces el mismo campo", async () => {
    const service = new DeclaredFieldService({ repository: repositorioEnMemoria() });
    await service.declare({ name: "campo_uno", dataType: "TEXTO", source: "CAPTA" }, "MARICELA");
    await assert.rejects(
      service.declare({ name: "campo_uno", dataType: "NUMERO", source: "CAPTA" }, "MARICELA"),
      /ya está declarado/u,
    );
  });

  it("aprobar es idempotente y deja constancia de quién aprobó", async () => {
    const service = new DeclaredFieldService({ repository: repositorioEnMemoria() });
    const campo = await service.declare(
      { name: "campo_uno", dataType: "TEXTO", source: "CAPTA" },
      "MARICELA",
    );

    const aprobado = await service.approve(campo.fieldId, "MARICELA");
    assert.equal(aprobado.approvedForRules, true);
    assert.equal(aprobado.approvedBy, "MARICELA");

    const otraVez = await service.approve(campo.fieldId, "OTRA_PERSONA");
    assert.equal(otraVez.approvedBy, "MARICELA", "reaprobar no debe reescribir al aprobador");
  });

  it("no aprueba un campo que no existe", async () => {
    const service = new DeclaredFieldService({ repository: repositorioEnMemoria() });
    await assert.rejects(service.approve("campo-inventado", "MARICELA"), /no está declarado/u);
  });
});

describe("consola interna · explorador de la base", () => {
  it("acota límite y desplazamiento en vez de rechazar la petición", async () => {
    const vistos: { limite: number; desde: number }[] = [];
    const repositorio: Pick<InternalConsolePort, "previewTable"> = {
      previewTable: (tabla, limite, desde) => {
        vistos.push({ limite, desde });
        return Promise.resolve({
          table: tabla,
          columns: [],
          rows: [],
          total: 0,
          limit: limite,
          offset: desde,
          maskedColumns: [],
        } satisfies TablePreview);
      },
    };

    const service = new DataPreviewService({ repository: repositorio as InternalConsolePort });
    await service.preview("sesion", "5000", "-40");
    await service.preview("sesion", undefined, undefined);

    assert.deepEqual(vistos[0], { limite: LIMITE_MAXIMO_DE_FILAS, desde: 0 });
    assert.equal(vistos[1]?.desde, 0);
  });

  it("una tabla inexistente y una vedada dan el mismo error", async () => {
    const service = new DataPreviewService({ repository: repositorioEnMemoria() });
    await assert.rejects(service.preview("tabla_que_no_existe"), /no está disponible/u);
    for (const vedada of TABLAS_VEDADAS) {
      await assert.rejects(service.preview(vedada), /no está disponible/u);
    }
  });
});

/**
 * El adaptador de PostgreSQL contra un ejecutor falso.
 *
 * No prueba el SQL —eso se verifica corriéndolo contra la base—, prueba la
 * traducción, que es donde vive la regla que importa: el motivo de
 * sobrescritura del lote no se enseña cuando esa liberación no sustituyó
 * ninguna fecha. El lote lo trae aunque no haya pisado nada, y filtrarlo
 * haría leer «sobrescribió con motivo X» donde no hubo sobrescritura.
 */
describe("consola interna · adaptador de PostgreSQL", () => {
  function ejecutorFalso(respuestas: (sql: string) => unknown[]): SqlExecutor {
    const ejecutor: SqlExecutor = {
      query: (sql: string) => Promise.resolve({ rows: respuestas(sql) as never[] }),
      transaction: (fn) => fn(ejecutor),
    };
    return ejecutor;
  }

  const liberacionBase = {
    liberacion_id: "l1",
    lote_id: "b1",
    solicitud_id: "req-0001",
    codigo_sesion: "KCM-260804-1",
    numero_trabajador: "10001",
    nombre_completo: "TRABAJADOR SINTETICO",
    curso: "5S",
    fecha_efectiva: "2026-08-04",
    resultado: "APPLIED",
    creada_en: "2026-08-04T10:00:00.000Z",
    estado_lote: "COMPLETADO",
    liberado_por: "OPERADOR",
    motivo_sobrescritura: "Motivo declarado en el lote",
    actor_sobrescritura: null,
    sobrescrito_en: null,
  };

  it("enseña la fecha sustituida con su motivo cuando sí hubo sobrescritura", async () => {
    const repositorio = new SupabaseInternalConsoleRepository(
      ejecutorFalso(() => [
        {
          ...liberacionBase,
          fecha_anterior: "2025-03-01",
          actor_sobrescritura: "MARICELA",
          sobrescrito_en: "2026-08-04T10:00:01.000Z",
        },
      ]),
    );

    const [fila] = await repositorio.listReleaseAudit(10);
    assert.equal(fila?.effectiveDate, "2026-08-04");
    assert.equal(fila?.previousDate, "2025-03-01");
    assert.equal(fila?.overwriteReason, "Motivo declarado en el lote");
    assert.equal(fila?.overwriteActor, "MARICELA");
  });

  it("no atribuye una sobrescritura a la liberación que no pisó ninguna fecha", async () => {
    const repositorio = new SupabaseInternalConsoleRepository(
      ejecutorFalso(() => [{ ...liberacionBase, fecha_anterior: null }]),
    );

    const [fila] = await repositorio.listReleaseAudit(10);
    assert.equal(fila?.previousDate, undefined);
    assert.equal(fila?.overwriteReason, undefined, "el motivo del lote no debe filtrarse");
  });

  it("enmascara la CURP y los marcadores de journal en el previsualizador", async () => {
    const repositorio = new SupabaseInternalConsoleRepository(
      ejecutorFalso((sql) => {
        if (sql.includes("pg_class"))
          return [{ esquema: "organizacion", tabla: "trabajador", comentario: "Padrón." }];
        if (sql.includes("information_schema"))
          return [
            { column_name: "numero_trabajador" },
            { column_name: "curp" },
            { column_name: "hash_fuente" },
          ];
        if (sql.includes("count(*)")) return [{ total: 1 }];
        return [
          {
            numero_trabajador: "10001",
            curp: "XXXX000000HDFAAA00",
            hash_fuente: "abc123",
          },
        ];
      }),
    );

    const vista = await repositorio.previewTable("trabajador", 50, 0);
    assert.deepEqual(vista?.maskedColumns, ["curp", "hash_fuente"]);
    assert.deepEqual(vista?.rows[0], ["10001", "••••••", "••••••"]);
  });

  it("la lectura del previsualizador declara la transacción de sólo lectura", async () => {
    const sentencias: string[] = [];
    const repositorio = new SupabaseInternalConsoleRepository(
      ejecutorFalso((sql) => {
        sentencias.push(sql);
        if (sql.includes("pg_class"))
          return [{ esquema: "operacion", tabla: "sesion", comentario: null }];
        if (sql.includes("information_schema")) return [{ column_name: "sesion_id" }];
        if (sql.includes("count(*)")) return [{ total: 0 }];
        return [];
      }),
    );

    await repositorio.previewTable("sesion", 10, 0);
    assert.ok(
      sentencias.some((sql) => sql.includes("SET TRANSACTION READ ONLY")),
      "la vista previa debe correr dentro de una transacción de sólo lectura",
    );
  });
});

describe("consola interna · rutas", () => {
  it("las tres secciones de auditoría responden HTML y se distinguen entre sí", async () => {
    const app = await buildServer({ config, clock });
    try {
      const rutas = [
        ["/auditoria/sesiones", "Sesiones creadas, abiertas y cerradas"],
        ["/auditoria/salas", "Reservaciones de sala agendadas"],
        ["/auditoria/liberaciones", "Liberaciones ejecutadas"],
      ] as const;

      for (const [ruta, titulo] of rutas) {
        const respuesta = await app.inject({
          method: "GET",
          url: ruta,
          headers: { accept: "text/html" },
        });
        assert.equal(respuesta.statusCode, 200, ruta);
        assert.match(respuesta.body, new RegExp(titulo, "u"), ruta);
      }
    } finally {
      await app.close();
    }
  });

  it("sin base lo dice en lugar de enseñar un listado vacío", async () => {
    const app = await buildServer({ config, clock });
    try {
      const respuesta = await app.inject({
        method: "GET",
        url: "/auditoria/sesiones",
        headers: { accept: "text/html" },
      });
      assert.match(respuesta.body, /Sin conexión con la base de datos/u);
    } finally {
      await app.close();
    }
  });

  it("declara un campo por formulario y lo enseña en la pantalla", async () => {
    const app = await buildServer({ config, clock });
    try {
      const alta = await app.inject({
        method: "POST",
        url: "/campos",
        headers: { accept: "text/html", "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({
          nombre: "turno_declarado",
          tipo: "TEXTO",
          origen: "DEPARTAMENTO",
          descripcion: "Turno capturado por el departamento.",
        }).toString(),
      });
      assert.equal(alta.statusCode, 303);

      const pantalla = await app.inject({
        method: "GET",
        url: "/campos",
        headers: { accept: "text/html" },
      });
      assert.match(pantalla.body, /turno_declarado/u);
      assert.match(pantalla.body, /Sin aprobar/u);
    } finally {
      await app.close();
    }
  });

  it("un nombre inválido vuelve a la pantalla con el motivo, no con un 500", async () => {
    const app = await buildServer({ config, clock });
    try {
      const respuesta = await app.inject({
        method: "POST",
        url: "/campos",
        headers: { accept: "text/html", "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({
          nombre: "Turno Con Espacios",
          tipo: "TEXTO",
          origen: "DEPARTAMENTO",
        }).toString(),
      });
      assert.equal(respuesta.statusCode, 303);
      assert.match(String(respuesta.headers.location), /error=/u);
    } finally {
      await app.close();
    }
  });

  it("exige sesión para escribir cuando la corrida declaró credenciales", async () => {
    const conCredenciales = loadConfig({
      KCM_ENV: "development",
      KCM_PILOT_CONSOLE_USER: "Maricela0000",
      KCM_PILOT_CONSOLE_PASSWORD: "0000",
    });
    const app = await buildServer({ config: conCredenciales, clock });
    try {
      const respuesta = await app.inject({
        method: "POST",
        url: "/campos",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: new URLSearchParams({
          nombre: "campo_sin_sesion",
          tipo: "TEXTO",
          origen: "PLATAFORMA",
        }).toString(),
      });
      // El guardia atiende antes que la ruta y manda a la puerta con el
      // destino puesto: es una pantalla, no una API, y un JSON de error en el
      // navegador no le sirve a nadie. Lo que se fija sigue siendo lo mismo:
      // sin sesión no se escribe.
      assert.equal(respuesta.statusCode, 303);
      assert.equal(respuesta.headers.location, "/acceso?destino=%2Fcampos");
    } finally {
      await app.close();
    }
  });

  it("el explorador no abre una tabla que no salió del catálogo", async () => {
    const app = await buildServer({ config, clock });
    try {
      const respuesta = await app.inject({
        method: "GET",
        url: "/base/pg_shadow",
        headers: { accept: "text/html" },
      });
      assert.equal(respuesta.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it("no expone ninguna ruta que escriba en la base desde el explorador", async () => {
    const app = await buildServer({ config, clock });
    try {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const respuesta = await app.inject({ method, url: "/base/sesion" });
        assert.equal(respuesta.statusCode, 404, `${method} /base/sesion debe no existir`);
      }
    } finally {
      await app.close();
    }
  });
});
