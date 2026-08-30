import { immutableCopy } from "./immutable.js";

function defaultId() {
  return globalThis.crypto?.randomUUID?.() ?? `audit-${Date.now()}-${Math.random()}`;
}

export class AuditLedger {
  #events = [];
  #clock;
  #idFactory;

  constructor({ clock = () => new Date(), idFactory = defaultId } = {}) {
    this.#clock = clock;
    this.#idFactory = idFactory;
  }

  record(input) {
    const event = immutableCopy({
      eventId: String(input.eventId ?? this.#idFactory()),
      timestamp: String(input.timestamp ?? this.#clock().toISOString()),
      actor: String(input.actor ?? "SYSTEM"),
      role: String(input.role ?? "SYSTEM"),
      sessionId: input.sessionId == null ? null : String(input.sessionId),
      entityType: String(input.entityType),
      entityId: String(input.entityId),
      action: String(input.action),
      previousState: input.previousState == null ? null : String(input.previousState),
      newState: input.newState == null ? null : String(input.newState),
      reason: input.reason == null ? null : String(input.reason),
      requestId: input.requestId == null ? null : String(input.requestId),
      version: String(input.version ?? "1.0.0"),
      evidenceId: input.evidenceId == null ? null : String(input.evidenceId)
    });
    this.#events.push(event);
    return event;
  }

  list(predicate = () => true) {
    return this.#events.filter(predicate);
  }
}
