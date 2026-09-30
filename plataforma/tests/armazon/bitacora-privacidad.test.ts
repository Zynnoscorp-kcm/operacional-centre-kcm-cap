import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { afterEach, describe, it } from "node:test";

import { loadConfig } from "../../src/config/environment.ts";
import { scrubPersonalData, scrubUnknown } from "../../src/observability/logging.ts";
import { buildServer } from "../../src/server/build-server.ts";

const NUMERO_SINTETICO = "01234";
const CURP_SINTETICA = "XAXX010101HDFXXX01";
const CORREO_SINTETICO = "persona.inventada@ejemplo.test";

describe("saneamiento de texto", () => {
  it("enmascara un número de cinco dígitos", () => {
    assert.equal(scrubPersonalData(`alta de ${NUMERO_SINTETICO}`), "alta de #####");
  });

  it("enmascara una CURP y un correo", () => {
    assert.ok(!scrubPersonalData(CURP_SINTETICA).includes(CURP_SINTETICA));
    assert.ok(!scrubPersonalData(CORREO_SINTETICO).includes("persona.inventada"));
  });

  it("enmascara el número dentro de una ruta, que es por donde se fuga solo", () => {
    assert.equal(scrubPersonalData("/trabajador/01234/cursos"), "/trabajador/#####/cursos");
  });

  it("no toca corridas de dígitos que no son de cinco", () => {
    assert.equal(scrubPersonalData("puerto 8787 en 2026"), "puerto 8787 en 2026");
    assert.equal(scrubPersonalData("lote 1234567"), "lote 1234567");
    assert.equal(scrubPersonalData("duró 123456 ms"), "duró 123456 ms");
  });
});

describe("saneamiento de estructuras", () => {
  it("enmascara cadenas y deja intactos los números", () => {
    const saneado = scrubUnknown({ url: `/t/${NUMERO_SINTETICO}`, responseTime: 12345 }) as Record<
      string,
      unknown
    >;
    assert.equal(saneado["url"], "/t/#####");
    assert.equal(saneado["responseTime"], 12345);
  });

  it("recorre arreglos y objetos anidados", () => {
    const saneado = scrubUnknown({ lote: [{ curp: CURP_SINTETICA }] });
    assert.ok(!JSON.stringify(saneado).includes(CURP_SINTETICA));
  });

  it("corta a la profundidad máxima en vez de colgarse con un ciclo", () => {
    const ciclo: Record<string, unknown> = {};
    ciclo["propio"] = ciclo;
    assert.ok(JSON.stringify(scrubUnknown(ciclo)).includes("profundidad-excedida"));
  });

  it("no reconstruye un objeto con prototipo propio, que perdería sus getters", () => {
    class ConGetter {
      get url(): string {
        return "/t/01234";
      }
    }
    const original = new ConGetter();
    const saneado = scrubUnknown({ req: original }) as Record<string, unknown>;
    assert.equal(saneado["req"], original, "debió pasar la instancia intacta");
    assert.equal(saneado["req"].url, "/t/01234");
  });

  it("sí reconstruye el objeto plano que la envuelve", () => {
    const saneado = scrubUnknown({ nota: "de 01234" }) as Record<string, unknown>;
    assert.equal(saneado["nota"], "de #####");
  });
});

describe("bitácora del servidor", () => {
  const abiertos: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (abiertos.length > 0) {
      await abiertos.pop()?.close();
    }
  });

  async function servidorConBitacora(): Promise<{
    inject: (opciones: { method: "GET"; url: string }) => Promise<unknown>;
    lineas: () => string;
    log: (objeto: object, mensaje: string) => void;
  }> {
    const capturado: string[] = [];
    const destino = new Writable({
      write(fragmento: Buffer, _codificacion, listo): void {
        capturado.push(fragmento.toString("utf8"));
        listo();
      },
    });

    const app = await buildServer({
      config: loadConfig({ KCM_LOG_LEVEL: "trace" }),
      logDestination: destino,
    });
    abiertos.push(app);

    return {
      inject: (opciones) => app.inject(opciones),
      lineas: () => capturado.join(""),
      log: (objeto, mensaje) => {
        app.log.info(objeto, mensaje);
      },
    };
  }

  it("no publica el número de trabajador que venía en la ruta", async () => {
    const servidor = await servidorConBitacora();
    await servidor.inject({ method: "GET", url: `/trabajador/${NUMERO_SINTETICO}` });

    const salida = servidor.lineas();
    assert.ok(salida.length > 0, "la bitácora quedó vacía; la prueba no comprobaría nada");
    assert.ok(!salida.includes(NUMERO_SINTETICO), `el número apareció en la bitácora:\n${salida}`);
    assert.ok(salida.includes("#####"), "no se ve la máscara; el saneador no corrió");
  });

  it("no publica una CURP ni un correo que alguien haya puesto en el mensaje", async () => {
    const servidor = await servidorConBitacora();
    servidor.log({ nota: CORREO_SINTETICO }, `revisando ${CURP_SINTETICA}`);

    const salida = servidor.lineas();
    assert.ok(!salida.includes(CURP_SINTETICA), `la CURP apareció:\n${salida}`);
    assert.ok(!salida.includes("persona.inventada"), `el correo apareció:\n${salida}`);
  });

  it("no publica cabeceras de autorización", async () => {
    const servidor = await servidorConBitacora();
    servidor.log({ headers: { authorization: "Bearer secreto-de-prueba" } }, "petición");

    const salida = servidor.lineas();
    assert.ok(!salida.includes("secreto-de-prueba"), `la credencial apareció:\n${salida}`);
  });
});
