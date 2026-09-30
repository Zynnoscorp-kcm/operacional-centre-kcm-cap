export const PREFIJO_DE_SESION = "KC-";
export const MAYOR_NUMERO_DE_SESION = 9999;

const CODIGO_NUEVO = /^KC-(\d{4})$/u;
const CODIGO_ANTERIOR = /^KCM-\d{6}-[A-Z0-9]{6}$/u;
const TECLEADO_NUEVO = /^KC-?(\d{1,4})$/u;

export function formatearCodigoDeSesion(numero: number): string {
  if (!Number.isInteger(numero) || numero < 1 || numero > MAYOR_NUMERO_DE_SESION) {
    throw new RangeError(`El número de sesión ${String(numero)} no cabe en cuatro cifras.`);
  }
  return `${PREFIJO_DE_SESION}${String(numero).padStart(4, "0")}`;
}

export function numeroDeCodigoDeSesion(codigo: string): number | null {
  const encontrado = CODIGO_NUEVO.exec(codigo);
  return encontrado?.[1] ? Number(encontrado[1]) : null;
}

export function normalizarCodigoDeSesion(texto: string): string {
  const limpio = texto.replace(/\s+/gu, "").toUpperCase();
  const tecleado = TECLEADO_NUEVO.exec(limpio);
  const numero = tecleado?.[1] ? Number(tecleado[1]) : 0;
  return numero >= 1 ? formatearCodigoDeSesion(numero) : limpio;
}

export function esCodigoDeSesion(texto: string): boolean {
  return CODIGO_NUEVO.test(texto) || CODIGO_ANTERIOR.test(texto);
}
