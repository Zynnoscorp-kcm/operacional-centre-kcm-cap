/**
 * Render en servidor.
 *
 * No hay motor de plantillas: hay una plantilla etiquetada que escapa por
 * omisión. Interpolar texto es seguro sin pensarlo, y publicar marcado crudo
 * exige escribir `rawHtml`, que es una palabra que se ve en la revisión.
 *
 * Un valor de un tipo no previsto —un objeto, una función, un `Symbol`— lanza
 * en vez de imprimirse. La alternativa era `[object Object]` en pantalla o,
 * peor, un objeto de dominio serializado entero con campos que la vista no
 * necesitaba. Falla cerrado.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export interface Html {
  readonly __html: string;
}

export function escapeHtml(valor: string): string {
  return valor.replace(/[&<>"']/gu, (caracter) => ESCAPES[caracter] ?? caracter);
}

/**
 * Marca una cadena como marcado ya seguro. Sólo se usa sobre contenido literal
 * del árbol, nunca sobre algo que venga de una petición o de la base.
 */
export function rawHtml(marcado: string): Html {
  return { __html: marcado };
}

export function isHtml(valor: unknown): valor is Html {
  return typeof valor === "object" && valor !== null && typeof (valor as Html).__html === "string";
}

export function html(literales: TemplateStringsArray, ...valores: unknown[]): Html {
  let salida = literales[0] ?? "";
  for (let indice = 0; indice < valores.length; indice += 1) {
    salida += interpolar(valores[indice]);
    salida += literales[indice + 1] ?? "";
  }
  return { __html: salida };
}

function interpolar(valor: unknown): string {
  if (valor === null || valor === undefined || valor === false) return "";
  if (isHtml(valor)) return valor.__html;
  if (typeof valor === "string") return escapeHtml(valor);
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) {
      throw new TypeError("No se interpola un número no finito en HTML.");
    }
    return escapeHtml(String(valor));
  }
  if (valor === true) return "";
  if (Array.isArray(valor)) return valor.map(interpolar).join("");
  throw new TypeError(
    `No se interpola un valor de tipo ${typeof valor} en HTML. ` +
      "Conviértelo a texto en la vista, o márcalo con rawHtml si de verdad es marcado.",
  );
}

/**
 * Envuelve un cuerpo ya renderizado en el documento completo. Recorta los
 * extremos porque el sangrado de la plantilla dejaría espacios antes de `<html>`.
 */
export function renderDocument(documento: Html): string {
  return `<!doctype html>\n${documento.__html.trim()}\n`;
}
