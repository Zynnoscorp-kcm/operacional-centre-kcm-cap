// Constancia DC-3 en PDF. La plantilla oficial es una hoja de calculo: al imprimirla arrastra la
// cuadricula, los renglones descuadrados y el reverso con los dos catalogos del Catalogo Nacional de
// Ocupaciones, que son material de consulta y no parte del documento que se entrega al trabajador.
//
// Por eso el PDF no se convierte desde la hoja: se compone. Las leyendas oficiales —titulo,
// encabezados de seccion, etiquetas, protesta de decir verdad, pies de firma e instrucciones— se
// leen del archivo oficial celda por celda, de modo que siguen siendo las suyas y un cambio en la
// plantilla se detecta; lo unico que cambia es la maquetacion.
import { XlsxWorkbook } from "../xlsx-reader.js";
import { LEYENDAS_DC3 } from "./leyendas-oficiales.js";
import { buildPdf, measureText, PdfPage, wrapText } from "./pdf-writer.js";

const PAGE = Object.freeze({ width: 612, height: 792, margin: 44 });
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const RULE = Object.freeze({ gray: 0.45, width: 0.6 });
// La banda de logotipos arranca dentro del margen superior. Con este alto rebasa los 44
// puntos del margen, asi que el contenido empieza debajo de la banda en vez de en el margen:
// asi el membrete se ve y el formato aprovecha mejor la hoja, sin que nada se encime.
const LOGO = Object.freeze({ y: 8, alto: 62, anchoMaximo: 240, separacion: 12 });
// Las tres barras de seccion van en negro solido con el texto en blanco, como en el formato oficial.
// El gris claro anterior se veia lavado al imprimir en laser y no separaba las secciones.
const BAR_FILL = 0;
const BAR_TEXT_GRAY = 1;
const LABEL_SIZE = 7;
const VALUE_SIZE = 10.5;
const BOX_HEIGHT = 20;
const BAR_HEIGHT = 15;

// Celdas de la plantilla oficial que contienen texto fijo. El anverso termina en la fila 67: todo lo
// que sigue es el reverso de consulta y queda deliberadamente fuera del documento final.
const LEGEND_CELLS = Object.freeze({
  title: "G8",
  workerSection: "E10",
  workerNameLabel: "E12",
  curpLabel: "E15",
  occupationLabel: "Z15",
  positionLabel: "E18",
  employerSection: "E22",
  employerNameLabel: "E24",
  employerName: "F26",
  taxIdLabel: "E27",
  programSection: "E31",
  courseLabel: "E33",
  durationLabel: "E36",
  periodLabel: "P36",
  startYearLabel: "V36",
  startMonthLabel: "Z36",
  startDayLabel: "AD36",
  endYearLabel: "AJ36",
  endMonthLabel: "AN36",
  endDayLabel: "AR36",
  fromLabel: "T38",
  toLabel: "AH38",
  thematicAreaLabel: "E39",
  trainingAgentLabel: "E42",
  affidavitFirst: "E47",
  affidavitSecond: "E48",
  instructorCaption: "H51",
  employerCaption: "U51",
  workerCaption: "AH51",
  signatureFooter: "H55",
  instructionsTitle: "E59",
  instructions: "E60",
  formId: "E66"
});

const TAX_ID_CELLS = Object.freeze([
  "E29", "G29", "H29", "I29", "J29", "K29", "L29", "M29", "N29", "O29", "P29", "Q29", "R29", "S29"
]);

const TEMPLATE_SIGNATURE_CELLS = Object.freeze({
  instructor: "G53",
  employerRepresentative: "T53",
  workerRepresentative: "AG53"
});

function cellText(sheet, reference) {
  const cell = sheet.cells.get(reference);
  if (!cell || cell.error || cell.value === null) return "";
  return String(cell.value).replace(/\s+/g, " ").trim();
}

/**
 * Lee del archivo oficial las leyendas y los datos del patron. Si la plantilla dejara de declarar
 * una leyenda obligatoria el proceso se detiene: preferible no emitir a emitir una constancia con
 * una seccion muda.
 */
export function extractDc3Legends(templateBuffer) {
  if (!Buffer.isBuffer(templateBuffer)) throw new TypeError("La plantilla debe ser un Buffer XLSX");
  const workbook = new XlsxWorkbook(templateBuffer);
  if (workbook.sheets.length !== 1) throw new Error("La plantilla DC-3 debe contener exactamente una hoja");
  const sheet = workbook.readSheet(workbook.sheets[0].name);
  const legends = {};
  for (const [field, reference] of Object.entries(LEGEND_CELLS)) {
    const text = cellText(sheet, reference);
    if (!text) throw new Error(`La plantilla oficial no declara la leyenda ${field} en ${reference}`);
    legends[field] = text;
  }
  legends.taxId = TAX_ID_CELLS.map((reference) => cellText(sheet, reference)).filter(Boolean);
  if (legends.taxId.length < 12) throw new Error("La plantilla oficial no declara el RFC del patron");
  legends.templateSignatures = Object.fromEntries(
    Object.entries(TEMPLATE_SIGNATURE_CELLS).map(([role, reference]) => [role, cellText(sheet, reference)])
  );
  return legends;
}

function sectionBar(page, y, text) {
  page.rect(PAGE.margin, y, CONTENT_WIDTH, BAR_HEIGHT, { fill: BAR_FILL, stroke: BAR_FILL });
  page.text(text, { x: PAGE.margin + 6, y: y + 4, size: 8, bold: true, gray: BAR_TEXT_GRAY });
  return y + BAR_HEIGHT;
}

// Campo con etiqueta arriba y recuadro abajo. El valor se reduce hasta caber en vez de desbordarse
// sobre el campo vecino, que es justamente el efecto que arruina la impresion de la hoja de calculo.
//
// `field` nombra el recuadro para que, cuando llegue vacio y el documento se pida editable, se le
// pueda escribir encima en el visor en lugar de a mano sobre el papel.
function labeledBox(page, { x, y, width, label, value, height = BOX_HEIGHT, size = VALUE_SIZE, align = "left", field, editable = false }) {
  page.text(label, { x, y, size: LABEL_SIZE, gray: 0.25 });
  const top = y + LABEL_SIZE + 2.4;
  page.rect(x, top, width, height, { stroke: RULE.gray });
  const text = String(value ?? "").trim();
  if (text) {
    let fitted = size;
    while (fitted > 5.5 && measureText(text, { size: fitted }) > width - 10) fitted -= 0.25;
    page.text(text, {
      x: x + 5,
      y: top + (height - fitted) / 2 + 0.4,
      size: fitted,
      width: width - 10,
      align
    });
  } else if (editable && field) {
    writableBox(page, { x, y: top, width, height, field, label });
  }
  return top + height;
}

/**
 * Convierte un recuadro ya trazado en uno escribible. Solo se llama sobre los que salen vacios: un
 * dato que si se capturo no debe poder alterarse desde el visor, y la constancia completa sigue
 * siendo un PDF plano.
 */
function writableBox(page, { x, y, width, height, field, label }) {
  page.formField({
    name: field,
    x: x + 1,
    y: y + 1,
    width: width - 2,
    height: height - 2,
    size: 9,
    tooltip: `${label} — pendiente de capturar`
  });
}

function characterBoxes(page, { x, y, count, values, boxWidth, height = 18, size = 10 }) {
  for (let index = 0; index < count; index += 1) {
    const left = x + index * boxWidth;
    page.rect(left, y, boxWidth, height, { stroke: RULE.gray });
    const character = String(values[index] ?? "");
    if (character) {
      page.text(character, { x: left, y: y + (height - size) / 2 + 0.4, size, width: boxWidth, align: "center" });
    }
  }
  return y + height;
}

function dateBlocks(page, { x, y, label, iso, blockWidth }) {
  const [year, month, day] = String(iso).split("-");
  const parts = [[label.year, year], [label.month, month], [label.day, day]];
  let cursor = x;
  for (const [caption, value] of parts) {
    const width = caption === label.year ? blockWidth * 1.35 : blockWidth;
    page.text(caption, { x: cursor, y, size: LABEL_SIZE - 0.4, width, align: "center", gray: 0.25 });
    page.rect(cursor, y + LABEL_SIZE + 2, width, 17, { stroke: RULE.gray });
    page.text(value, { x: cursor, y: y + LABEL_SIZE + 6, size: 9.5, width, align: "center" });
    cursor += width + 4;
  }
  return cursor;
}

// El nombre va debajo de la raya y el espacio de arriba queda libre: quien firma necesita ese hueco,
// y en la hoja de calculo el nombre impreso caia justo donde se firma.
function signatureBlock(page, { x, y, width, caption, name, footer }) {
  page.line(x + 4, y + 30, x + width - 4, y + 30, { gray: 0.2 });
  page.text(name, { x, y: y + 33, size: 8.6, width, align: "center" });
  page.text(caption, { x, y: y + 45, size: 7.2, width, align: "center", gray: 0.15 });
  page.text(footer, { x, y: y + 54.5, size: 6.6, width, align: "center", gray: 0.4 });
}

const PRINTABLE_FIELDS = Object.freeze([
  "workerName", "curp", "position", "courseName", "durationHours",
  "startDate", "endDate", "thematicArea", "trainingAgent"
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}

function blank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

/**
 * `allowBlank` invierte la regla por omision: en lugar de detener la emision, deja el campo vacio y
 * el recuadro se imprime en blanco, listo para llenarse a mano. Se pidio explicitamente para poder
 * entregar el formato mientras el area tematica y el agente capacitador siguen sin capturarse.
 *
 * No es el modo por omision y no debe serlo: una constancia incompleta es valida como formato, no
 * como constancia. Quien la emite asi lo declara, el ledger la marca `partial` y una emision
 * posterior con los datos completos la reemplaza.
 */
function assertPrintable(data, allowBlank = false) {
  if (!allowBlank) {
    for (const field of PRINTABLE_FIELDS) {
      if (blank(data?.[field])) {
        throw new Error(`Falta el campo requerido ${field} para generar el DC-3`);
      }
    }
  }

  const curp = String(data?.curp ?? "").toUpperCase().replace(/[^A-Z0-9Ñ]/g, "");
  if (!allowBlank && curp.length !== 18) throw new Error("La CURP debe contener 18 caracteres");
  // Con campos en blanco permitidos, una CURP de longitud distinta a 18 se recorta a los 18
  // recuadros del formato en lugar de desbordarlos; lo que falte queda vacio.
  const printableCurp = allowBlank ? curp.slice(0, 18) : curp;

  const dates = {};
  for (const field of ["startDate", "endDate"]) {
    const value = String(data?.[field] ?? "");
    if (ISO_DATE.test(value)) {
      dates[field] = value;
      continue;
    }
    if (!allowBlank) throw new Error(`La fecha ${field} del DC-3 debe usar YYYY-MM-DD`);
    // Una fecha ilegible se imprime como recuadros vacios: escribirla a medias en las casillas de
    // ano, mes y dia produciria una fecha falsa que nadie podria distinguir de una capturada.
    dates[field] = "";
  }

  // `Number(undefined)` es NaN y llegaria al recuadro como el texto "NaN".
  const duration = Number(data?.durationHours);
  const durationHours = Number.isFinite(duration) && duration > 0 ? duration : "";

  return { ...data, curp: printableCurp, ...dates, durationHours };
}

export function renderDc3Pdf({ legends, data: rawData, allowBlank = false, editable = false, logos }) {
  const data = assertPrintable(rawData, allowBlank);
  const page = new PdfPage({ width: PAGE.width, height: PAGE.height });
  const left = PAGE.margin;

  // Los logotipos van arriba de todo, y el contenido arranca debajo de la banda que
  // ocupan. El bloque entero baja igual para todos: se desplaza en conjunto, no se
  // reacomoda por dentro, asi que la maqueta que costo trabajo dejar como esta queda
  // intacta. Si no hay imagenes, el contenido empieza en el margen de siempre.
  const finDeLosLogotipos = dibujarLogotipos(page, left, logos);
  let y = Math.max(PAGE.margin, finDeLosLogotipos + LOGO.separacion);

  // Encabezado. La nota de la plantilla que explica que ahi puede ir un logotipo es una instruccion
  // de llenado, no parte de la constancia: en el documento final ese espacio simplemente no existe.
  const kicker = /^(FORMATO\s+DC-3)\b[\s.:-]*(.*)$/i.exec(legends.title);
  const heading = kicker ? kicker[2].trim() : legends.title;
  if (kicker) {
    page.text(kicker[1].toUpperCase(), {
      x: left, y, size: 9, bold: true, width: CONTENT_WIDTH, align: "center", gray: 0.35
    });
    y += 13;
  }
  const title = wrapText(heading, { size: 13.5, bold: true, maxWidth: CONTENT_WIDTH });
  title.lines.forEach((line, index) => {
    page.text(line, { x: left, y: y + index * 16, size: 13.5, bold: true, width: CONTENT_WIDTH, align: "center" });
  });
  y += title.lines.length * 16 + 6;
  page.line(left, y, left + CONTENT_WIDTH, y, { gray: 0.2, lineWidth: 1.1 });
  y += 12;

  y = sectionBar(page, y, legends.workerSection) + 8;
  y = labeledBox(page, {
    x: left, y, width: CONTENT_WIDTH, label: legends.workerNameLabel, value: data.workerName,
    field: "workerName", editable
  }) + 9;

  const curpBoxWidth = 15.5;
  const curpWidth = 18 * curpBoxWidth;
  page.text(legends.curpLabel, { x: left, y, size: LABEL_SIZE, gray: 0.25 });
  page.text(legends.occupationLabel, { x: left + curpWidth + 16, y, size: LABEL_SIZE, gray: 0.25 });
  const boxesTop = y + LABEL_SIZE + 2.6;
  const curpBottom = characterBoxes(page, {
    x: left, y: boxesTop, count: 18, values: [...data.curp], boxWidth: curpBoxWidth
  });
  const occupationLeft = left + curpWidth + 16;
  const occupationWidth = CONTENT_WIDTH - curpWidth - 16;
  page.rect(occupationLeft, boxesTop, occupationWidth, 18, { stroke: RULE.gray });
  if (String(data.occupation || "").trim()) {
    page.text(String(data.occupation).trim(), {
      x: occupationLeft + 5, y: boxesTop + 4.6, size: 9, width: occupationWidth - 10
    });
  } else if (editable) {
    writableBox(page, {
      x: occupationLeft, y: boxesTop, width: occupationWidth, height: 18,
      field: "occupation", label: legends.occupationLabel
    });
  }
  y = curpBottom + 9;

  y = labeledBox(page, {
    x: left, y, width: CONTENT_WIDTH * 0.62, label: legends.positionLabel, value: data.position,
    field: "position", editable
  }) + 14;

  y = sectionBar(page, y, legends.employerSection) + 8;
  y = labeledBox(page, {
    x: left,
    y,
    width: CONTENT_WIDTH,
    label: legends.employerNameLabel,
    value: String(data.employerName || "").trim() || legends.employerName
  }) + 9;
  page.text(legends.taxIdLabel, { x: left, y, size: LABEL_SIZE, gray: 0.25 });
  y = characterBoxes(page, {
    x: left,
    y: y + LABEL_SIZE + 2.6,
    count: legends.taxId.length,
    values: legends.taxId,
    boxWidth: 17
  }) + 14;

  y = sectionBar(page, y, legends.programSection) + 8;
  // El nombre del curso es el unico campo que puede ocupar dos renglones: los cursos de LOTO llevan
  // el nombre largo completo que exige la norma.
  page.text(legends.courseLabel, { x: left, y, size: LABEL_SIZE, gray: 0.25 });
  const courseTop = y + LABEL_SIZE + 2.6;
  const courseText = String(data.courseName).trim();
  let courseSize = VALUE_SIZE;
  let courseLines = wrapText(courseText, { size: courseSize, maxWidth: CONTENT_WIDTH - 14 });
  while (courseSize > 7 && courseLines.lines.length > 2) {
    courseSize -= 0.25;
    courseLines = wrapText(courseText, { size: courseSize, maxWidth: CONTENT_WIDTH - 14 });
  }
  const courseHeight = Math.max(BOX_HEIGHT, courseLines.lines.length * (courseSize + 3) + 8);
  page.rect(left, courseTop, CONTENT_WIDTH, courseHeight, { stroke: RULE.gray });
  courseLines.lines.forEach((line, index) => {
    page.text(line, {
      x: left + 7,
      y: courseTop + 5.5 + index * (courseSize + 3),
      size: courseSize,
      width: CONTENT_WIDTH - 14
    });
  });
  y = courseTop + courseHeight + 9;

  const durationWidth = 104;
  labeledBox(page, {
    x: left, y, width: durationWidth, label: legends.durationLabel, value: String(data.durationHours),
    height: 17, size: 10, align: "center", field: "durationHours", editable
  });
  const periodLeft = left + durationWidth + 30;
  page.text(legends.periodLabel, { x: periodLeft, y, size: LABEL_SIZE, gray: 0.25 });
  const blocksTop = y + 11;
  page.text(legends.fromLabel, { x: periodLeft, y: blocksTop + 11, size: 8 });
  const afterStart = dateBlocks(page, {
    x: periodLeft + 20,
    y: blocksTop,
    label: { year: legends.startYearLabel, month: legends.startMonthLabel, day: legends.startDayLabel },
    iso: data.startDate,
    blockWidth: 33
  });
  page.text(legends.toLabel, { x: afterStart + 7, y: blocksTop + 11, size: 8 });
  dateBlocks(page, {
    x: afterStart + 22,
    y: blocksTop,
    label: { year: legends.endYearLabel, month: legends.endMonthLabel, day: legends.endDayLabel },
    iso: data.endDate,
    blockWidth: 33
  });
  y += 44;

  y = labeledBox(page, {
    x: left, y, width: CONTENT_WIDTH, label: legends.thematicAreaLabel, value: data.thematicArea,
    field: "thematicArea", editable
  }) + 9;
  y = labeledBox(page, {
    x: left, y, width: CONTENT_WIDTH, label: legends.trainingAgentLabel, value: data.trainingAgent,
    field: "trainingAgent", editable
  }) + 16;

  const affidavit = `${legends.affidavitFirst} ${legends.affidavitSecond}`;
  const affidavitBlock = page.paragraph(affidavit, {
    x: left, y, size: 7.8, width: CONTENT_WIDTH, gray: 0.15
  });
  y += affidavitBlock.height + 18;

  const signatures = data.signatures || {};
  const columnWidth = (CONTENT_WIDTH - 24) / 3;
  const captions = [
    [legends.instructorCaption, signatures.instructor || legends.templateSignatures.instructor],
    [legends.employerCaption, signatures.employerRepresentative || legends.templateSignatures.employerRepresentative],
    [legends.workerCaption, signatures.workerRepresentative || legends.templateSignatures.workerRepresentative]
  ];
  captions.forEach(([caption, name], index) => {
    signatureBlock(page, {
      x: left + index * (columnWidth + 12),
      y,
      width: columnWidth,
      caption,
      name,
      footer: legends.signatureFooter
    });
  });
  y += 72;

  page.line(left, y, left + CONTENT_WIDTH, y, { gray: 0.6 });
  y += 7;
  // El bloque de INSTRUCCIONES del formato oficial es guia de llenado para quien captura,
  // no contenido de la constancia entregada: se omite a proposito. Las leyendas siguen en
  // el catalogo por si alguna vez hace falta imprimir el formato en blanco.
  page.text(legends.formId, { x: left, y, size: 7.4, bold: true, width: CONTENT_WIDTH, align: "right", gray: 0.35 });
  if (y + 14 > PAGE.height - PAGE.margin) {
    // Un desbordamiento silencioso dejaria texto legal fuera de la hoja: preferible no emitir.
    throw new Error("El contenido del DC-3 no cabe en una pagina");
  }

  return buildPdf({
    pages: [page],
    title: `${legends.formId} ${data.workerName}`,
    // La fecha del PDF es su propiedad de creacion, no un recuadro impreso. Normalmente es la del
    // cierre del curso; cuando la constancia se emite sin fecha —el formato en blanco para llenarse
    // a mano— se usa el dia de la emision, que es lo unico cierto que hay. Fallar aqui dejaria sin
    // documento a quien pidio justamente el formato vacio.
    date: ISO_DATE.test(String(data.endDate ?? "")) ? data.endDate : hoyIso(),
    producer: "KCM Cap DC3"
  });
}

/**
 * Punto de entrada equivalente al que llenaba la hoja de calculo: recibe la plantilla oficial y los
 * datos de la constancia y devuelve el PDF listo para entregar.
 */
/**
 * Constancia lista para imprimir. Las leyendas salen de `leyendas-oficiales.js`, no de ningun
 * archivo: emitir un DC-3 no depende de que la hoja oficial este en el disco.
 *
 * `extractDc3Legends` sigue exportada, pero solo para la prueba que compara lo horneado contra esa
 * hoja cuando alguien la tiene a mano.
 */
export function generateDc3Document(data, { allowBlank = false, editable = false, logos } = {}) {
  return renderDc3Pdf({ legends: LEYENDAS_DC3, data, allowBlank, editable, logos });
}

/**
 * Banda de logotipos del margen superior.
 *
 * El de la empresa va siempre pegado al margen derecho. El del sindicato, cuando
 * la constancia es de personal sindicalizado, va al extremo contrario: pegado al
 * margen izquierdo. Quedan en las esquinas opuestas del encabezado, que es como
 * se acostumbra cuando dos organizaciones firman el mismo documento.
 *
 * Cada uno conserva su proporcion y se ajusta al alto de la banda; si a ese alto
 * sale demasiado ancho, manda el ancho maximo y sobra alto. Se apoyan los dos en
 * la misma linea de abajo: colgados del borde superior, dos logotipos de
 * proporciones distintas se ven descuadrados.
 *
 * Devuelve el borde inferior de la banda para que quien llama sepa desde donde
 * seguir. Sin logotipos devuelve cero, y entonces el contenido empieza en el
 * margen de siempre.
 */
function dibujarLogotipos(page, left, logos) {
  if (!logos) return 0;
  if (!logos.company && !logos.union) return 0;

  const colocar = (imagen, alineacion) => {
    if (!imagen) return;
    const proporcion = imagen.width > 0 ? imagen.height / imagen.width : 1;
    let alto = LOGO.alto;
    let ancho = proporcion > 0 ? alto / proporcion : LOGO.anchoMaximo;
    if (ancho > LOGO.anchoMaximo) {
      ancho = LOGO.anchoMaximo;
      alto = ancho * proporcion;
    }
    const x = alineacion === "derecha" ? left + CONTENT_WIDTH - ancho : left;
    const y = LOGO.y + (LOGO.alto - alto);
    page.image(imagen, { x, y, width: ancho, height: alto });
  };

  colocar(logos.union, "izquierda");
  colocar(logos.company, "derecha");
  return LOGO.y + LOGO.alto;
}
