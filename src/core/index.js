/**
 * API publica del nucleo local.
 *
 * Para demos y pruebas de punta a punta se recomienda `createInMemoryCore`.
 * Los servicios y repositorios individuales se exportan para adaptadores y
 * pruebas que necesiten inyeccion explicita de dependencias.
 */
export * from "./attendance-service.js";
export * from "./audit-ledger.js";
export * from "./create-in-memory-core.js";
export * from "./eligibility.js";
export * from "./errors.js";
export * from "./exam-reconciliation.js";
export * from "./matrix-gateway.js";
export * from "./release-service.js";
export * from "./repositories.js";
