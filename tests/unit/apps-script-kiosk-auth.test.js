import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("src/apps-script/server/02_Auth.gs"), "utf8");

function signedBytes(buffer) {
  return [...buffer].map((byte) => byte > 127 ? byte - 256 : byte);
}

function createHarness(secret, mockMode = false) {
  const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
  const base64url = (value) => Buffer.from(value).toString("base64url");
  const context = vm.createContext({
    Array, Boolean, Date, Error, JSON, Math, Number, Object, RegExp, String,
    KcmValidation: { fail },
    KcmConfig: {
      property: (name, fallback) => name === "KCM_KIOSK_TOKEN_SECRET" ? secret : fallback,
      isMockMode: () => mockMode,
      kioskTokenMinutes: () => 120
    },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      getUuid: () => "nonce-synthetic-1",
      base64EncodeWebSafe(value) {
        const bytes = typeof value === "string"
          ? Buffer.from(value, "utf8")
          : Buffer.from([...value].map((byte) => byte < 0 ? byte + 256 : byte));
        return base64url(bytes);
      },
      base64DecodeWebSafe(value) { return signedBytes(Buffer.from(String(value), "base64url")); },
      computeHmacSha256Signature(value, key) {
        return signedBytes(crypto.createHmac("sha256", String(key)).update(String(value)).digest());
      },
      newBlob(bytes) {
        const unsigned = [...bytes].map((byte) => byte < 0 ? byte + 256 : byte);
        return { getDataAsString: () => Buffer.from(unsigned).toString("utf8") };
      }
    }
  });
  new vm.Script(source, { filename: "02_Auth.gs" }).runInContext(context);
  return context.KcmAuth;
}

const tokenInput = Object.freeze({
  sessionId: "session-kiosk-1",
  issuedBy: "trainer@example.invalid",
  expiresInMinutes: 30,
  stationLabel: "Sala sintética · Equipo 01"
});

test("producción exige un secreto base64url canónico de al menos 32 bytes y diversidad suficiente", () => {
  const encodedPlaceholders = ["changeme".repeat(4), "password-example-replace-secret-1234"]
    .map((value) => Buffer.from(value).toString("base64url"));
  for (const invalid of ["", "short-secret", "x".repeat(42), `${"x".repeat(43)}!`, "x".repeat(129), "A".repeat(43), ...encodedPlaceholders]) {
    const auth = createHarness(invalid, false);
    assert.throws(
      () => auth.createKioskToken(tokenInput),
      (error) => error.code === "INTERNAL_ERROR" && error.message === "Configuracion incompleta"
    );
  }
});

test("un secreto fuerte firma y verifica un token sin exponerlo en configuración", () => {
  const strongSecret = crypto.createHash("sha256").update("synthetic-kiosk-secret-fixture-v1").digest("base64url");
  const auth = createHarness(strongSecret, false);
  const issued = auth.createKioskToken(tokenInput);
  assert.match(issued.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  const identity = auth.verifyKioskToken(issued.token, tokenInput.sessionId);
  assert.deepEqual(
    [identity.actor, identity.role, identity.sessionId, identity.stationLabel],
    ["KIOSK", "KIOSK", "session-kiosk-1", "Sala sintética · Equipo 01"]
  );
});

test("MOCK usa exclusivamente un secreto sintético interno", () => {
  const auth = createHarness("", true);
  assert.match(auth.createKioskToken(tokenInput).token, /\./);
});
