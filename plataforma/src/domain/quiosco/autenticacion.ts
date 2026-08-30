/**
 * Servicio de autenticación y autorización del Quiosco (Función 1).
 * Implementa la segunda contraseña: alcances separados para registrarse vs abrir sesión,
 * con auditoría y secretos independientes .
 */

import { createHmac, randomBytes } from "node:crypto";
import type { Clock } from "../../ports/reloj.ts";
import type { KioskSessionRepositoryPort } from "../../ports/quiosco.port.ts";
import { igualEnTiempoConstante } from "../../server/sesion-consola.ts";
import { KioskAuthError, RateLimitExceededError } from "./errores.ts";
import type { ActorIdentity, SecretScope } from "./tipos.ts";

/** Cuerpo de la concesión de `/api/kiosk/unlock`, tal como lo firma `signGrant`. */
export interface KioskGrantPayload {
  readonly role?: string | undefined;
  readonly expiresAt?: string | undefined;
  readonly stationLabel?: string | undefined;
  readonly nonce?: string | undefined;
}

export interface KioskTokenPayload {
  readonly sessionId: string;
  readonly issuedBy: string;
  readonly stationLabel?: string | undefined;
  readonly expiresAt: string;
  readonly nonce: string;
}

export interface KioskAuthDeps {
  readonly repository: KioskSessionRepositoryPort;
  readonly clock: Clock;
  readonly tokenSecret: string;
  readonly maxPinAttempts?: number;
  /**
   * Contraseñas de la corrida piloto, por alcance. Donde hay una declarada
   * manda ella y el secreto de la base no se consulta: dos fuentes válidas a
   * la vez darían dos contraseñas correctas y ninguna forma de saber cuál se
   * usó. La configuración las prohíbe en producción.
   */
  readonly pilotSecrets?: Partial<Record<SecretScope, string>>;
  /**
   * Acceso abierto de prueba. Cualquier PIN se acepta —incluido el vacío— y la
   * bitácora lo registra igual, con el motivo diciendo que la compuerta estaba
   * abierta. La configuración lo prohíbe en producción.
   */
  readonly openAccess?: boolean;
}

export class KioskAuthService {
  private readonly repo: KioskSessionRepositoryPort;
  private readonly clock: Clock;
  private readonly tokenSecret: string;
  private readonly maxPinAttempts: number;
  private readonly pilotSecrets: Partial<Record<SecretScope, string>>;
  private readonly openAccess: boolean;
  private readonly rateLimits = new Map<string, { attempts: number; resetAt: number }>();

  constructor(deps: KioskAuthDeps) {
    this.repo = deps.repository;
    this.clock = deps.clock;
    this.tokenSecret = deps.tokenSecret;
    this.maxPinAttempts = deps.maxPinAttempts ?? 10;
    this.pilotSecrets = deps.pilotSecrets ?? {};
    this.openAccess = deps.openAccess ?? false;
  }

  /** Verifica contra la contraseña de piloto si la hay; si no, contra la base. */
  private async verifySecret(scope: SecretScope, candidate: string): Promise<boolean> {
    if (this.openAccess) return true;
    const piloto = this.pilotSecrets[scope];
    if (piloto !== undefined) return igualEnTiempoConstante(candidate, piloto);
    return this.repo.verifySecret(scope, candidate);
  }

  private checkRateLimit(key: string, limit: number, windowMs: number): void {
    // Con el acceso abierto no hay PIN que adivinar, y el límite sólo estorbaría
    // a quien está recorriendo la plataforma de prueba.
    if (this.openAccess) return;
    const now = this.clock.now().getTime();
    const entry = this.rateLimits.get(key);
    if (entry && entry.resetAt > now) {
      if (entry.attempts >= limit) {
        throw new RateLimitExceededError("Demasiados intentos de PIN; espere cinco minutos.");
      }
      entry.attempts += 1;
    } else {
      this.rateLimits.set(key, { attempts: 1, resetAt: now + windowMs });
    }
  }

  private resetRateLimit(key: string): void {
    this.rateLimits.delete(key);
  }

  /**
   * Valida la primera contraseña: PIN del Quiosco para registro de participantes (Secret 1).
   */
  async unlockKiosk(
    pin: string,
    stationLabel?: string,
  ): Promise<{ grant: string; expiresAt: string }> {
    const rateLimitKey = "kiosk-pin:global";
    this.checkRateLimit(rateLimitKey, this.maxPinAttempts, 5 * 60 * 1000);

    const valid = await this.verifySecret("REGISTRO_QUIOSCO", pin);
    const kioskIdentity: ActorIdentity = { actor: "KIOSK", role: "KIOSK" };

    if (!valid) {
      await this.repo.recordAudit({
        actor: kioskIdentity.actor,
        role: kioskIdentity.role,
        entityType: "Access",
        entityId: "KIOSK_PIN",
        action: "KIOSK_PIN_REJECTED",
        newState: "DENEGADO",
        reason: stationLabel ? `ESTACION:${stationLabel}` : "",
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });
      throw new KioskAuthError("El PIN del quiosco no es correcto.");
    }

    this.resetRateLimit(rateLimitKey);

    await this.repo.recordAudit({
      actor: kioskIdentity.actor,
      role: kioskIdentity.role,
      entityType: "Access",
      entityId: "KIOSK_PIN",
      action: "KIOSK_PIN_ACCEPTED",
      newState: "AUTORIZADO",
      reason: stationLabel ? `ESTACION:${stationLabel}` : "",
      provenance: "PLATAFORMA",
      contractVersion: "1.0.0",
    });

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + 120 * 60 * 1000).toISOString();
    const grant = this.signGrant("KIOSK", expiresAt, stationLabel);

    return { grant, expiresAt };
  }

  /**
   * Valida la segunda contraseña: PIN de apertura / lanzamiento de sesión en sala (Secret 2).
   */
  async verifySessionLaunchSecret(
    pin: string,
    sessionId?: string,
    stationLabel?: string,
  ): Promise<boolean> {
    const rateLimitKey = `session-pin:${stationLabel || "global"}`;
    this.checkRateLimit(rateLimitKey, 5, 5 * 60 * 1000);

    const valid = await this.verifySecret("APERTURA_SESION", pin);
    const identity: ActorIdentity = { actor: "SALA_QUIOSCO", role: "CAPACITADOR" };

    if (!valid) {
      await this.repo.recordAudit({
        actor: identity.actor,
        role: identity.role,
        entityType: "Access",
        entityId: "SESSION_LAUNCH_PIN",
        action: "SESSION_PIN_REJECTED",
        newState: "DENEGADO",
        sessionId,
        reason: stationLabel ? `ESTACION:${stationLabel}` : "",
        provenance: "PLATAFORMA",
        contractVersion: "1.0.0",
      });
      throw new KioskAuthError("El PIN de apertura de sesión no es correcto.");
    }

    this.resetRateLimit(rateLimitKey);

    await this.repo.recordAudit({
      actor: identity.actor,
      role: identity.role,
      entityType: "Access",
      entityId: "SESSION_LAUNCH_PIN",
      action: "SESSION_PIN_ACCEPTED",
      newState: "AUTORIZADO",
      sessionId,
      reason: stationLabel ? `ESTACION:${stationLabel}` : "",
      provenance: "PLATAFORMA",
      contractVersion: "1.0.0",
    });

    return true;
  }

  /**
   * Emite un token HMAC firmado para la estación del quiosco ligado a una sesión específica.
   */
  createKioskToken(
    sessionId: string,
    stationLabel?: string,
    minutes = 120,
  ): { token: string; expiresAt: string } {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
    const payload: KioskTokenPayload = {
      sessionId,
      issuedBy: "KIOSK",
      stationLabel,
      expiresAt,
      nonce: randomBytes(16).toString("hex"),
    };

    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const hmac = createHmac("sha256", this.tokenSecret).update(payloadBase64).digest("base64url");
    const token = `${payloadBase64}.${hmac}`;

    return { token, expiresAt };
  }

  /**
   * Verifica la validez y firma del token del quiosco.
   */
  verifyKioskToken(token: string, expectedSessionId?: string): KioskTokenPayload {
    if (!token || typeof token !== "string" || !token.includes(".")) {
      throw new KioskAuthError("Token de quiosco malformado");
    }

    const [payloadBase64 = "", signature = ""] = token.split(".");
    const expectedSig = createHmac("sha256", this.tokenSecret)
      .update(payloadBase64)
      .digest("base64url");
    if (signature !== expectedSig) {
      throw new KioskAuthError("Firma de token de quiosco inválida");
    }

    let payload: KioskTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(payloadBase64, "base64url").toString("utf8"),
      ) as KioskTokenPayload;
    } catch {
      throw new KioskAuthError("Cuerpo de token ilegible");
    }

    const now = this.clock.now().getTime();
    const exp = Date.parse(payload.expiresAt);
    if (isNaN(exp) || exp < now) {
      throw new KioskAuthError("El token de quiosco ha expirado");
    }

    if (expectedSessionId && payload.sessionId !== expectedSessionId) {
      throw new KioskAuthError("El token no corresponde a la sesión indicada");
    }

    return payload;
  }

  private signGrant(role: string, expiresAt: string, stationLabel?: string): string {
    const data = JSON.stringify({
      role,
      expiresAt,
      stationLabel,
      nonce: randomBytes(8).toString("hex"),
    });
    const b64 = Buffer.from(data).toString("base64url");
    const sig = createHmac("sha256", this.tokenSecret).update(b64).digest("base64url");
    return `${b64}.${sig}`;
  }

  /**
   * Verifica la concesión que emite `/api/kiosk/unlock`.
   *
   * Se escribió con la misma forma que `verifyKioskToken`, que era la correcta,
   * después de que esta gemela acumulara tres defectos que se tapaban entre sí:
   *
   * 1. La comprobación de vencimiento vivía dentro del `try`, así que su
   *    propio `throw` lo atrapaba el `catch` de abajo y una concesión vencida se
   *    reportaba como «ilegible». Quien depurara por qué el quiosco no abre leía
   *    la causa equivocada.
   * 2. Sin guarda `isNaN`. `Date.parse(undefined)` da `NaN` y `NaN < ahora`
   *    es falso, de modo que una concesión sin `expiresAt` no vencía nunca.
   * 3. Comparación de firma con `!==`, cuando el archivo ya importa
   *    `igualEnTiempoConstante` y lo usa unas líneas más arriba.
   */
  verifyGrant(grant: string): { role: string; stationLabel?: string | undefined } {
    if (!grant || typeof grant !== "string" || !grant.includes(".")) {
      throw new KioskAuthError("Concesión de quiosco inválida o ausente");
    }
    const [b64 = "", sig = ""] = grant.split(".");
    const expectedSig = createHmac("sha256", this.tokenSecret).update(b64).digest("base64url");
    if (!igualEnTiempoConstante(sig, expectedSig)) {
      throw new KioskAuthError("Firma de concesión alterada");
    }

    let parsed: KioskGrantPayload;
    try {
      parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as KioskGrantPayload;
    } catch {
      throw new KioskAuthError("Concesión ilegible");
    }

    const vence = Date.parse(parsed.expiresAt ?? "");
    if (isNaN(vence) || vence < this.clock.now().getTime()) {
      throw new KioskAuthError("La concesión ha expirado");
    }
    if (typeof parsed.role !== "string" || parsed.role === "") {
      throw new KioskAuthError("Concesión sin alcance declarado");
    }

    return { role: parsed.role, stationLabel: parsed.stationLabel };
  }
}
