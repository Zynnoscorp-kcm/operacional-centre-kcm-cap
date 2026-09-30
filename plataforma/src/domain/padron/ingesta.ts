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

const MUESTRA = 12;
const PLANES_EN_MEMORIA = 3;
const VIGENCIA_DEL_PLAN_MS = 30 * 60 * 1000;

const ORIGEN_POR_OMISION: OrigenDelPadron = { tipo: "CONSOLA", actor: "consola" };

interface PlanGuardado {
  readonly plan: PlanDePadron;
  readonly escrituras: EscriturasDePadron;
  readonly venceEn: number;
}

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
  readonly #bitacora: BitacoraDeCargas | undefined;
  #comparacion: ComparacionConLaAnterior | undefined;

  #ultimoPlanId: string | undefined;
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

  comparacion(): ComparacionConLaAnterior | undefined {
    return this.#comparacion;
  }

  ultimoPlan(): PlanDePadron | undefined {
    this.#podar(this.#clock.now().getTime());
    return this.#ultimoPlanId === undefined
      ? undefined
      : this.#planes.get(this.#ultimoPlanId)?.plan;
  }

  descartar(): Promise<void> {
    if (this.#ultimoPlanId !== undefined) this.#planes.delete(this.#ultimoPlanId);
    this.#ultimoPlanId = undefined;
    return this.#revisiones?.descartar("PADRON") ?? Promise.resolve();
  }

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
    const nominasDivergentes: Divergencia[] = [];
    const plantasDivergentes: Divergencia[] = [];
    const ocupaciones: [string, string][] = [];
    let ocupacionesQueCoinciden = 0;
    const clavesPorAdscripcion = new Map<string, Set<string>>();
    const conflictos: string[] = [];
    const cambiosDePuesto: CambioDePuesto[] = [];
    let reconocidos = 0;
    let altasQueCoinciden = 0;
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
        inducciones.push([
          `roster-alta:${empleado.employeeId}:${empleado.hireDate}`,
          actual.trabajadorId,
          empleado.hireDate,
        ]);
      }
      if (empleado.position) {
        const fueraDeCatalogo = !catalogoDePuestos.has(clave(empleado.position));
        if (fueraDeCatalogo) puestosNuevos.add(empleado.position);
        if (actual.puesto && clave(empleado.position) !== clave(actual.puesto)) {
          cambiosDePuesto.push({
            numeroTrabajador: empleado.employeeId,
            antes: textoVisible(actual.puesto),
            ahora: empleado.position,
            fueraDeCatalogo,
          });
        }
      }

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

        const adscripcion = `${clave(empleado.position)}|${clave(actual.area)}`;
        const vistas = clavesPorAdscripcion.get(adscripcion);
        if (vistas) vistas.add(empleado.cnoKey);
        else clavesPorAdscripcion.set(adscripcion, new Set([empleado.cnoKey]));
      }
    }

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

    const conocidos = new Set(desconocidos);
    const nombreEnArchivo = new Map(
      leido.employees.map((empleado) => [empleado.employeeId, empleado.displayName]),
    );
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

    this.#comparacion = await this.#bitacora?.comparar("PADRON", plan.sha256, nombreArchivo);
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

  obtener(planId: string): PlanDePadron | undefined {
    this.#podar(this.#clock.now().getTime());
    return this.#planes.get(planId)?.plan;
  }

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
    this.#planes.delete(planId);
    if (this.#ultimoPlanId === planId) this.#ultimoPlanId = undefined;
    if (this.#revisiones && !(await this.#revisiones.retirar("PADRON", planId))) {
      throw new DomainError(
        "ROSTER_PLAN_NOT_FOUND",
        "La revisión ya no está disponible. Vuelva a subir el archivo para confirmar qué cambiaría.",
      );
    }

    const escrito = await this.#repository.aplicar(guardado.escrituras);
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
