"use strict";
(function () {
  var form = document.getElementById("form-clasificar");
  if (!form) return;

  var btn = document.getElementById("btn-clasificar");
  var progreso = document.getElementById("progreso-ia");
  var barra = document.getElementById("barra-relleno");
  var texto = document.getElementById("progreso-texto");
  var detalle = document.getElementById("progreso-detalle");
  var btnCancelar = document.getElementById("btn-cancelar");
  var xhrActivo = null;

  function reiniciar() {
    xhrActivo = null;
    if (btn) { btn.disabled = false; btn.textContent = "Clasificar faltantes"; }
    if (progreso) progreso.style.display = "none";
    if (barra) { barra.style.width = "30%"; barra.style.animation = ""; }
    if (detalle) detalle.textContent = "Preparando…";
    if (btnCancelar) btnCancelar.style.display = "none";
    form.reset();
  }

  if (btnCancelar) {
    btnCancelar.addEventListener("click", function () {
      if (xhrActivo) {
        xhrActivo.abort();
        xhrActivo = null;
      }
      reiniciar();
    });
  }

  form.addEventListener("submit", function (evento) {
    evento.preventDefault();

    var archivo = form.querySelector('input[type="file"]');
    if (!archivo || !archivo.files || !archivo.files[0]) return;

    if (btn) { btn.disabled = true; btn.textContent = "Clasificando…"; }
    if (progreso) progreso.style.display = "block";
    if (btnCancelar) btnCancelar.style.display = "";
    if (barra) { barra.style.width = "30%"; barra.style.animation = ""; }
    if (texto) texto.innerHTML = "<strong>Clasificando ocupaciones…</strong> No cierres ni recargues esta pestaña.";
    if (detalle) detalle.textContent = "Subiendo archivo…";

    var datos = new FormData();
    datos.append("archivo", archivo.files[0]);

    var xhr = new XMLHttpRequest();
    xhrActivo = xhr;
    xhr.open("POST", "/api/ocupaciones/clasificar", true);
    xhr.responseType = "text";

    var leido = 0;

    function procesarEventos() {
      var pendiente = xhr.responseText.substring(leido);
      var lineas = pendiente.split("\n");

      for (var i = 0; i < lineas.length; i++) {
        var linea = lineas[i].trim();
        if (linea.indexOf("data: ") !== 0) continue;
        try {
          var ev = JSON.parse(linea.substring(6));
          manejarEvento(ev);
        } catch (_) { /* línea incompleta */ }
      }
      leido = xhr.responseText.length;
    }

    function manejarEvento(ev) {
      if (ev.tipo === "plan") {
        if (texto) texto.innerHTML =
          "<strong>Clasificando ocupaciones…</strong> " +
          ev.faltantes + " trabajadores sin clave, " + ev.casos + " casos únicos.";
        if (detalle) detalle.textContent = "Iniciando clasificación…";
      }

      if (ev.tipo === "avance") {
        var pct = ev.total > 0 ? Math.round((ev.actual / ev.total) * 100) : 0;
        if (barra) { barra.style.width = pct + "%"; barra.style.animation = "none"; }
        if (detalle) {
          detalle.textContent = "Caso " + ev.actual + " de " + ev.total +
            (ev.estado === "sugerida" ? " — sugerida: " + ev.codigo :
             ev.estado === "sin_respuesta" ? " — sin respuesta" :
             " — a revisar");
        }
        if (texto) texto.innerHTML =
          "<strong>Clasificando… " + pct + "%</strong> " +
          "Caso " + ev.actual + " de " + ev.total + ".";
      }

      if (ev.tipo === "resultado") {
        xhrActivo = null;
        if (btnCancelar) btnCancelar.style.display = "none";
        if (barra) { barra.style.width = "100%"; barra.style.animation = "none"; }
        if (detalle) detalle.textContent =
          ev.escritos + " claves escritas de " + ev.consultados + " consultados.";

        if (ev.descargaId) {
          if (texto) texto.innerHTML =
            "<strong>Clasificación completada.</strong> Descargando el archivo…";
          var a = document.createElement("a");
          a.href = "/api/ocupaciones/descarga/" + ev.descargaId;
          a.download = "";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          setTimeout(function () {
            if (texto) texto.innerHTML =
              "<strong>✅ Listo.</strong> Revisa el archivo descargado. " +
              "Si las claves son correctas, súbelo a " +
              '<a href="/padron">Padrón</a> para aplicar.';
            if (btn) { btn.disabled = false; btn.textContent = "Clasificar faltantes"; }
          }, 1000);
        } else {
          if (texto) texto.innerHTML =
            "<strong>Clasificación completada.</strong> " +
            "Ninguna clave se sugirió con confianza suficiente.";
          if (btn) { btn.disabled = false; btn.textContent = "Clasificar faltantes"; }
        }
      }

      if (ev.tipo === "error") {
        xhrActivo = null;
        if (btnCancelar) btnCancelar.style.display = "none";
        if (texto) texto.innerHTML = "<strong>Error:</strong> " + (ev.mensaje || "Error desconocido");
        if (barra) barra.style.animation = "none";
        if (btn) { btn.disabled = false; btn.textContent = "Clasificar faltantes"; }
      }
    }

    xhr.onprogress = procesarEventos;
    xhr.onloadend = function () {
      procesarEventos();
      if (xhrActivo === xhr) xhrActivo = null;
    };
    xhr.onerror = function () {
      manejarEvento({ tipo: "error", mensaje: "No se pudo conectar con el servidor." });
    };
    xhr.ontimeout = function () {
      manejarEvento({ tipo: "error", mensaje: "La clasificación tardó demasiado. Intenta con menos faltantes." });
    };

    xhr.send(datos);
  });
})();
