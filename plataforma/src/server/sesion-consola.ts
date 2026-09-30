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

  emitir(usuario: string, ahora: Date, seguro: boolean): string {
    const sesion: SesionDeConsola = {
      usuario,
      expiraEn: new Date(ahora.getTime() + DURACION_MS).toISOString(),
    };
    const cuerpo = Buffer.from(JSON.stringify(sesion)).toString("base64url");
    const valor = `${cuerpo}.${this.firmar(cuerpo)}`;
    return this.cookie(valor, Math.floor(DURACION_MS / 1000), seguro);
  }

  revocar(seguro: boolean): string {
    return this.cookie("", 0, seguro);
  }

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

export function igualEnTiempoConstante(recibido: string, esperado: string): boolean {
  const a = createHmac("sha256", "kcm-comparacion").update(recibido).digest();
  const b = createHmac("sha256", "kcm-comparacion").update(esperado).digest();
  return timingSafeEqual(a, b);
}
