import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(path.resolve("src/apps-script/web/Kiosk.html"), "utf8");
const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

test("Kiosk es una pantalla participante separada, accesible y limitada a cinco dígitos", () => {
  assert.match(html, /<main[^>]+id="main"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /id="registration-form"/);
  assert.match(html, /id="employee-id"[^>]+inputmode="numeric"/);
  assert.match(html, /pattern="\[0-9\]\{5\}"/);
  assert.match(html, /minlength="5" maxlength="5"/);
  assert.match(html, /Registrar asistencia/);
  assert.match(html, /Disponibilidad/);
  assert.match(html, /Solicitud recibida/);
  assert.doesNotMatch(html, /result-identity|Asistencia ya registrada|No fue posible validar el registro/);
  assert.doesNotMatch(html, /Sesiones y cierre|Liberación idempotente|Auditoría/);
});

test("token se toma sólo del fragmento, se elimina del historial y permanece fuera de almacenamiento y DOM", () => {
  assert.match(html, /location\.hash/);
  assert.match(html, /google\.script\.url/);
  assert.match(html, /urlApi\.getLocation/);
  assert.match(html, /historyApi\.replace\(\{\}, null, ""\)/);
  assert.match(html, /URLSearchParams/);
  assert.match(html, /getAll\("kioskToken"\)/);
  assert.match(html, /history\.replaceState/);
  assert.match(html, /pathname \+ window\.location\.search/);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(html, /innerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(html, /console\.(?:log|info|warn|error)/);
  assert.match(html, /name="referrer" content="no-referrer"/);
});

test("mock HTTP sólo se habilita en loopback y usa los dos endpoints de quiosco", () => {
  assert.match(html, /loopbackHosts/);
  assert.match(html, /localhost/);
  assert.match(html, /127\.0\.0\.1/);
  assert.match(html, /localPreview = !hasGoogleRunner/);
  assert.match(html, /call\("kioskBootstrap"/);
  assert.match(html, /call\("kioskRegister"/);
  assert.match(html, /fetch\("\/api"/);
  assert.match(html, /pagehide/);
});

test("script inline de Kiosk conserva sintaxis JavaScript válida", () => {
  assert.equal([...html.matchAll(/<script>/g)].length, 1);
  assert.doesNotThrow(() => new vm.Script(inlineScript, { filename: "Kiosk.inline.js" }));
});

test("en HTML Service consume y borra el hash exterior antes del bootstrap", async () => {
  const initiallyHidden = new Set(["unavailable", "registration", "result-message", "next-person", "preview-note"]);
  const elements = new Map();
  const events = [];
  const apiCalls = [];
  let historyArguments = null;
  const document = {
    title: "Registro de capacitación KCM",
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          hidden: initiallyHidden.has(id),
          value: "",
          textContent: "",
          className: "",
          disabled: false,
          addEventListener() {},
          focus() {},
          setCustomValidity() {},
          reportValidity() {}
        });
      }
      return elements.get(id);
    }
  };
  let successHandler;
  let failureHandler;
  const runner = {
    withSuccessHandler(handler) { successHandler = handler; return runner; },
    withFailureHandler(handler) { failureHandler = handler; return runner; },
    api(action, input) {
      apiCalls.push({ action, input: { ...input } });
      events.push("bootstrap");
      try {
        successHandler({
          ok: true,
          data: {
            sessionId: "session-kiosk-synthetic",
            sessionCode: "KCM-SYNTHETIC",
            status: "ABIERTA",
            trainingId: "CAP-SINT-001",
            stationLabel: "Sala sintética · Equipo 01",
            expiresAt: "2999-07-22T18:00:00.000Z",
            availability: { maximum: 40, available: true },
            acceptingRegistrations: true
          }
        });
      } catch (error) {
        failureHandler(error);
      }
    }
  };
  const google = {
    script: {
      run: runner,
      url: {
        getLocation(callback) {
          events.push("location");
          callback({ hash: "kioskToken=signed.synthetic.kiosk-token-value" });
        }
      },
      history: {
        replace(state, parameters, hash) {
          events.push("clear");
          historyArguments = { state, parameters, hash };
        }
      }
    }
  };
  const window = {
    google,
    location: { hostname: "script.google.com", pathname: "/macros/s/example/exec", search: "?view=kiosk", hash: "" },
    history: { replaceState() { events.push("direct-clear"); } },
    crypto: { randomUUID: () => "request-synthetic" },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    addEventListener() {}
  };
  const context = vm.createContext({
    Array, Boolean, Date, Error, Math, Number, Object, Promise, String, URLSearchParams,
    document, google, window
  });

  new vm.Script(inlineScript, { filename: "Kiosk.inline.js" }).runInContext(context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events.slice(0, 3), ["location", "clear", "bootstrap"]);
  assert.deepEqual(Object.keys(historyArguments.state), []);
  assert.equal(historyArguments.parameters, null);
  assert.equal(historyArguments.hash, "");
  assert.equal(events.includes("direct-clear"), false);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].action, "kioskBootstrap");
  assert.equal(apiCalls[0].input.token, "signed.synthetic.kiosk-token-value");
  assert.equal(elements.get("registration").hidden, false);
  assert.equal(elements.get("session-code").textContent, "Sesión KCM-SYNTHETIC");
});
