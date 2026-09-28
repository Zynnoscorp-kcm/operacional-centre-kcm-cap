/**
 * Los cinco ajustes pedidos para la corrida piloto: cancelar reserva desde
 * `/salas`, contraseña para agendar, contraseña del quiosco antes del número de
 * sesión, planta en `/trabajadores` y acceso con usuario y contraseña en
 * `/acceso`.
 *
 * La prueba que más importa no es ninguna de las cinco: es la que comprueba que
 * estas credenciales no pueden existir en producción.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryKioskSessionRepository } from "../../src/adapters/memoria/quiosco.ts";
import { ConfigError, loadConfig } from "../../src/config/environment.ts";
import { shortPlantName } from "../../src/domain/sistema-trabajador/planta.ts";
import { parseWorkerNumber } from "../../src/domain/comun/numero-trabajador.ts";
import type { InjectOptions } from "fastify";

import { buildServer } from "../../src/server/build-server.ts";

const FECHA_FIJA = new Date("2026-08-03T12:00:00.000Z");
const clock = { now: () => FECHA_FIJA, nowIso: () => FECHA_FIJA.toISOString() };

const ENTORNO_PILOTO = {
  KCM_ENV: "development",
  KCM_PILOT_CONSOLE_USER: "Maricela0000",
  KCM_PILOT_CONSOLE_PASSWORD: "0000",
  KCM_PILOT_ROOM_PASSWORD: "0000",
  KCM_PILOT_KIOSK_PIN: "0000",
} as const;

const COMO_NAVEGADOR = { accept: "text/html,application/xhtml+xml" };

function formulario(campos: Record<string, string>): {
  payload: string;
  headers: Record<string, string>;
} {
  return {
    payload: new URLSearchParams(campos).toString(),
    headers: { ...COMO_NAVEGADOR, "content-type": "application/x-www-form-urlencoded" },
  };
}

describe("Ajustes del piloto · configuración", () => {
  it("las credenciales de piloto no pueden existir en producción", () => {
    assert.throws(
      () =>
        loadConfig({
          KCM_ENV: "production",
          KCM_DATABASE_URL: "postgresql://x/y",
          KCM_PILOT_CONSOLE_USER: "Maricela0000",
          KCM_PILOT_CONSOLE_PASSWORD: "0000",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /KCM_PILOT_CONSOLE_PASSWORD/u);
        return true;
      },
    );
  });

  it("un usuario sin contraseña —o al revés— detiene el arranque", () => {
    assert.throws(
      () => loadConfig({ KCM_ENV: "development", KCM_PILOT_CONSOLE_USER: "Maricela0000" }),
      ConfigError,
    );
  });

  it("sin variables de piloto no queda ninguna credencial, y el acceso sigue cerrado", () => {
    assert.deepEqual(loadConfig({ KCM_ENV: "development" }).pilot, { openAccess: false });
  });

  it("el acceso abierto se declara y no se hereda de las demás credenciales", () => {
    const conPin = loadConfig({ KCM_ENV: "development", KCM_PILOT_KIOSK_PIN: "1234" });
    assert.equal(conPin.pilot.openAccess, false);

    const abierto = loadConfig({ KCM_ENV: "development", KCM_PILOT_OPEN_ACCESS: "1" });
    assert.equal(abierto.pilot.openAccess, true);
  });

  it("el acceso abierto no puede existir en producción", () => {
    assert.throws(
      () =>
        loadConfig({
          KCM_ENV: "production",
          KCM_DATABASE_URL: "postgresql://x/y",
          KCM_PILOT_OPEN_ACCESS: "1",
        }),
      ConfigError,
    );
  });
});

describe("Ajustes del piloto · planta", () => {
  it("traduce ECATEPEC I y II a 1 y 2", () => {
    assert.equal(shortPlantName("ECATEPEC I"), "1");
    assert.equal(shortPlantName("ECATEPEC II"), "2");
    assert.equal(shortPlantName("  planta ecatepec ii "), "2");
  });

  it("deja intacto lo que no es una de las dos plantas", () => {
    assert.equal(shortPlantName("MANTTO INGENIERIA"), "MANTTO INGENIERIA");
    assert.equal(shortPlantName(""), "");
    assert.equal(shortPlantName(null), "");
  });
});

describe("Ajustes del piloto · acceso, salas, quiosco y padrón", () => {
  /**
   * Servidor del piloto con la sesión ya abierta.
   *
   * El guardia cierra `/salas`, `/trabajadores` y las escrituras de agenda, así
   * que cada inyección viaja con la cookie que deja `/acceso`. Envolver
   * `inject` una vez evita repetir la cabecera en veinte llamadas y deja que
   * cada prueba hable de lo suyo —contraseña de agenda, nómina, planta— y no de
   * la puerta, que se prueba en `guardia.test.ts`. Un entorno sin credencial
   * declarada no autentica: la cookie queda vacía y la petición va sin sesión,
   * que es justo lo que esas pruebas quieren ver.
   */
  async function servidor(entorno: Record<string, string> = { ...ENTORNO_PILOTO }) {
    const app = await buildServer({
      config: loadConfig(entorno),
      clock,
      kioskSessionRepository: new MemoryKioskSessionRepository({
        activeWorkers: [parseWorkerNumber("12345")],
      }),
      kioskTokenSecret: "test-secret-long-enough-32-chars!!",
    });

    const sinSesion = app.inject.bind(app);
    const entrada = await sinSesion({
      method: "POST",
      url: "/acceso",
      ...formulario({ usuario: "Maricela0000", clave: "0000" }),
    });
    const cookie = String(entrada.headers["set-cookie"] ?? "").split(";")[0] ?? "";

    app.inject = ((opciones: InjectOptions) =>
      sinSesion({
        ...opciones,
        headers: { ...(opciones.headers ?? {}), cookie },
      })) as typeof app.inject;

    return app;
  }

  it("POST /acceso con la credencial del piloto deja sesión y redirige", async () => {
    const app = await servidor();
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      ...formulario({ usuario: "Maricela0000", clave: "0000", destino: "/trabajadores" }),
    });

    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, "/trabajadores");
    const cookie = String(res.headers["set-cookie"]);
    assert.match(cookie, /^kcm_sesion=/u);
    assert.match(cookie, /HttpOnly/u);
    assert.match(cookie, /SameSite=Lax/u);
    // Sin HTTPS no se marca `Secure`, o el navegador descartaría la cookie.
    assert.equal(cookie.includes("Secure"), false);
  });

  it("POST /acceso con la contraseña equivocada responde 401 sin decir qué falló", async () => {
    const app = await servidor();
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      ...formulario({ usuario: "Maricela0000", clave: "0001" }),
    });

    assert.equal(res.statusCode, 401);
    assert.equal(res.headers["set-cookie"], undefined);
    assert.match(res.body, /Usuario o contraseña incorrectos/u);
    assert.equal(res.body.includes("Maricela"), false, "la pantalla no repite el usuario");
  });

  it("un destino con origen no se acepta como retorno", async () => {
    const app = await servidor();
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      ...formulario({
        usuario: "Maricela0000",
        clave: "0000",
        destino: "//ejemplo.invalido/robo",
      }),
    });

    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.location, "/");
  });

  it("sin credenciales declaradas /acceso sigue diciendo que no hay directorio", async () => {
    const app = await servidor({ KCM_ENV: "development" });
    const res = await app.inject({
      method: "POST",
      url: "/acceso",
      ...formulario({ usuario: "quien", clave: "sea" }),
    });

    assert.equal(res.statusCode, 503);
    assert.match(res.body, /directorio de credenciales/u);
  });

  it("agendar una sala exige la contraseña de agenda", async () => {
    const app = await servidor();
    const datos = {
      roomId: "VOGUE",
      date: "2026-08-10",
      startTime: "09:00",
      endTime: "10:00",
      requesterName: "MARICELA",
      requesterWorkerNumber: "12345",
      reason: "Curso de inducción",
      estimatedAttendees: "12",
    };

    const sinClave = await app.inject({
      method: "POST",
      url: "/api/rooms/reservations",
      ...formulario({ ...datos, requestId: "req-sin-clave" }),
    });
    assert.equal(sinClave.statusCode, 303);
    assert.match(String(sinClave.headers.location), /error=/u);

    const conClave = await app.inject({
      method: "POST",
      url: "/api/rooms/reservations",
      ...formulario({ ...datos, requestId: "req-con-clave", clave: "0000" }),
    });
    assert.equal(conClave.statusCode, 303);
    assert.match(String(conClave.headers.location), /notice=/u);

    const agenda = await app.inject({ method: "GET", url: "/api/rooms/reservations" });
    const { reservations } = JSON.parse(agenda.body) as {
      reservations: readonly { status: string }[];
    };
    assert.equal(reservations.length, 1, "la reserva sin contraseña no se guardó");
  });

  /**
   * La base exige nómina o contacto (`reserva_solicitante_identificado`, 0021) y
   * el formulario había dejado de pedir ambos: toda reserva hecha desde la
   * pantalla moría con un 500 de la restricción. La persistencia en memoria no
   * tiene restricciones, así que la regla vive en el dominio o no se prueba.
   */
  it("agendar sin nómina se rechaza como error de captura, no como falla del servidor", async () => {
    const app = await servidor();
    const datos = {
      requestId: "req-sin-nomina",
      roomId: "VOGUE",
      date: "2026-08-10",
      startTime: "09:00",
      endTime: "10:00",
      requesterName: "MARICELA",
      reason: "Curso de inducción",
      estimatedAttendees: "12",
      clave: "0000",
    };

    const enJson = await app.inject({
      method: "POST",
      url: "/api/rooms/reservations",
      payload: datos,
    });
    assert.equal(enJson.statusCode, 400);
    assert.match(enJson.body, /nómina/u);

    // Desde la pantalla vuelve al formulario con el motivo, no a un JSON crudo.
    const enPantalla = await app.inject({
      method: "POST",
      url: "/api/rooms/reservations",
      ...formulario(datos),
    });
    assert.equal(enPantalla.statusCode, 303);
    assert.match(String(enPantalla.headers.location), /error=/u);

    const agenda = await app.inject({ method: "GET", url: "/api/rooms/reservations" });
    const { reservations } = JSON.parse(agenda.body) as { reservations: readonly unknown[] };
    assert.equal(reservations.length, 0, "no se guardó nada sin quien la solicita");
  });

  it("una nómina que no es de cinco dígitos se rechaza", async () => {
    const app = await servidor();
    const res = await app.inject({
      method: "POST",
      url: "/api/rooms/reservations",
      payload: {
        requestId: "req-nomina-corta",
        roomId: "VOGUE",
        date: "2026-08-10",
        startTime: "09:00",
        endTime: "10:00",
        requesterName: "MARICELA",
        requesterWorkerNumber: "123",
        reason: "Curso de inducción",
        estimatedAttendees: 12,
        clave: "0000",
      },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /cinco dígitos/u);
  });

  it("el formulario de salas pide la nómina de quien reserva", async () => {
    const app = await servidor();
    const res = await app.inject({ method: "GET", url: "/salas" });

    assert.match(res.body, /name="requesterWorkerNumber"/u);
    // El patrón se escribe con clase explícita: `\d` no sobrevive a la
    // plantilla etiquetada y dejaría un patrón que rechaza toda nómina.
    assert.match(res.body, /pattern="\[0-9\]\{5\}"/u);
  });

  it("la pantalla de salas ofrece cancelar y la cancelación pide la misma contraseña", async () => {
    const app = await servidor();
    const creada = await app.inject({
      method: "POST",
      url: "/api/rooms/reservations",
      payload: {
        requestId: "req-cancelable",
        roomId: "KLEENEX",
        date: "2026-08-11",
        startTime: "11:00",
        endTime: "12:00",
        requesterName: "MARICELA",
        requesterWorkerNumber: "12345",
        reason: "Sesión de prueba",
        estimatedAttendees: 5,
        clave: "0000",
      },
    });
    assert.equal(creada.statusCode, 201);
    const { reservation } = JSON.parse(creada.body) as { reservation: { reservationId: string } };

    const pantalla = await app.inject({ method: "GET", url: "/salas?date=2026-08-11" });
    assert.match(pantalla.body, /Cancelar reservación/u);
    assert.match(pantalla.body, /Contraseña de agenda/u);

    const sinClave = await app.inject({
      method: "POST",
      url: `/api/rooms/reservations/${reservation.reservationId}/cancel`,
      ...formulario({ reason: "Se suspendió el curso", date: "2026-08-11" }),
    });
    assert.equal(sinClave.statusCode, 303);
    assert.match(String(sinClave.headers.location), /error=/u);

    const conClave = await app.inject({
      method: "POST",
      url: `/api/rooms/reservations/${reservation.reservationId}/cancel`,
      ...formulario({ reason: "Se suspendió el curso", date: "2026-08-11", clave: "0000" }),
    });
    assert.equal(conClave.statusCode, 303);

    const agenda = await app.inject({ method: "GET", url: "/api/rooms/reservations" });
    const { reservations } = JSON.parse(agenda.body) as {
      reservations: readonly { status: string; cancellationReason?: string }[];
    };
    assert.equal(reservations[0]?.status, "CANCELADA");
    assert.equal(reservations[0]?.cancellationReason, "Se suspendió el curso");
  });

  it("el quiosco no emite el vínculo de una sesión sin la contraseña", async () => {
    const app = await servidor();

    const sinConcesion = await app.inject({
      method: "POST",
      url: "/api/kiosk/token",
      payload: { sessionCode: "KCM-260803-ABC123" },
    });
    assert.equal(sinConcesion.statusCode, 400);
    assert.equal(
      sinConcesion.body.includes("KCM-260803"),
      false,
      "el rechazo no confirma que el código exista",
    );

    const desbloqueo = await app.inject({
      method: "POST",
      url: "/api/kiosk/unlock",
      payload: { pin: "0000", stationLabel: "SALA-PILOTO" },
    });
    assert.equal(desbloqueo.statusCode, 200);
    const { grant } = JSON.parse(desbloqueo.body) as { grant: string };
    assert.ok(grant);

    // Con la concesión ya se consulta la sesión: el código sintético no existe,
    // y lo que se comprueba es que el rechazo ya no es por falta de contraseña.
    const conConcesion = await app.inject({
      method: "POST",
      url: "/api/kiosk/token",
      payload: { grant, sessionCode: "KCM-260803-ABC123" },
    });
    assert.notEqual(conConcesion.statusCode, 200);
    assert.equal(conConcesion.body.includes("QUIOSCO_NO_AUTORIZADO"), false);
  });

  it("GET /trabajadores muestra la planta traducida a 1 o 2", async () => {
    const app = await servidor();
    const res = await app.inject({ method: "GET", url: "/trabajadores" });

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<th scope="col">Planta<\/th>/u);
    // El nombre largo se conserva como título del dato; el visible es el corto.
    assert.match(res.body, /title="ECATEPEC I"/u);
    assert.match(res.body, /MANTTO INGENIERIA/u);
  });

  it("la ficha lleva nombre, puesto, área y planta en el encabezado", async () => {
    const app = await servidor();
    const res = await app.inject({ method: "GET", url: "/trabajadores/01234" });

    assert.equal(res.statusCode, 200);
    assert.match(res.body, /JUAN PÉREZ GARCÍA/u);
    assert.match(res.body, /TECNICO INSTRUMENTISTA/u);
    assert.match(res.body, /GERENCIA DE MANTTO\. ELECTRICO/u);
    assert.match(res.body, /Planta 1/u);
  });
});
