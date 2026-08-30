/**
 * Errores del dominio. El dominio no conoce HTTP ni Fastify: lanza estos y la
 * capa web decide cómo se ven. Sin esa separación, una regla de negocio
 * terminaría acarreando un código de estado.
 */

export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
