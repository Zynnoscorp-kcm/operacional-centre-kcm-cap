import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Clock } from "../../ports/reloj.port.ts";
import type { PreReleaseRepositoryPort } from "../../ports/preliberacion.port.ts";
import type { ActorIdentity } from "../quiosco/tipos.ts";
import { PdfPage, buildPdf, rgb, wrapText, type Color } from "../../web/pdf/escritor.ts";
import { leerImagen, type ImagenParaPdf } from "../../web/pdf/imagenes.ts";
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
  BLOCKING_REASON_LABELS,
  EXAM_OUTCOME_LABELS,
  MAX_REPORT_BYTES,
  PRERELEASE_FINDINGS,
  REPORT_KIND,
  REPORT_MIME_TYPE,
  type BlockingReason,
  type FindingCode,
} from "./tipos.ts";

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

const LOGO_PATH = fileURLToPath(new URL("../../web/pdf/membrete/empresa.png", import.meta.url));

const LOGO_HEIGHT = 34;

const ROSTER_COLUMNS = [
  { key: "index", label: "#", width: 26, align: "right" as const },
  { key: "employeeId", label: "Nómina", width: 60, align: "left" as const },
  { key: "displayName", label: "Trabajador", width: 190, align: "left" as const },
  { key: "examStatus", label: "Examen", width: 78, align: "left" as const },
  { key: "state", label: "Estado", width: 62, align: "left" as const },
  { key: "reasons", label: "Motivos", width: 116, align: "left" as const },
];

const LOGOTIPOS = new Map<string, ImagenParaPdf | null>();

function leerLogotipo(projectRoot: string): ImagenParaPdf | null {
  const ruta = resolve(projectRoot, LOGO_PATH);
  const recordado = LOGOTIPOS.get(ruta);
  if (recordado !== undefined) return recordado;

  let imagen: ImagenParaPdf | null;
  try {
    imagen = leerImagen(readFileSync(ruta));
  } catch {
    imagen = null;
  }
  LOGOTIPOS.set(ruta, imagen);
  return imagen;
}

export interface ReportServiceDeps {
  readonly repository: PreReleaseRepositoryPort;
  readonly workbench: WorkbenchService;
  readonly clock: Clock;
  readonly projectRoot?: string;
}

export interface GenerateReportInput {
  readonly sessionId: string;
  readonly mode: ReportMode;
}

export class PreReleaseReportService {
  private readonly repo: PreReleaseRepositoryPort;
  private readonly workbench: WorkbenchService;
  private readonly clock: Clock;
  private readonly projectRoot: string;

  constructor(deps: ReportServiceDeps) {
    this.repo = deps.repository;
    this.workbench = deps.workbench;
    this.clock = deps.clock;
    this.projectRoot = deps.projectRoot ?? process.cwd();
  }

  async generate(input: GenerateReportInput, identity: ActorIdentity): Promise<PreReleaseReport> {
    if (!input || typeof input !== "object") {
      throw new PreReleaseInputError("Solicitud de reporte inválida");
    }
    const mode = input.mode;
    if (mode !== "VISTA_PREVIA" && mode !== "ARCHIVO") {
      throw new PreReleaseInputError("Modo de reporte no reconocido");
    }

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

  async bySession(sessionId: string): Promise<readonly ReportEvidenceRecord[]> {
    const id = String(sessionId ?? "").trim();
    if (!id) throw new PreReleaseInputError("sessionId es requerido");
    return this.repo.listReportsBySession(id);
  }

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

  private fileName(session: SessionHeader, now: Date): string {
    const code = session.sessionCode.replace(/[^A-Za-z0-9-]/g, "");
    const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
    return `Preliberacion-${code}-${stamp}.pdf`;
  }

  private compose(state: WorkbenchState, now: Date): Buffer {
    const pages: PdfPage[] = [];
    const page = new PdfPage({ width: PAGE.width, height: PAGE.height });
    pages.push(page);

    const clean = state.findings.length === 0;
    let y: number = PAGE.margin;

    y = this.drawHeader(page, y, now, clean);
    y = this.drawSessionGrid(page, y, state.session, state.findings, state.review.comments);

    this.drawRoster(pages, page, y, state.roster);

    this.drawFooter(pages, state.session);

    return buildPdf({
      pages,
      title: `Preliberación ${state.session.sessionCode}`,
      date: now.toISOString().slice(0, 10),
    });
  }

  private drawHeader(page: PdfPage, y: number, now: Date, clean: boolean): number {
    const logo = leerLogotipo(this.projectRoot);

    if (logo) {
      page.image(logo, {
        x: PAGE.margin,
        y,
        width: (logo.width / logo.height) * LOGO_HEIGHT,
        height: LOGO_HEIGHT,
      });
    } else {
      page.text("KIMBERLY-CLARK DE MÉXICO", {
        x: PAGE.margin,
        y: y + 10,
        size: 14,
        bold: true,
        color: BRAND.dark,
      });
    }

    page.text(this.formattedDateTime(now), {
      x: PAGE.margin,
      y: y + 4,
      size: 7,
      width: CONTENT_WIDTH,
      align: "right",
      color: BRAND.muted,
    });
    page.text(clean ? "Talón de sesión concluida" : "Acta de hallazgos de preliberación", {
      x: PAGE.margin,
      y: y + LOGO_HEIGHT + 8,
      size: 15,
      bold: true,
      color: BRAND.primary,
      width: CONTENT_WIDTH,
      align: "right",
    });

    const base = y + LOGO_HEIGHT + 26;
    page.line(PAGE.margin, base, PAGE.width - PAGE.margin, base, {
      color: BRAND.primary,
      lineWidth: 1.6,
    });
    return base + 16;
  }

  private drawSectionTitle(page: PdfPage, y: number, label: string): number {
    page.text(label.toUpperCase(), { x: PAGE.margin, y, size: 8, bold: true, color: BRAND.dark });
    page.line(PAGE.margin, y + 12, PAGE.width - PAGE.margin, y + 12, { color: BRAND.line });
    return y + 18;
  }

  private drawSessionGrid(
    page: PdfPage,
    y: number,
    session: SessionHeader,
    findings: readonly string[],
    comments: string,
  ): number {
    let cursor = this.drawSectionTitle(page, y, "Datos generales de la sesión");
    const fields: readonly { label: string; value: string; span: number }[] = [
      { label: "Código de sesión", value: session.sessionCode, span: 1 },
      { label: "Fecha", value: this.formattedDate(session.date), span: 1 },
      {
        label: "Estado",
        value: `${session.status}${session.authorized ? " · Autorizada" : " · Sin autorizar"}`,
        span: 1,
      },
      { label: "Capacitación", value: session.trainingName, span: 2 },
      { label: "Instructor", value: session.instructor, span: 1 },
    ];

    const columnWidth = CONTENT_WIDTH / 3;
    const rowHeight = 22;
    let column = 0;
    let row = 0;
    for (const field of fields) {
      if (column + field.span > 3) {
        column = 0;
        row += 1;
      }
      const x = PAGE.margin + column * columnWidth;
      const rowY = cursor + row * rowHeight;
      page.text(field.label.toUpperCase(), { x, y: rowY, size: 6.5, color: BRAND.muted });
      const { lines } = wrapText(field.value || "-", {
        size: 9,
        maxWidth: columnWidth * field.span - 10,
        maxLines: 1,
      });
      page.text(lines[0] ?? "-", { x, y: rowY + 9, size: 9, bold: true, color: BRAND.ink });
      column += field.span;
    }
    cursor += (row + 1) * rowHeight;

    page.text("RESULTADO DE LA REVISIÓN", {
      x: PAGE.margin,
      y: cursor,
      size: 6.5,
      color: BRAND.muted,
    });
    const resultado = this.findingsLine(findings);
    const medido = page.paragraph(resultado.texto, {
      x: PAGE.margin,
      y: cursor + 9,
      size: 9,
      bold: true,
      width: CONTENT_WIDTH,
      color: resultado.color,
      maxLines: 3,
    });
    cursor += 9 + medido.height + 4;

    if (comments) {
      page.text("COMENTARIOS DE LA REVISIÓN", {
        x: PAGE.margin,
        y: cursor,
        size: 6.5,
        color: BRAND.muted,
      });
      const notas = page.paragraph(comments, {
        x: PAGE.margin,
        y: cursor + 9,
        size: 8,
        width: CONTENT_WIDTH,
        color: BRAND.ink,
        maxLines: 4,
      });
      cursor += 9 + notas.height + 4;
    }

    return cursor + 12;
  }

  private findingsLine(findings: readonly string[]): { texto: string; color: Color } {
    if (findings.length === 0) {
      return { texto: "Sin observaciones. La sesión está apta para liberación.", color: BRAND.ok };
    }
    const nombres = findings.map((code) => {
      const definition = PRERELEASE_FINDINGS[code as FindingCode];
      return definition ? definition.label : code;
    });
    const cuantas =
      findings.length === 1 ? "1 observación" : `${String(findings.length)} observaciones`;
    return { texto: `${cuantas}: ${nombres.join("; ")}.`, color: BRAND.alert };
  }

  private drawRoster(
    pages: PdfPage[],
    startPage: PdfPage,
    startY: number,
    roster: readonly RosterRow[],
  ): { page: PdfPage; y: number } {
    let page = startPage;
    let y = this.drawSectionTitle(page, startY, "Detalle de la sesión");
    y = this.drawRosterHead(page, y);

    const bottomLimit = PAGE.height - PAGE.margin - 30;

    roster.forEach((row, index) => {
      if (y + 14 > bottomLimit) {
        page = new PdfPage({ width: PAGE.width, height: PAGE.height });
        pages.push(page);
        y = this.drawSectionTitle(page, PAGE.margin, "Detalle de la sesión (continúa)");
        y = this.drawRosterHead(page, y);
      }

      const situacion = rosterSituation(row);
      const state = ROSTER_SITUATION_LABELS[situacion];
      const stateColor = situacion === "A_LIBERAR" ? BRAND.ok : BRAND.alert;
      const reasons =
        row.blockingReasons
          .map((motivo) => BLOCKING_REASON_LABELS[motivo as BlockingReason] ?? motivo)
          .join("; ") ||
        row.exclusionReason ||
        "-";

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
