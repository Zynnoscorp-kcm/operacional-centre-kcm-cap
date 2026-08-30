// Leyendas oficiales del formato DC-3.
//
// Son el texto fijo que la STPS imprime en el formato: titulo, encabezados de seccion, etiquetas de
// campo, la protesta de decir verdad, los pies de firma, las instrucciones y el identificador. Se
// transcribieron una sola vez desde el formato oficial y viven aqui, en el codigo.
//
// POR QUE AQUI Y NO EN UN ARCHIVO. Antes se releian de la hoja de calculo oficial en cada emision.
// Esa hoja es un borrador de trabajo, no viaja con el repositorio y no existe en ningun servidor,
// asi que la plataforma solo podia emitir constancias en la maquina donde alguien la tuviera a
// mano; en cualquier otra fallaba con SIN_PLANTILLA_DC3. Horneadas aqui, emitir un DC-3 no depende
// de ningun archivo externo.
//
// COMO SE VERIFICAN. `packages/dc3/testing` compara estas cadenas contra las de la hoja oficial
// cuando la hoja esta presente, y se salta la comparacion cuando no. Asi, quien tenga el borrador
// se entera si el formato oficial cambio, y quien no lo tenga puede emitir igual.
//
// TRES VALORES QUE NO SON ETIQUETAS. `taxId` es el RFC del patron, `templateSignatures` son los
// nombres al pie y `employerName` es la razon social. Los tres se imprimen en la constancia.
//
// `employerName` es el unico valor que no se transcribe tal cual del formato oficial. La hoja
// lo trae con errata ("KIMBERL- CLARK ... S.A.B DE C.V") y aqui va corregido, porque es la razon
// social que se imprime y una errata en ella invalida la constancia. Por eso la prueba que compara
// contra el borrador lo excluye a proposito: es la unica diferencia declarada.
//
// De todos modos sigue siendo un respaldo. La razon social viaja en los datos, desde
// `employer.legalName` de `dc3-config.json`, y al viajar ahi entra en la huella del documento: un
// cambio de razon social no se emite en silencio. Las firmas tambien pueden sustituirse desde la
// configuracion.

export const LEYENDAS_DC3 = Object.freeze({
  title: "FORMATO DC-3 CONSTANCIA DE COMPETENCIAS O DE HABILIDADES LABORALES",
  workerSection: "DATOS DEL TRABAJADOR",
  workerNameLabel: "Nombre (Anotar apellido paterno, apellido materno y nombre (s))",
  curpLabel: "Clave Única de Registro de Población",
  occupationLabel: "Ocupación específica (Catálogo Nacional de Ocupaciones) 1/",
  positionLabel: "Puesto*",
  employerSection: "DATOS DE LA EMPRESA",
  employerNameLabel: "Nombre o razón social (En caso de persona física, anotar apellido paterno, apellido materno y nombre(s))",
  employerName: "KIMBERLY CLARK DE MÉXICO S.A.B DE C.V",
  taxIdLabel: "Registro Federal de Contribuyentes con homoclave (SHCP)",
  programSection: "DATOS DEL PROGRAMA DE CAPACITACIÓN, ADIESTRAMIENTO Y PRODUCTIVIDAD",
  courseLabel: "Nombre del curso",
  durationLabel: "Duración en horas",
  periodLabel: "Periodo de ejecución",
  startYearLabel: "Año",
  startMonthLabel: "Mes",
  startDayLabel: "Día",
  endYearLabel: "Año",
  endMonthLabel: "Mes",
  endDayLabel: "Día",
  fromLabel: "De",
  toLabel: "a",
  thematicAreaLabel: "Área temática del curso 2/",
  trainingAgentLabel: "Nombre del agente capacitador o STPS 3/",
  affidavitFirst: "Los datos se asientan en esta constancia bajo protesta de decir verdad, apercibidos de la responsabilidad en que incurre todo",
  affidavitSecond: "aquel que no se conduce con verdad.",
  instructorCaption: "Instructor o tutor",
  employerCaption: "Patrón o representante legal 4/",
  workerCaption: "Representante de los trabajadores 5/",
  signatureFooter: "Nombre y firma",
  instructionsTitle: "INSTRUCCIONES",
  instructions: "- Llenar a máquina o con letra de molde. - Deberá entregarse al trabajador dentro de los veinte días hábiles siguientes al término del curso de capacitación aprobado. 1/ Las áreas y subáreas ocupacionales del Catálogo Nacional de Ocupaciones se encuentran disponibles en el reverso de este formato y en la página www.stps.gob.mx 2/ Las áreas temáticas de los cursos se encuentran disponibles en el reverso de este formato y en la página www.stps.gob.mx 3/ Cursos impartidos por el área competente de la Secretaria del Trabajo y Previsión Social. 4/ Para empresas con menos de 51 trabajadores. Para empresas con más de 50 trabajadores firmaría el representante del patrón ante la Comisión mixta de capacitación, adiestramiento y productividad. 5/ Solo para empresas con más de 50 trabajadores. * Dato no obligatorio.",
  formId: "DC-3",
  taxId: Object.freeze(["K", "C", "M", "8", "1", "0", "2", "2", "6", "-", "D", "E", "A"]),
  templateSignatures: Object.freeze({
    instructor: "MARICELA JUÁREZ VILLA",
    employerRepresentative: "VÍCTOR MANUEL VALDÉS MARQUÉZ",
    workerRepresentative: "JOSÉ TORRES BONILLA"
  }),
});
