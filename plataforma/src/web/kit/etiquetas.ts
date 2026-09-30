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

const CLAVES_DE_AUDITORIA: Readonly<Record<string, string>> = {
  ...ESTADOS_DE_SESION,
  DC3_EMITIDA_INDIVIDUAL: "Constancia DC-3 emitida",
  CONSTANCIA_DC3: "Constancia DC-3",
  EMITIDA: "Emitida",
  EMITIDA_PARCIAL: "Emitida con recuadros en blanco",
  CARGA_MATRIZ: "Carga de la matriz",
  CARGA_PADRON: "Carga del padrón",
  CAMPO_DECLARADO: "Campo declarado",
  DECLARAR: "Declaración",
  APROBAR: "Aprobación",
  APROBADO: "Aprobado",
  SIN_APROBAR: "Sin aprobar",
  APLICADA: "Aplicada",
  APPLIED: "Aplicada",
  RECOVERED: "Recuperada",
  SOBRESCRITA: "Sobrescrita",
  ENTREGADA: "Entregada",
  PENDIENTE_ACUSE: "Esperando confirmación de Excel",
  CONFIRMADO: "Confirmado",
  COMPLETADO: "Completado",
  PLATAFORMA: "Plataforma",
  CAPACITACION: "Capacitación",
  ADMINISTRADOR: "Administración",
  SESSION_RELEASE: "Sesión liberada",
  XLSB_IMPORT: "Matriz de capacitación",
  ROSTER_ALTA: "Alta del padrón",
};

export function etiquetaDeAuditoria(clave: string | null | undefined): string {
  if (!clave) return "—";
  const conocida = CLAVES_DE_AUDITORIA[clave];
  if (conocida) return conocida;
  if (!/^[A-Z0-9_]+$/u.test(clave)) return clave;
  const texto = clave.toLocaleLowerCase("es-MX").replaceAll("_", " ");
  return texto.charAt(0).toLocaleUpperCase("es-MX") + texto.slice(1);
}
