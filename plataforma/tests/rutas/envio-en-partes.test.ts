import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";

import { MemoryExcelRepository } from "../../src/adapters/memoria/excel.ts";
import { MemoryMatrixRepository } from "../../src/adapters/memoria/matriz.ts";
import { loadConfig } from "../../src/config/environment.ts";
import { ExcelIntegrationService } from "../../src/domain/excel/integracion.ts";
import type { BridgeRequest } from "../../src/domain/excel/tipos.ts";
import type { Clock } from "../../src/ports/reloj.port.ts";
import { buildServer } from "../../src/server/build-server.ts";

class RelojFalso implements Clock {
  #ahora: Date;
  constructor(inicio = "2026-09-25T12:00:00.000Z") {
    this.#ahora = new Date(inicio);
  }
  now(): Date {
    return new Date(this.#ahora);
  }
  nowIso(): string {
    return this.#ahora.toISOString();
  }
  avanzarMinutos(minutos: number): void {
    this.#ahora = new Date(this.#ahora.getTime() + minutos * 60_000);
  }
}

const CABECERAS = [
  "dc3Key",
  "employeeId",
  "courseId",
  "completionDate",
  "status",
  "fileSha256",
  "generatedAt",
  "errorCode",
];

function reporte(renglones: number, prefijo = "DC3-SINTETICO-"): string {
  const filas = Array.from({ length: renglones }, (_, i) =>
    [
      `${prefijo}${String(i).padStart(4, "0")}`,
      String(10000 + i),
      "curso-sintetico",
      "2026-09-01",
      "GENERADO",
      "a".repeat(64),
      "2026-09-25T11:00:00.000Z",
      "",
    ].join("\t"),
  );
  const tsv = [CABECERAS.join("\t"), ...filas].join("\n");
  return Buffer.from(tsv, "utf8").toString("base64url");
}

function partir(texto: string, partes: number): string[] {
  const tamano = Math.ceil(texto.length / partes);
  return Array.from({ length: partes }, (_, i) => texto.slice(i * tamano, (i + 1) * tamano));
}

function campos(respuesta: string): Record<string, string> {
  const [, estado, ...pares] = respuesta.split("\n");
  const salida: Record<string, string> = { estado: estado ?? "" };
  for (const par of pares) {
    const corte = par.indexOf("=");
    salida[par.slice(0, corte)] = decodeURIComponent(par.slice(corte + 1));
  }
  return salida;
}

async function puente(clientes: readonly string[] = ["KCM-OFFICE-01"]) {
  const reloj = new RelojFalso();
  const repository = new MemoryExcelRepository({ clock: reloj });
  const service = new ExcelIntegrationService({
    repository,
    matrixRepository: new MemoryMatrixRepository(),
    clock: reloj,
  });
  const secretos = new Map<string, string>();
  for (const clientId of clientes) {
    const emitida = await service.issueCredential({
      clientId,
      principal: "usuario.sintetico",
      windowsProfile: "perfil-sintetico",
      equipment: "equipo-sintetico",
      scope: "PUENTE_VBA",
      resource: "bridge",
      expiresAt: null,
    });
    secretos.set(clientId, emitida.secret);
  }
  let nonce = 0;
  function llamar(peticion: Partial<BridgeRequest> & Pick<BridgeRequest, "action" | "payload">) {
    nonce += 1;
    const clientId = peticion.clientId ?? clientes[0] ?? "";
    return service.handleBridge({
      clientId,
      requestId: "vba-dc3-sintetico",
      sentAt: reloj.nowIso(),
      nonce: `nonce-${String(nonce)}`,
      credential: secretos.get(clientId) ?? "",
      ...peticion,
    });
  }
  function parte(
    completo: string,
    trozos: readonly string[],
    indice: number,
    extra: Partial<BridgeRequest> = {},
  ) {
    return llamar({
      action: "UPLOAD_PART_V1",
      target: "DC3_REPORT_V1",
      part: String(indice),
      parts: String(trozos.length),
      length: String(completo.length),
      payload: trozos[indice - 1] ?? "",
      ...extra,
    });
  }
  return { reloj, repository, llamar, parte };
}

describe("Envío en partes · UPLOAD_PART_V1", () => {
  it("un envío partido en tres llega igual que entero", async () => {
    const completo = reporte(40);
    const trozos = partir(completo, 3);

    const enPartes = await puente();
    const primera = campos(await enPartes.parte(completo, trozos, 1));
    const segunda = campos(await enPartes.parte(completo, trozos, 2));
    const ultima = campos(await enPartes.parte(completo, trozos, 3));

    assert.equal(primera.estado, "OK");
    assert.equal(primera.uploadComplete, "false");
    assert.equal(primera.uploadPart, "1");
    assert.equal(segunda.uploadComplete, "false");
    assert.equal(ultima.estado, "OK");
    assert.equal(ultima.uploadComplete, "true");
    assert.equal(ultima.uploadParts, "3");
    assert.equal((await enPartes.repository.listDc3Events()).length, 40);

    const entero = await puente();
    const deUnaVez = campos(await entero.llamar({ action: "DC3_REPORT_V1", payload: completo }));
    for (const [clave, valor] of Object.entries(deUnaVez)) {
      assert.equal(ultima[clave], valor, `el campo ${clave} difiere del envío entero`);
    }
  });

  it("repetir la última parte no duplica nada", async () => {
    const completo = reporte(12);
    const trozos = partir(completo, 2);
    const { parte, repository } = await puente();

    await parte(completo, trozos, 1);
    await parte(completo, trozos, 2);
    const repetida = campos(await parte(completo, trozos, 2));

    assert.equal(repetida.estado, "OK");
    assert.equal(repetida.uploadComplete, "true");
    assert.equal((await repository.listDc3Events()).length, 12);
  });

  it("reenviar con la misma llave empieza de cero: no mezcla partes ni se procesa antes", async () => {
    const primero = reporte(12);
    const segundo = reporte(12, "DC3-SINTETICA-");
    assert.equal(segundo.length, primero.length);
    const { parte, reloj, repository } = await puente();

    await parte(primero, partir(primero, 2), 1);
    assert.equal(campos(await parte(primero, partir(primero, 2), 2)).uploadComplete, "true");
    reloj.avanzarMinutos(20);

    assert.equal(campos(await parte(segundo, partir(segundo, 2), 1)).uploadComplete, "false");
    assert.equal(campos(await parte(segundo, partir(segundo, 2), 2)).uploadComplete, "true");
    const claves = (await repository.listDc3Events()).map((evento) => evento.dc3Key);
    assert.equal(claves.length, 24);
    assert.equal(claves.filter((clave) => clave.startsWith("DC3-SINTETICA-")).length, 12);
  });

  it("mientras faltan partes no se lee su contenido", async () => {
    const completo = reporte(40);
    const trozos = partir(completo, 4);
    const { parte, repository } = await puente();
    let lecturasConContenido = 0;
    const original = repository.listUploadParts.bind(repository);
    repository.listUploadParts = (envio, ahora) => {
      lecturasConContenido += 1;
      return original(envio, ahora);
    };

    for (const indice of [1, 2, 3, 4]) await parte(completo, trozos, indice);

    assert.equal(lecturasConContenido, 1);
    assert.equal((await repository.listDc3Events()).length, 40);
  });

  it("sin todas las partes no se procesa nada", async () => {
    const completo = reporte(20);
    const trozos = partir(completo, 3);
    const { parte, repository } = await puente();

    assert.equal(campos(await parte(completo, trozos, 1)).uploadComplete, "false");
    assert.equal(campos(await parte(completo, trozos, 3)).uploadComplete, "false");
    assert.equal((await repository.listDc3Events()).length, 0);
  });

  it("las partes de un equipo no completan el envío de otro", async () => {
    const completo = reporte(20);
    const trozos = partir(completo, 3);
    const { parte, repository } = await puente(["KCM-OFFICE-01", "KCM-OFFICE-02"]);

    await parte(completo, trozos, 1, { clientId: "KCM-OFFICE-01" });
    await parte(completo, trozos, 2, { clientId: "KCM-OFFICE-01" });
    const ajena = campos(await parte(completo, trozos, 3, { clientId: "KCM-OFFICE-02" }));

    assert.equal(ajena.uploadComplete, "false");
    assert.equal((await repository.listDc3Events()).length, 0);
  });

  it("una parte que no cuadra se rechaza sin reintento", async () => {
    const completo = reporte(10);
    const trozos = partir(completo, 2);
    const { parte } = await puente();

    const casos: readonly [string, Partial<BridgeRequest>][] = [
      ["una acción que no sube datos", { target: "STATUS_V1" }],
      ["una acción que no existe", { target: "BORRAR_TODO_V1" }],
      ["un número de parte fuera de rango", { part: "3" }],
      ["un envío de una sola parte", { parts: "1" }],
      ["demasiadas partes", { parts: "65" }],
      ["un largo que no es número", { length: "mucho" }],
      ["caracteres fuera de base64 web-safe", { payload: "no+es/base64=" }],
      ["una parte más larga que el envío", { length: "5" }],
    ];
    for (const [que, cambio] of casos) {
      const respuesta = campos(await parte(completo, trozos, 1, cambio));
      assert.equal(respuesta.estado, "ERROR", que);
      assert.equal(respuesta.code, "INVALID_EXCEL_REQUEST", que);
      assert.equal(respuesta.retryable, "false", que);
    }
  });

  it("si las partes no suman el largo anunciado, no se procesa", async () => {
    const completo = reporte(10);
    const trozos = partir(completo, 2);
    const { parte, repository } = await puente();
    const anunciado = String(completo.length + 7);

    await parte(completo, trozos, 1, { length: anunciado });
    const ultima = campos(await parte(completo, trozos, 2, { length: anunciado }));

    assert.equal(ultima.estado, "ERROR");
    assert.equal(ultima.code, "INVALID_EXCEL_REQUEST");
    assert.equal((await repository.listDc3Events()).length, 0);
  });

  it("las partes de un envío interrumpido vencen en una hora", async () => {
    const completo = reporte(10);
    const trozos = partir(completo, 2);
    const { parte, reloj, repository } = await puente();

    await parte(completo, trozos, 1);
    reloj.avanzarMinutos(61);
    const tardia = campos(await parte(completo, trozos, 2));

    assert.equal(tardia.uploadComplete, "false");
    assert.equal((await repository.listDc3Events()).length, 0);
  });
});

describe("Envío en partes · por la ruta del puente en la nube", () => {
  const abiertos: FastifyInstance[] = [];
  afterEach(async () => {
    while (abiertos.length) await abiertos.pop()?.close();
  });

  it("la ruta entrega los campos de la parte y la nube junta el envío", async () => {
    const ahora = new Date().toISOString();
    const app = await buildServer({
      config: loadConfig({
        KCM_ENV: "development",
        KCM_ROLE: "nube",
        KCM_PILOT_OPEN_ACCESS: "true",
        KCM_ROOM_PASSWORD: "clave-sintetica-de-agenda",
      }),
    });
    abiertos.push(app);

    const emitida = await app.inject({
      method: "POST",
      url: "/api/excel/credentials",
      payload: {
        clientId: "KCM-OFFICE-09",
        principal: "usuario.sintetico",
        windowsProfile: "perfil-sintetico",
        equipment: "equipo-sintetico",
        scope: "PUENTE_VBA",
        resource: "bridge",
        permanent: "true",
      },
    });
    assert.equal(emitida.statusCode, 201);
    const secreto = (JSON.parse(emitida.body) as { credential: string }).credential;

    const completo = reporte(30);
    const trozos = partir(completo, 2);
    const respuestas: Record<string, string>[] = [];
    for (const [i, trozo] of trozos.entries()) {
      const respuesta = await app.inject({
        method: "POST",
        url: "/api/v1/vba-bridge",
        payload: {
          protocol: "KCM_VBA_BRIDGE_V1",
          action: "UPLOAD_PART_V1",
          clientId: "KCM-OFFICE-09",
          requestId: "vba-dc3-ruta",
          sentAt: ahora,
          nonce: `nonce-ruta-${String(i)}`,
          token: secreto,
          target: "DC3_REPORT_V1",
          part: String(i + 1),
          parts: String(trozos.length),
          length: String(completo.length),
          payload: trozo,
        },
      });
      assert.equal(respuesta.statusCode, 200);
      respuestas.push(campos(respuesta.body));
    }

    assert.equal(respuestas[0]?.uploadComplete, "false");
    assert.equal(respuestas[1]?.estado, "OK");
    assert.equal(respuestas[1]?.uploadComplete, "true");
    assert.equal(respuestas[1]?.uploadParts, "2");
  });
});
