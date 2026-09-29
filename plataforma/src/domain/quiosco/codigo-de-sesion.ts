/**
 * El código público de una sesión: `KC-` y cuatro cifras, como `KC-0001`.
 *
 * Desde el 2026-09-29, por decisión del departamento, reemplaza a
 * `KCM-AAMMDD-XXXXXX`. Aquél se armaba con la fecha y seis caracteres al azar:
 * no chocaba nunca, pero eran doce caracteres que nadie recuerda al dictarlos
 * en la sala ni al leerlos en la nota de una celda de la matriz. Éste es un
 * consecutivo: la sesión nueva lleva el siguiente al mayor en uso.
 *
 * Las sesiones creadas antes conservan su código. Por eso buscar y liberar
 * aceptan los dos formatos, y el consecutivo sólo cuenta los códigos nuevos.
 */

export const PREFIJO_DE_SESION = "KC-";
/** Cuatro cifras: después de `KC-9999` no hay código que dar. */
export const MAYOR_NUMERO_DE_SESION = 9999;

const CODIGO_NUEVO = /^KC-(\d{4})$/u;
const CODIGO_ANTERIOR = /^KCM-\d{6}-[A-Z0-9]{6}$/u;
/** Lo que alguien teclea por un código nuevo: con o sin guion y sin los ceros. */
const TECLEADO_NUEVO = /^KC-?(\d{1,4})$/u;

export function formatearCodigoDeSesion(numero: number): string {
  if (!Number.isInteger(numero) || numero < 1 || numero > MAYOR_NUMERO_DE_SESION) {
    throw new RangeError(`El número de sesión ${String(numero)} no cabe en cuatro cifras.`);
  }
  return `${PREFIJO_DE_SESION}${String(numero).padStart(4, "0")}`;
}

/** El consecutivo de un código nuevo, o `null` si es de otro formato. */
export function numeroDeCodigoDeSesion(codigo: string): number | null {
  const encontrado = CODIGO_NUEVO.exec(codigo);
  return encontrado?.[1] ? Number(encontrado[1]) : null;
}

/**
 * El código tal como lo guarda la base. En mayúsculas y sin espacios, y un
 * código nuevo con sus cuatro cifras: «kc-1», «KC1» y «KC 0001» son `KC-0001`.
 * Es lo que se dicta en la sala; exigir los ceros sólo haría fallar la búsqueda.
 * Cualquier otra cosa se devuelve limpia pero sin interpretar.
 */
export function normalizarCodigoDeSesion(texto: string): string {
  const limpio = texto.replace(/\s+/gu, "").toUpperCase();
  const tecleado = TECLEADO_NUEVO.exec(limpio);
  const numero = tecleado?.[1] ? Number(tecleado[1]) : 0;
  return numero >= 1 ? formatearCodigoDeSesion(numero) : limpio;
}

/** Si el texto, ya normalizado, tiene la forma de un código de sesión, nuevo o anterior. */
export function esCodigoDeSesion(texto: string): boolean {
  return CODIGO_NUEVO.test(texto) || CODIGO_ANTERIOR.test(texto);
}
