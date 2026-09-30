export const COURSE_CATEGORIES = Object.freeze({
  QUALITY: "QUALITY",
  TECHNICAL: "TECHNICAL",
  MATRIX_OTHER: "MATRIX_OTHER"
});

export function normalizeCatalogKey(text) {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export const UNIFIED_COURSES = Object.freeze([
  {
    trainingId: "kcm-course:bpm",
    canonicalName: "BUENAS PRACTICAS DE MANUFACTURA",
    category: COURSE_CATEGORIES.QUALITY,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:bpm", "hc-course:buenas-practicas"]
  },
  {
    trainingId: "kcm-course:bpr",
    canonicalName: "BPR",
    category: COURSE_CATEGORIES.QUALITY,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:bpr"]
  },
  {
    trainingId: "kcm-course:haccp",
    canonicalName: "HACCP",
    category: COURSE_CATEGORIES.QUALITY,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:haccp"]
  },
  {
    trainingId: "kcm-course:qms",
    canonicalName: "QMS",
    category: COURSE_CATEGORIES.QUALITY,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:qms"]
  },
  {
    trainingId: "kcm-course:politica-calidad",
    canonicalName: "POLITICA DE CALIDAD",
    category: COURSE_CATEGORIES.QUALITY,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:politica-calidad"]
  },
  {
    trainingId: "kcm-course:imagen-calidad",
    canonicalName: "IMAGEN DE CALIDAD",
    category: COURSE_CATEGORIES.QUALITY,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:imagen-calidad"]
  },
  {
    trainingId: "kcm-course:inspeccion-linea",
    canonicalName: "INSPECCION EN LINEA",
    category: COURSE_CATEGORIES.QUALITY,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:inspeccion-linea"]
  },
  {
    trainingId: "kcm-course:control-producto-no-conforme",
    canonicalName: "CONTROL DE PRODUCTO NO CONFORME",
    category: COURSE_CATEGORIES.QUALITY,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:control-producto-no-conforme"]
  },

  {
    trainingId: "kcm-course:sistema-control-motores",
    canonicalName: "SISTEMA DE CONTROL DE MOTORES",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:sistema-control-motores"]
  },
  {
    trainingId: "kcm-course:instrumentacion-control",
    canonicalName: "INSTRUMENTACION Y CONTROL",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:instrumentacion-control"]
  },
  {
    trainingId: "kcm-course:electronica-potencia",
    canonicalName: "ELECTRONICA DE POTENCIA",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:electronica-potencia"]
  },
  {
    trainingId: "kcm-course:motores-induccion-jaula-ardilla",
    canonicalName: "MOTORES DE INDUCCION JAULA DE ARDILLA",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:motores-induccion-jaula-ardilla"]
  },
  {
    trainingId: "kcm-course:fundamentos-variadores-frecuencia",
    canonicalName: "FUNDAMENTOS BASICOS DE VARIADORES DE FRECUENCIA",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:fundamentos-variadores-frecuencia"]
  },
  {
    trainingId: "kcm-course:neumatica-basica",
    canonicalName: "NEUMATICA BASICA",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:neumatica-basica"]
  },
  {
    trainingId: "kcm-course:instalaciones-electricas-industriales",
    canonicalName: "INSTALACIONES ELECTRICAS INDUSTRIALES",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:instalaciones-electricas-industriales"]
  },
  {
    trainingId: "kcm-course:matematicas-taller",
    canonicalName: "MATEMATICAS DEL TALLER",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:matematicas-taller"]
  },
  {
    trainingId: "kcm-course:fisica-basica",
    canonicalName: "FISICA BASICA",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:fisica-basica"]
  },
  {
    trainingId: "kcm-course:conceptos-basicos-electricidad",
    canonicalName: "CONCEPTOS BASICOS DE ELECTRICIDAD",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:conceptos-basicos-electricidad"]
  },
  {
    trainingId: "kcm-course:mantenimiento-sistemas-aire-acondicionado",
    canonicalName: "MANTENIMIENTO A SISTEMAS DE AIRE ACONDICIONADO",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:mantenimiento-sistemas-aire-acondicionado"]
  },
  {
    trainingId: "kcm-course:mantenimiento-configuracion-dcs",
    canonicalName: "MANTENIMIENTO Y CONFIGURACION DCS VALMET O EXPIRION",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:mantenimiento-configuracion-dcs"]
  },
  {
    trainingId: "kcm-course:capacitacion-eam",
    canonicalName: "CAPACITACION EAM (PERFILES Y CORREO)",
    category: COURSE_CATEGORIES.TECHNICAL,
    defaultValidityMonths: 24,
    defaultGraceDays: 30,
    sourceKeys: ["dnc-course:capacitacion-eam"]
  },

  {
    trainingId: "kcm-course:loto-bloqueo",
    canonicalName: "LOTO",
    category: COURSE_CATEGORIES.MATRIX_OTHER,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:loto-bloqueo", "hc-course:loto-1", "hc-course:loto-col-v"]
  },
  {
    trainingId: "kcm-course:loto-candadeo",
    canonicalName: "LOTO CANDADEO",
    category: COURSE_CATEGORIES.MATRIX_OTHER,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:loto-candadeo", "hc-course:loto-2", "hc-course:loto-col-w"]
  },
  {
    trainingId: "kcm-course:5s",
    canonicalName: "5S",
    category: COURSE_CATEGORIES.MATRIX_OTHER,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:5s"]
  },
  {
    trainingId: "kcm-course:reinduccion",
    canonicalName: "REINDUCCION A LA EMPRESA",
    category: COURSE_CATEGORIES.MATRIX_OTHER,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:reinduccion"]
  },
  {
    trainingId: "kcm-course:food-defense",
    canonicalName: "FOOD DEFENSE",
    category: COURSE_CATEGORIES.MATRIX_OTHER,
    defaultValidityMonths: 12,
    defaultGraceDays: 30,
    sourceKeys: ["hc-course:food-defense"]
  }
]);

export const APPROVED_ALIASES = Object.freeze([
  {
    alias: "BPM",
    trainingId: "kcm-course:bpm",
    source: "TSV",
    approvedBy: "CONTROL_CAPACITACION",
    approvedAt: "2026-08-02T16:48:00.000Z"
  },
  {
    alias: "BUENAS PRACTICAS DE MANUFACTURA",
    trainingId: "kcm-course:bpm",
    source: "MATRIZ_XLSB",
    approvedBy: "CONTROL_CAPACITACION",
    approvedAt: "2026-08-02T16:48:00.000Z"
  },
  {
    alias: "INSPECCIÓN EN LINEA",
    trainingId: "kcm-course:inspeccion-linea",
    source: "TSV",
    approvedBy: "CONTROL_CAPACITACION",
    approvedAt: "2026-08-02T16:48:00.000Z"
  },
  {
    alias: "INSPECCION EN LINEA",
    trainingId: "kcm-course:inspeccion-linea",
    source: "MATRIZ_XLSB",
    approvedBy: "CONTROL_CAPACITACION",
    approvedAt: "2026-08-02T16:48:00.000Z"
  },
  {
    alias: "REINDUCCION",
    trainingId: "kcm-course:reinduccion",
    source: "MATRIZ_XLSB",
    approvedBy: "CONTROL_CAPACITACION",
    approvedAt: "2026-08-02T16:48:00.000Z"
  }
]);

export function resolveCourse(identifier, options = {}) {
  if (!identifier || typeof identifier !== "string") return null;

  const trimmed = identifier.trim();
  if (!trimmed) return null;

  const byId = UNIFIED_COURSES.find((c) => c.trainingId === trimmed);
  if (byId) return byId;

  if (options.sourceKey) {
    const bySourceKey = UNIFIED_COURSES.find((c) =>
      c.sourceKeys.includes(options.sourceKey)
    );
    if (bySourceKey) return bySourceKey;
  }

  const normalized = normalizeCatalogKey(trimmed);

  const byCanonicalName = UNIFIED_COURSES.find(
    (c) => normalizeCatalogKey(c.canonicalName) === normalized
  );
  if (byCanonicalName) return byCanonicalName;

  const byAlias = APPROVED_ALIASES.find(
    (a) => normalizeCatalogKey(a.alias) === normalized
  );
  if (byAlias) {
    return UNIFIED_COURSES.find((c) => c.trainingId === byAlias.trainingId) || null;
  }

  const bySourceKeyGen = UNIFIED_COURSES.find((c) =>
    c.sourceKeys.some((k) => normalizeCatalogKey(k) === normalized)
  );
  if (bySourceKeyGen) return bySourceKeyGen;

  return null;
}
