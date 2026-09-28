/**
 * Parámetros del agente de ocupaciones.
 *
 * Todo lo que decide cómo razona el agente vive aquí, versionado: qué modelos,
 * en qué orden, con cuánto esfuerzo, con qué topes. Del entorno sólo se leen
 * las llaves. Cambiar un modelo o un tope es un cambio de código con su
 * revisión, y `VERSION_DEL_AGENTE` sube con él; cada sugerencia lleva la versión
 * y la huella con que se hizo.
 *
 * Por qué estos modelos (medido el 2026-09-26, todo por OpenRouter y gratis):
 *
 * - **Principal: `nvidia/nemotron-3-super-120b-a12b:free`.** Razona, admite
 *   esquema estricto y respondió en la primera prueba: 552081900, subárea 05.5,
 *   para «*OPERARIO 2°» de Higiénicos, en ~35 s por caso.
 * - **Verificador: `dots-studio/dots-3-note-preview:free`, con respaldo en
 *   `qwen/qwen3.8-27b:free`.** Otras familias, para que la segunda opinión no
 *   repita el sesgo de la primera. Dots coincidió con Nemotron en la prueba,
 *   con ~60 s por caso; es una versión «preview» y por eso lleva respaldo.
 *   Ninguno de los dos cae nunca en Nemotron: dos opiniones del mismo modelo
 *   serían una.
 * - **Gemma quedó fuera.** Su cupo gratuito lo comparten todos los usuarios de
 *   OpenRouter y devolvió 429 en cada intento; el departamento decidió no
 *   conectar una llave propia de Google.
 *
 * Los dos papeles corren a la vez: juntos tardan lo que el más lento, ~60 s,
 * dentro de los 120 s que da la función publicada.
 *
 * Tope del plan gratuito de OpenRouter: 20 peticiones por minuto y 50 por día
 * (1 000 por día tras una compra única de 10 dólares en créditos). Un caso usa
 * cuatro peticiones, así que el plan gratuito alcanza para unos 12 casos al día.
 *
 * Los proveedores gratuitos no prometen privacidad: sólo viajan puesto y centro
 * de costos, nunca datos de una persona. Los planes cambian sin aviso;
 * reemplazar un modelo es editar este archivo, subir la versión y volver a
 * evaluar.
 */

import type {
  DestinoDeModelo,
  EsfuerzoDeRazonamiento,
  OpcionesDelRespaldo,
} from "../adapters/ia/chat-compatible.ts";
import type { LimitesDelAgente } from "../domain/ocupaciones/agente.ts";
import type { LimitesDelLote } from "../domain/ocupaciones/lote.ts";
import { ConfigError, type EnvSource } from "./environment.ts";

export const VERSION_DEL_AGENTE = "2026-09-26.6";

const OPENROUTER = "https://openrouter.ai/api/v1";

/**
 * Lo que OpenRouter recibe en cada petición, además de lo común:
 *
 * - `reasoning.effort: "high"`: el modelo razona antes de contestar.
 *   `exclude: true` hace que ese razonamiento no regrese en la respuesta: no
 *   viaja de vuelta ni se guarda, sólo se cuentan sus tokens.
 * - `provider.require_parameters`: OpenRouter sólo enruta a proveedores que
 *   respetan todo lo pedido, incluido el formato JSON. Sin esto podría elegir
 *   uno que lo ignore en silencio.
 */
const EN_OPENROUTER = {
  reasoning: { effort: "high", exclude: true },
  provider: { require_parameters: true },
} as const;

interface ModeloDeclarado {
  readonly proveedor: string;
  readonly url: string;
  readonly modelo: string;
  /** Variable de entorno con la llave. El valor nunca se escribe en el árbol. */
  readonly variableDeLlave: string;
  readonly esfuerzo?: EsfuerzoDeRazonamiento;
  readonly formato: "json_schema" | "json_object";
  readonly campoDeTope?: "max_tokens" | "max_completion_tokens";
  readonly extras?: Readonly<Record<string, unknown>>;
}

const PRINCIPAL: readonly ModeloDeclarado[] = [
  {
    proveedor: "openrouter",
    url: OPENROUTER,
    modelo: "nvidia/nemotron-3-super-120b-a12b:free",
    variableDeLlave: "KCM_IA_OPENROUTER_LLAVE",
    formato: "json_schema",
    campoDeTope: "max_tokens",
    extras: EN_OPENROUTER,
  },
];

const VERIFICADOR: readonly ModeloDeclarado[] = [
  {
    proveedor: "openrouter",
    url: OPENROUTER,
    modelo: "dots-studio/dots-3-note-preview:free",
    variableDeLlave: "KCM_IA_OPENROUTER_LLAVE",
    formato: "json_schema",
    campoDeTope: "max_tokens",
    extras: EN_OPENROUTER,
  },
  {
    proveedor: "openrouter",
    url: OPENROUTER,
    modelo: "qwen/qwen3.8-27b:free",
    variableDeLlave: "KCM_IA_OPENROUTER_LLAVE",
    formato: "json_schema",
    campoDeTope: "max_tokens",
    extras: EN_OPENROUTER,
  },
];

/**
 * Tope de salida y de espera de cada llamada individual. El razonamiento cuenta
 * dentro del tope: con 6 000, una tanda de seis casos gastó 5 655 (3 804 de
 * razonamiento) y a veces se cortaba antes de cerrar el JSON. 16 000 deja
 * holgura; el modelo se detiene cuando termina, el tope sólo evita el corte.
 */
const POR_LLAMADA = { maxTokensDeSalida: 16_000, tiempoMaximoMs: 70_000 } as const;

export const LIMITES_DEL_AGENTE: LimitesDelAgente = {
  maxSubareas: 2,
  // ~3 000 tokens de opciones por llamada: comparar pocas a la vez razona mejor.
  maxOpciones: 260,
  reintentosPorCodigoInvalido: 1,
  // Un solo reintento: cada intento fallido también gasta del cupo diario gratuito.
  intentosPorLlamada: 2,
  esperaInicialMs: 5000,
  limiteDePasos: 20,
  // Por debajo de los 120 s que la función publicada da a una petición.
  tiempoMaximoMs: 105_000,
  // Una llamada a estos modelos no baja de ~15 s; con menos, ni se empieza.
  tiempoMinimoPorLlamadaMs: 15_000,
};

/**
 * Topes del botón «Clasificar faltantes», que clasifica por lotes.
 *
 * - Subáreas de 20 casos por petición: es la pregunta fácil, 55 opciones.
 * - Ocupación de 4 casos por petición, agrupados por subárea: pocas opciones y
 *   pocos casos a la vez, para que el lote no le quite atención a cada caso.
 * - Dos tandas en vuelo por papel: con los dos papeles son cuatro peticiones a
 *   la vez, lejos de las 20 por minuto del plan gratuito.
 * - Cada paso dura hasta 95 s y sólo empieza una tanda si cabe su llamada
 *   entera; Excel vuelve a llamar hasta terminar.
 */
export const LIMITES_DEL_LOTE: LimitesDelLote = {
  // El cupo gratuito da 50 peticiones al día. En la prueba real, 8 casos
  // gastaron 10; 30 dejan margen para reintentos y consultas sueltas. En el
  // padrón de la semana 31, las 30 combinaciones más frecuentes cubren a 1 264
  // de 1 683 trabajadores.
  casosPorCorrida: 30,
  casosPorTandaDeSubarea: 20,
  casosPorTandaDeOcupacion: 4,
  tandasEnParaleloPorPapel: 2,
  maxSubareas: LIMITES_DEL_AGENTE.maxSubareas,
  maxOpciones: LIMITES_DEL_AGENTE.maxOpciones,
  intentosPorCaso: 2,
  fallasSeguidasPorPapel: 3,
  // Cada tanda fallida parte a la siguiente en dos: 20, 10, 5 y 2 casos en la
  // subárea; 4, 2 y 1 en la ocupación.
  tandasFallidasPorCaso: 4,
  // 5 s, 10 s y 20 s: un parpadeo del proveedor no tira al papel.
  esperaTrasFallaMs: 5000,
  tiempoPorPasoMs: 95_000,
  // Una tanda sólo empieza si cabe su llamada entera. Cortada por el fin del
  // paso, la petición ya gastó cupo y además contaría como falla del proveedor.
  tiempoMinimoPorTandaMs: POR_LLAMADA.tiempoMaximoMs,
  limiteDePasos: 200,
};

/**
 * La cadena del verificador. Un modelo que no contestó a tiempo o se quedó sin
 * cupo se salta cinco minutos, y mientras tanto su respaldo recibe el tiempo
 * completo. Con menos de 15 s por delante no se empieza ninguno.
 */
export const RESPALDO: OpcionesDelRespaldo = { enfriamientoMs: 300_000, tiempoMinimoMs: 15_000 };

export interface ParametrosDelAgente {
  readonly version: string;
  readonly principal: readonly DestinoDeModelo[];
  readonly verificador: readonly DestinoDeModelo[];
  readonly limites: LimitesDelAgente;
  readonly lote: LimitesDelLote;
  readonly respaldo: OpcionesDelRespaldo;
}

/**
 * Variables que harían que LangChain mandara la traza de cada corrida a
 * LangSmith, fuera de la plataforma. Con cualquiera activa no se arranca.
 */
const TRAZADO_EXTERNO = [
  "LANGSMITH_TRACING",
  "LANGSMITH_TRACING_V2",
  "LANGCHAIN_TRACING",
  "LANGCHAIN_TRACING_V2",
] as const;

function resolver(
  declarados: readonly ModeloDeclarado[],
  source: EnvSource,
): readonly DestinoDeModelo[] {
  const destinos: DestinoDeModelo[] = [];
  for (const declarado of declarados) {
    const llave = source[declarado.variableDeLlave]?.trim();
    if (!llave) continue;
    destinos.push({
      proveedor: declarado.proveedor,
      url: declarado.url,
      modelo: declarado.modelo,
      llave,
      formato: declarado.formato,
      ...(declarado.esfuerzo ? { esfuerzo: declarado.esfuerzo } : {}),
      ...(declarado.campoDeTope ? { campoDeTope: declarado.campoDeTope } : {}),
      ...(declarado.extras ? { extras: declarado.extras } : {}),
      ...POR_LLAMADA,
    });
  }
  return destinos;
}

/**
 * Los modelos con llave en el entorno, o `undefined` si no hay ninguno para el
 * papel principal: sin llave el agente no existe y su ruta lo explica.
 */
export function leerAgenteDelEntorno(
  source: EnvSource = process.env,
): ParametrosDelAgente | undefined {
  const principal = resolver(PRINCIPAL, source);
  if (principal.length === 0) return undefined;

  // Sólo se vigila con el agente encendido: sin llave, LangChain nunca se carga.
  const activa = TRAZADO_EXTERNO.find((nombre) =>
    ["true", "1", "yes"].includes((source[nombre] ?? "").trim().toLowerCase()),
  );
  if (activa) {
    throw new ConfigError(
      `${activa} está activa: la traza del agente de ocupaciones saldría a LangSmith. ` +
        "La traza vive sólo en la plataforma; la variable se quita del entorno.",
    );
  }

  return {
    version: VERSION_DEL_AGENTE,
    principal,
    verificador: resolver(VERIFICADOR, source),
    limites: LIMITES_DEL_AGENTE,
    lote: LIMITES_DEL_LOTE,
    respaldo: RESPALDO,
  };
}
