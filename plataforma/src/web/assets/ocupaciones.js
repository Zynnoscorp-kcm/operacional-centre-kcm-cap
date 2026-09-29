/**
 * La clasificación de ocupaciones, conducida desde el navegador.
 *
 * La función publicada corta cada petición a los 120 s y un caso tarda cerca de
 * medio minuto. Por eso el guion pide un caso por petición en lugar de esperar
 * la corrida entera en una sola:
 *
 * 1. Manda el padrón a `/api/ocupaciones/plan` y recibe los casos.
 * 2. Consulta los casos en `/api/ocupaciones/sugerir`, de uno en uno.
 * 3. Vuelve a mandar el padrón, con las claves sugeridas, a
 *    `/api/ocupaciones/escribir` y baja el Excel que regresa.
 *
 * Mientras un caso está en vuelo, un reloj cuenta sus segundos: la pantalla no
 * se queda quieta aunque el modelo tarde. Cancelar aborta la petición en vuelo
 * y no pide más casos, así que en el servidor no queda nada gastando cupo. Tres
 * casos seguidos sin respuesta detienen la corrida —casi siempre es el cupo
 * gratuito del día— y se escribe lo que ya se obtuvo.
 *
 * Los textos se ponen con `textContent`: el puesto y el centro de costos vienen
 * del padrón y nunca se interpretan como marcado.
 */

(function () {
  "use strict";

  var formulario = document.getElementById("form-clasificar");
  var entrada = document.querySelector('#form-clasificar input[type="file"]');
  var boton = document.getElementById("btn-clasificar");
  var tarjeta = document.getElementById("progreso-ia");
  var barra = document.getElementById("barra-relleno");
  var texto = document.getElementById("progreso-texto");
  var detalle = document.getElementById("progreso-detalle");
  var cancelar = document.getElementById("btn-cancelar");
  var lista = document.getElementById("progreso-casos");
  if (!formulario || !entrada || !boton || !tarjeta || !barra || !texto || !detalle) return;
  if (!cancelar || !lista) return;

  /** Casos seguidos sin respuesta que detienen la corrida. */
  var FALLAS_SEGUIDAS = 3;
  var ROTULO = boton.textContent;

  /** La corrida en curso: si se canceló, la petición en vuelo y el reloj del caso. */
  var corrida = null;

  /** Un error ya redactado para la pantalla. `detiene` corta la corrida entera. */
  function Aviso(mensaje, detiene) {
    this.message = mensaje;
    this.detiene = detiene;
  }

  function cifra(valor) {
    return Number(valor).toLocaleString("es-MX");
  }

  function cuantos(numero, singular, plural) {
    return cifra(numero) + " " + (numero === 1 ? singular : plural);
  }

  function minutosYSegundos(ms) {
    var segundos = Math.max(0, Math.round(ms / 1000));
    var resto = segundos % 60;
    return Math.floor(segundos / 60) + ":" + (resto < 10 ? "0" : "") + resto;
  }

  function loQueFalta(ms) {
    var minutos = Math.round(ms / 60000);
    return minutos < 1
      ? "falta menos de un minuto"
      : "faltan cerca de " + cuantos(minutos, "minuto", "minutos");
  }

  function decir(principal, secundario) {
    texto.textContent = principal;
    detalle.textContent = secundario;
  }

  function avance(hechos, total) {
    barra.classList.add("avance-medido");
    barra.style.width = (total > 0 ? Math.round((hechos / total) * 100) : 0) + "%";
  }

  function avanceSinMedida() {
    barra.classList.remove("avance-medido");
    barra.style.width = "";
  }

  function arrancarReloj(esta, pintar) {
    pararReloj(esta);
    pintar();
    esta.reloj = window.setInterval(pintar, 1000);
  }

  function pararReloj(esta) {
    if (esta.reloj) window.clearInterval(esta.reloj);
    esta.reloj = null;
  }

  /** Cerrar o recargar a media corrida la detiene: el navegador pregunta antes. */
  function retener(evento) {
    evento.preventDefault();
    evento.returnValue = "";
  }

  function avisoDe(estado, error) {
    var codigo = (error && error.code) || "";
    if (estado === 401 || codigo === "SESION_REQUERIDA") {
      return new Aviso("La sesión de la consola venció; hace falta entrar de nuevo.", true);
    }
    if (codigo === "IA_SIN_CONFIGURAR") {
      return new Aviso("El agente de ocupaciones está apagado en esta instalación.", true);
    }
    if (estado === 413) {
      return new Aviso("El archivo pasa del tamaño que acepta la plataforma.", true);
    }
    return new Aviso((error && error.message) || "La plataforma respondió " + estado + ".", false);
  }

  /** Una petición de la corrida. Cancelar la aborta aunque esté a medio camino. */
  function pedir(esta, url, cuerpo, tipo) {
    var controlador = new AbortController();
    esta.controlador = controlador;
    var cabeceras = { accept: "application/json" };
    if (tipo) cabeceras["content-type"] = tipo;
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: cabeceras,
      body: cuerpo,
      signal: controlador.signal,
    }).then(function (respuesta) {
      if (respuesta.ok) return respuesta;
      return respuesta
        .json()
        .catch(function () {
          return null;
        })
        .then(function (cuerpoDeError) {
          throw avisoDe(respuesta.status, cuerpoDeError && cuerpoDeError.error);
        });
    });
  }

  /** Los casos, de uno en uno. Resuelve con lo obtenido, aunque la corrida se detenga. */
  function consultar(esta, casos) {
    var resultado = {
      claves: [],
      sinClave: [],
      sugeridos: 0,
      revisar: 0,
      sinRespuesta: 0,
      detenida: "",
    };
    var seguidas = 0;
    var ultimoMotivo = "";
    var comienzo = Date.now();

    function sinClave(caso, nota) {
      resultado.sinClave.push({ caso: caso, nota: nota });
    }

    function siguiente(indice) {
      if (esta.cancelada || indice >= casos.length) return Promise.resolve(resultado);
      if (seguidas >= FALLAS_SEGUIDAS) {
        resultado.detenida = /\b429\b/.test(ultimoMotivo)
          ? "se agotó el cupo gratuito del modelo por hoy"
          : "el modelo dejó de responder";
        for (var resto = indice; resto < casos.length; resto += 1) {
          sinClave(casos[resto], "no se consultó");
        }
        return Promise.resolve(resultado);
      }

      var caso = casos[indice];
      var inicio = Date.now();
      texto.textContent =
        "Caso " +
        (indice + 1) +
        " de " +
        casos.length +
        " · " +
        caso.puesto +
        " · " +
        caso.centroDeCostos;
      arrancarReloj(esta, function () {
        var ahora = Date.now();
        var partes = ["Consultando al modelo · " + minutosYSegundos(ahora - inicio)];
        if (indice > 0) {
          var porCaso = (inicio - comienzo) / indice;
          partes.push(loQueFalta(porCaso * (casos.length - indice) - (ahora - inicio)));
        }
        detalle.textContent = partes.join(" · ");
      });

      var pregunta = JSON.stringify({ puesto: caso.puesto, centroDeCostos: caso.centroDeCostos });
      return pedir(esta, "/api/ocupaciones/sugerir", pregunta, "application/json")
        .then(function (respuesta) {
          return respuesta.json();
        })
        .then(
          function (sugerencia) {
            var propuesta = sugerencia && sugerencia.sugerencia;
            if (sugerencia && sugerencia.estado === "sugerida" && propuesta) {
              resultado.claves.push({
                casoId: caso.id,
                puesto: caso.puesto,
                centroDeCostos: caso.centroDeCostos,
                codigo: propuesta.codigo,
              });
              resultado.sugeridos += 1;
              seguidas = 0;
            } else if (sugerencia && sugerencia.estado === "revisar") {
              resultado.revisar += 1;
              sinClave(
                caso,
                propuesta
                  ? "para revisar, el modelo propone " +
                      propuesta.codigo +
                      " " +
                      propuesta.descripcion +
                      " con confianza " +
                      propuesta.confianza
                  : "para revisar",
              );
              seguidas = 0;
            } else {
              resultado.sinRespuesta += 1;
              sinClave(caso, "sin respuesta del modelo");
              seguidas += 1;
              ultimoMotivo = (sugerencia && sugerencia.razon) || "";
            }
          },
          function (error) {
            if (esta.cancelada || (error instanceof Aviso && error.detiene)) throw error;
            resultado.sinRespuesta += 1;
            sinClave(caso, "sin respuesta del modelo");
            seguidas += 1;
            ultimoMotivo = (error && error.message) || "";
          },
        )
        .then(function () {
          pararReloj(esta);
          avance(indice + 1, casos.length);
          return siguiente(indice + 1);
        });
    }

    avance(0, casos.length);
    return siguiente(0);
  }

  function nombreDeSalida(original) {
    return (original.replace(/\.xlsx$/i, "") || "padron") + " con ocupaciones.xlsx";
  }

  function bajar(contenido, nombre) {
    var direccion = URL.createObjectURL(contenido);
    var enlace = document.createElement("a");
    enlace.href = direccion;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    window.setTimeout(function () {
      URL.revokeObjectURL(direccion);
    }, 60000);
  }

  /** Manda el padrón con las claves y baja la copia; resuelve con las celdas escritas. */
  function escribir(esta, archivo, claves) {
    var datos = new FormData();
    datos.append("archivo", archivo);
    datos.append("codigos", JSON.stringify(claves));
    return pedir(esta, "/api/ocupaciones/escribir", datos).then(function (respuesta) {
      var celdas = Number(respuesta.headers.get("x-kcm-celdas-escritas") || 0);
      return respuesta.blob().then(function (contenido) {
        if (!esta.cancelada) bajar(contenido, nombreDeSalida(archivo.name));
        return celdas;
      });
    });
  }

  function ensenarSinClave(pendientes) {
    var resumen = lista.querySelector("summary");
    var renglones = lista.querySelector("ul");
    lista.hidden = pendientes.length === 0;
    if (!resumen || !renglones || pendientes.length === 0) return;
    resumen.textContent = cuantos(
      pendientes.length,
      "caso sin clave escrita",
      "casos sin clave escrita",
    );
    renglones.textContent = "";
    pendientes.forEach(function (pendiente) {
      var renglon = document.createElement("li");
      renglon.textContent =
        pendiente.caso.puesto +
        " · " +
        pendiente.caso.centroDeCostos +
        " (" +
        cuantos(pendiente.caso.trabajadores, "trabajador", "trabajadores") +
        "): " +
        pendiente.nota;
      renglones.appendChild(renglon);
    });
  }

  function enlaceAPadron() {
    var enlace = document.createElement("a");
    enlace.href = "/padron";
    enlace.textContent = "Padrón";
    detalle.appendChild(document.createTextNode(" El archivo se revisa antes de aplicarlo desde "));
    detalle.appendChild(enlace);
    detalle.appendChild(document.createTextNode("."));
  }

  function soltar(esta) {
    pararReloj(esta);
    if (corrida === esta) corrida = null;
    window.removeEventListener("beforeunload", retener);
    boton.disabled = false;
    boton.textContent = ROTULO;
    entrada.disabled = false;
    cancelar.hidden = true;
  }

  function cuentas(resultado, total, pendientes) {
    var partes = [
      cuantos(resultado.sugeridos, "caso", "casos") + " de " + cifra(total) + " con clave",
    ];
    if (resultado.revisar > 0) partes.push(cifra(resultado.revisar) + " para revisar a mano");
    if (resultado.sinRespuesta > 0) partes.push(cifra(resultado.sinRespuesta) + " sin respuesta");
    if (pendientes && pendientes.casos > 0) {
      partes.push(
        "quedan " +
          cuantos(pendientes.casos, "caso", "casos") +
          " para otra corrida con el archivo que bajó",
      );
    }
    return partes.join(" · ") + ".";
  }

  function reiniciar() {
    if (corrida) {
      corrida.cancelada = true;
      if (corrida.controlador) corrida.controlador.abort();
      soltar(corrida);
    }
    tarjeta.hidden = true;
    lista.hidden = true;
    avanceSinMedida();
    decir("", "");
    formulario.reset();
  }

  cancelar.addEventListener("click", reiniciar);

  // Una pestaña que vuelve de la caché del navegador no trae su corrida consigo.
  window.addEventListener("pageshow", function (evento) {
    if (evento.persisted) reiniciar();
  });

  formulario.addEventListener("submit", function (evento) {
    evento.preventDefault();
    var archivo = entrada.files && entrada.files[0];
    if (corrida || !archivo) return;

    var esta = { cancelada: false, controlador: null, reloj: null };
    corrida = esta;
    boton.disabled = true;
    boton.textContent = "Clasificando…";
    entrada.disabled = true;
    tarjeta.hidden = false;
    cancelar.hidden = false;
    lista.hidden = true;
    avanceSinMedida();
    decir("Leyendo el padrón…", "");
    window.addEventListener("beforeunload", retener);

    var datos = new FormData();
    datos.append("archivo", archivo);
    var plan = null;

    pedir(esta, "/api/ocupaciones/plan", datos)
      .then(function (respuesta) {
        return respuesta.json();
      })
      .then(function (recibido) {
        plan = recibido;
        return plan.casos.length > 0 ? consultar(esta, plan.casos) : null;
      })
      .then(function (resultado) {
        if (esta.cancelada) return undefined;
        if (!resultado) {
          soltar(esta);
          avance(1, 1);
          decir("No hay trabajadores activos sin clave de ocupación que se puedan clasificar.", "");
          return undefined;
        }
        var total = plan.casos.length;
        if (resultado.claves.length === 0) {
          soltar(esta);
          decir(
            resultado.detenida
              ? "La clasificación se detuvo: " + resultado.detenida + "."
              : "Ningún caso salió con confianza suficiente para escribirse.",
            cuentas(resultado, total, null),
          );
          ensenarSinClave(resultado.sinClave);
          return undefined;
        }
        decir("Escribiendo las claves en el padrón…", "");
        return escribir(esta, archivo, resultado.claves).then(function (celdas) {
          if (esta.cancelada) return;
          soltar(esta);
          decir(
            (resultado.detenida
              ? "La clasificación se detuvo (" + resultado.detenida + "); "
              : "Listo: ") +
              "el archivo bajó con " +
              cuantos(celdas, "clave nueva", "claves nuevas") +
              ".",
            cuentas(resultado, total, plan.pendientes),
          );
          enlaceAPadron();
          ensenarSinClave(resultado.sinClave);
        });
      })
      .catch(function (error) {
        if (esta.cancelada) return;
        soltar(esta);
        decir(
          "La clasificación no terminó.",
          error instanceof Aviso ? error.message : "Se perdió la conexión con la plataforma.",
        );
      });
  });
})();
