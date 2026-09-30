export function sumarDiasIso(fechaIso, dias) {
  const texto = String(fechaIso ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const desplazamiento = Number(dias);
  if (!Number.isInteger(desplazamiento) || desplazamiento === 0) return texto;
  const base = new Date(`${texto}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + desplazamiento);
  return base.toISOString().slice(0, 10);
}
