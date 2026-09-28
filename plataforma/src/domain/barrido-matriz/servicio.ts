/**
 * Barrido de la matriz: encargarlo, recibirlo, leerlo y —sólo entonces— aplicarlo.
 *
 * La regla es la del padrón semanal, palabra por palabra: leer no escribe.
 * El cliente VBA recorre el XLSB y transmite el snapshot; aquí se confronta
 * contra SQL y se guarda una revisión. Ninguna fila del dominio se mueve hasta
 * que alguien aprieta «Aplicar a la base».
 *
 * Eso corrige, para esta ruta, algo que `MATRIX_IMPORT_V1` no permite: esa
 * acción recibe y aplica en la misma petición, de modo que un barrido con
 * alcance FULL retira fechas antes de que nadie haya visto cuáles. El barrido
 * separa los dos actos sin tocar la acción anterior, que sigue existiendo para
 * el ciclo programado.
 *
 * Tres decisiones de costo, iguales a las del padrón porque el problema es el
 * mismo:
 *
 * 1. Tres lecturas por barrido: trabajadores, cursos y registros HC. Es lo
 *    que cuesta la comparación completa, y es exactamente lo que gastaría la
 *    aplicación; no se paga dos veces por preguntar antes de escribir.
 * 2. La revisión no crea el lote de importación, que es justamente lo que no
 *    debe existir todavía. Vive en el proceso y, donde hay base, además en
 *    `sistema.revision_pendiente` (`revisiones`): publicada con varias
 *    instancias, el «Aplicar» puede llegar a una que no recibió el barrido.
 *    Si se pierde, se vuelve a barrer: una lectura de la hoja, ninguna escritura.
 * 3. Un barrido a la vez. El snapshot de una matriz de 1,686 filas pesa
 *    varios megabytes; conservar una cola de ellos en memoria no compra nada.
 *    El nuevo sustituye al anterior.
 */

import { randomUUID } from "node:crypto";

import type { Clock } from "../../ports/reloj.port.ts";
import type { MatrixRepositoryPort } from "../../ports/importacion-matriz.port.ts";
import type { RevisionesCompartidasPort } from "../../ports/revisiones-compartidas.port.ts";
import type { BitacoraDeCargas } from "../cargas/bitacora.ts";
import type { ComparacionConLaAnterior } from "../cargas/tipos.ts";
import {
  FECHAS_DETALLADAS,
  adscripcion,
  type DetalleDeCambios,
  type FechaDelCambio,
  type MovimientoDelCambio,
} from "../cargas/detalle.ts";
import { DomainError } from "../comun/errores.ts";
import { MatrixImportService } from "../importacion-matriz/servicio.ts";
import {
  normalizeText,
  reconcileSnapshot,
  resolveCourseMappings,
} from "../importacion-matriz/reconciliador.ts";
import type {
  CourseCatalogEntry,
  MatrixSnapshot,
  WorkerCatalogEntry,
} from "../importacion-matriz/tipos.ts";
import {
  MUESTRA_DE_BARRIDO,
  type BarridoGuardado,
  type CambioDeAdscripcion,
  type ColumnaDetectada,
  type CuadreDeBarrido,
  type EstadoDeColumna,
  type InformeDeBarrido,
  type MuestrasDeBarrido,
  type ResultadoDeBarrido,
} from "./tipos.ts";

const VIGENCIA_MS = 30 * 60 * 1000;

/** Normaliza para comparar adscripciones. Un puesto no cambia por un espacio. */
function clave(valor: string | null | undefined): string {
  return (valor ?? "").trim().toUpperCase();
}

function textoVisible(valor: string | null | undefined): string {
  const limpio = (valor ?? "").trim();
  return limpio === "" ? "(sin dato)" : limpio;
}

export interface MatrixScanDeps {
  readonly repository: MatrixRepositoryPort;
  readonly clock: Clock;
  /** Se inyecta para pruebas; por omisión se construye sobre el repositorio. */
  readonly imports?: MatrixImportService;
  /**
   * Sin ella el barrido funciona igual que antes de esta ejecución: revisa y
   * aplica, pero nadie puede saber después qué libro se aplicó ni quién lo pidió.
   */
  readonly bitacora?: BitacoraDeCargas;
  /**
   * Sin él la revisión sólo vive en este proceso, que es lo correcto en una
   * máquina y en las pruebas. Con él, cualquier instancia puede aplicarla.
   */
  readonly revisiones?: RevisionesCompartidasPort;
}

/** Lo que se comparte entre instancias: la revisión y su comparación ya resuelta. */
interface BarridoCompartido {
  readonly barrido: BarridoGuardado;
  readonly comparacion?: ComparacionConLaAnterior;
}

export class MatrixScanService {
  readonly #repository: MatrixRepositoryPort;
  readonly #imports: MatrixImportService;
  readonly #clock: Clock;
  readonly #bitacora: BitacoraDeCargas | undefined;
  readonly #revisiones: RevisionesCompartidasPort | undefined;

  #barrido: BarridoGuardado | undefined;
  #resultado: ResultadoDeBarrido | undefined;
  /** Resuelta al recibir el barrido, no al pintarlo. Ver el padrón: mismo motivo. */
  #comparacion: ComparacionConLaAnterior | undefined;

  constructor(deps: MatrixScanDeps) {
    this.#repository = deps.repository;
    this.#imports = deps.imports ?? new MatrixImportService(deps.repository);
    this.#clock = deps.clock;
    this.#bitacora = deps.bitacora;
    this.#revisiones = deps.revisiones;
  }

  /**
   * Trae la revisión compartida, si la hay. Las rutas la llaman antes de leer
   * el estado: sin almacén compartido no hace nada y todo queda en memoria.
   *
   * El almacén manda. Si otra instancia aplicó o descartó, aquí se olvida la
   * copia local para no ofrecer un «Aplicar» que ya no existe.
   */
  async sincronizar(): Promise<void> {
    if (!this.#revisiones) return;
    const vigente = await this.#revisiones.vigente("BARRIDO_MATRIZ");
    if (vigente !== undefined && this.#barrido?.informe.barridoId === vigente) return;
    const guardada =
      vigente === undefined ? undefined : await this.#revisiones.leer("BARRIDO_MATRIZ");
    if (!guardada) {
      this.#barrido = undefined;
      this.#comparacion = undefined;
      return;
    }
    const compartido = guardada.contenido as BarridoCompartido;
    this.#barrido = compartido.barrido;
    this.#comparacion = compartido.comparacion;
  }

  /** Lo que se sabe de la carga anterior, para la revisión que está en pantalla. */
  comparacion(): ComparacionConLaAnterior | undefined {
    return this.#comparacion;
  }

  // ------------------------------------------------------------ el barrido

  /**
   * Recibe el snapshot barrido y produce la revisión. No escribe nada.
   *
   * Un snapshot mal formado —celdas de error, números duplicados, fechas
   * ilegibles— falla aquí con el mensaje del validador, que es el mismo que
   * detendría la carga. Vale más rechazarlo antes de enseñar conteos que
   * describirían una matriz que nadie va a aplicar.
   */
  async registrar(input: {
    readonly snapshot: MatrixSnapshot;
    readonly requestId: string;
    readonly cliente: string;
  }): Promise<InformeDeBarrido> {
    const { snapshot } = input;

    const [trabajadores, cursos, registros] = await Promise.all([
      this.#repository.getWorkers(),
      this.#repository.getCourses(),
      this.#repository.getHcRecords(),
    ]);

    const barridoId = randomUUID();

    // El reconciliador es el que decide qué pasaría de verdad: se le pregunta a
    // él en lugar de reproducir sus reglas, para que la pantalla no pueda
    // anunciar una cosa y la aplicación hacer otra.
    const reconciliado = reconcileSnapshot({
      snapshot,
      existingWorkers: trabajadores,
      existingCourses: cursos,
      existingRecords: registros,
      importId: `barrido-${barridoId}`,
      requestId: input.requestId,
      actorId: input.cliente,
      scope: "FULL",
    });

    const columnas = this.#clasificarColumnas(snapshot, cursos);
    const adscripciones = this.#compararAdscripciones(snapshot, trabajadores);

    const enMatriz = new Set(snapshot.employees.map((empleado) => empleado.employeeId));
    const enBase = new Map(trabajadores.map((fila) => [fila.workerNumber as string, fila]));
    const nuevos = snapshot.employees
      .filter((empleado) => !enBase.has(empleado.employeeId))
      .map((empleado) => empleado.employeeId);
    const ausentes = trabajadores
      .filter((fila) => fila.active && !enMatriz.has(fila.workerNumber))
      .map((fila) => fila.workerNumber as string);

    // Un curso que la base conoce y este barrido no trae como columna. No se
    // desactiva solo: se denuncia, porque la causa habitual es un rango de
    // cursos recortado y no una capacitación retirada del programa.
    const identidadesVistas = new Set(
      columnas.map((columna) => columna.claveOrigen).filter((valor) => valor !== ""),
    );
    const nombresVistos = new Set(columnas.map((columna) => normalizeText(columna.nombre)));
    const retiradas = cursos
      .filter(
        (curso) =>
          curso.active &&
          !identidadesVistas.has(curso.sourceKey) &&
          !nombresVistos.has(curso.normalizedName),
      )
      .map((curso) => curso.sourceName);

    const columnasNuevas = columnas.filter((columna) => columna.estado === "NUEVA");
    const columnasRenombradas = columnas.filter((columna) => columna.estado === "RENOMBRADA");

    const cuadre: CuadreDeBarrido = {
      trabajadoresEnMatriz: snapshot.employees.length,
      trabajadoresEnBase: trabajadores.length,
      trabajadoresNuevos: nuevos.length,
      trabajadoresAusentes: ausentes.length,
      cambiosDePuesto: adscripciones.filter((cambio) => cambio.campo === "PUESTO").length,
      cambiosDeArea: adscripciones.filter((cambio) => cambio.campo === "AREA").length,
      cambiosDeDepartamento: adscripciones.filter((cambio) => cambio.campo === "DEPARTAMENTO")
        .length,

      columnasEnMatriz: columnas.length,
      columnasEnBase: cursos.filter((curso) => curso.active).length,
      columnasNuevas: columnasNuevas.length,
      columnasRenombradas: columnasRenombradas.length,
      columnasRetiradas: retiradas.length,

      fechasEnMatriz: snapshot.completions.length,
      fechasNuevas: reconciliado.counts.insertedCount,
      fechasCorregidas: reconciliado.counts.correctedCount,
      fechasRetiradas: reconciliado.counts.retiredCount,
      fechasReactivadas: reconciliado.counts.reactivatedCount,
      conflictos: reconciliado.conflicts.length,
      pendientesEnMaestro: reconciliado.counts.pendingMasterCount,
    };

    const muestras: MuestrasDeBarrido = {
      trabajadoresNuevos: nuevos.slice(0, MUESTRA_DE_BARRIDO),
      trabajadoresAusentes: ausentes.slice(0, MUESTRA_DE_BARRIDO),
      cambiosDeAdscripcion: adscripciones.slice(0, MUESTRA_DE_BARRIDO),
      columnasNuevas: columnasNuevas.map((columna) => columna.nombre).slice(0, MUESTRA_DE_BARRIDO),
      // Completa: son pocos cursos y la revisión los enseña todos.
      columnasRetiradas: retiradas,
      conflictos: reconciliado.conflicts
        .slice(0, MUESTRA_DE_BARRIDO)
        .map(
          (conflicto) =>
            `${conflicto.workerNumber} · ${conflicto.trainingId}: la matriz trae ` +
            `${conflicto.snapshotDate} y la plataforma liberó ${conflicto.existingDate}`,
        ),
    };

    // El detalle, persona por persona, con nombre y adscripción. Los nombres de
    // quien entra salen del libro; los de quien ya no aparece, de la base.
    const nombreEnLibro = new Map(
      snapshot.employees.map((empleado) => [empleado.employeeId as string, empleado.displayName]),
    );
    const nombreDe = (nomina: string): string =>
      nombreEnLibro.get(nomina) ?? enBase.get(nomina)?.displayName ?? "";
    const nombreDeCurso = new Map<string, string>([
      ...cursos.map((curso) => [curso.trainingId, curso.sourceName] as const),
      ...reconciliado.coursesToUpsert.map((curso) => [curso.trainingId, curso.sourceName] as const),
    ]);
    const nuevosEnLibro = new Set(nuevos);
    const fechas: FechaDelCambio[] = reconciliado.historyEntriesToInsert
      .filter((cambio) => cambio.changeType !== "SOBRESCRITA")
      .map((cambio) => ({
        nomina: cambio.workerNumber,
        nombre: nombreDe(cambio.workerNumber),
        curso: nombreDeCurso.get(cambio.trainingId) ?? cambio.trainingId,
        antes: cambio.changeType === "ALTA" ? null : cambio.previousCompletionDate,
        ahora: cambio.changeType === "RETIRADA" ? null : cambio.completionDate,
      }));
    const detalle: DetalleDeCambios = {
      altas: snapshot.employees
        .filter((empleado) => nuevosEnLibro.has(empleado.employeeId))
        .map((empleado) => ({
          nomina: empleado.employeeId,
          nombre: empleado.displayName,
          adscripcion: adscripcion(empleado.position, empleado.area, empleado.department),
        })),
      // Se da de baja sólo quien tampoco estuvo en el último padrón (0046).
      bajas: ausentes.map((nomina) => {
        const fila = enBase.get(nomina);
        const baja = fila?.seenInRoster === false;
        return {
          nomina,
          nombre: fila?.displayName ?? "",
          adscripcion: adscripcion(fila?.position, fila?.area, fila?.department),
          nota: baja ? "Se da de baja" : "Sigue activo: está en el padrón",
          ...(baja ? {} : { soloAviso: true }),
        };
      }),
      movimientos: this.#datosQueCambian(snapshot, enBase),
      fechas: fechas.slice(0, FECHAS_DETALLADAS),
      fechasOmitidas: Math.max(0, fechas.length - FECHAS_DETALLADAS),
    };

    const sinCambios =
      cuadre.trabajadoresNuevos === 0 &&
      adscripciones.length === 0 &&
      cuadre.columnasNuevas === 0 &&
      cuadre.columnasRenombradas === 0 &&
      cuadre.columnasRetiradas === 0 &&
      cuadre.fechasNuevas === 0 &&
      cuadre.fechasCorregidas === 0 &&
      cuadre.fechasRetiradas === 0 &&
      cuadre.fechasReactivadas === 0;

    const ahora = this.#clock.now().getTime();
    const informe: InformeDeBarrido = {
      barridoId,
      recibidoEn: this.#clock.nowIso(),
      venceEn: new Date(ahora + VIGENCIA_MS).toISOString(),
      fuente: {
        nombreArchivo: snapshot.source.fileName,
        hoja: snapshot.source.sheetName,
        sha256: snapshot.source.sha256,
        extraidoEn: snapshot.extractedAt,
        cliente: input.cliente,
      },
      columnas,
      cuadre,
      muestras,
      detalle,
      sinCambios,
      bloqueado: reconciliado.conflicts.length > 0,
      incidencias: snapshot.diagnostics.issues.map((incidencia) => ({
        codigo: incidencia.code,
        cuenta: incidencia.count,
      })),
    };

    this.#barrido = { informe, snapshot, requestId: input.requestId };

    this.#comparacion = await this.#bitacora?.comparar(
      "MATRIZ",
      informe.fuente.sha256,
      informe.fuente.nombreArchivo,
    );
    // Se espera: si la respuesta saliera antes de guardar, un «Aplicar» rápido
    // en otra instancia no encontraría la revisión.
    await this.#revisiones?.guardar("BARRIDO_MATRIZ", {
      id: barridoId,
      contenido: {
        barrido: this.#barrido,
        ...(this.#comparacion ? { comparacion: this.#comparacion } : {}),
      } satisfies BarridoCompartido,
      venceEn: informe.venceEn,
    });
    await this.#bitacora?.registrar({
      tipo: "MATRIZ",
      hecho: "REVISADA",
      actor: input.cliente,
      archivo: informe.fuente.nombreArchivo,
      sha256: informe.fuente.sha256,
      solicitudId: input.requestId,
      resumen: {
        hoja: informe.fuente.hoja,
        trabajadoresEnMatriz: cuadre.trabajadoresEnMatriz,
        columnasEnMatriz: cuadre.columnasEnMatriz,
        // Lo que lee Control de cambios: quién entra, quién falta y quién se
        // movió. Las nóminas van de muestra, las mismas doce de la revisión.
        trabajadoresNuevos: cuadre.trabajadoresNuevos,
        muestraNuevos: informe.muestras.trabajadoresNuevos.join(", "),
        trabajadoresAusentes: cuadre.trabajadoresAusentes,
        muestraAusentes: informe.muestras.trabajadoresAusentes.join(", "),
        cambiosDePuesto: cuadre.cambiosDePuesto,
        cambiosDeArea: cuadre.cambiosDeArea,
        cambiosDeDepartamento: cuadre.cambiosDeDepartamento,
        columnasNuevas: cuadre.columnasNuevas,
        fechasNuevas: cuadre.fechasNuevas,
        fechasCorregidas: cuadre.fechasCorregidas,
        fechasRetiradas: cuadre.fechasRetiradas,
        conflictos: cuadre.conflictos,
        bloqueado: informe.bloqueado,
        sinCambios,
      },
    });
    return informe;
  }

  /** La revisión vigente, o `undefined` si venció o el proceso se reinició. */
  ultimoBarrido(): InformeDeBarrido | undefined {
    this.#podar();
    return this.#barrido?.informe;
  }

  /** El acuse de la última aplicación, mientras dure el proceso. */
  ultimoResultado(): ResultadoDeBarrido | undefined {
    return this.#resultado;
  }

  /** Olvida la revisión aquí y, si lo hay, en el almacén compartido. */
  descartar(): Promise<void> {
    this.#barrido = undefined;
    return this.#revisiones?.descartar("BARRIDO_MATRIZ") ?? Promise.resolve();
  }

  // ---------------------------------------------------------- la escritura

  /**
   * Aplica lo que la revisión describe. Un barrido se aplica una sola vez.
   *
   * El `requestId` es el que trajo el cliente, derivado de la huella del libro:
   * volver a aplicar la misma matriz es un no-op del lado del lote, no una
   * segunda importación.
   */
  async aplicar(barridoId: string, actor: string): Promise<ResultadoDeBarrido> {
    this.#podar();
    const guardado = this.#barrido;
    if (!guardado || guardado.informe.barridoId !== barridoId) {
      throw new DomainError(
        "BARRIDO_NO_DISPONIBLE",
        "La revisión ya no está disponible: un barrido nuevo vuelve a mostrar qué cambiaría.",
      );
    }
    if (guardado.informe.bloqueado) {
      // Se registra el rechazo, no sólo el éxito: un barrido bloqueado por
      // conflictos es precisamente el hecho que hay que poder consultar después,
      // cuando alguien pregunte por qué la matriz y la plataforma dejaron de
      // coincidir esa semana.
      await this.#bitacora?.registrar({
        tipo: "MATRIZ",
        hecho: "RECHAZADA",
        actor,
        archivo: guardado.informe.fuente.nombreArchivo,
        sha256: guardado.informe.fuente.sha256,
        solicitudId: guardado.requestId,
        resumen: {
          motivo: "BARRIDO_BLOQUEADO",
          conflictos: guardado.informe.cuadre.conflictos,
        },
      });
      throw new DomainError(
        "BARRIDO_BLOQUEADO",
        "El barrido contradice fechas que la plataforma liberó. Los conflictos se resuelven en la " +
          "matriz antes de aplicarlo: una importación no puede pisar una sesión ya liberada.",
      );
    }

    // Se retira antes de escribir: un doble clic no debe volverse dos
    // transacciones. La aplicación es idempotente por `requestId`, pero el
    // acuse que se enseña dejaría de ser cierto. Con almacén compartido el
    // retiro es atómico en la base: de dos instancias, sólo una lo gana.
    this.#barrido = undefined;
    if (this.#revisiones && !(await this.#revisiones.retirar("BARRIDO_MATRIZ", barridoId))) {
      throw new DomainError(
        "BARRIDO_NO_DISPONIBLE",
        "La revisión ya no está disponible: un barrido nuevo vuelve a mostrar qué cambiaría.",
      );
    }

    const aplicado = await this.#imports.importSnapshot({
      requestId: guardado.requestId,
      snapshot: guardado.snapshot,
      actorId: actor,
      scope: "FULL",
    });

    const resultado: ResultadoDeBarrido = {
      informe: guardado.informe,
      importId: aplicado.importId,
      aplicadoEn: this.#clock.nowIso(),
      aplicadoPor: actor,
      repetido: aplicado.repeated,
      conteos: aplicado.counts,
    };
    this.#resultado = resultado;
    await this.#bitacora?.registrar({
      tipo: "MATRIZ",
      hecho: "APLICADA",
      actor,
      archivo: guardado.informe.fuente.nombreArchivo,
      sha256: guardado.informe.fuente.sha256,
      solicitudId: guardado.requestId,
      resumen: {
        hoja: guardado.informe.fuente.hoja,
        importId: aplicado.importId,
        // Un lote repetido no escribió nada: la carga es idempotente por
        // `requestId` y volver a aplicar el mismo libro es un no-op. Se dice,
        // porque de otro modo el historial mostraría dos cargas iguales sin
        // explicar por qué la segunda no movió ninguna cifra.
        repetido: aplicado.repeated,
        insertadas: aplicado.counts.insertedCount,
        corregidas: aplicado.counts.correctedCount,
        retiradas: aplicado.counts.retiredCount,
        reactivadas: aplicado.counts.reactivatedCount,
        trabajadoresEnMatriz: guardado.informe.cuadre.trabajadoresEnMatriz,
        columnasEnMatriz: guardado.informe.cuadre.columnasEnMatriz,
      },
    });
    this.#comparacion = undefined;
    return resultado;
  }

  // ------------------------------------------------------------- interiores

  /**
   * Cada columna del barrido frente al catálogo de SQL.
   *
   * La clasificación sale de `resolveCourseMappings`, que es el mismo paso que
   * ejecutará la carga: lo que aquí se llama NUEVA es exactamente lo que allá
   * daría de alta una capacitación.
   */
  #clasificarColumnas(
    snapshot: MatrixSnapshot,
    cursos: readonly CourseCatalogEntry[],
  ): ColumnaDetectada[] {
    const resuelto = resolveCourseMappings(snapshot.courses, cursos, [], true);
    const nuevas = new Set(resuelto.newCourses.map((curso) => curso.sourceKey));
    const actualizadas = new Set(resuelto.updatedCourses.map((curso) => curso.sourceKey));
    const porIdentidad = new Map(cursos.map((curso) => [curso.trainingId, curso]));

    const fechasPorColumna = new Map<string, number>();
    for (const fecha of snapshot.completions) {
      fechasPorColumna.set(fecha.sourceKey, (fechasPorColumna.get(fecha.sourceKey) ?? 0) + 1);
    }

    return snapshot.courses.map((curso) => {
      const estado: EstadoDeColumna = nuevas.has(curso.sourceKey)
        ? "NUEVA"
        : actualizadas.has(curso.sourceKey)
          ? "RENOMBRADA"
          : "COINCIDE";
      const identidad = resuelto.sourceKeyToTrainingId.get(curso.sourceKey);
      const enBase = identidad === undefined ? undefined : porIdentidad.get(identidad);
      const nombreEnBase =
        estado === "RENOMBRADA" && enBase && enBase.sourceName !== curso.displayName
          ? enBase.sourceName
          : undefined;

      return {
        columna: curso.sourceColumn,
        nombre: curso.displayName,
        claveOrigen: curso.sourceKey,
        fechas: fechasPorColumna.get(curso.sourceKey) ?? 0,
        estado,
        ...(nombreEnBase === undefined ? {} : { nombreEnBase }),
      };
    });
  }

  /**
   * Puesto, área y departamento de quien está en los dos lados.
   *
   * Se reporta también el campo que la base tenía vacío y la matriz llena: es
   * una escritura real, y esconderla haría que el acuse enseñara cambios que la
   * revisión nunca anunció.
   */
  /**
   * Cada dato del trabajador que la aplicación reescribiría, sólo si cambia.
   *
   * Son los mismos campos que el reconciliador actualiza —nombre, alta, nómina,
   * puesto, área, departamento, planta y reactivación—, comparados sin
   * mayúsculas ni espacios de más: un cambio que sólo es de formato no se
   * enseña, porque no cambia nada que alguien vaya a leer.
   */
  #datosQueCambian(
    snapshot: MatrixSnapshot,
    enBase: ReadonlyMap<string, WorkerCatalogEntry>,
  ): MovimientoDelCambio[] {
    const cambios: MovimientoDelCambio[] = [];
    for (const empleado of snapshot.employees) {
      const actual = enBase.get(empleado.employeeId);
      if (!actual) continue;
      const campos: readonly (readonly [string, string | null, string | null])[] = [
        ["Nombre", actual.displayName, empleado.displayName],
        ["Fecha de alta", actual.hireDate, empleado.hireDate],
        ["Nómina", actual.payrollType, empleado.payrollType],
        ["Puesto", actual.position, empleado.position],
        ["Área", actual.area, empleado.area],
        ["Departamento", actual.department, empleado.department],
        ["Planta", actual.plant, empleado.plant],
      ];
      for (const [campo, antes, ahora] of campos) {
        if (clave(antes) === clave(ahora)) continue;
        cambios.push({
          nomina: empleado.employeeId,
          nombre: empleado.displayName,
          campo,
          antes: textoVisible(antes),
          ahora: textoVisible(ahora),
        });
      }
      if (!actual.active) {
        cambios.push({
          nomina: empleado.employeeId,
          nombre: empleado.displayName,
          campo: "Estado",
          antes: "Inactivo",
          ahora: "Activo",
        });
      }
    }
    return cambios;
  }

  #compararAdscripciones(
    snapshot: MatrixSnapshot,
    trabajadores: readonly WorkerCatalogEntry[],
  ): CambioDeAdscripcion[] {
    const porNumero = new Map(trabajadores.map((fila) => [fila.workerNumber as string, fila]));
    const cambios: CambioDeAdscripcion[] = [];

    for (const empleado of snapshot.employees) {
      const actual = porNumero.get(empleado.employeeId);
      if (!actual) continue;

      const campos = [
        { campo: "PUESTO" as const, antes: actual.position, ahora: empleado.position },
        { campo: "AREA" as const, antes: actual.area, ahora: empleado.area },
        { campo: "DEPARTAMENTO" as const, antes: actual.department, ahora: empleado.department },
      ];

      for (const { campo, antes, ahora } of campos) {
        if (clave(antes) === clave(ahora)) continue;
        cambios.push({
          numeroTrabajador: empleado.employeeId,
          campo,
          antes: textoVisible(antes),
          ahora: textoVisible(ahora),
        });
      }
    }
    return cambios;
  }

  #podar(): void {
    if (
      this.#barrido &&
      new Date(this.#barrido.informe.venceEn).getTime() <= this.#clock.now().getTime()
    ) {
      this.#barrido = undefined;
    }
  }
}
