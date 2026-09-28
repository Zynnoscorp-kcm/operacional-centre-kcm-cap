/**
 * Ingesta del padrón semanal desde la consola.
 *
 * Es la misma operación que `scripts/ingest-roster.js` hace por línea de
 * comandos, con la misma regla de oro: leer no escribe. Subir el archivo
 * produce un plan —qué cambiaría y en qué no cuadra con lo que hay— y sólo un
 * segundo acto explícito lo aplica. El script llama a eso `--aplicar`; aquí es
 * un botón.
 *
 * Tres decisiones de costo, que en esta instalación son decisiones de diseño:
 *
 * 1. Una lectura por archivo. El padrón entero de la base cabe en memoria
 *    —menos de 2 000 filas cortas— y se compara ahí. La alternativa, consultar
 *    por trabajador, son 1 700 viajes contra un presupuesto que no los tiene.
 * 2. El plan se guarda en el proceso, no en la base. Entre la vista previa
 *    y el botón no hay nada que persistir: si el proceso se duerme —el
 *    alojamiento gratuito lo hace a los quince minutos— el plan se pierde y se
 *    vuelve a subir el archivo, que cuesta una lectura más y ninguna escritura.
 * 3. El archivo no se guarda en ningún lado. Se lee en memoria y se
 *    descarta; lo único que queda es su SHA-256 en el plan.
 */

import { randomUUID } from "node:crypto";

import type { Clock } from "../../ports/reloj.port.ts";
import type { RevisionesCompartidasPort } from "../../ports/revisiones-compartidas.port.ts";
import type {
  EscriturasDePadron,
  FilaDePadronBase,
  RosterRepositoryPort,
} from "../../ports/padron.port.ts";
import type { BitacoraDeCargas } from "../cargas/bitacora.ts";
import type { ComparacionConLaAnterior } from "../cargas/tipos.ts";
import { DomainError } from "../comun/errores.ts";
import type {
  CambioDePuesto,
  CuadreDePadron,
  Divergencia,
  EmpleadoDelPadron,
  MuestrasDeCuadre,
  OrigenDelPadron,
  PlanDePadron,
  ResultadoDePadron,
  RosterExtractorPort,
} from "./tipos.ts";
import { adscripcion, type DetalleDeCambios, type MovimientoDelCambio } from "../cargas/detalle.ts";
import type { DatoDelPadron } from "../../ports/padron.port.ts";

/**
 * Las columnas personales del padrón: dónde viven en la base, cómo se rotulan
 * y de qué campo del archivo salen. Se escriben siempre que el archivo traiga
 * un valor distinto; una celda vacía no borra lo que ya había.
 */
const COLUMNAS_PERSONALES: readonly (readonly [
  DatoDelPadron,
  string,
  (empleado: EmpleadoDelPadron) => string | undefined,
  (fila: FilaDePadronBase) => string | null | undefined,
])[] = [
  ["rfc", "RFC", (e) => e.rfc, (f) => f.rfc],
  ["nss", "IMSS", (e) => e.nss, (f) => f.nss],
  ["centro_costos_clave", "Centro de costos", (e) => e.costCenterKey, (f) => f.centroCostosClave],
  [
    "centro_costos_nombre",
    "Nombre del centro de costos",
    (e) => e.costCenterName,
    (f) => f.centroCostosNombre,
  ],
  ["direccion", "Dirección", (e) => e.address, (f) => f.direccion],
  ["codigo_postal", "Código postal", (e) => e.postalCode, (f) => f.codigoPostal],
  ["estado_civil", "Estado civil", (e) => e.maritalStatus, (f) => f.estadoCivil],
  ["sexo", "Sexo", (e) => e.sex, (f) => f.sexo],
];

/** Cuántos números se enseñan de cada lista. Lo demás es un conteo. */
const MUESTRA = 12;
const PLANES_EN_MEMORIA = 3;
const VIGENCIA_DEL_PLAN_MS = 30 * 60 * 1000;

/** La subida manual de siempre, cuando nadie declara de dónde vino el archivo. */
const ORIGEN_POR_OMISION: OrigenDelPadron = { tipo: "CONSOLA", actor: "consola" };

interface PlanGuardado {
  readonly plan: PlanDePadron;
  readonly escrituras: EscriturasDePadron;
  readonly venceEn: number;
}

/** Lo que se comparte entre instancias: el plan y su comparación ya resuelta. */
interface PlanCompartido {
  readonly guardado: PlanGuardado;
  readonly comparacion?: ComparacionConLaAnterior;
}

function clave(texto: string | null | undefined): string {
  return (texto ?? "").trim().toUpperCase();
}

function textoVisible(valor: string | null | undefined): string {
  const limpio = (valor ?? "").trim();
  return limpio === "" ? "(sin dato)" : limpio;
}

export class RosterIngestService {
  readonly #repository: RosterRepositoryPort;
  readonly #extractor: RosterExtractorPort;
  readonly #clock: Clock;
  readonly #planes = new Map<string, PlanGuardado>();
  /**
   * Opcional a propósito: una corrida sin base no tiene dónde escribir asientos
   * y no por eso debe dejar de poder revisar un archivo. Donde falta, el padrón
   * se comporta como antes de esta ejecución.
   */
  readonly #bitacora: BitacoraDeCargas | undefined;
  /**
   * La comparación de la revisión viva, resuelta al leer el archivo y no al
   * pintarla. La pantalla se dibuja muchas veces —cada recarga, cada vuelta del
   * vigilante— y consultar la última carga aplicada en cada dibujo sería una
   * consulta por visita contra un enlace que va a 17 KB/s.
   */
  #comparacion: ComparacionConLaAnterior | undefined;

  /**
   * Encargo de barrido pendiente y última revisión recibida.
   *
   * Existen por el mismo motivo que en la matriz: el archivo puede llegar por
   * el puente en lugar de por el formulario, y entonces la revisión aparece sin
   * que ninguna petición del navegador la haya producido. La pantalla necesita
   * poder preguntar «¿qué hay?» en vez de recibirla como respuesta a un POST.
   */
  #ultimoPlanId: string | undefined;
  /**
   * Donde hay base, el plan también espera en `sistema.revision_pendiente`:
   * publicada con varias instancias, el «Aplicar» puede llegar a una que no
   * leyó el archivo. Sin él, todo queda en este proceso, como antes.
   */
  readonly #revisiones: RevisionesCompartidasPort | undefined;

  constructor(input: {
    repository: RosterRepositoryPort;
    extractor: RosterExtractorPort;
    clock: Clock;
    bitacora?: BitacoraDeCargas;
    revisiones?: RevisionesCompartidasPort;
  }) {
    this.#repository = input.repository;
    this.#extractor = input.extractor;
    this.#clock = input.clock;
    this.#bitacora = input.bitacora;
    this.#revisiones = input.revisiones;
  }

  /**
   * Trae el plan compartido, si lo hay. Las rutas la llaman antes de leer el
   * estado. El almacén manda: si otra instancia aplicó o descartó, aquí se
   * olvida la copia local.
   */
  async sincronizar(): Promise<void> {
    if (!this.#revisiones) return;
    const vigente = await this.#revisiones.vigente("PADRON");
    if (vigente !== undefined && this.#ultimoPlanId === vigente && this.#planes.has(vigente)) {
      return;
    }
    const guardada = vigente === undefined ? undefined : await this.#revisiones.leer("PADRON");
    if (!guardada) {
      this.#planes.clear();
      this.#ultimoPlanId = undefined;
      this.#comparacion = undefined;
      return;
    }
    const compartido = guardada.contenido as PlanCompartido;
    this.#planes.clear();
    this.#planes.set(guardada.id, compartido.guardado);
    this.#ultimoPlanId = guardada.id;
    this.#comparacion = compartido.comparacion;
  }

  /** Lo que se sabe de la carga anterior, para la revisión que está en pantalla. */
  comparacion(): ComparacionConLaAnterior | undefined {
    return this.#comparacion;
  }

  /** La última revisión viva, venga del formulario o del puente. */
  ultimoPlan(): PlanDePadron | undefined {
    this.#podar(this.#clock.now().getTime());
    return this.#ultimoPlanId === undefined
      ? undefined
      : this.#planes.get(this.#ultimoPlanId)?.plan;
  }

  /** Olvida la revisión aquí y, si lo hay, en el almacén compartido. */
  descartar(): Promise<void> {
    if (this.#ultimoPlanId !== undefined) this.#planes.delete(this.#ultimoPlanId);
    this.#ultimoPlanId = undefined;
    return this.#revisiones?.descartar("PADRON") ?? Promise.resolve();
  }

  /**
   * Lee el archivo y lo confronta con la base. No escribe nada.
   *
   * Un libro con otra forma —hojas o encabezados distintos— falla aquí y dice
   * qué no resolvió: es preferible a adivinar una columna y escribir CURP en el
   * trabajador equivocado.
   */
  async previsualizar(
    archivo: Buffer,
    nombreArchivo: string,
    origen: OrigenDelPadron = ORIGEN_POR_OMISION,
  ): Promise<PlanDePadron> {
    let leido;
    try {
      leido = this.#extractor.extraer(archivo);
    } catch (error) {
      throw new DomainError(
        "INVALID_ROSTER_FILE",
        `El archivo no tiene la forma del padrón semanal: ${(error as Error).message}`,
      );
    }

    const [base, puestos] = await Promise.all([
      this.#repository.leerPadronBase(),
      this.#repository.leerPuestos(),
    ]);

    const porNumero = new Map<string, FilaDePadronBase>(
      base.map((fila) => [fila.numeroTrabajador, fila]),
    );
    const catalogoDePuestos = new Map(puestos.map((puesto) => [clave(puesto.nombre), puesto]));
    const enArchivo = new Set<string>();

    const curp: [string, string][] = [];
    const altas: [string, string][] = [];
    const inducciones: [string, string, string][] = [];
    const desconocidos: string[] = [];
    const puestosNuevos = new Set<string>();
    /**
     * Lo que el padrón dice y la base no.
     *
     * Se acumulan y no se escriben: por decisión del departamento la matriz
     * sigue mandando en estos dos campos, porque la plataforma la consulta mucho
     * más. El padrón es, aun así, la fuente de mayor autoridad sobre cómo está
     * contratada una persona y en qué planta trabaja, de modo que cuando las dos
     * difieren hay algo que revisar. Denunciarlo es lo único que puede hacer una
     * carga que no tiene permiso para resolverlo.
     */
    const nominasDivergentes: Divergencia[] = [];
    const plantasDivergentes: Divergencia[] = [];
    /**
     * La clave de ocupación se escribe tal como llega, por trabajador.
     *
     * Antes se consolidaba por puesto y el puesto con dos claves distintas se
     * rechazaba entero. Esa regla venía de creer que la ocupación describía al
     * puesto; con la regla real —varía por puesto y área— un mismo puesto en dos
     * áreas trae dos claves legítimas, y consolidarlas perdía las dos.
     */
    const ocupaciones: [string, string][] = [];
    let ocupacionesQueCoinciden = 0;
    /**
     * Lo que sí sigue siendo sospechoso: dos claves distintas dentro del mismo
     * par `(puesto, área)`, que por la regla del departamento debería ser
     * uniforme. No bloquea —el archivo manda— pero se cuenta y se enseña,
     * porque es la forma que tiene un error de captura de verse.
     */
    const clavesPorAdscripcion = new Map<string, Set<string>>();
    const conflictos: string[] = [];
    /**
     * El cambio de puesto se guarda con nombre y no sólo como cuenta: «doce
     * cambios de puesto» no permite revisar ninguno, y es justo el dato que hay
     * que mirar cuando un DC-3 sale con la ocupación equivocada.
     */
    const cambiosDePuesto: CambioDePuesto[] = [];
    let reconocidos = 0;
    let altasQueCoinciden = 0;
    /** Todo lo que le cambia a cada quien, escrito o sólo avisado, con su valor anterior. */
    const movimientos: MovimientoDelCambio[] = [];
    const datos: [string, DatoDelPadron, string][] = [];
    const reactivar: string[] = [];

    for (const empleado of leido.employees) {
      enArchivo.add(empleado.employeeId);
      const actual = porNumero.get(empleado.employeeId);
      if (!actual) {
        desconocidos.push(empleado.employeeId);
        continue;
      }
      reconocidos += 1;
      const quien = { nomina: empleado.employeeId, nombre: empleado.displayName };
      if (!actual.activo) {
        reactivar.push(actual.trabajadorId);
        movimientos.push({ ...quien, campo: "Estado", antes: "Baja", ahora: "Activo" });
      }
      if (empleado.curp && empleado.curp !== actual.curp) {
        movimientos.push({
          ...quien,
          campo: "CURP",
          antes: actual.curp ?? "",
          ahora: empleado.curp,
        });
      }
      if (empleado.hireDate && empleado.hireDate !== actual.fechaAlta) {
        movimientos.push({
          ...quien,
          campo: "Fecha de alta",
          antes: actual.fechaAlta ?? "",
          ahora: empleado.hireDate,
        });
      }
      // El nombre lo escribe la matriz; aquí sólo se avisa si el padrón lo dice distinto.
      if (
        empleado.displayName &&
        actual.nombre &&
        clave(empleado.displayName) !== clave(actual.nombre)
      ) {
        movimientos.push({
          ...quien,
          campo: "Nombre",
          antes: actual.nombre,
          ahora: empleado.displayName,
          soloAviso: true,
        });
      }
      for (const [columna, rotulo, delArchivo, deLaBase] of COLUMNAS_PERSONALES) {
        const nuevo = (delArchivo(empleado) ?? "").trim();
        const anterior = (deLaBase(actual) ?? "").trim();
        if (nuevo === "" || clave(nuevo) === clave(anterior)) continue;
        datos.push([actual.trabajadorId, columna, nuevo]);
        movimientos.push({ ...quien, campo: rotulo, antes: anterior, ahora: nuevo });
      }

      if (empleado.curp && empleado.curp !== actual.curp) {
        curp.push([actual.trabajadorId, empleado.curp]);
      }
      if (empleado.hireDate) {
        if (empleado.hireDate === actual.fechaAlta) altasQueCoinciden += 1;
        else altas.push([actual.trabajadorId, empleado.hireDate]);
        // La clave lleva trabajador y fecha: si el departamento corrige un alta,
        // entra un registro nuevo en vez de sobrescribir el anterior en silencio.
        inducciones.push([
          `roster-alta:${empleado.employeeId}:${empleado.hireDate}`,
          actual.trabajadorId,
          empleado.hireDate,
        ]);
      }
      if (empleado.position) {
        const fueraDeCatalogo = !catalogoDePuestos.has(clave(empleado.position));
        if (fueraDeCatalogo) puestosNuevos.add(empleado.position);
        // El cambio se reporta aunque el puesto nuevo no esté en el catálogo.
        // Antes no: la rama estaba encadenada a «puesto nuevo» con un `else`, de
        // modo que mudarse a un puesto sin declarar no contaba como mudanza. Son
        // dos hechos distintos —la persona se movió, y el destino no está en el
        // catálogo— y el segundo no debe tapar al primero.
        if (actual.puesto && clave(empleado.position) !== clave(actual.puesto)) {
          cambiosDePuesto.push({
            numeroTrabajador: empleado.employeeId,
            antes: textoVisible(actual.puesto),
            ahora: empleado.position,
            fueraDeCatalogo,
          });
        }
      }

      // Tipo de nómina: el padrón lo declara por la hoja en que viene la fila,
      // y la base lo tiene puesto por la matriz. Sólo se compara cuando las dos
      // partes tienen valor: contra una base sin dato no hay divergencia, hay
      // un hueco, y son cosas distintas.
      if (empleado.payrollType && actual.tipoNomina) {
        if (clave(empleado.payrollType) !== clave(actual.tipoNomina)) {
          nominasDivergentes.push({
            numeroTrabajador: empleado.employeeId,
            enPadron: empleado.payrollType,
            enBase: actual.tipoNomina,
          });
        }
      }

      if (empleado.plant && actual.planta) {
        if (clave(empleado.plant) !== clave(actual.planta)) {
          plantasDivergentes.push({
            numeroTrabajador: empleado.employeeId,
            enPadron: empleado.plant,
            enBase: actual.planta,
          });
        }
      }

      // La clave de ocupación no depende del puesto del catálogo: se escribe a
      // quien la traiga, exista o no su puesto. Un puesto sin declarar es otro
      // problema y ya tiene su propio aviso.
      if (empleado.cnoKey) {
        if (clave(actual.claveOcupacion) === empleado.cnoKey) ocupacionesQueCoinciden += 1;
        else {
          ocupaciones.push([actual.trabajadorId, empleado.cnoKey]);
          movimientos.push({
            ...quien,
            campo: "Clave de ocupación",
            antes: actual.claveOcupacion ?? "",
            ahora: empleado.cnoKey,
          });
        }

        // El par se arma con el puesto del archivo y el área de la base: el
        // archivo no trae área, y es la matriz la que la sabe.
        const adscripcion = `${clave(empleado.position)}|${clave(actual.area)}`;
        const vistas = clavesPorAdscripcion.get(adscripcion);
        if (vistas) vistas.add(empleado.cnoKey);
        else clavesPorAdscripcion.set(adscripcion, new Set([empleado.cnoKey]));
      }
    }

    // Un par `(puesto, área)` con más de una clave. Se denuncia sin bloquear:
    // el archivo es la autoridad y puede haber un motivo, pero la causa
    // habitual es un dedazo y sin esto no se vería nunca.
    for (const [adscripcion, vistas] of clavesPorAdscripcion) {
      if (vistas.size < 2) continue;
      const [puesto = "", area = ""] = adscripcion.split("|");
      conflictos.push(
        `${puesto || "(sin puesto)"} · ${area || "(sin área)"}: ${[...vistas].join(" / ")}`,
      );
    }

    const filasAusentes = base.filter(
      (fila) => fila.activo && !enArchivo.has(fila.numeroTrabajador),
    );
    const ausentes = filasAusentes.map((fila) => fila.numeroTrabajador);

    // Quién es quién, con nombre: los que no están en la base salen del archivo,
    // los que ya no vienen salen de la base.
    const conocidos = new Set(desconocidos);
    const nombreEnArchivo = new Map(
      leido.employees.map((empleado) => [empleado.employeeId, empleado.displayName]),
    );
    // Lo que el padrón informa y no escribe, porque en esos datos manda la matriz.
    const nombreDe = (nomina: string): string =>
      nombreEnArchivo.get(nomina) ?? porNumero.get(nomina)?.nombre ?? "";
    for (const cambio of cambiosDePuesto) {
      movimientos.push({
        nomina: cambio.numeroTrabajador,
        nombre: nombreDe(cambio.numeroTrabajador),
        campo: "Puesto",
        antes: cambio.antes,
        ahora: cambio.ahora,
        soloAviso: true,
      });
    }
    for (const [campo, lista] of [
      ["Tipo de nómina", nominasDivergentes],
      ["Planta", plantasDivergentes],
    ] as const) {
      for (const divergencia of lista) {
        movimientos.push({
          nomina: divergencia.numeroTrabajador,
          nombre: nombreDe(divergencia.numeroTrabajador),
          campo,
          antes: divergencia.enBase,
          ahora: divergencia.enPadron,
          soloAviso: true,
        });
      }
    }

    // La baja: sólo quien tampoco estuvo en la última matriz. Los demás siguen
    // activos y se avisa que el padrón ya no los trae.
    const fechaDeBaja = new Map(
      (leido.terminations ?? []).map((baja) => [baja.employeeId, baja.terminationDate]),
    );
    const seDanDeBaja = filasAusentes.filter((fila) => fila.vistoEnMatriz === false);

    const detalle: DetalleDeCambios = {
      altas: leido.employees
        .filter((empleado) => conocidos.has(empleado.employeeId))
        .map((empleado) => ({
          nomina: empleado.employeeId,
          nombre: empleado.displayName,
          adscripcion: adscripcion(empleado.position),
          nota: "Entra con la matriz",
          soloAviso: true,
        })),
      bajas: filasAusentes.map((fila) => {
        const baja = fila.vistoEnMatriz === false;
        const fecha = fechaDeBaja.get(fila.numeroTrabajador);
        return {
          nomina: fila.numeroTrabajador,
          nombre: fila.nombre ?? "",
          adscripcion: adscripcion(fila.puesto, fila.area),
          nota: baja ? "Se da de baja" : "Sigue activo: está en la matriz",
          ...(fecha ? { fechaDeBaja: fecha } : {}),
          ...(baja ? {} : { soloAviso: true }),
        };
      }),
      movimientos,
      fechas: [],
      fechasOmitidas: 0,
    };

    // Sin esto la pantalla anunciaría mil seiscientas inducciones cada semana.
    // Lo que importa es cuántas entrarían de verdad y cuántas chocan con una
    // fecha ya registrada, que son las que nadie debe escribir sin decidirlo.
    const revisadas = await this.#repository.revisarInducciones(
      inducciones.map(([, trabajadorId, fecha]) => ({ trabajadorId, fecha })),
    );

    const cuadre: CuadreDePadron = {
      activosEnArchivo: leido.diagnostics.employeeCount,
      sinIncidencias: leido.diagnostics.readyEmployeeCount,
      reconocidos,
      desconocidos: desconocidos.length,
      ausentes: ausentes.length,
      curpPorEscribir: curp.length,
      altasPorCorregir: altas.length,
      altasQueCoinciden,
      induccionesNuevas: revisadas.nuevas,
      induccionesDivergentes: revisadas.divergentes,
      puestosNuevos: puestosNuevos.size,
      puestosCambiados: cambiosDePuesto.length,
      nominasDivergentes: nominasDivergentes.length,
      plantasDivergentes: plantasDivergentes.length,
      traeColumnaPlanta: leido.employees.some((empleado) => empleado.plant !== ""),
      traeColumnaCno: leido.employees.some((empleado) => empleado.cnoKey !== ""),
      cnoPorEscribir: ocupaciones.length,
      cnoQueCoinciden: ocupacionesQueCoinciden,
      cnoEnConflicto: conflictos.length,
      datosPorEscribir: datos.length,
      bajas: seDanDeBaja.length,
      reactivados: reactivar.length,
    };

    const muestras: MuestrasDeCuadre = {
      desconocidos: desconocidos.slice(0, MUESTRA),
      ausentes: ausentes.slice(0, MUESTRA),
      puestosNuevos: [...puestosNuevos].slice(0, MUESTRA),
      cnoEnConflicto: conflictos.slice(0, MUESTRA),
      cambiosDePuesto: cambiosDePuesto.slice(0, MUESTRA),
      nominasDivergentes: nominasDivergentes.slice(0, MUESTRA),
      plantasDivergentes: plantasDivergentes.slice(0, MUESTRA),
      incidencias: leido.diagnostics.issues,
    };

    const ahora = this.#clock.now().getTime();
    const plan: PlanDePadron = {
      planId: randomUUID(),
      nombreArchivo,
      sha256: leido.source.sha256,
      leidoEn: this.#clock.nowIso(),
      origen,
      hojas: leido.diagnostics.sheets ?? [],
      cuadre,
      muestras,
      detalle,
      sinCambios:
        curp.length === 0 &&
        altas.length === 0 &&
        revisadas.nuevas === 0 &&
        ocupaciones.length === 0 &&
        datos.length === 0 &&
        reactivar.length === 0 &&
        ausentes.length === 0,
    };

    this.#podar(ahora);
    const guardado: PlanGuardado = {
      plan,
      escrituras: {
        curp,
        altas,
        inducciones,
        ocupaciones,
        datos,
        enArchivo: [...enArchivo],
        fechasDeBaja: filasAusentes
          .map((fila) => [fila.numeroTrabajador, fechaDeBaja.get(fila.numeroTrabajador)] as const)
          .filter((par): par is readonly [string, string] => par[1] !== undefined),
        reactivar,
      },
      venceEn: ahora + VIGENCIA_DEL_PLAN_MS,
    };
    this.#planes.set(plan.planId, guardado);
    this.#ultimoPlanId = plan.planId;

    // La comparación sí se espera: es parte de la revisión que se devuelve y sin
    // ella la pantalla no puede decir si este archivo ya se aplicó.
    this.#comparacion = await this.#bitacora?.comparar("PADRON", plan.sha256, nombreArchivo);
    // También se espera el guardado: un «Aplicar» rápido en otra instancia debe
    // encontrarlo.
    await this.#revisiones?.guardar("PADRON", {
      id: plan.planId,
      contenido: {
        guardado,
        ...(this.#comparacion ? { comparacion: this.#comparacion } : {}),
      } satisfies PlanCompartido,
      venceEn: new Date(guardado.venceEn).toISOString(),
    });
    await this.#bitacora?.registrar({
      tipo: "PADRON",
      hecho: "REVISADA",
      actor: origen.actor,
      archivo: nombreArchivo,
      sha256: plan.sha256,
      solicitudId: plan.planId,
      resumen: {
        origen: origen.tipo,
        activosEnArchivo: cuadre.activosEnArchivo,
        desconocidos: cuadre.desconocidos,
        muestraDesconocidos: plan.muestras.desconocidos.join(", "),
        ausentes: cuadre.ausentes,
        muestraAusentes: plan.muestras.ausentes.join(", "),
        puestosCambiados: cuadre.puestosCambiados,
        curpPorEscribir: cuadre.curpPorEscribir,
        altasPorCorregir: cuadre.altasPorCorregir,
        induccionesNuevas: cuadre.induccionesNuevas,
        puestosNuevos: cuadre.puestosNuevos,
        sinCambios: plan.sinCambios,
      },
    });
    return plan;
  }

  /** El plan vigente, o `undefined` si venció o el proceso se reinició. */
  obtener(planId: string): PlanDePadron | undefined {
    this.#podar(this.#clock.now().getTime());
    return this.#planes.get(planId)?.plan;
  }

  /**
   * Escribe lo que el plan describe. Un plan se aplica una sola vez.
   *
   * El actor es obligatorio: el padrón escribe CURP y fechas de alta de todo el
   * personal, y sin actor esa escritura quedaría sin constancia de quién la
   * pidió.
   */
  async aplicar(planId: string, actor: string): Promise<ResultadoDePadron> {
    this.#podar(this.#clock.now().getTime());
    const guardado = this.#planes.get(planId);
    if (!guardado) {
      await this.#bitacora?.registrar({
        tipo: "PADRON",
        hecho: "RECHAZADA",
        actor,
        archivo: "(revisión vencida)",
        sha256: "",
        solicitudId: planId,
        resumen: { motivo: "ROSTER_PLAN_NOT_FOUND" },
      });
      throw new DomainError(
        "ROSTER_PLAN_NOT_FOUND",
        "La revisión ya no está disponible. Vuelva a subir el archivo para confirmar qué cambiaría.",
      );
    }
    // Se retira antes de escribir: un doble clic no debe convertirse en dos
    // transacciones. Las escrituras son idempotentes de todos modos, pero el
    // resultado que se enseña dejaría de ser cierto.
    this.#planes.delete(planId);
    if (this.#ultimoPlanId === planId) this.#ultimoPlanId = undefined;
    // Con almacén compartido el retiro es atómico en la base: de dos «Aplicar»
    // en instancias distintas, sólo uno escribe.
    if (this.#revisiones && !(await this.#revisiones.retirar("PADRON", planId))) {
      throw new DomainError(
        "ROSTER_PLAN_NOT_FOUND",
        "La revisión ya no está disponible. Vuelva a subir el archivo para confirmar qué cambiaría.",
      );
    }

    const escrito = await this.#repository.aplicar(guardado.escrituras);
    // Después de escribir, no antes: un asiento de carga aplicada que precede a
    // la escritura mentiría si la transacción abortara. La bitácora describe
    // hechos consumados y ésta es la única línea que fija ese orden.
    await this.#bitacora?.registrar({
      tipo: "PADRON",
      hecho: "APLICADA",
      actor,
      archivo: guardado.plan.nombreArchivo,
      sha256: guardado.plan.sha256,
      solicitudId: planId,
      resumen: {
        origen: guardado.plan.origen.tipo,
        activosEnArchivo: guardado.plan.cuadre.activosEnArchivo,
        curp: escrito.curp,
        altas: escrito.altas,
        inducciones: escrito.inducciones,
        ocupaciones: escrito.ocupaciones,
        desconocidos: guardado.plan.cuadre.desconocidos,
        ausentes: guardado.plan.cuadre.ausentes,
      },
    });
    // La revisión aplicada deja de tener con qué compararse: la carga anterior
    // pasó a ser ésta.
    this.#comparacion = undefined;
    return { plan: guardado.plan, ...escrito, aplicadoEn: this.#clock.nowIso() };
  }

  #podar(ahora: number): void {
    for (const [id, guardado] of this.#planes) {
      if (guardado.venceEn <= ahora) this.#planes.delete(id);
    }
    while (this.#planes.size > PLANES_EN_MEMORIA) {
      const masViejo = this.#planes.keys().next();
      if (masViejo.done === true) break;
      this.#planes.delete(masViejo.value);
    }
  }
}
