import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIRECTORIO_ESTATICOS = join(import.meta.dirname, "assets");
const HOJAS = ["tokens.css", "base.css"] as const;

const ALFABETO_DE_HUELLA = "abcdefghijklmnopqrstuvwxyz";
const LARGO_DE_HUELLA = 12;

function huella(contenido: string | Buffer): string {
  const resumen = createHash("sha256").update(contenido).digest();
  let salida = "";
  for (let indice = 0; indice < LARGO_DE_HUELLA; indice += 1) {
    salida += ALFABETO_DE_HUELLA[(resumen[indice] ?? 0) % ALFABETO_DE_HUELLA.length];
  }
  return salida;
}

export interface HojaDeEstilos {
  readonly ruta: string;
  readonly contenido: string;
  readonly hash: string;
  readonly tipo: string;
}

export interface ImagenEstatica {
  readonly ruta: string;
  readonly contenido: Buffer;
  readonly hash: string;
  readonly tipo: string;
}

function construirHoja(caras: string): HojaDeEstilos {
  const contenido = [
    caras,
    ...HOJAS.map((nombre) => readFileSync(join(DIRECTORIO_ESTATICOS, nombre), "utf8")),
  ].join("\n");
  const hash = huella(contenido);
  return {
    ruta: `/assets/kcm-${hash}.css`,
    contenido,
    hash,
    tipo: "text/css; charset=utf-8",
  };
}

function construirImagen(nombre: string, tipo: string): ImagenEstatica {
  const contenido = readFileSync(join(DIRECTORIO_ESTATICOS, nombre));
  const hash = huella(contenido);
  const extension = nombre.slice(nombre.lastIndexOf("."));
  const base = nombre.slice(0, nombre.lastIndexOf("."));
  return { ruta: `/assets/${base}-${hash}${extension}`, contenido, hash, tipo };
}

interface CaraTipografica {
  readonly familia: string;
  readonly peso: string;
  readonly archivo: ImagenEstatica;
}

const CARAS: readonly CaraTipografica[] = [
  {
    familia: "Manrope",
    peso: "200 800",
    archivo: construirImagen("fuentes/manrope.woff2", "font/woff2"),
  },
  {
    familia: "IBM Plex Mono",
    peso: "400",
    archivo: construirImagen("fuentes/plex-mono-regular.woff2", "font/woff2"),
  },
  {
    familia: "IBM Plex Mono",
    peso: "500",
    archivo: construirImagen("fuentes/plex-mono-medium.woff2", "font/woff2"),
  },
  {
    familia: "IBM Plex Mono",
    peso: "600",
    archivo: construirImagen("fuentes/plex-mono-semibold.woff2", "font/woff2"),
  },
];

function reglasDeCaras(): string {
  return CARAS.map(
    (cara) =>
      `@font-face {\n  font-family: "${cara.familia}";\n  font-style: normal;\n` +
      `  font-weight: ${cara.peso};\n  font-display: swap;\n` +
      `  src: url("${cara.archivo.ruta}") format("woff2");\n}`,
  ).join("\n");
}

export const hojaDeEstilos: HojaDeEstilos = construirHoja(reglasDeCaras());

export const simboloKcm: ImagenEstatica = construirImagen("simbolo-kcm.png", "image/png");

export const guionHaces: HojaDeEstilos = construirGuion("haces.js");

export const guionQuiosco: HojaDeEstilos = construirGuion("quiosco.js");

export const guionAcceso: HojaDeEstilos = construirGuion("acceso.js");

export const guionOcupaciones: HojaDeEstilos = construirGuion("ocupaciones.js");

function construirGuion(nombre: string): HojaDeEstilos {
  const contenido = readFileSync(join(DIRECTORIO_ESTATICOS, nombre), "utf8");
  const hash = huella(contenido);
  const base = nombre.slice(0, nombre.lastIndexOf("."));
  return {
    ruta: `/assets/${base}-${hash}.js`,
    contenido,
    hash,
    tipo: "text/javascript; charset=utf-8",
  };
}

export const imagenes: readonly ImagenEstatica[] = [
  simboloKcm,
  ...CARAS.map((cara) => cara.archivo),
];
