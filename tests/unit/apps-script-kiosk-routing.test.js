import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve("src/apps-script");
const routerSource = await readFile(path.join(ROOT, "server/Router.gs"), "utf8");

function routingHarness() {
  const templates = [];
  const context = vm.createContext({
    String,
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: "DEFAULT" },
      createTemplateFromFile(name) {
        templates.push(name);
        const output = {
          templateName: name,
          title: "",
          viewport: "",
          frameMode: "",
          setTitle(value) { this.title = value; return this; },
          addMetaTag(name_, value) { if (name_ === "viewport") this.viewport = value; return this; },
          setXFrameOptionsMode(value) { this.frameMode = value; return this; }
        };
        return { evaluate: () => output };
      }
    }
  });
  new vm.Script(routerSource, { filename: "Router.gs" }).runInContext(context);
  return { context, templates };
}

test("doGet selecciona Kiosk sólo con la vista permitida y conserva Index por defecto", () => {
  const { context, templates } = routingHarness();

  const kiosk = context.doGet({ parameter: { view: "kiosk" } });
  assert.equal(kiosk.templateName, "Kiosk");
  assert.equal(kiosk.title, "Registro de capacitacion KCM");
  assert.equal(kiosk.frameMode, "DEFAULT");

  const index = context.doGet({ parameter: {} });
  assert.equal(index.templateName, "Index");
  assert.equal(index.title, "Control de capacitaciones KCM");

  const unknown = context.doGet({ parameter: { view: "KIOSK", kioskToken: "query-token-not-accepted" } });
  assert.equal(unknown.templateName, "Index");
  assert.deepEqual(templates, ["Kiosk", "Index", "Index"]);
});

test("la ruta servidor nunca intenta leer kioskToken desde query ni evento", () => {
  const doGetSource = routerSource.slice(routerSource.indexOf("function doGet"), routerSource.indexOf("function api"));
  assert.match(doGetSource, /parameter\.view/);
  assert.doesNotMatch(doGetSource, /kioskToken|token/i);
  assert.match(doGetSource, /requestedView === "kiosk"/);
});
