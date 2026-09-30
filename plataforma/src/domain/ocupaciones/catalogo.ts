import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface Subarea {
  readonly clave: string;
  readonly denominacion: string;
  readonly area: string;
  readonly denominacionDelArea: string;
}

export interface Ocupacion {
  readonly consecutivo: string;
  readonly codigo: string;
  readonly descripcion: string;
  readonly subarea: string;
}

const AREAS: Readonly<Record<string, string>> = {
  "01": "Cultivo, crianza y aprovechamiento",
  "02": "Extracción y suministro",
  "03": "Construcción",
  "04": "Tecnología",
  "05": "Procesamiento y fabricación",
  "06": "Transporte",
  "07": "Provisión de bienes y servicios",
  "08": "Gestión y soporte administrativo",
  "09": "Salud y protección social",
  "10": "Comunicación",
  "11": "Desarrollo y extensión del conocimiento",
};

const DENOMINACIONES: readonly (readonly [string, string])[] = [
  ["01.1", "Agricultura y silvicultura"],
  ["01.2", "Ganadería"],
  ["01.3", "Pesca y acuacultura"],
  ["02.1", "Exploración"],
  ["02.2", "Extracción"],
  ["02.3", "Refinación y beneficio"],
  ["02.4", "Provisión de energía"],
  ["02.5", "Provisión de agua"],
  ["03.1", "Planeación y dirección de obras"],
  ["03.2", "Edificación y urbanización"],
  ["03.3", "Acabado"],
  ["03.4", "Instalación y mantenimiento"],
  ["04.1", "Mecánica"],
  ["04.2", "Electricidad"],
  ["04.3", "Electrónica"],
  ["04.4", "Informática"],
  ["04.5", "Telecomunicaciones"],
  ["04.6", "Procesos industriales"],
  ["05.1", "Minerales no metálicos"],
  ["05.2", "Metales"],
  ["05.3", "Alimentos y bebidas"],
  ["05.4", "Textiles y prendas de vestir"],
  ["05.5", "Materia orgánica"],
  ["05.6", "Productos químicos"],
  ["05.7", "Productos metálicos y de hule y plástico"],
  ["05.8", "Productos eléctricos y electrónicos"],
  ["05.9", "Productos impresos"],
  ["06.1", "Ferroviario"],
  ["06.2", "Autotransporte"],
  ["06.3", "Aéreo"],
  ["06.4", "Marítimo y fluvial"],
  ["06.5", "Servicios de apoyo"],
  ["07.1", "Comercio"],
  ["07.2", "Alimentación y hospedaje"],
  ["07.3", "Turismo"],
  ["07.4", "Deporte y esparcimiento"],
  ["07.5", "Servicios personales"],
  ["07.6", "Reparación de artículos de uso doméstico y personal"],
  ["07.7", "Limpieza"],
  ["07.8", "Servicio postal y mensajería"],
  ["08.1", "Bolsa, banca y seguros"],
  ["08.2", "Administración"],
  ["08.3", "Servicios legales"],
  ["09.1", "Servicios médicos"],
  ["09.2", "Inspección sanitaria y del medio ambiente"],
  ["09.3", "Seguridad social"],
  ["09.4", "Protección de bienes y/o personas"],
  ["10.1", "Publicación"],
  ["10.2", "Radio, cine, televisión y teatro"],
  ["10.3", "Interpretación artística"],
  ["10.4", "Traducción e interpretación lingüística"],
  ["10.5", "Publicidad, propaganda y relaciones públicas"],
  ["11.1", "Investigación"],
  ["11.2", "Enseñanza"],
  ["11.3", "Difusión cultural"],
];

export const SUBAREAS_CNO: readonly Subarea[] = DENOMINACIONES.map(([clave, denominacion]) => {
  const area = clave.slice(0, 2);
  return { clave, denominacion, area, denominacionDelArea: AREAS[area] ?? "" };
});

const SUBAREA_POR_CLAVE: ReadonlyMap<string, Subarea> = new Map(
  SUBAREAS_CNO.map((subarea) => [subarea.clave, subarea]),
);

export function subareaDelCodigo(codigo: string): string | null {
  if (/^\d{9}$/u.test(codigo)) return `0${codigo.charAt(0)}.${codigo.charAt(1)}`;
  if (/^\d{10}$/u.test(codigo)) return `${codigo.slice(0, 2)}.${codigo.charAt(2)}`;
  return null;
}

export class CatalogoDeOcupaciones {
  readonly huella: string;
  readonly #porCodigo: ReadonlyMap<string, Ocupacion>;
  readonly #porSubarea: ReadonlyMap<string, readonly Ocupacion[]>;

  private constructor(ocupaciones: readonly Ocupacion[], huella: string) {
    this.huella = huella;
    this.#porCodigo = new Map(ocupaciones.map((ocupacion) => [ocupacion.codigo, ocupacion]));
    const porSubarea = new Map<string, Ocupacion[]>();
    for (const ocupacion of ocupaciones) {
      const lista = porSubarea.get(ocupacion.subarea);
      if (lista) lista.push(ocupacion);
      else porSubarea.set(ocupacion.subarea, [ocupacion]);
    }
    this.#porSubarea = porSubarea;
  }

  static desdeTexto(texto: string): CatalogoDeOcupaciones {
    const ocupaciones: Ocupacion[] = [];
    const vistos = new Set<string>();
    const lineas = texto.split("\n");
    let encabezado = false;
    for (const [indice, cruda] of lineas.entries()) {
      const linea = cruda.trimEnd();
      if (linea === "" || linea.startsWith("#")) continue;
      if (!encabezado) {
        if (linea !== "consecutivo\tcodigo\tdescripcion") {
          throw new Error("El catálogo de ocupaciones no trae el encabezado esperado.");
        }
        encabezado = true;
        continue;
      }
      const [consecutivo = "", codigo = "", descripcion = ""] = linea.split("\t");
      const subarea = subareaDelCodigo(codigo);
      if (!consecutivo || !descripcion || subarea === null || !SUBAREA_POR_CLAVE.has(subarea)) {
        throw new Error(`La línea ${String(indice + 1)} del catálogo de ocupaciones no es válida.`);
      }
      if (vistos.has(codigo))
        throw new Error(`El código ${codigo} aparece dos veces en el catálogo.`);
      vistos.add(codigo);
      ocupaciones.push({ consecutivo, codigo, descripcion, subarea });
    }
    if (ocupaciones.length === 0) throw new Error("El catálogo de ocupaciones está vacío.");
    return new CatalogoDeOcupaciones(
      ocupaciones,
      createHash("sha256").update(texto, "utf8").digest("hex"),
    );
  }

  get tamano(): number {
    return this.#porCodigo.size;
  }

  ocupacion(codigo: string): Ocupacion | undefined {
    return this.#porCodigo.get(codigo);
  }

  deSubarea(clave: string): readonly Ocupacion[] {
    return this.#porSubarea.get(clave) ?? [];
  }

  subarea(clave: string): Subarea | undefined {
    return SUBAREA_POR_CLAVE.get(clave);
  }

  buscar(consulta: {
    readonly texto?: string;
    readonly subarea?: string;
    readonly limite: number;
  }): { readonly total: number; readonly ocupaciones: readonly Ocupacion[] } {
    const palabras = normalizarParaBuscar(consulta.texto ?? "")
      .split(" ")
      .filter(Boolean);
    const universo = consulta.subarea
      ? this.deSubarea(consulta.subarea)
      : [...this.#porCodigo.values()];
    const coinciden = universo.filter((ocupacion) => {
      const descripcion = this.#normalizada(ocupacion);
      return palabras.every((palabra) =>
        /^\d+$/u.test(palabra)
          ? ocupacion.codigo.startsWith(palabra) || descripcion.includes(palabra)
          : descripcion.includes(palabra),
      );
    });
    return { total: coinciden.length, ocupaciones: coinciden.slice(0, consulta.limite) };
  }

  readonly #normalizadas = new Map<string, string>();

  #normalizada(ocupacion: Ocupacion): string {
    let texto = this.#normalizadas.get(ocupacion.codigo);
    if (texto === undefined) {
      texto = normalizarParaBuscar(ocupacion.descripcion);
      this.#normalizadas.set(ocupacion.codigo, texto);
    }
    return texto;
  }
}

function normalizarParaBuscar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

let cargado: CatalogoDeOcupaciones | undefined;

export function catalogoDeLaPlataforma(): CatalogoDeOcupaciones {
  cargado ??= CatalogoDeOcupaciones.desdeTexto(
    readFileSync(new URL("./catalogo-cno.tsv", import.meta.url), "utf8"),
  );
  return cargado;
}
