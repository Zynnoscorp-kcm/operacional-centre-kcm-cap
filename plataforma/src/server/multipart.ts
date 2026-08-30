/**
 * Lector de `multipart/form-data`.
 *
 * La consola no tenía forma de recibir un archivo: el analizador de formularios
 * de `build-server.ts` entiende `application/x-www-form-urlencoded`, que no
 * puede transportar bytes. Esto es lo mínimo para que una pantalla acepte un
 * `.xlsx`, y está escrito aquí por la misma razón que aquel: traer una
 * dependencia nueva por doscientas líneas engordaría una imagen que costó
 * trabajo dejar en 15 MB.
 *
 * Dos cosas que un lector ingenuo hace mal y este no:
 *
 * 1. El contenido nunca pasa por `string`. Un `.xlsx` es un ZIP; leerlo
 *    como texto y volverlo a codificar lo corrompe en silencio. Todo el
 *    recorrido trabaja con índices sobre el `Buffer` y sólo las cabeceras de
 *    cada parte —que son ASCII por definición— se convierten a texto.
 * 2. El `CRLF` que precede al delimitador es del delimitador, no del
 *    archivo. Quitarlo mal deja dos bytes de más al final y el ZIP no abre.
 *
 * Lo que no hace: `base64` por parte, cabeceras plegadas en varias líneas ni
 * archivos en disco. Nada de eso aparece en un formulario de navegador.
 */

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

/** `undefined` si la cabecera no declara un multipart utilizable. */
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
    // `--` cierra el formulario; cualquier otra cosa que no sea CRLF está rota.
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
          // Sólo el nombre, nunca la ruta: un navegador de Windows manda la
          // ruta completa y ese texto termina en pantalla y en la bitácora.
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

/**
 * `name="archivo"` o `name=archivo`, indistintamente. No intenta descifrar
 * `filename*=UTF-8''…`: un nombre así llega con su versión simple al lado.
 */
function valorDeParametro(cabecera: string, parametro: string): string | undefined {
  const patron = new RegExp(`(?:^|;)\\s*${parametro}\\s*=\\s*(?:"([^"]*)"|([^;]*))`, "i");
  const encontrado = patron.exec(cabecera);
  if (!encontrado) return undefined;
  return (encontrado[1] ?? encontrado[2] ?? "").trim();
}
