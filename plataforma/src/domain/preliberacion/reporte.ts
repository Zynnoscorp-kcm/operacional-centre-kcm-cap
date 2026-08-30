/**
 * Reporte de preliberación (paso 6 de la función 4).
 *
 * Compone el reporte de preliberación. Una implementación anterior componía HTML y dejaba que el
 * convertidor de Google lo volviera PDF; aquí no hay ese convertidor, así que el
 * documento se compone directo con el escritor vectorial sin dependencias, que
 * es la misma decisión que ya tomó la DC-3.
 *
 * Produce dos documentos con la misma identidad visual: un acta de hallazgos
 * cuando la revisión encontró algo, y un talón de sesión concluida cuando no.
 *
 * Dos modos, y la diferencia importa:
 * - `VISTA_PREVIA` no toca nada. Se puede pedir cuantas veces se quiera sin
 *   cambiar la revisión ni la etapa de la sesión ni dejar rastro.
 * - `ARCHIVO` deja evidencia inmutable con su SHA-256 y un asiento de auditoría,
 *   y por eso queda buscable por sesión.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Clock } from "../../ports/reloj.ts";
import type { PreReleaseRepositoryPort } from "../../ports/preliberacion.port.ts";
import type { ActorIdentity } from "../quiosco/tipos.ts";
import { PdfPage, buildPdf, rgb, wrapText, type Color } from "../../web/pdf/escritor.ts";
import { InvalidPreReleaseStateError, PreReleaseInputError } from "./errores.ts";
import { ROSTER_SITUATION_LABELS, rosterSituation } from "./servicio.ts";
import type { WorkbenchService } from "./banco-de-trabajo.ts";
import type {
  PreReleaseReport,
  ReportEvidenceRecord,
  ReportMode,
  RosterRow,
  SessionHeader,
  WorkbenchState,
} from "./tipos.ts";
import {
  EXAM_OUTCOME_LABELS,
  MAX_REPORT_BYTES,
  PRERELEASE_FINDINGS,
  REPORT_KIND,
  REPORT_MIME_TYPE,
  type FindingCode,
} from "./tipos.ts";

/**
 * Paleta del documento impreso. Toma el azul de marca de la Parte 2 del plan; el
 * resto son los tonos de apoyo que ya usaba el reporte legado.
 */
const BRAND = {
  primary: rgb("#3E6899"),
  dark: rgb("#12324F"),
  ink: rgb("#0f172a"),
  muted: rgb("#64748B"),
  alert: rgb("#A63A43"),
  ok: rgb("#267255"),
  line: rgb("#DCE4EC"),
  surface: rgb("#F6F8FB"),
} satisfies Record<string, Color>;

const PAGE = { width: 612, height: 792, margin: 40 } as const;
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

/** Columnas del padrón, en puntos y proporcionales al ancho útil. */
const ROSTER_COLUMNS = [
  { key: "index", label: "#", width: 24, align: "right" as const },
  { key: "employeeId", label: "Nómina", width: 58, align: "left" as const },
  { key: "displayName", label: "Trabajador", width: 168, align: "left" as const },
  { key: "examStatus", label: "Examen", width: 76, align: "left" as const },
  { key: "state", label: "Estado", width: 66, align: "left" as const },
  { key: "reasons", label: "Motivos", width: 140, align: "left" as const },
];

export interface ReportServiceDeps {
  readonly repository: PreReleaseRepositoryPort;
  readonly workbench: WorkbenchService;
  readonly clock: Clock;
}

export interface GenerateReportInput {
  readonly sessionId: string;
  readonly mode: ReportMode;
}

export class PreReleaseReportService {
  private readonly repo: PreReleaseRepositoryPort;
  private readonly workbench: WorkbenchService;
  private readonly clock: Clock;

  constructor(deps: ReportServiceDeps) {
    this.repo = deps.repository;
    this.workbench = deps.workbench;
    this.clock = deps.clock;
  }

  /**
   * Compone el reporte. En modo `ARCHIVO` lo persiste como evidencia inmutable y
   * lo deja asentado en auditoría; en `VISTA_PREVIA` no escribe nada.
   */
  async generate(input: GenerateReportInput, identity: ActorIdentity): Promise<PreReleaseReport> {
    if (!input || typeof input !== "object") {
      throw new PreReleaseInputError("Solicitud de reporte inválida");
    }
    const mode = input.mode;
    if (mode !== "VISTA_PREVIA" && mode !== "ARCHIVO") {
      throw new PreReleaseInputError("Modo de reporte no reconocido");
    }

    // Se abre por el banco de trabajo para que el reporte y la pantalla nunca
    // puedan discrepar: es el mismo estado calculado por el mismo camino.
    const state = await this.workbench.open(input.sessionId);

    const now = this.clock.now();
    const content = this.compose(state, now);

    if (content.byteLength > MAX_REPORT_BYTES) {
      throw new InvalidPreReleaseStateError("El reporte generado no tiene un tamaño utilizable");
    }

    const sha256 = createHash("sha256").update(content).digest("hex");
    const fileName = this.fileName(state.session, now);
    const clean = state.findings.length === 0;

    const base = {
      sessionId: state.session.sessionId,
      sessionCode: state.session.sessionCode,
      mode,
      clean,
      findings: state.findings,
      counters: state.counters,
      fileName,
      sha256,
      byteSize: content.byteLength,
      content,
    };

    if (mode === "VISTA_PREVIA") {
      return { ...base, archived: false, evidenceId: "" };
    }

    const record: ReportEvidenceRecord = {
      evidenceId: randomUUID(),
      sessionId: state.session.sessionId,
      kind: REPORT_KIND,
      fileName,
      mimeType: REPORT_MIME_TYPE,
      sha256,
      byteSize: content.byteLength,
      storagePath: `preliberacion/${state.session.sessionId}/${fileName}`,
      immutable: true,
      createdBy: identity.actor,
      createdAt: now.toISOString(),
    };

    await this.repo.archiveReport(record, content);

    // El asiento se escribe después de que la evidencia existe: auditar un
    // archivo que falló al guardarse anunciaría algo que no se puede consultar.
    await this.repo.recordAudit({
      actor: identity.actor,
      role: identity.role,
      entityType: "Evidence",
      entityId: record.evidenceId,
      action: "PRERELEASE_REPORT_ARCHIVED",
      previousState: "NO_ARCHIVADO",
      newState: clean ? "SIN_HALLAZGOS" : "CON_HALLAZGOS",
      reason: `${REPORT_KIND}:${sha256.slice(0, 16)}`,
      sessionId: state.session.sessionId,
      provenance: "PLATAFORMA",
      contractVersion: "1.0.0",
    });

    return { ...base, archived: true, evidenceId: record.evidenceId };
  }

  /** Reportes archivados de una sesión, para la búsqueda en auditoría. */
  async bySession(sessionId: string): Promise<readonly ReportEvidenceRecord[]> {
    const id = String(sessionId ?? "").trim();
    if (!id) throw new PreReleaseInputError("sessionId es requerido");
    return this.repo.listReportsBySession(id);
  }

  /** Devuelve los bytes de un reporte archivado, o `null` si no existe. */
  async content(
    evidenceId: string,
  ): Promise<{ record: ReportEvidenceRecord; content: Uint8Array } | null> {
    const id = String(evidenceId ?? "").trim();
    if (!id) throw new PreReleaseInputError("evidenceId es requerido");
    const record = await this.repo.getReportById(id);
    if (!record) return null;
    const content = await this.repo.getReportContent(id);
    if (!content) return null;
    return { record, content };
  }

  // -----------------------------------------------------------------------
  // Composición del documento
  // -----------------------------------------------------------------------

  private fileName(session: SessionHeader, now: Date): string {
    const code = session.sessionCode.replace(/[^A-Za-z0-9-]/g, "");
    const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    return `Preliberacion-${code}-${stamp}.pdf`;
  }

  private compose(state: WorkbenchState, now: Date): Buffer {
    const pages: PdfPage[] = [];
    let page = new PdfPage({ width: PAGE.width, height: PAGE.height });
    pages.push(page);

    const clean = state.findings.length === 0;
    let y: number = PAGE.margin;

    y = this.drawHeader(page, y, now);
    y = this.drawTitle(page, y, clean);
    y = this.drawBanner(page, y, clean, state.findings.length);
    y = this.drawSessionGrid(page, y, state.session);
    y = this.drawTotals(page, y, state.counters);

    if (!clean) y = this.drawFindings(page, y, state.findings);

    // El padrón puede desbordar; cuando pasa, la página nueva repite encabezado
    // de tabla para que ninguna hoja suelta quede sin contexto.
    const rosterResult = this.drawRoster(pages, page, y, state.roster);
    page = rosterResult.page;
    y = rosterResult.y;

    if (state.review.comments) y = this.drawComments(page, y, state.review.comments);

    this.drawSignatures(page, y);
    this.drawFooter(pages, state.session);

    return buildPdf({
      pages,
      title: `Preliberación ${state.session.sessionCode}`,
      // Fecha del documento, no del reloj de la corrida: el mismo estado en el
      // mismo día produce los mismos bytes y por tanto el mismo SHA-256.
      date: now.toISOString().slice(0, 10),
    });
  }

  private drawHeader(page: PdfPage, y: number, now: Date): number {
    page.text("KIMBERLY-CLARK DE MÉXICO", {
      x: PAGE.margin,
      y,
      size: 13,
      bold: true,
      color: BRAND.dark,
    });
    page.text("CONTROL DE CAPACITACIONES", {
      x: PAGE.margin,
      y: y + 3,
      size: 7,
      width: CONTENT_WIDTH,
      align: "right",
      color: BRAND.muted,
    });
    page.text(this.formattedDateTime(now), {
      x: PAGE.margin,
      y: y + 13,
      size: 7,
      width: CONTENT_WIDTH,
      align: "right",
      color: BRAND.muted,
    });
    page.line(PAGE.margin, y + 24, PAGE.width - PAGE.margin, y + 24, {
      color: BRAND.primary,
      lineWidth: 1.6,
    });
    return y + 36;
  }

  private drawTitle(page: PdfPage, y: number, clean: boolean): number {
    page.text(clean ? "PRELIBERACIÓN SIN OBSERVACIONES" : "PRELIBERACIÓN CON OBSERVACIONES", {
      x: PAGE.margin,
      y,
      size: 7,
      bold: true,
      color: BRAND.primary,
    });
    page.text(clean ? "Talón de sesión concluida" : "Acta de hallazgos de preliberación", {
      x: PAGE.margin,
      y: y + 11,
      size: 16,
      bold: true,
      color: BRAND.dark,
    });
    page.paragraph(
      clean
        ? "La revisión no encontró observaciones que impidan la liberación."
        : "La revisión registró observaciones que deben atenderse.",
      { x: PAGE.margin, y: y + 32, size: 9, width: CONTENT_WIDTH * 0.78, color: BRAND.muted },
    );
    return y + 50;
  }

  private drawBanner(page: PdfPage, y: number, clean: boolean, findingCount: number): number {
    const color = clean ? BRAND.ok : BRAND.alert;
    page.rect(PAGE.margin, y, CONTENT_WIDTH, 22, {
      fill: null,
      fillColor: clean ? rgb("#F0F8F4") : rgb("#FCF3F4"),
      stroke: null,
    });
    page.rect(PAGE.margin, y, 3, 22, { fill: null, fillColor: color, stroke: null });
    page.text(
      clean
        ? "SESIÓN SIN HALLAZGOS · APTA PARA LIBERACIÓN"
        : `SESIÓN CON ${findingCount} HALLAZGO(S) · REVISIÓN REQUERIDA`,
      { x: PAGE.margin + 12, y: y + 6, size: 9, bold: true, color },
    );
    return y + 34;
  }

  private drawSectionTitle(page: PdfPage, y: number, label: string): number {
    page.text(label.toUpperCase(), { x: PAGE.margin, y, size: 8, bold: true, color: BRAND.dark });
    page.line(PAGE.margin, y + 12, PAGE.width - PAGE.margin, y + 12, { color: BRAND.line });
    return y + 18;
  }

  private drawSessionGrid(page: PdfPage, y: number, session: SessionHeader): number {
    let cursor = this.drawSectionTitle(page, y, "Datos de la sesión");
    const fields: readonly [string, string][] = [
      ["Código de sesión", session.sessionCode],
      ["Capacitación", session.trainingName],
      ["Fecha", this.formattedDate(session.date)],
      ["Instructor", session.instructor],
      ["Estado", session.status],
      ["Autorizada", session.authorized ? "Sí" : "No"],
    ];

    // Dos columnas: seis campos en tres renglones aprovechan el ancho sin apretar.
    // El renglón mide 24 puntos porque debe alojar la etiqueta de 6.5 y el valor
    // de 9 sin que la etiqueta del renglón siguiente se monte sobre el valor.
    const columnWidth = CONTENT_WIDTH / 2;
    const rowHeight = 24;
    fields.forEach(([label, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = PAGE.margin + column * columnWidth;
      const rowY = cursor + row * rowHeight;
      page.text(label.toUpperCase(), { x, y: rowY, size: 6.5, color: BRAND.muted });
      page.text(value || "-", { x, y: rowY + 9, size: 9, bold: true, color: BRAND.ink });
    });

    cursor += Math.ceil(fields.length / 2) * rowHeight;
    return cursor + 12;
  }

  private drawTotals(page: PdfPage, y: number, counters: WorkbenchState["counters"]): number {
    const cards: readonly [number, string][] = [
      [counters.expectedExams, "Registrados"],
      [counters.approvedExams, "Aprobados"],
      [counters.failedExams, "Reprobados"],
      [counters.missingExams, "Sin entregar"],
      [counters.excludedCount, "Excluidos"],
      [counters.eligibleCount, "A liberar"],
    ];
    const gap = 6;
    const cardWidth = (CONTENT_WIDTH - gap * (cards.length - 1)) / cards.length;

    cards.forEach(([value, label], index) => {
      const x = PAGE.margin + index * (cardWidth + gap);
      page.rect(x, y, cardWidth, 42, {
        fill: null,
        fillColor: BRAND.surface,
        stroke: null,
        strokeColor: BRAND.line,
        lineWidth: 0.5,
      });
      page.text(String(value), {
        x,
        y: y + 8,
        size: 15,
        bold: true,
        width: cardWidth,
        align: "center",
        color: BRAND.dark,
      });
      page.text(label.toUpperCase(), {
        x,
        y: y + 28,
        size: 6,
        width: cardWidth,
        align: "center",
        color: BRAND.muted,
      });
    });

    return y + 56;
  }

  private drawFindings(page: PdfPage, y: number, findings: readonly string[]): number {
    let cursor = this.drawSectionTitle(page, y, "Hallazgos detectados");
    for (const code of findings) {
      const definition = PRERELEASE_FINDINGS[code as FindingCode];
      page.text(code, { x: PAGE.margin, y: cursor, size: 8, bold: true, color: BRAND.ink });
      page.text(definition ? definition.label : code, {
        x: PAGE.margin + 190,
        y: cursor,
        size: 8,
        color: BRAND.alert,
      });
      cursor += 13;
    }
    return cursor + 10;
  }

  private drawRoster(
    pages: PdfPage[],
    startPage: PdfPage,
    startY: number,
    roster: readonly RosterRow[],
  ): { page: PdfPage; y: number } {
    let page = startPage;
    let y = this.drawSectionTitle(page, startY, "Padrón de la sesión");
    y = this.drawRosterHead(page, y);

    // Deja aire abajo para firmas y pie; si no cabe otro renglón, salta de hoja.
    const bottomLimit = PAGE.height - PAGE.margin - 90;

    roster.forEach((row, index) => {
      if (y + 14 > bottomLimit) {
        page = new PdfPage({ width: PAGE.width, height: PAGE.height });
        pages.push(page);
        y = this.drawSectionTitle(page, PAGE.margin, "Padrón de la sesión (continúa)");
        y = this.drawRosterHead(page, y);
      }

      // La situación la decide el dominio, no cada vista: el reporte y el banco
      // de trabajo tienen que decir lo mismo de la misma fila.
      const situacion = rosterSituation(row);
      const state = ROSTER_SITUATION_LABELS[situacion];
      const stateColor = situacion === "A_LIBERAR" ? BRAND.ok : BRAND.alert;
      const reasons = row.blockingReasons.join(", ") || row.exclusionReason || "-";

      const values: Record<string, string> = {
        index: String(index + 1),
        employeeId: row.employeeId,
        displayName: row.displayName || "No identificado",
        examStatus: EXAM_OUTCOME_LABELS[row.examStatus] ?? row.examStatus,
        state,
        reasons,
      };

      let x = PAGE.margin;
      for (const column of ROSTER_COLUMNS) {
        const raw = values[column.key] ?? "";
        // Trunca por medida real, no por número de caracteres: un nombre largo
        // no debe montarse sobre la columna siguiente.
        const { lines } = wrapText(raw, { size: 7.5, maxWidth: column.width - 6, maxLines: 1 });
        const text = lines[0] ?? "";
        page.text(text, {
          x,
          y,
          size: 7.5,
          width: column.width - 6,
          align: column.align,
          color: column.key === "state" ? stateColor : BRAND.ink,
          bold: column.key === "state",
        });
        x += column.width;
      }

      page.line(PAGE.margin, y + 11, PAGE.width - PAGE.margin, y + 11, {
        color: BRAND.line,
        lineWidth: 0.4,
      });
      y += 14;
    });

    if (roster.length === 0) {
      page.text("La sesión no tiene participantes registrados.", {
        x: PAGE.margin,
        y,
        size: 8,
        color: BRAND.muted,
      });
      y += 14;
    }

    return { page, y: y + 10 };
  }

  private drawRosterHead(page: PdfPage, y: number): number {
    page.rect(PAGE.margin, y - 2, CONTENT_WIDTH, 14, {
      fill: null,
      fillColor: BRAND.surface,
      stroke: null,
    });
    let x = PAGE.margin;
    for (const column of ROSTER_COLUMNS) {
      page.text(column.label.toUpperCase(), {
        x,
        y: y + 2,
        size: 6.2,
        bold: true,
        width: column.width - 6,
        align: column.align,
        color: BRAND.dark,
      });
      x += column.width;
    }
    page.line(PAGE.margin, y + 12, PAGE.width - PAGE.margin, y + 12, {
      color: BRAND.primary,
      lineWidth: 0.7,
    });
    return y + 18;
  }

  private drawComments(page: PdfPage, y: number, comments: string): number {
    const cursor = this.drawSectionTitle(page, y, "Comentarios de la revisión");
    const measured = page.paragraph(comments, {
      x: PAGE.margin + 10,
      y: cursor + 4,
      size: 8,
      width: CONTENT_WIDTH - 20,
      color: BRAND.ink,
      maxLines: 8,
    });
    page.rect(PAGE.margin, cursor, 3, measured.height + 8, {
      fill: null,
      fillColor: BRAND.primary,
      stroke: null,
    });
    return cursor + measured.height + 18;
  }

  private drawSignatures(page: PdfPage, y: number): void {
    const labels = ["Instructor", "Capacitación", "Revisor"];
    const gap = 16;
    const width = (CONTENT_WIDTH - gap * (labels.length - 1)) / labels.length;
    const baseline = Math.min(y + 24, PAGE.height - PAGE.margin - 46);

    labels.forEach((label, index) => {
      const x = PAGE.margin + index * (width + gap);
      page.line(x, baseline, x + width, baseline, { color: BRAND.ink, lineWidth: 0.6 });
      page.text(label.toUpperCase(), {
        x,
        y: baseline + 5,
        size: 6.5,
        width,
        align: "center",
        color: BRAND.muted,
      });
    });
  }

  private drawFooter(pages: readonly PdfPage[], session: SessionHeader): void {
    pages.forEach((page, index) => {
      const y = PAGE.height - PAGE.margin - 12;
      page.line(PAGE.margin, y, PAGE.width - PAGE.margin, y, { color: BRAND.line, lineWidth: 0.5 });
      page.text(`Control de capacitaciones KCM · Sesión ${session.sessionCode}`, {
        x: PAGE.margin,
        y: y + 5,
        size: 6.5,
        color: BRAND.muted,
      });
      page.text(`Página ${index + 1} de ${pages.length}`, {
        x: PAGE.margin,
        y: y + 5,
        size: 6.5,
        width: CONTENT_WIDTH,
        align: "right",
        color: BRAND.muted,
      });
    });
  }

  private formattedDate(value: string): string {
    const text = String(value ?? "");
    if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return text;
    const [year, month, day] = text.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
  }

  private formattedDateTime(now: Date): string {
    const iso = now.toISOString();
    return `${this.formattedDate(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC`;
  }
}
