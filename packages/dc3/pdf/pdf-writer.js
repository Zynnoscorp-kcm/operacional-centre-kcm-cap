/**
 * Compositor PDF compartido por preliberación y DC-3.
 *
 * La implementación canónica vive en la aplicación Node. Este módulo conserva
 * la ruta histórica para no romper `dc3-document.js` ni sus caracterizaciones.
 */
export { buildPdf, measureText, PdfPage, wrapText } from "../../../plataforma/src/web/pdf/escritor.ts";
