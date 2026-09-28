/**
 * Estáticos de la capa web.
 *
 * Las hojas se leen una vez al arrancar, se concatenan y se publican bajo una
 * URL que lleva el hash del contenido. Así el navegador puede cachear para
 * siempre y un cambio de estilo invalida solo, sin `@fastify/static` ni una
 * dependencia más.
 *
 * El símbolo de Kimberly-Clark y las tipografías viajan por el mismo camino.
 * La política de contenido declara `img-src 'self' data:` y `font-src 'self'`,
 * así que la imagen y las fuentes se sirven desde este árbol, cada una con su
 * propio hash, y la pantalla no depende de que un tercero siga en línea.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIRECTORIO_ESTATICOS = join(import.meta.dirname, "assets");
const HOJAS = ["tokens.css", "base.css"] as const;

/**
 * El alfabeto de las huellas de contenido, sin dígitos.
 *
 * En hexadecimal la huella cae tarde o temprano en cinco dígitos seguidos —le
 * pasó a `kcm-7c58e02086d5.css`— y entonces la URL de la hoja de estilos tiene
 * la forma de un número de nómina. La plataforma prohíbe publicar algo así en
 * una pantalla, y la prueba de la pantalla base lo comprueba con una expresión
 * regular que no puede distinguir una nómina de una casualidad.
 *
 * Con puras letras la casualidad deja de ser posible. Doce letras dan unos 56
 * bits, que es de sobra para invalidar una caché; nadie está firmando nada aquí.
 */
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

/**
 * Las tipografías de la consola, con su licencia OFL junto a los archivos.
 *
 * Manrope para el texto y los títulos; IBM Plex Mono para lo que se lee como
 * dato —nóminas, fechas, claves—. Antes la hoja nombraba una familia que no
 * viajaba con la plataforma, y cada equipo dibujaba la que tuviera instalada:
 * la misma pantalla se veía distinta en cada computadora. Son cuatro archivos
 * del subconjunto latino —el español entero, con signos y comillas— que suman
 * setenta kilobytes y se cachean para siempre.
 */
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

/** Las reglas `@font-face`, con la dirección de cada archivo ya con su hash. */
function reglasDeCaras(): string {
  return CARAS.map(
    (cara) =>
      `@font-face {\n  font-family: "${cara.familia}";\n  font-style: normal;\n` +
      `  font-weight: ${cara.peso};\n  font-display: swap;\n` +
      `  src: url("${cara.archivo.ruta}") format("woff2");\n}`,
  ).join("\n");
}

/**
 * Se resuelve al importar el módulo, no en cada petición: si una hoja falta, el
 * proceso no arranca en vez de servir una pantalla sin estilo.
 */
export const hojaDeEstilos: HojaDeEstilos = construirHoja(reglasDeCaras());

/** Símbolo de marca, el mismo archivo que el departamento publicó en Drive. */
export const simboloKcm: ImagenEstatica = construirImagen("simbolo-kcm.png", "image/png");

/**
 * El fondo de haces del quiosco de sala. Vive aparte del guion del quiosco
 * porque lo compartía con la puerta de `/acceso`; desde el rediseño de la
 * puerta lo carga sólo el quiosco, y se conserva separado porque es el fondo y
 * no la lógica de la pantalla.
 */
export const guionHaces: HojaDeEstilos = construirGuion("haces.js");

/**
 * El guion del quiosco de sala. Viaja por el mismo camino que la hoja —hash en
 * la dirección, caché eterna— y no en línea dentro del marcado, porque su
 * shader GLSL está escrito con plantillas de plantilla.
 */
export const guionQuiosco: HojaDeEstilos = construirGuion("quiosco.js");

/**
 * El guion de la puerta de `/acceso`: retiene el envío del formulario mientras
 * las dos hojas se corren hacia las orillas.
 *
 * Son los tres únicos guiones que la plataforma publica. Sus pantallas llevan
 * una política de contenido propia; el resto de la consola sigue sin
 * `script-src`.
 */
export const guionAcceso: HojaDeEstilos = construirGuion("acceso.js");

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

/** Todo lo binario que la capa web publica bajo `/assets`: el símbolo y las fuentes. */
export const imagenes: readonly ImagenEstatica[] = [
  simboloKcm,
  ...CARAS.map((cara) => cara.archivo),
];
