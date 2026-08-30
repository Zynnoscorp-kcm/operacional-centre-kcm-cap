/**
 * Bitácora de cargas sobre `kcm.auditoria`.
 *
 * No hay tabla nueva y es deliberado. La auditoría ya es el ledger append-only
 * del sistema —con trigger que aborta cualquier `UPDATE` o `DELETE`— y una carga
 * de matriz o de padrón es exactamente el tipo de hecho que ese ledger existe
 * para conservar. Crear una tabla propia habría exigido una migración, y las
 * migraciones de este proyecto no se aplican sin confirmación del departamento:
 * la bitácora habría quedado escrita en el árbol y sin funcionar en la base.
 *
 * Cómo se aloja cada campo, que es lo único no obvio:
 *
 * - `entidad_tipo` distingue las dos fuentes: `CARGA_MATRIZ` o `CARGA_PADRON`.
 *   Es el filtro de todas las consultas de aquí y no colisiona con ninguna
 *   entidad existente.
 * - `entidad_id` lleva la huella del archivo, que es la identidad real de
 *   una carga: dos cargas del mismo libro comparten huella aunque el archivo se
 *   haya movido de carpeta o le hayan cambiado el nombre.
 * - `estado_nuevo` lleva el resumen como JSON compacto. Es texto libre en el
 *   esquema y aquí se usa como tal; el rótulo humano de cada cifra lo pone la
 *   pantalla, no la base, porque cambiar una etiqueta no debe reescribir
 *   asientos que son inmutables por trigger.
 * - `motivo` se deja nulo siempre: es un enum cerrado del dominio de sesiones y
 *   forzar una carga dentro de sus valores sería mentir sobre lo que pasó.
 *
 * `registrar` no lanza. Un asiento perdido es un problema; una carga de mil
 * setecientas filas abortada a la mitad porque su asiento falló es un problema
 * peor y más difícil de deshacer, porque las escrituras ya ocurrieron.
 */

import type {
  AsientoDeCarga,
  CargaRegistrada,
  HechoDeCarga,
  ResumenDeCarga,
  TipoDeCarga,
} from "../../domain/cargas/tipos.ts";
import type { LoadLogPort } from "../../ports/bitacora-cargas.port.ts";
import type { SqlExecutor } from "./matriz.ts";

const ENTIDAD: Readonly<Record<TipoDeCarga, string>> = {
  MATRIZ: "CARGA_MATRIZ",
  PADRON: "CARGA_PADRON",
};

/** Procedencia declarada de cada fuente, con los valores del enum del esquema. */
const PROCEDENCIA: Readonly<Record<TipoDeCarga, string>> = {
  MATRIZ: "MATRIZ_XLSB",
  PADRON: "DEPARTAMENTO",
};

const TIPO_POR_ENTIDAD: Readonly<Record<string, TipoDeCarga>> = {
  CARGA_MATRIZ: "MATRIZ",
  CARGA_PADRON: "PADRON",
};

const HECHOS: readonly HechoDeCarga[] = ["ENCARGADA", "REVISADA", "APLICADA", "RECHAZADA"];

interface FilaDeAsiento {
  evento_id: string;
  ocurrido_en: string | Date;
  actor: string;
  entidad_tipo: string;
  entidad_id: string;
  accion: string;
  estado_nuevo: string | null;
  solicitud_id: string | null;
}

/** El nombre del archivo viaja dentro del resumen, bajo una clave reservada. */
const CLAVE_ARCHIVO = "archivo";

/**
 * El dominio `kcm.identificador_solicitud` del esquema, copiado aquí.
 *
 * No es paranoia: el asiento de rechazo lleva el identificador que vino del
 * formulario, y ése es el único de todos que un navegador puede fabricar. Un
 * valor vacío o con caracteres fuera del alfabeto haría fallar el `INSERT`, y
 * como esta bitácora se traga sus errores, el asiento se perdería justo en el
 * caso que más importa conservar. Se sanea a nulo y el hecho sobrevive sin su
 * referencia, que es mucho mejor que no sobrevivir.
 */
const IDENTIFICADOR_VALIDO = /^[A-Za-z0-9._:-]{8,128}$/u;

function solicitudSaneada(valor: string | undefined): string | null {
  if (valor === undefined) return null;
  return IDENTIFICADOR_VALIDO.test(valor) ? valor : null;
}

function esHecho(valor: string): valor is HechoDeCarga {
  return (HECHOS as readonly string[]).includes(valor);
}

function leerResumen(crudo: string | null): ResumenDeCarga {
  if (!crudo) return {};
  try {
    const leido: unknown = JSON.parse(crudo);
    if (typeof leido !== "object" || leido === null || Array.isArray(leido)) return {};
    const limpio: Record<string, number | string | boolean> = {};
    for (const [clave, valor] of Object.entries(leido)) {
      const tipo = typeof valor;
      if (tipo === "number" || tipo === "string" || tipo === "boolean") {
        limpio[clave] = valor as number | string | boolean;
      }
    }
    return limpio;
  } catch {
    // Un asiento con JSON ilegible no debe tumbar la pantalla entera: se
    // devuelve sin resumen y el resto de la fila —quién, cuándo, qué archivo—
    // sigue siendo cierto y sigue sirviendo.
    return {};
  }
}

function aIso(valor: string | Date): string {
  return valor instanceof Date ? valor.toISOString() : new Date(valor).toISOString();
}

export class SupabaseLoadLog implements LoadLogPort {
  readonly #db: SqlExecutor;
  readonly #alFallar: (error: unknown) => void;

  constructor(db: SqlExecutor, alFallar?: (error: unknown) => void) {
    this.#db = db;
    this.#alFallar = alFallar ?? (() => {});
  }

  async registrar(asiento: AsientoDeCarga): Promise<CargaRegistrada | undefined> {
    const resumen: ResumenDeCarga = { ...asiento.resumen, [CLAVE_ARCHIVO]: asiento.archivo };
    try {
      const res = await this.#db.query<FilaDeAsiento>(
        `INSERT INTO kcm.auditoria (
           actor, rol, entidad_tipo, entidad_id, accion,
           estado_nuevo, solicitud_id, procedencia
         ) VALUES ($1, 'CAPACITACION', $2, $3, $4, $5, $6, $7)
         RETURNING evento_id, ocurrido_en, actor, entidad_tipo, entidad_id,
                   accion, estado_nuevo, solicitud_id;`,
        [
          asiento.actor,
          ENTIDAD[asiento.tipo],
          // Sin huella todavía —una orden encargada no tiene archivo— se guarda
          // un guion: `entidad_id` es `NOT NULL` y una cadena vacía se leería
          // como una huella de cero caracteres en vez de como su ausencia.
          asiento.sha256 === "" ? "-" : asiento.sha256,
          asiento.hecho,
          JSON.stringify(resumen),
          solicitudSaneada(asiento.solicitudId),
          PROCEDENCIA[asiento.tipo],
        ],
      );
      const fila = res.rows[0];
      return fila ? this.#mapear(fila) : undefined;
    } catch (error) {
      this.#alFallar(error);
      return undefined;
    }
  }

  async listar(limite: number): Promise<readonly CargaRegistrada[]> {
    // `secuencia` y no `ocurrido_en`: dos asientos de la misma carga pueden
    // compartir el instante hasta el microsegundo, y la secuencia es el orden
    // real de los efectos, que es justamente lo que el historial debe mostrar.
    const res = await this.#db.query<FilaDeAsiento>(
      `SELECT evento_id, ocurrido_en, actor, entidad_tipo, entidad_id,
              accion, estado_nuevo, solicitud_id
         FROM kcm.auditoria
        WHERE entidad_tipo IN ('CARGA_MATRIZ', 'CARGA_PADRON')
        ORDER BY secuencia DESC
        LIMIT $1;`,
      [limite],
    );
    return res.rows.map((fila) => this.#mapear(fila));
  }

  async ultimaAplicada(tipo: TipoDeCarga): Promise<CargaRegistrada | undefined> {
    const res = await this.#db.query<FilaDeAsiento>(
      `SELECT evento_id, ocurrido_en, actor, entidad_tipo, entidad_id,
              accion, estado_nuevo, solicitud_id
         FROM kcm.auditoria
        WHERE entidad_tipo = $1 AND accion = 'APLICADA'
        ORDER BY secuencia DESC
        LIMIT 1;`,
      [ENTIDAD[tipo]],
    );
    const fila = res.rows[0];
    return fila ? this.#mapear(fila) : undefined;
  }

  #mapear(fila: FilaDeAsiento): CargaRegistrada {
    const resumen = leerResumen(fila.estado_nuevo);
    const archivo = resumen[CLAVE_ARCHIVO];
    const { [CLAVE_ARCHIVO]: _omitido, ...resto } = resumen;
    return {
      asientoId: fila.evento_id,
      ocurridoEn: aIso(fila.ocurrido_en),
      tipo: TIPO_POR_ENTIDAD[fila.entidad_tipo] ?? "MATRIZ",
      hecho: esHecho(fila.accion) ? fila.accion : "REVISADA",
      actor: fila.actor,
      archivo: typeof archivo === "string" ? archivo : "(sin nombre)",
      sha256: fila.entidad_id === "-" ? "" : fila.entidad_id,
      solicitudId: fila.solicitud_id ?? undefined,
      resumen: resto,
    };
  }
}
