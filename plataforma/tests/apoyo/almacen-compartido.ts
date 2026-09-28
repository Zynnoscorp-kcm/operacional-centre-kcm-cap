/**
 * Almacén compartido falso para las pruebas de varias instancias.
 *
 * Guarda el contenido serializado, como la base: lo que no sobreviva a
 * `JSON.stringify` tampoco sobrevive a `sistema.revision_pendiente`.
 */

import type {
  RevisionesCompartidasPort,
  TipoDeRevision,
} from "../../src/ports/revisiones-compartidas.port.ts";

export function almacenCompartido(): RevisionesCompartidasPort {
  const ranuras = new Map<TipoDeRevision, { id: string; json: string }>();
  return {
    guardar: (tipo, revision) => {
      ranuras.set(tipo, { id: revision.id, json: JSON.stringify(revision.contenido) });
      return Promise.resolve();
    },
    vigente: (tipo) => Promise.resolve(ranuras.get(tipo)?.id),
    leer: (tipo) => {
      const ranura = ranuras.get(tipo);
      return Promise.resolve(
        ranura ? { id: ranura.id, contenido: JSON.parse(ranura.json) as unknown } : undefined,
      );
    },
    retirar: (tipo, id) => {
      const ranura = ranuras.get(tipo);
      if (ranura?.id !== id) return Promise.resolve(false);
      ranuras.delete(tipo);
      return Promise.resolve(true);
    },
    descartar: (tipo) => {
      ranuras.delete(tipo);
      return Promise.resolve();
    },
  };
}
