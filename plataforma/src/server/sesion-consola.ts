/**
 * Sesión de la consola central.
 *
 * Lo que hay aquí es deliberadamente poco: una cookie firmada con HMAC que dice
 * quién entró por `/acceso` y hasta cuándo. No hay directorio de identidad, no
 * hay roles y no cierra ninguna pantalla: las rutas de la consola siguen
 * respondiendo igual con o sin sesión. Es lo acordado para la corrida piloto.
 *
 * La llave se sortea al arrancar el proceso y nunca se escribe. Consecuencia
 * buscada: reiniciar el servidor invalida todas las sesiones abiertas, que es
 * exactamente lo que se quiere de una credencial de prueba.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const NOMBRE_DE_COOKIE = "kcm_sesion";
const DURACION_MS = 8 * 60 * 60 * 1000;

export interface SesionDeConsola {
  readonly usuario: string;
  readonly expiraEn: string;
}

export class ConsoleSessionCodec {
  private readonly llave: Buffer;

  constructor(llave: Buffer = randomBytes(32)) {
    this.llave = llave;
  }

  /** Devuelve el valor completo de la cabecera `set-cookie`. */
  emitir(usuario: string, ahora: Date, seguro: boolean): string {
    const sesion: SesionDeConsola = {
      usuario,
      expiraEn: new Date(ahora.getTime() + DURACION_MS).toISOString(),
    };
    const cuerpo = Buffer.from(JSON.stringify(sesion)).toString("base64url");
    const valor = `${cuerpo}.${this.firmar(cuerpo)}`;
    return this.cookie(valor, Math.floor(DURACION_MS / 1000), seguro);
  }

  /** Cookie vacía y vencida: es la única forma de cerrar sesión sin estado. */
  revocar(seguro: boolean): string {
    return this.cookie("", 0, seguro);
  }

  /** `undefined` ante cualquier duda: firma alterada, cuerpo ilegible o vencida. */
  leer(cabeceraCookie: string | undefined, ahora: Date): SesionDeConsola | undefined {
    const valor = extraerCookie(cabeceraCookie, NOMBRE_DE_COOKIE);
    if (valor === undefined) return undefined;

    const [cuerpo = "", firma = ""] = valor.split(".");
    const esperada = this.firmar(cuerpo);
    if (!igualEnTiempoConstante(firma, esperada)) return undefined;

    try {
      const sesion = JSON.parse(
        Buffer.from(cuerpo, "base64url").toString("utf8"),
      ) as SesionDeConsola;
      if (typeof sesion.usuario !== "string" || sesion.usuario === "") return undefined;
      const vence = Date.parse(sesion.expiraEn);
      if (Number.isNaN(vence) || vence <= ahora.getTime()) return undefined;
      return sesion;
    } catch {
      return undefined;
    }
  }

  private firmar(cuerpo: string): string {
    return createHmac("sha256", this.llave).update(cuerpo).digest("base64url");
  }

  private cookie(valor: string, maxAge: number, seguro: boolean): string {
    const partes = [
      `${NOMBRE_DE_COOKIE}=${valor}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${String(maxAge)}`,
    ];
    // Sin HTTPS no se puede marcar `Secure`, o el navegador descarta la cookie
    // y la sesión del piloto en `localhost` nunca llegaría a existir.
    if (seguro) partes.push("Secure");
    return partes.join("; ");
  }
}

function extraerCookie(cabecera: string | undefined, nombre: string): string | undefined {
  if (!cabecera) return undefined;
  for (const par of cabecera.split(";")) {
    const separador = par.indexOf("=");
    if (separador === -1) continue;
    if (par.slice(0, separador).trim() !== nombre) continue;
    return par.slice(separador + 1).trim();
  }
  return undefined;
}

/**
 * Comparación de secretos sin fuga por tiempo. `timingSafeEqual` exige la misma
 * longitud, así que las cadenas se resumen antes: comparar los resúmenes es
 * comparar longitud y contenido a la vez.
 */
export function igualEnTiempoConstante(recibido: string, esperado: string): boolean {
  const a = createHmac("sha256", "kcm-comparacion").update(recibido).digest();
  const b = createHmac("sha256", "kcm-comparacion").update(esperado).digest();
  return timingSafeEqual(a, b);
}
