(function () {
  "use strict";

  var hojas = document.getElementById("puerta-hojas");
  var formulario = document.getElementById("puerta-formulario");
  if (!hojas || !formulario) return;

  var RECORRIDO_MS = 520;

  var enviando = false;

  formulario.addEventListener("submit", function (evento) {
    if (enviando) {
      evento.preventDefault();
      return;
    }

    if (typeof formulario.checkValidity === "function" && !formulario.checkValidity()) return;

    evento.preventDefault();
    enviando = true;

    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }

    hojas.classList.add("puerta-abierta");

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
