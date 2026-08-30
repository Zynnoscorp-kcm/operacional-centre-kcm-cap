export class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export function domainError(code, message) {
  return new DomainError(code, message);
}
