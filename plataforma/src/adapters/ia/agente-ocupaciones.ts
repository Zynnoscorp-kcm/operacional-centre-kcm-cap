/**
 * Arma el agente de ocupaciones con los modelos que tienen llave: el servicio
 * de un caso suelto y la puerta del botón «Clasificar faltantes».
 *
 * Se importa con `import()` la primera vez que alguien lo usa: así LangGraph y
 * el catálogo sólo se cargan en ese momento y ninguna otra pantalla paga su peso
 * al arrancar.
 */

import type { ParametrosDelAgente } from "../../config/agente-ocupaciones.ts";
import { AgenteDeOcupaciones } from "../../domain/ocupaciones/agente.ts";
import { catalogoDeLaPlataforma } from "../../domain/ocupaciones/catalogo.ts";
import { ClasificadorPorLotes } from "../../domain/ocupaciones/lote.ts";
import { PuertaDeOcupaciones } from "../../domain/ocupaciones/puerta.ts";
import { huellaDeConfiguracion, ServicioDeOcupaciones } from "../../domain/ocupaciones/servicio.ts";
import { RosterExtractorAdapter } from "../archivos/extractor-padron.ts";
import {
  ModeloChatCompatible,
  ModeloConRespaldo,
  type DestinoDeModelo,
} from "./chat-compatible.ts";

interface Opciones {
  readonly fetch?: typeof fetch;
}

/** Catálogo, modelos y huella: lo mismo para un caso suelto que para un lote. */
function piezas(parametros: ParametrosDelAgente, opciones: Opciones) {
  const catalogo = catalogoDeLaPlataforma();
  const cadena = (destinos: readonly DestinoDeModelo[]) =>
    new ModeloConRespaldo(
      destinos.map(
        (destino) =>
          new ModeloChatCompatible(destino, opciones.fetch ? { fetch: opciones.fetch } : {}),
      ),
      parametros.respaldo,
    );
  const principal = cadena(parametros.principal);
  const verificador =
    parametros.verificador.length > 0 ? cadena(parametros.verificador) : undefined;

  const describir = (papel: string) => (destino: DestinoDeModelo) =>
    `${papel}:${destino.proveedor}/${destino.modelo}/${destino.esfuerzo ?? "-"}/${destino.formato}/` +
    `${destino.campoDeTope ?? "max_completion_tokens"}/${String(destino.maxTokensDeSalida)}/` +
    `${String(destino.tiempoMaximoMs)}/${JSON.stringify(destino.extras ?? {})}`;
  const huella = huellaDeConfiguracion({
    version: parametros.version,
    modelos: [
      ...parametros.principal.map(describir("principal")),
      ...parametros.verificador.map(describir("verificador")),
    ],
    limites: { caso: parametros.limites, lote: parametros.lote, respaldo: parametros.respaldo },
    catalogo: catalogo.huella,
  });

  return { catalogo, principal, verificador, huella };
}

export function armarServicioDeOcupaciones(
  parametros: ParametrosDelAgente,
  opciones: Opciones = {},
): ServicioDeOcupaciones {
  const { catalogo, principal, verificador, huella } = piezas(parametros, opciones);
  const agente = new AgenteDeOcupaciones({
    catalogo,
    principal,
    ...(verificador ? { verificador } : {}),
    limites: parametros.limites,
  });
  return new ServicioDeOcupaciones({ agente, version: parametros.version, huella });
}

export function armarClasificadorPorLotes(
  parametros: ParametrosDelAgente,
  opciones: Opciones = {},
): ClasificadorPorLotes {
  const { catalogo, principal, verificador, huella } = piezas(parametros, opciones);
  return new ClasificadorPorLotes({
    catalogo,
    principal,
    ...(verificador ? { verificador } : {}),
    limites: parametros.lote,
    version: parametros.version,
    huella,
  });
}

export function armarPuertaDeOcupaciones(
  parametros: ParametrosDelAgente,
  opciones: Opciones = {},
): PuertaDeOcupaciones {
  const extractor = new RosterExtractorAdapter();
  return new PuertaDeOcupaciones({
    extraer: (archivo) => extractor.extraer(archivo),
    lotes: armarClasificadorPorLotes(parametros, opciones),
    casosPorCorrida: parametros.lote.casosPorCorrida,
  });
}
