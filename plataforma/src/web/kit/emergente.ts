/**
 * El recuadro emergente de la consola.
 *
 * Es un diálogo sin una línea de JavaScript, y no por purismo: la consola
 * declara `default-src 'none'` sin `script-src`, así que `showModal()` no
 * existe aquí y `<dialog>` se quedaría cerrado para siempre. Lo que sí existe es
 * el fragmento de la dirección: un enlace a `#apagar` marca ese elemento como
 * `:target` y la hoja de estilos lo enseña. Abrir y cerrar es entonces mover el
 * fragmento, que es instantáneo y no le pregunta nada al servidor.
 *
 * Esa última parte importa más de lo que parece en el apagado: cuando el
 * emergente termina su secuencia el proceso ya está muerto, así que cualquier
 * cierre que implicara navegar —un `href="/"`, un formulario— daría un error de
 * conexión en vez de cerrarse. Con el fragmento, el botón de OK funciona con el
 * servidor apagado, porque no sale de la página.
 *
 * Dos modos:
 *
 * - **Con `ancla`**: cerrado hasta que alguien pulsa el enlace que apunta a él.
 *   Es el de la pantalla de inicio.
 * - **`fijo`**: abierto desde que la página carga, para cuando la pantalla
 *   entera *es* el diálogo. Es el de `/apagar` y el del acuse.
 *
 * El velo no captura el foco ni bloquea el teclado —sin guiones no hay forma—,
 * así que el contenido de detrás sigue siendo alcanzable con el tabulador. Se
 * asume a sabiendas: las dos pantallas que lo usan no tienen nada detrás que
 * pueda hacer daño, y la alternativa sería no tener diálogo.
 */

import { html, type Html } from "./html.ts";

export interface OpcionesDeEmergente {
  /**
   * Identificador del fragmento que lo abre. El enlace que lo llama apunta a
   * `#<ancla>`; sin ancla, el emergente nace abierto.
   */
  readonly ancla?: string;
  /** Abierto desde la carga. Excluyente con `ancla`. */
  readonly fijo?: boolean;
  readonly titulo: string;
  readonly cuerpo: Html;
  /** Clases extra de la caja, para emparejar transiciones de vista. */
  readonly claseDeCaja?: string;
  /**
   * Ancla que lo cierra. El botón de cerrar apunta a `#<anclaDeCierre>`, y la
   * hoja apaga el emergente en cuanto esa otra ancla es la marcada. Sólo hace
   * falta en el modo `fijo`: el de `ancla` se cierra soltando el fragmento.
   */
  readonly anclaDeCierre?: string;
}

/**
 * El identificador del título se deriva del ancla para que `aria-labelledby`
 * apunte a algo estable sin que cada pantalla tenga que inventarlo.
 */
function idDelTitulo(opciones: OpcionesDeEmergente): string {
  return `titulo-emergente-${opciones.ancla ?? opciones.anclaDeCierre ?? "fijo"}`;
}

export function renderEmergente(opciones: OpcionesDeEmergente): Html {
  const titulo = idDelTitulo(opciones);
  const caja = opciones.claseDeCaja ? ` ${opciones.claseDeCaja}` : "";

  const emergente = html`<div
    class="emergente${opciones.fijo ? " emergente-fijo" : ""}"
    ${opciones.ancla ? html`id="${opciones.ancla}"` : ""}
    role="dialog"
    aria-modal="true"
    aria-labelledby="${titulo}"
  >
    <div class="emergente-caja${caja}">
      <h2 class="emergente-titulo" id="${titulo}">${opciones.titulo}</h2>
      ${opciones.cuerpo}
    </div>
  </div>`;

  // El ancla de cierre va **antes** del emergente y es su hermana: así la hoja
  // puede apagarlo con `#cerrado:target ~ .emergente`, que es la única forma de
  // que un elemento reaccione a que otro esté marcado.
  return opciones.anclaDeCierre
    ? html`<span class="ancla-de-cierre" id="${opciones.anclaDeCierre}"></span>${emergente}`
    : emergente;
}
