export type EnvironmentName = "development" | "staging" | "production";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export type DeploymentRole = "local" | "nube";

export interface PilotCredentials {
  readonly consoleUser?: string;
  readonly consolePassword?: string;
  readonly roomPassword?: string;
  readonly kioskPin?: string;
  readonly sessionLaunchPin?: string;
  readonly openAccess: boolean;
}

export interface AppConfig {
  readonly environment: EnvironmentName;
  readonly role: DeploymentRole;
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly requestTimeoutMs: number;
  readonly trustedProxyHops: number;
  readonly databaseUrl?: string;
  readonly pilot: PilotCredentials;
  readonly roomPassword?: string;
  readonly dedicatedHosts: {
    readonly kiosk: readonly string[];
    readonly agenda: readonly string[];
  };
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const ENTORNOS: readonly EnvironmentName[] = ["development", "staging", "production"];
const NIVELES: readonly LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace"];
const PAPELES: readonly DeploymentRole[] = ["local", "nube"];

const DIRECCIONES_LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function loadConfig(source: EnvSource = process.env): AppConfig {
  const environment = leerEnumerado("KCM_ENV", source.KCM_ENV, ENTORNOS, "development");
  const role = leerEnumerado("KCM_ROLE", source.KCM_ROLE, PAPELES, "local");
  const host = (source.KCM_HOST ?? "127.0.0.1").trim();
  const port = leerPuerto("KCM_PORT", source.KCM_PORT, 8787);
  const logLevel = leerEnumerado(
    "KCM_LOG_LEVEL",
    source.KCM_LOG_LEVEL,
    NIVELES,
    environment === "production" ? "info" : "debug",
  );
  const requestTimeoutMs = leerEnteroPositivo(
    "KCM_REQUEST_TIMEOUT_MS",
    source.KCM_REQUEST_TIMEOUT_MS,
    30_000,
  );
  const trustedProxyHops = leerSaltosDeProxy("KCM_TRUST_PROXY", source.KCM_TRUST_PROXY);

  if (host === "") {
    throw new ConfigError("KCM_HOST no puede estar vacío.");
  }

  const permitePublico = leerBandera("KCM_ALLOW_PUBLIC_BIND", source.KCM_ALLOW_PUBLIC_BIND);
  if (environment === "production" && !DIRECCIONES_LOOPBACK.has(host) && !permitePublico) {
    throw new ConfigError(
      `En producción KCM_HOST debe ser loopback (recibido ${host}). La plataforma se publica por túnel ` +
        "nombrado hacia 127.0.0.1. Para escuchar en otra interfaz hay que declararlo con KCM_ALLOW_PUBLIC_BIND=1.",
    );
  }

  const databaseUrl = (source.KCM_DATABASE_URL ?? "").trim();
  if (databaseUrl !== "" && !/^postgres(ql)?:\/\//u.test(databaseUrl)) {
    throw new ConfigError("KCM_DATABASE_URL debe ser una URI postgresql://.");
  }
  if (environment === "production" && databaseUrl === "") {
    throw new ConfigError(
      "En producción KCM_DATABASE_URL es obligatoria: sin base, la plataforma perdería " +
        "asistencias, liberaciones y auditoría al reiniciar.",
    );
  }

  const roomPassword = (source.KCM_ROOM_PASSWORD ?? "").trim();
  if (role === "nube" && roomPassword === "") {
    throw new ConfigError(
      "En la nube KCM_ROOM_PASSWORD es obligatoria: /agenda es pública y sin clave cualquiera " +
        "podría reservar o cancelar una sala desde internet.",
    );
  }

  const dominios = (valor: string | undefined): string[] =>
    (valor ?? "")
      .split(",")
      .map((dominio) => dominio.trim().toLowerCase())
      .filter((dominio) => dominio !== "");

  return {
    environment,
    role,
    host,
    port,
    logLevel,
    requestTimeoutMs,
    trustedProxyHops,
    ...(databaseUrl === "" ? {} : { databaseUrl }),
    pilot: leerCredencialesDePiloto(source, environment),
    ...(roomPassword === "" ? {} : { roomPassword }),
    dedicatedHosts: {
      kiosk: dominios(source.KCM_DOMINIO_QUIOSCO),
      agenda: dominios(source.KCM_DOMINIO_AGENDA),
    },
  };
}

const VARIABLES_DE_PILOTO = {
  consoleUser: "KCM_PILOT_CONSOLE_USER",
  consolePassword: "KCM_PILOT_CONSOLE_PASSWORD",
  roomPassword: "KCM_PILOT_ROOM_PASSWORD",
  kioskPin: "KCM_PILOT_KIOSK_PIN",
  sessionLaunchPin: "KCM_PILOT_SESSION_PIN",
} as const satisfies Record<Exclude<keyof PilotCredentials, "openAccess">, string>;

const VARIABLE_DE_ACCESO_ABIERTO = "KCM_PILOT_OPEN_ACCESS";

function leerCredencialesDePiloto(
  source: EnvSource,
  environment: EnvironmentName,
): PilotCredentials {
  const entradas = Object.entries(VARIABLES_DE_PILOTO);
  const definidas = entradas.filter(([, variable]) => (source[variable] ?? "").trim() !== "");
  const accesoAbierto = leerBandera(VARIABLE_DE_ACCESO_ABIERTO, source[VARIABLE_DE_ACCESO_ABIERTO]);

  const declaradas = [
    ...definidas.map(([, variable]) => variable),
    ...(accesoAbierto ? [VARIABLE_DE_ACCESO_ABIERTO] : []),
  ];
  if (environment === "production" && declaradas.length > 0) {
    throw new ConfigError(
      `Las credenciales de piloto no pueden existir en producción (${declaradas.join(", ")}). ` +
        "Son contraseñas planas sin directorio ni rotación: " +
        "sirvieron para la prueba del 2026-08-03 y deben retirarse del entorno antes de operar.",
    );
  }

  const credenciales: Record<string, string | boolean> = { openAccess: accesoAbierto };
  for (const [campo, variable] of definidas) {
    credenciales[campo] = (source[variable] ?? "").trim();
  }

  const tieneUsuario = credenciales.consoleUser !== undefined;
  const tieneClave = credenciales.consolePassword !== undefined;
  if (tieneUsuario !== tieneClave) {
    throw new ConfigError(
      `${VARIABLES_DE_PILOTO.consoleUser} y ${VARIABLES_DE_PILOTO.consolePassword} se declaran juntas o no se declaran.`,
    );
  }

  return credenciales as unknown as PilotCredentials;
}

export function requireSecret(name: string, source: EnvSource = process.env): string {
  const valor = source[name];
  if (valor === undefined || valor.trim() === "") {
    throw new ConfigError(
      `Falta el secreto ${name}. Se lee del entorno; nunca del árbol de trabajo.`,
    );
  }
  return valor;
}

function leerEnumerado<T extends string>(
  name: string,
  valor: string | undefined,
  permitidos: readonly T[],
  porOmision: T,
): T {
  if (valor === undefined || valor.trim() === "") return porOmision;
  const normalizado = valor.trim().toLowerCase();
  const encontrado = permitidos.find((permitido) => permitido === normalizado);
  if (encontrado === undefined) {
    throw new ConfigError(`${name} debe ser uno de: ${permitidos.join(", ")}. Recibido: ${valor}`);
  }
  return encontrado;
}

const SOLO_DIGITOS = /^\d+$/u;

function leerEntero(name: string, valor: string, descripcion: string): number {
  if (!SOLO_DIGITOS.test(valor.trim())) {
    throw new ConfigError(`${name} debe ser ${descripcion}. Recibido: ${valor}`);
  }
  return Number(valor.trim());
}

function leerPuerto(name: string, valor: string | undefined, porOmision: number): number {
  if (valor === undefined || valor.trim() === "") return porOmision;
  const numero = leerEntero(name, valor, "un entero entre 1024 y 65535");
  if (numero < 1024 || numero > 65535) {
    throw new ConfigError(`${name} debe ser un entero entre 1024 y 65535. Recibido: ${valor}`);
  }
  return numero;
}

function leerEnteroPositivo(name: string, valor: string | undefined, porOmision: number): number {
  if (valor === undefined || valor.trim() === "") return porOmision;
  const numero = leerEntero(name, valor, "un entero positivo");
  if (numero <= 0) {
    throw new ConfigError(`${name} debe ser un entero positivo. Recibido: ${valor}`);
  }
  return numero;
}

function leerSaltosDeProxy(name: string, valor: string | undefined): number {
  if (valor === undefined || valor.trim() === "") return 0;
  const numero = leerEntero(name, valor, "un entero entre 0 y 10");
  if (numero > 10) {
    throw new ConfigError(`${name} debe ser un entero entre 0 y 10. Recibido: ${valor}`);
  }
  return numero;
}

function leerBandera(name: string, valor: string | undefined): boolean {
  if (valor === undefined || valor.trim() === "") return false;
  const normalizado = valor.trim().toLowerCase();
  if (normalizado === "1" || normalizado === "true") return true;
  if (normalizado === "0" || normalizado === "false") return false;
  throw new ConfigError(`${name} debe ser 1, 0, true o false. Recibido: ${valor}`);
}
