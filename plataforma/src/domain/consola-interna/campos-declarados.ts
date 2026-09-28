/**
 * Alta de campos nuevos.
 *
 * Qué agrega un campo aquí y qué no
 *
 * No ejecuta DDL. Declarar un campo no corre `ALTER TABLE`, no crea
 * columnas y no toca el esquema. Una pantalla que emitiera DDL contra la base
 * de operación podría dejar una tabla a medio migrar mientras el puente VBA
 * está escribiendo, y no hay `ROLLBACK` que devuelva eso.
 *
 * Lo que hace es lo que el esquema ya tenía previsto para esto: agrega un
 * renglón a `organizacion.atributo_definicion`, el registro de campos que existe justamente
 * para incorporar un dato nuevo sin desplegar código. Los valores de ese campo
 * viven después en `organizacion.trabajador_atributo`, uno por trabajador, con
 * procedencia y vigencia.
 *
 * La aprobación es un acto aparte
 *
 * Un campo recién declarado nace con `aprobado_para_reglas = false`. Se puede
 * capturar y consultar, pero no alimenta ninguna regla DNC ni ningún
 * porcentaje de cobertura hasta que alguien lo autoriza por su nombre. Eso
 * impide que un campo capturado a medias mueva un número que Recursos Humanos
 * ya reportó.
 *
 * Ambas operaciones dejan evento en `sistema.bitacora_auditoria`, que es de sólo agregado.
 */

import type { DeclaredFieldPort } from "../../ports/consola-interna.port.ts";
import { DomainError } from "../comun/errores.ts";
import {
  ORIGENES_DE_CAMPO,
  TIPOS_DE_CAMPO,
  type DeclareFieldInput,
  type DeclaredField,
  type OrigenDeCampo,
  type TipoDeCampo,
} from "./tipos.ts";

/**
 * Un nombre de campo se escribe como identificador: minúsculas, dígitos y guión
 * bajo, empezando por letra. No es capricho de estilo —es lo que permite que el
 * mismo nombre sirva de clave en `atributo_declarado`, de encabezado en una
 * exportación y de referencia en una regla sin necesitar comillas ni escapes en
 * ninguno de los tres lugares.
 */
const NOMBRE_VALIDO = /^[a-z][a-z0-9_]{2,59}$/u;

const LARGO_MAXIMO_DESCRIPCION = 500;

export class DeclaredFieldService {
  readonly #repository: DeclaredFieldPort;

  constructor(deps: { readonly repository: DeclaredFieldPort }) {
    this.#repository = deps.repository;
  }

  list(): Promise<readonly DeclaredField[]> {
    return this.#repository.listDeclaredFields();
  }

  async declare(input: DeclareFieldInput, actor: string): Promise<DeclaredField> {
    const name = input.name.trim().toLowerCase();

    if (!NOMBRE_VALIDO.test(name)) {
      throw new DomainError(
        "NOMBRE_INVALIDO",
        "El nombre del campo va en minúsculas, entre 3 y 60 caracteres, empieza con letra y sólo " +
          "admite letras, dígitos y guión bajo. Ejemplo: escolaridad_declarada.",
      );
    }

    const dataType = normalizar(input.dataType, TIPOS_DE_CAMPO) as TipoDeCampo | undefined;
    if (dataType === undefined) {
      throw new DomainError(
        "TIPO_INVALIDO",
        `El tipo de dato debe ser uno de: ${TIPOS_DE_CAMPO.join(", ")}.`,
      );
    }

    const source = normalizar(input.source, ORIGENES_DE_CAMPO) as OrigenDeCampo | undefined;
    if (source === undefined) {
      throw new DomainError(
        "ORIGEN_INVALIDO",
        `El origen debe ser uno de: ${ORIGENES_DE_CAMPO.join(", ")}.`,
      );
    }

    const description = input.description?.trim();
    if (description !== undefined && description.length > LARGO_MAXIMO_DESCRIPCION) {
      throw new DomainError(
        "DESCRIPCION_LARGA",
        `La descripción admite hasta ${String(LARGO_MAXIMO_DESCRIPCION)} caracteres.`,
      );
    }

    // El nombre es UNIQUE en el esquema, así que la carrera entre dos altas
    // simultáneas la resuelve la base. Comprobarlo antes es para dar el mensaje
    // legible en el caso normal, no para sostener el invariante.
    const existentes = await this.#repository.listDeclaredFields();
    if (existentes.some((campo) => campo.name === name)) {
      throw new DomainError(
        "CAMPO_DUPLICADO",
        `El campo «${name}» ya está declarado. Un campo se declara una sola vez.`,
      );
    }

    return this.#repository.declareField(
      {
        name,
        dataType,
        source,
        ...(description ? { description } : {}),
      },
      actor,
    );
  }

  /**
   * Aprobar es irreversible desde esta pantalla, y lo es a propósito: el
   * esquema no ofrece un camino de regreso porque retirar la aprobación
   * dejaría reglas que ya corrieron apoyadas en un campo que después se declaró
   * no apto. Si un campo aprobado resulta equivocado, lo que se corrige es la
   * regla que lo usa.
   */
  async approve(fieldId: string, actor: string): Promise<DeclaredField> {
    if (fieldId.trim() === "") {
      throw new DomainError("CAMPO_REQUERIDO", "Falta el identificador del campo.");
    }

    const campos = await this.#repository.listDeclaredFields();
    const campo = campos.find((candidato) => candidato.fieldId === fieldId);
    if (campo === undefined) {
      throw new DomainError("CAMPO_NO_ENCONTRADO", "Ese campo no está declarado.");
    }
    if (campo.approvedForRules) {
      // Idempotente: reaprobar no vuelve a escribir ni vuelve a auditar.
      return campo;
    }

    return this.#repository.approveField(fieldId, actor);
  }
}

/** Acepta el valor en cualquier caja y lo devuelve canónico, o `undefined`. */
function normalizar(valor: string, permitidos: readonly string[]): string | undefined {
  const buscado = valor.trim().toUpperCase();
  return permitidos.find((permitido) => permitido === buscado);
}
