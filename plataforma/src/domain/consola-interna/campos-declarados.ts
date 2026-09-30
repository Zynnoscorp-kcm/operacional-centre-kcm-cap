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
      return campo;
    }

    return this.#repository.approveField(fieldId, actor);
  }
}

function normalizar(valor: string, permitidos: readonly string[]): string | undefined {
  const buscado = valor.trim().toUpperCase();
  return permitidos.find((permitido) => permitido === buscado);
}
