import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("src/apps-script/server/00_Config.gs"), "utf8");

function createConfig(properties = {}) {
  let uuidCounter = 0;
  const context = vm.createContext({
    Object,
    String,
    Number,
    Error,
    isFinite,
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            return Object.hasOwn(properties, name) ? properties[name] : null;
          },
          setProperty(name, value) {
            properties[name] = String(value);
          }
        };
      }
    },
    Utilities: {
      getUuid() {
        uuidCounter += 1;
        return uuidCounter === 1
          ? "12345678-1234-4abc-8def-1234567890ab"
          : "abcdef01-2345-4678-9abc-def012345678";
      }
    }
  });
  new vm.Script(source, { filename: "00_Config.gs" }).runInContext(context);
  return context.KcmConfig;
}

function isSafeConfigurationError(error) {
  return error.code === "INTERNAL_ERROR" && error.message === "La configuracion OCR no es valida";
}

test("la configuracion OCR aplica umbrales conservadores y revision humana por defecto", () => {
  const config = createConfig();
  assert.equal(config.ocrAutoAcceptThreshold(), 0.98);
  assert.equal(config.ocrDigitThreshold(), 0.98);
  assert.equal(config.ocrRequireHumanReview(), true);
});

test("la configuracion OCR acepta unicamente limites conservadores validos", () => {
  const minimums = createConfig({
    KCM_OCR_AUTO_ACCEPT_THRESHOLD: "0.96",
    KCM_OCR_DIGIT_THRESHOLD: "0.94",
    KCM_OCR_REQUIRE_HUMAN_REVIEW: "false"
  });
  assert.equal(minimums.ocrAutoAcceptThreshold(), 0.96);
  assert.equal(minimums.ocrDigitThreshold(), 0.94);
  assert.equal(minimums.ocrRequireHumanReview(), false);

  const maximums = createConfig({
    KCM_OCR_AUTO_ACCEPT_THRESHOLD: "1",
    KCM_OCR_DIGIT_THRESHOLD: "1",
    KCM_OCR_REQUIRE_HUMAN_REVIEW: "TRUE"
  });
  assert.equal(maximums.ocrAutoAcceptThreshold(), 1);
  assert.equal(maximums.ocrDigitThreshold(), 1);
  assert.equal(maximums.ocrRequireHumanReview(), true);
});

for (const [propertyName, getterName, invalidValues] of [
  ["KCM_OCR_AUTO_ACCEPT_THRESHOLD", "ocrAutoAcceptThreshold", ["NaN", "0", "-0.1", "0.959999", "1.0001", "Infinity"]],
  ["KCM_OCR_DIGIT_THRESHOLD", "ocrDigitThreshold", ["NaN", "0", "-0.1", "0.939999", "1.0001", "Infinity"]]
]) {
  for (const invalidValue of invalidValues) {
    test(`${propertyName} rechaza ${invalidValue} sin degradar a autoaceptacion`, () => {
      const config = createConfig({ [propertyName]: invalidValue });
      assert.throws(() => config[getterName](), isSafeConfigurationError);
    });
  }
}

test("la politica de revision humana rechaza valores booleanos ambiguos", () => {
  for (const invalidValue of ["yes", "1", "off", "NaN"]) {
    const config = createConfig({ KCM_OCR_REQUIRE_HUMAN_REVIEW: invalidValue });
    assert.throws(() => config.ocrRequireHumanReview(), isSafeConfigurationError);
  }
});

test("la integridad de liberacion exige secreto fuerte fuera de MOCK", () => {
  const missing = createConfig({ KCM_MODE: "REAL" });
  assert.throws(
    () => missing.releaseIntegritySecret(),
    (error) => error.code === "INTERNAL_ERROR" && /integridad de liberacion/.test(error.message)
  );
  for (const weak of ["short", "a".repeat(64), "replace_with_generated_secret_at_least_32_chars"]) {
    const config = createConfig({ KCM_MODE: "REAL", KCM_RELEASE_INTEGRITY_SECRET: weak });
    assert.throws(() => config.releaseIntegritySecret(), (error) => error.code === "INTERNAL_ERROR");
  }
  const strong = "0123456789abcdef".repeat(4);
  assert.equal(createConfig({ KCM_MODE: "REAL", KCM_RELEASE_INTEGRITY_SECRET: strong }).releaseIntegritySecret(), strong);
});

test("MOCK genera y reutiliza un secreto local si la propiedad falta", () => {
  const config = createConfig({ KCM_MODE: "MOCK" });
  const first = config.releaseIntegritySecret();
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(config.releaseIntegritySecret(), first);
});
