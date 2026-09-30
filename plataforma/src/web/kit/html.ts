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

export function renderDocument(documento: Html): string {
  return `<!doctype html>\n${documento.__html.trim()}\n`;
}
