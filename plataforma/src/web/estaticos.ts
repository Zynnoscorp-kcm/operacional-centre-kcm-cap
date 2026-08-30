/**
 * Estáticos de la capa web.
 *
 * Las hojas se leen una vez al arrancar, se concatenan y se publican bajo una
 * URL que lleva el hash del contenido. Así el navegador puede cachear para
 * siempre y un cambio de estilo invalida solo, sin `@fastify/static` ni una
 * dependencia más.
 *
 * El símbolo de Kimberly-Clark viaja por el mismo camino. La política de
 * contenido declara `img-src 'self' data:`, así que la imagen se sirve desde
 * este árbol, con su propio hash, y la pantalla no depende de que un tercero
 * siga en línea.
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

function construirHoja(): HojaDeEstilos {
  const contenido = HOJAS.map((nombre) =>
    readFileSync(join(DIRECTORIO_ESTATICOS, nombre), "utf8"),
  ).join("\n");
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
 * Se resuelve al importar el módulo, no en cada petición: si una hoja falta, el
 * proceso no arranca en vez de servir una pantalla sin estilo.
 */
export const hojaDeEstilos: HojaDeEstilos = construirHoja();

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

/** Todo lo binario que la capa web publica bajo `/assets`. */
export const imagenes: readonly ImagenEstatica[] = [simboloKcm];
