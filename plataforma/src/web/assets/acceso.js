/**
 * La puerta que se abre.
 *
 * La pantalla de acceso son dos hojas que cubren el viewport. Al entrar se
 * corren hacia sus orillas y dejan ver la consola; sólo entonces viaja el
 * formulario. Sin este guion la puerta no se anima y el formulario se envía como
 * cualquier otro: la animación es adorno, la autenticación no depende de ella.
 *
 * Por qué hace falta un guion para esto: un `POST` normal navega de inmediato y
 * el navegador descarta la página antes de pintar un solo cuadro del recorrido.
 * Hay que retener el envío el tiempo que dura la transición y soltarlo después.
 *
 * Es el único guion de la pantalla. No hay biblioteca, no hay origen externo y
 * la política de contenido de `/acceso` declara `script-src 'self'`.
 *
 * Lo que pasa después ya no es cosa de este guion. La silueta que la puerta
 * descubre lleva los mismos `view-transition-name` que el armazón de la consola,
 * así que al navegar el navegador convierte cada rectángulo gris en la pieza
 * real que le corresponde. Por eso la hoja dura menos que antes: ya no tiene que
 * cubrir el trayecto entero, sólo la primera mitad.
 */

(function () {
  "use strict";

  var hojas = document.getElementById("puerta-hojas");
  var formulario = document.getElementById("puerta-formulario");
  if (!hojas || !formulario) return;

  /** Duración de `.puerta-hoja` en la hoja de estilos, en milisegundos. */
  var RECORRIDO_MS = 520;

  var enviando = false;

  formulario.addEventListener("submit", function (evento) {
    // Un segundo envío mientras la puerta se abre volvería a arrancar la
    // transición desde el principio y dejaría la pantalla en blanco más tiempo.
    if (enviando) {
      evento.preventDefault();
      return;
    }

    // Con un campo vacío el navegador ya frena el envío por su cuenta y este
    // manejador ni siquiera corre. La comprobación cubre el caso de que alguien
    // añada `novalidate`: abrir la puerta sobre un formulario que no va a viajar
    // dejaría la consola falsa a la vista y nada detrás.
    if (typeof formulario.checkValidity === "function" && !formulario.checkValidity()) return;

    evento.preventDefault();
    enviando = true;

    // Se suelta el foco antes de mover nada. Un navegador que conserva el foco
    // dentro de una hoja que se va de la pantalla intenta seguirla, y en los que
    // aún no entienden `overflow: clip` eso arrastra la página detrás.
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }

    hojas.classList.add("puerta-abierta");

    // Quien pidió menos movimiento no espera: la hoja de estilos ya recortó la
    // transición a nada, así que aquí tampoco hay nada que esperar.
    var sinMovimiento =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    window.setTimeout(
      function () {
        formulario.submit();
      },
      sinMovimiento ? 0 : RECORRIDO_MS,
    );
  });
})();
