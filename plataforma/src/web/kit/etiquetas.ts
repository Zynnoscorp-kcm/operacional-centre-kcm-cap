/**
 * Etiquetas legibles de los códigos de estado.
 *
 * Los estados viajan en mayúsculas por el dominio, la bitácora y la base, que es
 * donde tienen que quedar tal cual. En pantalla se escriben como cualquier otro
 * texto de la consola: la traducción vive sólo aquí, en la capa web, y ningún
 * valor guardado cambia por ella.
 */

const ESTADOS_DE_SESION: Readonly<Record<string, string>> = {
  BORRADOR: "Borrador",
  ABIERTA: "Abierta",
  CERRADA: "Cerrada",
  PRELIBERACION: "En preliberación",
  LISTA_PARA_LIBERAR: "Lista para liberar",
  LIBERADA_PARCIAL: "Liberada parcial",
  LIBERADA_TOTAL: "Liberada",
  CANCELADA: "Cancelada",
  ERROR: "Error",
};

const ESTADOS_DE_RESERVACION: Readonly<Record<string, string>> = {
  ACTIVA: "Activa",
  CANCELADA: "Cancelada",
};

export function etiquetaDeEstadoDeSesion(estado: string): string {
  return ESTADOS_DE_SESION[estado] ?? estado;
}

export function etiquetaDeEstadoDeReservacion(estado: string): string {
  return ESTADOS_DE_RESERVACION[estado] ?? estado;
}
