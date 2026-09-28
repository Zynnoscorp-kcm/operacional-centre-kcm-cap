/**
 * Configuración por entorno.
 *
 * Dos reglas fijan la forma de este archivo:
 *
 * 1. Ningún secreto vive en el árbol. Todo secreto se lee de una variable
 *    de entorno con `requireSecret`, que falla cerrado si falta. `.env` está
 *    ignorado por Git; `.env.example` documenta los nombres sin valores.
 * 2. Falla cerrado. Un valor ausente o inválido detiene el arranque. Nunca
 *    se sustituye por un valor plausible: un puerto que se corrige solo o un
 *    entorno que cae a `development` por omisión es un servidor que arranca
 *    mintiendo sobre dónde está.
 */

export type EnvironmentName = "development" | "staging" | "production";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

/**
 * Qué papel juega este proceso en un despliegue partido.
 *
 * `local` es el comportamiento histórico y el valor por omisión: un proceso que
 * lo hace todo, con disco propio y sin techo de tamaño en las peticiones. Es lo
 * que corre en el equipo del departamento y lo que corre en las pruebas.
 *
 * `nube` declara lo contrario: un proceso efímero, sin disco que sobreviva y
 * detrás de un alojamiento que corta las peticiones grandes —4.5 MB en Vercel,
 * y es un techo de la plataforma, no del plan contratado—. Ahí las dos
 * operaciones pesadas del ciclo se rechazan con su explicación en vez de
 * fallar por truncamiento a mitad de una carga:
 *
 * - el snapshot completo de la matriz (`MATRIX_IMPORT_V1`, `MATRIX_SCAN_V1`),
 * - el padrón semanal (`ROSTER_SCAN_V1` y la carga por `/padron`).
 *
 * Las constancias DC-3 se emiten en los dos papeles, con topes de tamaño
 * distintos: allá la respuesta tiene techo.
 *
 * Lo que **no** se cierra en la nube son las actualizaciones ligeras de fechas
 * —`RELEASE_ACK_V1` y las demás acciones acotadas del puente—, que son la
 * operación más frecuente del día y caben de sobra.
 *
 * Por omisión `local` y no `nube` por la regla de siempre: el valor por omisión
 * conserva el comportamiento existente, y publicar en un alojamiento con techos
 * es la decisión que hay que declarar.
 */
export type DeploymentRole = "local" | "nube";

/**
 * Credenciales de la corrida piloto.
 *
 * Son contraseñas planas leídas del entorno, sin directorio, sin rotación y sin
 * bitácora de intentos por persona. Existen para que la corrida piloto pueda
 * recorrerse de principio a fin y no son un mecanismo de autenticación.
 *
 * Por eso `loadConfig` rechaza el arranque si alguna de ellas está definida con
 * `KCM_ENV=production`: la única forma de que un `0000` llegue al despliegue
 * real sería que alguien copiara el `.env` del piloto, y ese arranque falla en
 * vez de quedar abierto.
 */
export interface PilotCredentials {
  /** Usuario y contraseña de `/acceso`. */
  readonly consoleUser?: string;
  readonly consolePassword?: string;
  /** Contraseña para agendar y cancelar en `/salas`. */
  readonly roomPassword?: string;
  /** PIN del quiosco y de apertura de sesión, mientras la base no tiene secretos. */
  readonly kioskPin?: string;
  readonly sessionLaunchPin?: string;
  /**
   * Acceso abierto de prueba (`KCM_PILOT_OPEN_ACCESS=1`).
   *
   * Con esto en `true` ninguna pantalla pide contraseña ni PIN: ni `/acceso`,
   * ni la agenda, ni el quiosco, ni la autorización de sesiones, y `/padron` y la
   * consola interna dejan de exigir sesión. Existe para poder recorrer la
   * plataforma completa en una corrida de prueba sin ir cargando credenciales
   * pantalla por pantalla.
   *
   * No es un ajuste: es una decisión que se declara en el entorno y que
   * `loadConfig` rechaza en producción, junto con las demás credenciales de
   * piloto. Todo lo que se haga con el acceso abierto queda en la bitácora con
   * el actor de servicio, no con una persona.
   */
  readonly openAccess: boolean;
}

export interface AppConfig {
  readonly environment: EnvironmentName;
  /** Papel en el despliegue partido. Ver `DeploymentRole`. */
  readonly role: DeploymentRole;
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  /** Corta una petición colgada antes de que agote un manejador del servidor. */
  readonly requestTimeoutMs: number;
  /**
   * Cuántos proxies propios hay delante del proceso.
   *
   * Decide de dónde sale `request.ip`, y con él la identidad del equipo en los
   * frenos por intentos. Con `0` —lo que vale por omisión— `request.ip` es la
   * dirección del socket: detrás de un túnel eso es la del túnel, igual para
   * todo el mundo, así que un freno por IP deja de distinguir equipos y pasa a
   * ser un solo cubo compartido por toda la planta.
   *
   * Con `n > 0` se toma el enésimo salto contado desde el proceso hacia afuera
   * en `x-forwarded-for`. Cuenta de saltos y no `true` a propósito: `true`
   * confía en la cadena entera, y esa cadena la empieza a escribir el cliente.
   * Quien llame directo podría entonces declarar la IP que quiera y estrenar un
   * cubo de intentos con cada petición, que es peor que no tener freno, porque
   * parece que sí lo hay.
   *
   * Por eso vale `0` mientras nadie lo declare: equivocarse hacia abajo agrupa
   * de más, y equivocarse hacia arriba deja pasar a cualquiera.
   */
  readonly trustedProxyHops: number;
  /**
   * Cadena de conexión a PostgreSQL. Ausente significa memoria: la
   * plataforma arranca igual y pierde todo al cerrar. Es lo correcto para
   * pruebas y lo inaceptable en producción, así que allí se exige.
   */
  readonly databaseUrl?: string;
  /**
   * Credenciales del piloto. Vacío significa que ninguna pantalla pide
   * contraseña de piloto: `/acceso` sigue respondiendo que no hay directorio y
   * `/salas` agenda sin clave, como antes de la prueba.
   */
  readonly pilot: PilotCredentials;
  /**
   * Contraseña de la agenda para producción (`KCM_ROOM_PASSWORD`).
   *
   * No es de piloto: `/agenda` es pública, y publicada en internet sin clave
   * cualquiera podría reservar o cancelar una sala. Por eso en la nube es
   * obligatoria. Donde falta, las rutas caen a la de piloto, como antes.
   */
  readonly roomPassword?: string;
  /**
   * Dominios propios del quiosco y de la agenda (`KCM_DOMINIO_QUIOSCO`,
   * `KCM_DOMINIO_AGENDA`, separados por coma). En ellos sólo responde su
   * pantalla; ver `server/dominios.ts`. Vacíos, todo vive en un solo dominio.
   */
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

/**
 * La plataforma se publica por un único FQDN, mediante túnel nombrado hacia
 * `127.0.0.1`. Escuchar en `0.0.0.0` en producción expondría el servidor por la
 * red corporativa saltándose el túnel, así que se prohíbe salvo declaración
 * explícita.
 */
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
  // Un despliegue productivo sin base persiste en memoria y pierde asistencias,
  // liberaciones y auditoría al primer reinicio. Se prohíbe explícitamente.
  if (environment === "production" && databaseUrl === "") {
    throw new ConfigError(
      "En producción KCM_DATABASE_URL es obligatoria: sin base, la plataforma perdería " +
        "asistencias, liberaciones y auditoría al reiniciar.",
    );
  }

  const roomPassword = (source.KCM_ROOM_PASSWORD ?? "").trim();
  // La agenda es pública. Publicada en la nube y sin clave, cualquiera en
  // internet podría reservar o cancelar: se exige antes de arrancar.
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

/** Nombre de variable por campo. El orden es el del acta de ajustes del piloto. */
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

  // El acceso abierto se prohíbe en producción por la misma razón que las
  // contraseñas planas, y con más motivo: deja la plataforma entera sin puerta.
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

  // Un usuario sin contraseña —o al revés— dejaría `/acceso` aceptando la mitad
  // de una credencial o rechazando siempre sin decir por qué.
  const tieneUsuario = credenciales.consoleUser !== undefined;
  const tieneClave = credenciales.consolePassword !== undefined;
  if (tieneUsuario !== tieneClave) {
    throw new ConfigError(
      `${VARIABLES_DE_PILOTO.consoleUser} y ${VARIABLES_DE_PILOTO.consolePassword} se declaran juntas o no se declaran.`,
    );
  }

  return credenciales as unknown as PilotCredentials;
}

/**
 * Lee un secreto. No tiene valor por omisión y nunca lo tendrá: un secreto con
 * valor por omisión es un secreto publicado.
 *
 * El andamiaje todavía no consume ninguno —no hay base de datos ni sesiones—,
 * pero la vía queda abierta y probada para que ninguna ejecución posterior
 * necesite inventarse la suya.
 */
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

/**
 * Sólo dígitos. `Number()` por sí solo acepta `1e4`, `0x2000`, ` 8080 ` e
 * `Infinity`, y los convierte en algo plausible: la comprobación con
 * `Number.isInteger` los deja pasar. Un puerto escrito como `1e4` es un error de
 * captura, no una notación alternativa.
 */
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

/**
 * Saltos de proxy de confianza. Cero es válido y es el valor por omisión, así
 * que no puede leerse con `leerEnteroPositivo`. El techo de diez no protege de
 * nada por sí mismo: está para que un `KCM_TRUST_PROXY=100` —que casi siempre
 * es un dedo de más— se detecte al arrancar y no seis meses después.
 */
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
