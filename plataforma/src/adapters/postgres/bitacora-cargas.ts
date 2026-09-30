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

const PROCEDENCIA: Readonly<Record<TipoDeCarga, string>> = {
  MATRIZ: "MATRIZ_XLSB",
  PADRON: "DEPARTAMENTO",
};

const TIPO_POR_ENTIDAD: Readonly<Record<string, TipoDeCarga>> = {
  CARGA_MATRIZ: "MATRIZ",
  CARGA_PADRON: "PADRON",
};

const HECHOS: readonly HechoDeCarga[] = ["REVISADA", "APLICADA", "RECHAZADA"];

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

const CLAVE_ARCHIVO = "archivo";

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
        `INSERT INTO sistema.bitacora_auditoria (
           actor, rol, entidad_tipo, entidad_id, accion,
           estado_nuevo, solicitud_id, procedencia
         ) VALUES ($1, 'CAPACITACION', $2, $3, $4, $5, $6, $7)
         RETURNING evento_id, ocurrido_en, actor, entidad_tipo, entidad_id,
                   accion, estado_nuevo, solicitud_id;`,
        [
          asiento.actor,
          ENTIDAD[asiento.tipo],
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
    const res = await this.#db.query<FilaDeAsiento>(
      `SELECT evento_id, ocurrido_en, actor, entidad_tipo, entidad_id,
              accion, estado_nuevo, solicitud_id
         FROM sistema.bitacora_auditoria
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
         FROM sistema.bitacora_auditoria
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
