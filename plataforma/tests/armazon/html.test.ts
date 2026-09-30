import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeHtml, html, isHtml, rawHtml, renderDocument } from "../../src/web/kit/html.ts";

describe("plantilla HTML con escape por omisión", () => {
  it("escapa los cinco caracteres que rompen el marcado", () => {
    assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  });

  it("escapa el texto interpolado", () => {
    const salida = html`<p>${'<script>alert("x")</script>'}</p>`;
    assert.equal(salida.__html, "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
  });

  it("escapa también en posición de atributo, incluida la comilla simple", () => {
    const salida = html`<a title="${`x" onmouseover='malo()`}">t</a>`;
    assert.ok(!salida.__html.includes(`onmouseover='`));
    assert.ok(salida.__html.includes("&quot;"));
    assert.ok(salida.__html.includes("&#39;"));
  });

  it("inserta sin escapar lo que se marcó con rawHtml", () => {
    const salida = html`<div>${rawHtml("<b>ya seguro</b>")}</div>`;
    assert.equal(salida.__html, "<div><b>ya seguro</b></div>");
  });

  it("anida fragmentos ya renderizados sin doble escape", () => {
    const parte = html`<b>${"a & b"}</b>`;
    const salida = html`<p>${parte}</p>`;
    assert.equal(salida.__html, "<p><b>a &amp; b</b></p>");
  });

  it("une los arreglos y escapa cada elemento", () => {
    const salida = html`${["a & b", "c"].map((t) => html`<li>${t}</li>`)}`;
    assert.equal(salida.__html, "<li>a &amp; b</li><li>c</li>");
  });

  it("omite null, undefined y false, que es lo que permite condicionales", () => {
    assert.equal(html`<i>${null}${undefined}${false}</i>`.__html, "<i></i>");
  });

  it("lanza ante un objeto en vez de imprimir [object Object]", () => {
    assert.throws(() => html`<p>${{ curp: "secreto" }}</p>`, TypeError);
    assert.throws(() => html`<p>${(): void => undefined}</p>`, TypeError);
  });

  it("lanza ante un número no finito", () => {
    assert.throws(() => html`<p>${Number.NaN}</p>`, TypeError);
    assert.throws(() => html`<p>${Number.POSITIVE_INFINITY}</p>`, TypeError);
  });

  it("reconoce sus propios fragmentos", () => {
    assert.equal(isHtml(html`<p></p>`), true);
    assert.equal(isHtml("<p></p>"), false);
    assert.equal(isHtml(null), false);
  });

  it("renderDocument antepone el doctype una sola vez", () => {
    const documento = renderDocument(html`<html></html>`);
    assert.ok(documento.startsWith("<!doctype html>\n"));
    assert.equal(documento.match(/<!doctype/giu)?.length, 1);
  });
});
