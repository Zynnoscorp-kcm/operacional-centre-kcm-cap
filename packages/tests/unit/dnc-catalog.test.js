import assert from "node:assert/strict";
import test from "node:test";
import {
  UNIFIED_COURSES,
  APPROVED_ALIASES,
  COURSE_CATEGORIES,
  resolveCourse,
  normalizeCatalogKey
} from "../../dnc/catalog.js";

test("catalogo unificado contiene los 8 cursos de calidad y los 13 tecnicos", () => {
  const quality = UNIFIED_COURSES.filter((c) => c.category === COURSE_CATEGORIES.QUALITY);
  const technical = UNIFIED_COURSES.filter((c) => c.category === COURSE_CATEGORIES.TECHNICAL);

  assert.equal(quality.length, 8, "Debe haber exactamente 8 cursos de calidad del TSV");
  assert.equal(technical.length, 13, "Debe haber exactamente 13 cursos técnicos del DNC");
});

test("reconcilia BPM con BUENAS PRACTICAS DE MANUFACTURA", () => {
  const byBpm = resolveCourse("BPM");
  const byFull = resolveCourse("BUENAS PRACTICAS DE MANUFACTURA");
  const byId = resolveCourse("kcm-course:bpm");

  assert.ok(byBpm);
  assert.ok(byFull);
  assert.ok(byId);
  assert.equal(byBpm.trainingId, "kcm-course:bpm");
  assert.equal(byFull.trainingId, "kcm-course:bpm");
  assert.equal(byId.trainingId, "kcm-course:bpm");
  assert.equal(byBpm.canonicalName, "BUENAS PRACTICAS DE MANUFACTURA");
});

test("reconcilia INSPECCIÓN EN LINEA con e indistintamente de acentos", () => {
  const withAccent = resolveCourse("INSPECCIÓN EN LINEA");
  const withoutAccent = resolveCourse("INSPECCION EN LINEA");
  const lowerCase = resolveCourse("inspección en linea");

  assert.ok(withAccent);
  assert.ok(withoutAccent);
  assert.ok(lowerCase);
  assert.equal(withAccent.trainingId, "kcm-course:inspeccion-linea");
  assert.equal(withoutAccent.trainingId, "kcm-course:inspeccion-linea");
  assert.equal(lowerCase.trainingId, "kcm-course:inspeccion-linea");
});

test("resuelve LOTO por sourceKey inequívoco para desambiguar columnas repetidas", () => {
  const loto1 = resolveCourse("LOTO", { sourceKey: "hc-course:loto-1" });
  const loto2 = resolveCourse("LOTO", { sourceKey: "hc-course:loto-2" });

  assert.ok(loto1);
  assert.ok(loto2);
  assert.equal(loto1.trainingId, "kcm-course:loto-bloqueo");
  assert.equal(loto2.trainingId, "kcm-course:loto-candadeo");
});

test("los 13 cursos tecnicos se resuelven por su nombre exacto", () => {
  const names = [
    "SISTEMA DE CONTROL DE MOTORES",
    "INSTRUMENTACION Y CONTROL",
    "ELECTRONICA DE POTENCIA",
    "MOTORES DE INDUCCION JAULA DE ARDILLA",
    "FUNDAMENTOS BASICOS DE VARIADORES DE FRECUENCIA",
    "NEUMATICA BASICA",
    "INSTALACIONES ELECTRICAS INDUSTRIALES",
    "MATEMATICAS DEL TALLER",
    "FISICA BASICA",
    "CONCEPTOS BASICOS DE ELECTRICIDAD",
    "MANTENIMIENTO A SISTEMAS DE AIRE ACONDICIONADO",
    "MANTENIMIENTO Y CONFIGURACION DCS VALMET O EXPIRION",
    "CAPACITACION EAM (PERFILES Y CORREO)"
  ];

  for (const name of names) {
    const course = resolveCourse(name);
    assert.ok(course, `Debe resolver el curso técnico ${name}`);
    assert.equal(course.category, COURSE_CATEGORIES.TECHNICAL);
  }
});

test("un curso desconocido devuelve null sin adivinanza improvisada", () => {
  assert.equal(resolveCourse("CURSO INVENTADO DESCONOCIDO"), null);
  assert.equal(resolveCourse(""), null);
  assert.equal(resolveCourse(null), null);
});
