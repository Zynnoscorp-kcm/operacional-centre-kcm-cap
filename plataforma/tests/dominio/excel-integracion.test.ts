import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryExcelRepository } from "../../src/adapters/memoria/excel.ts";
import { MemoryMatrixRepository } from "../../src/adapters/memoria/matriz.ts";
import { ExcelIntegrationService } from "../../src/domain/excel/integracion.ts";
import type { BridgeAction } from "../../src/domain/excel/tipos.ts";
import type { Clock } from "../../src/ports/reloj.ts";

const instant = "2026-08-03T12:00:00.000Z";
const clock: Clock = { now: () => new Date(instant), nowIso: () => instant };
const pending = {
  idempotencyKey: "session|10001|qms|v1",
  batchId: "batch-1",
  sessionId: "session-1",
  employeeId: "10001",
  trainingId: "qms",
  completionDate: "2026-08-01",
  destinationSheet: "HC",
  destinationColumn: "H",
  headerRow: 3,
  destinationHeader: "QMS",
  targetMappingVersion: "v1",
  overwritePolicy: "NO_OVERWRITE",
} as const;

function service() {
  const repository = new MemoryExcelRepository({
    clock,
    pendingReleases: [pending],
    workers: [
      {
        employeeId: "10001",
        department: "DEPARTAMENTO SINTETICO",
        area: "AREA SINTETICA",
        position: "PUESTO SINTETICO",
        active: true,
      },
    ],
  });
  return {
    repository,
    service: new ExcelIntegrationService({
      repository,
      matrixRepository: new MemoryMatrixRepository(),
      clock,
    }),
  };
}

async function bridgeCall(
  target: ExcelIntegrationService,
  secret: string,
  action: BridgeAction,
  payload = "",
  nonce = "nonce-1",
  requestId = "request-1",
) {
  return target.handleBridge({
    action,
    clientId: "client-1",
    requestId,
    sentAt: instant,
    nonce,
    credential: secret,
    payload: Buffer.from(payload).toString("base64url"),
  });
}

describe("E11/E14 · credenciales, puente VBA y Power Query", () => {
  it("emite una credencial por equipo, guarda sólo hash y falla cerrado al expirar o usar otro recurso", async () => {
    const { repository, service: target } = service();
    const issued = await target.issueCredential({
      clientId: "client-1",
      principal: "usuario.sintetico",
      windowsProfile: "perfil-sintetico",
      equipment: "equipo-sintetico",
      scope: "POWER_QUERY_LECTURA",
      resource: "workers.csv",
      expiresAt: "2026-08-04T12:00:00.000Z",
    });
    const stored = (await repository.findCredentials("client-1", "POWER_QUERY_LECTURA"))[0];
    assert.notEqual(stored?.credentialHash, issued.secret);
    assert.equal(stored?.principal, "usuario.sintetico");
    const csv = await target.workersCsv("client-1", "workers.csv", issued.secret);
    assert.match(csv, /^"employeeId"/u);
    assert.match(csv, /"10001"/u);
    await assert.rejects(
      target.workersCsv("client-1", "otro.csv", issued.secret),
      /no está autorizada/u,
    );
  });

  it("acepta una credencial permanente, pero conserva revocación y aislamiento por recurso", async () => {
    const { service: target } = service();
    const issued = await target.issueCredential({
      clientId: "client-permanente",
      principal: "usuario",
      windowsProfile: "perfil",
      equipment: "equipo",
      scope: "PUENTE_VBA",
      resource: "bridge",
      expiresAt: null,
    });
    const result = await target.authenticate(
      "client-permanente",
      "PUENTE_VBA",
      "bridge",
      issued.secret,
    );
    assert.equal(result.expiresAt, null);
    await target.revokeCredential("client-permanente", "PUENTE_VBA", "BAJA DE EQUIPO");
    await assert.rejects(
      target.authenticate("client-permanente", "PUENTE_VBA", "bridge", issued.secret),
      /no está autorizada/u,
    );
  });

  it("implementa STATUS_V1 y rechaza el replay del nonce", async () => {
    const { service: target } = service();
    const issued = await target.issueCredential({
      clientId: "client-1",
      principal: "usuario",
      windowsProfile: "perfil",
      equipment: "equipo",
      scope: "PUENTE_VBA",
      resource: "bridge",
      expiresAt: "2026-08-04T12:00:00.000Z",
    });
    const ok = await bridgeCall(target, issued.secret, "STATUS_V1");
    assert.match(ok, /^KCM_VBA_BRIDGE_V1\nOK/mu);
    assert.match(ok, /payload=/u);
    // `status` ya es la segunda línea del protocolo. Un campo homónimo llega al
    // cliente como clave repetida y aborta con "Respuesta VBA duplicada".
    assert.doesNotMatch(ok, /^status=/mu);
    const replay = await bridgeCall(target, issued.secret, "STATUS_V1");
    assert.match(replay, /^KCM_VBA_BRIDGE_V1\nERROR/mu);
    assert.match(replay, /UNAUTHORIZED_EXCEL/u);
  });

  it("entrega RELEASE_PULL_V1 y registra RELEASE_ACK_V1 idempotente", async () => {
    const { repository, service: target } = service();
    const issued = await target.issueCredential({
      clientId: "client-1",
      principal: "usuario",
      windowsProfile: "perfil",
      equipment: "equipo",
      scope: "PUENTE_VBA",
      resource: "bridge",
      expiresAt: "2026-08-04T12:00:00.000Z",
    });
    const pull = await bridgeCall(
      target,
      issued.secret,
      "RELEASE_PULL_V1",
      "",
      "nonce-pull",
      "request-pull",
    );
    assert.match(pull, /count=1/u);
    const headers = [
      "idempotencyKey",
      "batchId",
      "targetMappingVersion",
      "completionDate",
      "status",
      "workbookSha256",
      "destinationAddress",
      "detail",
    ];
    const values = [
      pending.idempotencyKey,
      pending.batchId,
      pending.targetMappingVersion,
      pending.completionDate,
      "APPLIED",
      "a".repeat(64),
      "HC!H5",
      "",
    ];
    const payload = [headers, values]
      .map((row) => row.map(encodeURIComponent).join("\t"))
      .join("\n");
    const ack = await bridgeCall(
      target,
      issued.secret,
      "RELEASE_ACK_V1",
      payload,
      "nonce-ack",
      "request-ack",
    );
    assert.match(ack, /inserted=1/u);
    assert.equal((await repository.listReleaseAcks()).length, 1);
    assert.equal((await repository.listPendingReleases()).length, 0);
    const replay = await bridgeCall(
      target,
      issued.secret,
      "RELEASE_ACK_V1",
      payload,
      "nonce-ack-2",
      "request-ack",
    );
    assert.match(replay, /repeated=1/u);
    assert.equal((await repository.listReleaseAcks()).length, 1);
  });

  it("revoca la credencial y el siguiente uso falla cerrado", async () => {
    const { service: target } = service();
    const issued = await target.issueCredential({
      clientId: "client-1",
      principal: "usuario",
      windowsProfile: "perfil",
      equipment: "equipo",
      scope: "PUENTE_VBA",
      resource: "bridge",
      expiresAt: "2026-08-04T12:00:00.000Z",
    });
    await target.revokeCredential("client-1", "PUENTE_VBA", "ROTACION PROGRAMADA");
    const result = await bridgeCall(target, issued.secret, "STATUS_V1");
    assert.match(result, /UNAUTHORIZED_EXCEL/u);
  });
});
