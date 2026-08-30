/**
 * El color de cada sala.
 *
 * Las siete salas llevan el nombre de una marca de la empresa y cada marca
 * tiene su paleta. La tarjeta de la agenda las usa para que la sala se
 * reconozca por el color antes de leer el nombre, que es como se reconocen los
 * productos en el pasillo.
 *
 * Aquí sólo vive el vínculo sala → clase. Los colores están en
 * `base.css`, y no por gusto: la política de contenido de la plataforma declara
 * `style-src 'self'` sin `unsafe-inline`, así que un `style="--color: #354E99"`
 * escrito desde el servidor lo descartaría el navegador sin avisar. La hoja de
 * estilos es el único lugar donde un color puede vivir y aplicarse.
 *
 * Las paletas, tal como las entregó el departamento:
 *
 * · Kleenex — `#354E99` y blanco
 * · Pétalo — `#1B2969`, `#1E4A97` y blanco
 * · Vogue — `#2D144D`, `#A8307D`, `#F0CD46` y blanco
 * · Marli — `#DA794A` y blanco
 * · Delsey — `#142E7F`, `#263D75`, `#BFAF39`, `#F4EE4F` y blanco
 * · Dragones — `#912925` y blanco
 * · Gerencia — `#364556`, gris y negro
 */

import type { RoomId } from "../../domain/salas/tipos.ts";

const CLASES: Readonly<Record<RoomId, string>> = {
  KLEENEX: "sala-kleenex",
  PETALO: "sala-petalo",
  VOGUE: "sala-vogue",
  MARLI: "sala-marli",
  DELSEY: "sala-delsey",
  SALA_DRAGONES: "sala-dragones",
  SALA_GERENCIA: "sala-gerencia",
};

/**
 * Clase de marca de una sala. Una sala que se agregue mañana y todavía no
 * tenga paleta cae en el azul corporativo de `.agenda-sala`, que es el valor
 * por omisión de la hoja: se ve sobria en vez de romperse.
 */
export function claseDeSala(roomId: string): string {
  return CLASES[roomId as RoomId] ?? "";
}
