/**
 * Fecha ISO desplazada por dias enteros.
 *
 * Se hace en UTC a proposito. `new Date("2026-08-23")` se interpreta como medianoche UTC, pero
 * `getDate()` y compania responden en la zona local: en México, sumar dias asi devuelve el dia
 * anterior. Una constancia con la fecha corrida un dia es una constancia mal emitida, y el error
 * solo aparece en unas zonas horarias, que es la peor forma de aparecer.
 */
export function sumarDiasIso(fechaIso, dias) {
  const texto = String(fechaIso ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const desplazamiento = Number(dias);
  if (!Number.isInteger(desplazamiento) || desplazamiento === 0) return texto;
  const base = new Date(`${texto}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + desplazamiento);
  return base.toISOString().slice(0, 10);
}
