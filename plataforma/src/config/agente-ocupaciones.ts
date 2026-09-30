import type {
  DestinoDeModelo,
  EsfuerzoDeRazonamiento,
  OpcionesDelRespaldo,
} from "../adapters/ia/chat-compatible.ts";
import type { LimitesDelAgente } from "../domain/ocupaciones/agente.ts";
import type { LimitesDelLote } from "../domain/ocupaciones/lote.ts";
import { ConfigError, type EnvSource } from "./environment.ts";

export const VERSION_DEL_AGENTE = "2026-09-29.2";

const OPENROUTER = "https://openrouter.ai/api/v1";

const EN_OPENROUTER = {
  reasoning: { effort: "high", exclude: true },
  provider: { require_parameters: true },
} as const;

interface ModeloDeclarado {
  readonly proveedor: string;
  readonly url: string;
  readonly modelo: string;
  readonly variableDeLlave: string;
  readonly esfuerzo?: EsfuerzoDeRazonamiento;
  readonly formato: "json_schema" | "json_object";
  readonly campoDeTope?: "max_tokens" | "max_completion_tokens";
  readonly extras?: Readonly<Record<string, unknown>>;
}

const MODELOS: readonly ModeloDeclarado[] = [
  {
    proveedor: "openrouter",
    url: OPENROUTER,
    modelo: "nvidia/nemotron-3-super-120b-a12b:free",
    variableDeLlave: "KCM_IA_OPENROUTER_LLAVE",
    formato: "json_schema",
    campoDeTope: "max_tokens",
    extras: EN_OPENROUTER,
  },
  ...["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"].map(
    (modelo): ModeloDeclarado => ({
      proveedor: "openrouter",
      url: OPENROUTER,
      modelo,
      variableDeLlave: "KCM_IA_OPENROUTER_LLAVE",
      formato: "json_object",
      campoDeTope: "max_tokens",
      extras: EN_OPENROUTER,
    }),
  ),
];

const POR_LLAMADA = { maxTokensDeSalida: 16_000, tiempoMaximoMs: 70_000 } as const;

export const LIMITES_DEL_AGENTE: LimitesDelAgente = {
  maxSubareas: 2,
  maxOpciones: 260,
  reintentosPorCodigoInvalido: 1,
  intentosPorLlamada: 2,
  esperaInicialMs: 5000,
  limiteDePasos: 20,
  tiempoMaximoMs: 105_000,
  tiempoMinimoPorLlamadaMs: 15_000,
};

export const LIMITES_DEL_LOTE: LimitesDelLote = {
  casosPorCorrida: 30,
  casosPorTandaDeSubarea: 20,
  casosPorTandaDeOcupacion: 4,
  tandasEnParaleloPorPapel: 2,
  maxSubareas: LIMITES_DEL_AGENTE.maxSubareas,
  maxOpciones: LIMITES_DEL_AGENTE.maxOpciones,
  intentosPorCaso: 2,
  fallasSeguidasPorPapel: 3,
  tandasFallidasPorCaso: 4,
  esperaTrasFallaMs: 5000,
  tiempoPorPasoMs: 95_000,
  tiempoMinimoPorTandaMs: POR_LLAMADA.tiempoMaximoMs,
  limiteDePasos: 200,
};

export const RESPALDO: OpcionesDelRespaldo = { enfriamientoMs: 300_000, tiempoMinimoMs: 15_000 };

export interface ParametrosDelAgente {
  readonly version: string;
  readonly principal: readonly DestinoDeModelo[];
  readonly limites: LimitesDelAgente;
  readonly lote: LimitesDelLote;
  readonly respaldo: OpcionesDelRespaldo;
}

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

export function leerAgenteDelEntorno(
  source: EnvSource = process.env,
): ParametrosDelAgente | undefined {
  const principal = resolver(MODELOS, source);
  if (principal.length === 0) return undefined;

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
    limites: LIMITES_DEL_AGENTE,
    lote: LIMITES_DEL_LOTE,
    respaldo: RESPALDO,
  };
}
