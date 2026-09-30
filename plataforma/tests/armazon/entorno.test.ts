import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConfigError, loadConfig, requireSecret } from "../../src/config/environment.ts";

const BD = "postgresql://u:p@localhost:5432/postgres";

describe("configuración por entorno", () => {
  it("arranca en desarrollo sobre loopback cuando no hay variables", () => {
    const config = loadConfig({});
    assert.equal(config.environment, "development");
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 8787);
    assert.equal(config.logLevel, "debug");
  });

  it("baja el nivel de bitácora por omisión en producción", () => {
    assert.equal(loadConfig({ KCM_ENV: "production", KCM_DATABASE_URL: BD }).logLevel, "info");
  });

  it("acepta los valores declarados sin importar mayúsculas ni espacios", () => {
    const config = loadConfig({
      KCM_ENV: " Production ",
      KCM_LOG_LEVEL: "WARN",
      KCM_PORT: "9000",
      KCM_DATABASE_URL: BD,
    });
    assert.equal(config.environment, "production");
    assert.equal(config.logLevel, "warn");
    assert.equal(config.port, 9000);
  });

  it("rechaza un entorno que no existe en vez de caer a desarrollo", () => {
    assert.throws(() => loadConfig({ KCM_ENV: "prod" }), ConfigError);
    assert.throws(() => loadConfig({ KCM_ENV: "qa" }), ConfigError);
  });

  it("rechaza un puerto que no es entero, es privilegiado o se sale del rango", () => {
    for (const puerto of ["ocho", "80", "0", "-1", "70000", "8080.5"]) {
      assert.throws(() => loadConfig({ KCM_PORT: puerto }), ConfigError, `aceptó ${puerto}`);
    }
  });

  it("rechaza notaciones que Number() aceptaría en silencio", () => {
    for (const puerto of ["1e4", "0x2000", "+8080", "Infinity", "8_080"]) {
      assert.throws(() => loadConfig({ KCM_PORT: puerto }), ConfigError, `aceptó ${puerto}`);
    }
  });

  it("rechaza un nivel de bitácora desconocido", () => {
    assert.throws(() => loadConfig({ KCM_LOG_LEVEL: "verbose" }), ConfigError);
  });

  it("rechaza un host vacío", () => {
    assert.throws(() => loadConfig({ KCM_HOST: "   " }), ConfigError);
  });

  it("en producción no deja escuchar fuera de loopback", () => {
    assert.throws(
      () => loadConfig({ KCM_ENV: "production", KCM_HOST: "0.0.0.0", KCM_DATABASE_URL: BD }),
      (error: unknown) => error instanceof ConfigError && /túnel/u.test(error.message),
    );
  });

  it("permite escuchar fuera de loopback sólo si se declara explícitamente", () => {
    const config = loadConfig({
      KCM_ENV: "production",
      KCM_HOST: "0.0.0.0",
      KCM_ALLOW_PUBLIC_BIND: "1",
      KCM_DATABASE_URL: BD,
    });
    assert.equal(config.host, "0.0.0.0");
  });

  it("fuera de producción no impone loopback, que es lo que permite probar en red local", () => {
    assert.equal(loadConfig({ KCM_ENV: "development", KCM_HOST: "0.0.0.0" }).host, "0.0.0.0");
  });

  it("rechaza una bandera que no sea booleana reconocible", () => {
    assert.throws(() => loadConfig({ KCM_ALLOW_PUBLIC_BIND: "sí" }), ConfigError);
  });

  it("rechaza un tiempo de espera que no sea entero positivo", () => {
    for (const valor of ["0", "-5", "mucho"]) {
      assert.throws(() => loadConfig({ KCM_REQUEST_TIMEOUT_MS: valor }), ConfigError);
    }
  });

  it("no confía en ningún proxy mientras nadie lo declare", () => {
    assert.equal(loadConfig({}).trustedProxyHops, 0);
    assert.equal(loadConfig({ KCM_TRUST_PROXY: "  " }).trustedProxyHops, 0);
  });

  it("acepta la cuenta de saltos declarada, incluido el cero explícito", () => {
    assert.equal(loadConfig({ KCM_TRUST_PROXY: "1" }).trustedProxyHops, 1);
    assert.equal(loadConfig({ KCM_TRUST_PROXY: " 2 " }).trustedProxyHops, 2);
    assert.equal(loadConfig({ KCM_TRUST_PROXY: "0" }).trustedProxyHops, 0);
  });

  it("rechaza una cuenta de saltos que no es entero o se sale del rango", () => {
    for (const valor of ["true", "sí", "-1", "11", "1.5", "1e1"]) {
      assert.throws(() => loadConfig({ KCM_TRUST_PROXY: valor }), ConfigError, `aceptó ${valor}`);
    }
  });
});

describe("secretos", () => {
  it("falla cerrado cuando el secreto no está en el entorno", () => {
    assert.throws(() => requireSecret("KCM_LO_QUE_SEA", {}), ConfigError);
    assert.throws(() => requireSecret("KCM_LO_QUE_SEA", { KCM_LO_QUE_SEA: "  " }), ConfigError);
  });

  it("devuelve el valor tal cual, sin recortar, cuando existe", () => {
    assert.equal(requireSecret("KCM_LO_QUE_SEA", { KCM_LO_QUE_SEA: " abc " }), " abc ");
  });

  it("el mensaje de falta no reproduce ningún valor", () => {
    try {
      requireSecret("KCM_LO_QUE_SEA", {});
      assert.fail("se esperaba ConfigError");
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /nunca del árbol de trabajo/u);
    }
  });
});
