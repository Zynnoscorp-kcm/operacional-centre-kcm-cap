const MAXIMO_DE_PARTES = 20;
const MAXIMO_DE_CAMPO = 10_000;

export interface ArchivoRecibido {
  readonly campo: string;
  readonly nombre: string;
  readonly tipo: string;
  readonly contenido: Buffer;
}

export interface FormularioMultiparte {
  readonly campos: Readonly<Record<string, string>>;
  readonly archivos: readonly ArchivoRecibido[];
}

export class MultipartError extends Error {}

export function limiteDeMultipart(contentType: string | undefined): string | undefined {
  if (!contentType || !/^multipart\/form-data/i.test(contentType)) return undefined;
  const encontrado = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
  const limite = encontrado?.[1] ?? encontrado?.[2];
  return limite && limite.length <= 200 ? limite : undefined;
}

export function parseMultipart(
  cuerpo: Buffer,
  contentType: string | undefined,
): FormularioMultiparte {
  const limite = limiteDeMultipart(contentType);
  if (!limite) throw new MultipartError("La solicitud no declara un límite de multipart válido.");

  const separador = Buffer.from(`--${limite}`, "utf8");
  const campos: Record<string, string> = {};
  const archivos: ArchivoRecibido[] = [];

  let posicion = cuerpo.indexOf(separador);
  if (posicion === -1) throw new MultipartError("El cuerpo no contiene ninguna parte.");

  for (let parte = 0; posicion !== -1; parte += 1) {
    if (parte > MAXIMO_DE_PARTES) throw new MultipartError("El formulario trae demasiadas partes.");

    let inicio = posicion + separador.length;
    if (cuerpo[inicio] === 0x2d && cuerpo[inicio + 1] === 0x2d) break;
    if (cuerpo[inicio] !== 0x0d || cuerpo[inicio + 1] !== 0x0a) {
      throw new MultipartError("Una parte del formulario no está bien delimitada.");
    }
    inicio += 2;

    const finDeCabeceras = cuerpo.indexOf("\r\n\r\n", inicio, "utf8");
    if (finDeCabeceras === -1) throw new MultipartError("Una parte no cierra sus cabeceras.");

    const cabeceras = cuerpo.toString("utf8", inicio, finDeCabeceras);
    const siguiente = cuerpo.indexOf(separador, finDeCabeceras + 4);
    if (siguiente === -1) throw new MultipartError("El formulario no cierra su última parte.");

    let fin = siguiente;
    if (cuerpo[fin - 2] === 0x0d && cuerpo[fin - 1] === 0x0a) fin -= 2;
    const contenido = cuerpo.subarray(finDeCabeceras + 4, fin);

    const disposicion = /content-disposition:([^\r\n]*)/i.exec(cabeceras)?.[1] ?? "";
    const campo = valorDeParametro(disposicion, "name");
    if (campo) {
      const nombre = valorDeParametro(disposicion, "filename");
      if (nombre === undefined) {
        const texto = contenido.toString("utf8");
        if (texto.length > MAXIMO_DE_CAMPO) throw new MultipartError("Un campo excede su tamaño.");
        campos[campo] = texto;
      } else {
        archivos.push({
          campo,
          nombre: nombre.split(/[\\/]/).pop()?.slice(0, 200) ?? "",
          tipo: (/content-type:([^\r\n]*)/i.exec(cabeceras)?.[1] ?? "").trim(),
          contenido,
        });
      }
    }

    posicion = siguiente;
  }

  return { campos, archivos };
}

function valorDeParametro(cabecera: string, parametro: string): string | undefined {
  const patron = new RegExp(`(?:^|;)\\s*${parametro}\\s*=\\s*(?:"([^"]*)"|([^;]*))`, "i");
  const encontrado = patron.exec(cabecera);
  if (!encontrado) return undefined;
  return (encontrado[1] ?? encontrado[2] ?? "").trim();
}
