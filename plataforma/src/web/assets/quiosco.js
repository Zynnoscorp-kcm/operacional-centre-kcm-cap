/*
 * Guion del quiosco de sala.
 *
 * Conserva sin retocar el
 * trazo: el alternado de secciones, el sacudón del campo con error y el acuse
 * con auto-reinicio a los 3.5 s quedan tal cual.
 *
 * Lo único que cambia es el transporte. Allá `call()` hablaba con
 * `google.script.run`; aquí habla con las rutas REST que ya existen en
 * `plataforma/src/routes/quiosco.ts`, y devuelve el mismo sobre `{ ok, data }` que el
 * resto del guion espera, para no tener que tocar ni una línea de la vista.
 *
 * El fondo de haces salió de aquí a `haces.js` cuando `/acceso` pasó a usar el
 * mismo fondo. La pantalla carga los dos guiones, en ese orden, y el shader
 * GLSL sigue viviendo en un archivo aparte del marcado: escrito con plantillas
 * de plantilla, un acento grave mal escapado se ve como una pantalla negra.
 */
(function () {
  "use strict";

  var token = "";
  // Vinculo y ficha en espera de que la sala confirme que es su sesion. No se
  // promueven a `token` hasta que alguien lo diga: mientras vivan aqui, ninguna
  // pantalla de registro puede abrirse con ellos.
  var tokenPorConfirmar = "";
  var sesionPorConfirmar = null;
  var autoResetTimer = null;
  var kioskGrant = "";
  var catalogLoaded = false;

  /*
   * El PIN con el que se desbloqueó el equipo. La ruta de apertura de sesión de
   * esta plataforma pide la contraseña de apertura, no el pase del desbloqueo,
   * y el original no tiene un segundo campo donde pedirla; se reenvía el mismo
   * que ya se tecleó y, si el despliegue usa contraseñas distintas, el servidor
   * responde su propio mensaje y cae en el renglón de aviso del lanzador.
   */
  var kioskPin = "";

  function getElement(id) {
    return document.getElementById(id);
  }

  function extractToken() {
    var hashMatch = location.hash ? (location.hash.match(/kioskToken=([^&]+)/) || [])[1] : null;
    if (hashMatch) return decodeURIComponent(hashMatch);
    var searchParams = new URLSearchParams(window.location.search);
    var tokens = searchParams.getAll("kioskToken");
    if (tokens.length) return tokens[0];
    // La ruta `/quiosco` de esta plataforma nombra el parámetro `token`.
    return searchParams.get("token") || "";
  }

  function clearTokenFromHistory() {
    try {
      if (window.history && typeof window.history.replaceState === "function") {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {}
  }

  /*
   * El transporte. Cada acción del quiosco se resuelve contra la
   * ruta REST equivalente y se devuelve envuelta en `{ ok, data }`, que es lo
   * que el resto del guion espera recibir.
   */
  var ENDPOINTS = {
    kioskBootstrap: { method: "GET", path: "/api/kiosk/bootstrap" },
    kioskRegister: { method: "POST", path: "/api/kiosk/register" },
    kioskUnlock: { method: "POST", path: "/api/kiosk/unlock" },
    kioskLaunchSession: { method: "POST", path: "/api/kiosk/launch" },
    kioskCloseSession: { method: "POST", path: "/api/kiosk/close" },
    /*
     * Canjear el codigo de sesion. Sin esta entrada, `call()` rechazaba con
     * "aun no esta disponible en este equipo" sin llegar a la red: despues de
     * teclear el PIN, el numero de sesion no llevaba a ninguna parte. La ruta
     * exige la concesion del desbloqueo, que viaja en `grant`.
     */
    kioskRedeemAccessCode: { method: "POST", path: "/api/kiosk/token" },
  };

  function call(action, payload) {
    payload = payload || {};
    payload.requestId = payload.requestId || "req-" + Math.random().toString(36).slice(2, 10);

    var route = ENDPOINTS[action];
    if (!route) {
      return Promise.reject(new Error("Esta operación aún no está disponible en este equipo."));
    }

    var url = route.path;
    var opciones = { method: route.method, headers: {} };

    if (route.method === "GET") {
      var query = new URLSearchParams();
      Object.keys(payload).forEach(function (clave) {
        if (payload[clave] !== undefined && payload[clave] !== null && payload[clave] !== "") {
          query.set(clave, String(payload[clave]));
        }
      });
      var cadena = query.toString();
      if (cadena) url += "?" + cadena;
    } else {
      opciones.headers["Content-Type"] = "application/json";
      opciones.body = JSON.stringify(payload);
    }

    return fetch(url, opciones).then(function (response) {
      return response
        .json()
        .catch(function () {
          return null;
        })
        .then(function (cuerpo) {
          if (!response.ok) {
            var mensaje =
              (cuerpo && cuerpo.error && cuerpo.error.message) ||
              "No fue posible completar la operación.";
            throw new Error(mensaje);
          }
          return { ok: true, data: cuerpo };
        });
    });
  }

  /* Un fallo de configuracion llega sanitizado como mensaje generico: se traduce a la accion que lo resuelve. */
  function unlockFailureMessage(error) {
    var message = String((error && error.message) || "");
    if (!message) return "No fue posible validar el PIN.";
    if (/no fue posible completar la operaci/i.test(message)) {
      return "El servidor no pudo validar el PIN. Solicite revisar la configuración del quiosco.";
    }
    return message;
  }

  /**
   * Latido que impide que el alojamiento suspenda el proceso a media sesión.
   *
   * El quiosco no refresca solo a propósito —recargar perdería lo capturado—,
   * así que entre un registro y el siguiente pueden pasar veinte minutos sin
   * una sola petición. Un servicio que se suspende por inactividad se duerme
   * ahí, y el trabajador que llega tarde paga el arranque en frío completo.
   *
   * Late sólo mientras la pantalla de registro está visible: es la única en la
   * que hay una sesión viva esperando gente. `/healthz` no toca la base ni
   * escribe bitácora, y cinco minutos quedan holgados frente a los quince de
   * inactividad que tolera el alojamiento.
   */
  var LATIDO_MS = 5 * 60 * 1000;
  var latidoId = null;

  function ajustarLatido(activo) {
    if (activo && latidoId === null) {
      latidoId = setInterval(function () {
        // Un latido perdido no es un error: la siguiente petición real
        // despierta el servicio igual. Se ignora en silencio.
        fetch("/healthz", { method: "GET", cache: "no-store" }).catch(function () {});
      }, LATIDO_MS);
    } else if (!activo && latidoId !== null) {
      clearInterval(latidoId);
      latidoId = null;
    }
  }

  function showSection(sectionId) {
    ["loading", "unavailable", "boot", "unlock", "launcher", "confirm", "registration"].forEach(
      function (id) {
        var el = getElement(id);
        if (el) el.hidden = id !== sectionId;
      },
    );
    var closeBtn = getElement("kiosk-close-session-btn");
    if (closeBtn) closeBtn.hidden = sectionId !== "registration";
    ajustarLatido(sectionId === "registration");
  }

  function updateAvailability(availability) {
    var msgEl = getElement("availability-message");
    if (!msgEl) return;
    if (!availability) {
      msgEl.textContent = "Disponibilidad: validando…";
      return;
    }
    if (availability.available) {
      msgEl.textContent =
        "Disponibilidad: Este equipo está disponible para recibir solicitudes. (" +
        availability.maximum +
        " registros máx)";
    } else {
      msgEl.textContent =
        "Disponibilidad: Cupo completo de la sesión (" + availability.maximum + " registros).";
    }
  }

  function handleBootstrapSuccess(data) {
    if (!data) {
      showUnavailable("No se recibió información de la sesión.");
      return;
    }

    var sessionCodeEl = getElement("session-code");
    var stationLabelEl = getElement("station-label");
    var sessionStatusEl = getElement("session-status");
    var expirationEl = getElement("expiration");

    if (sessionCodeEl) sessionCodeEl.textContent = "Sesión " + (data.sessionCode || "KCM");

    var cursoEl = getElement("registration-training");
    if (cursoEl) {
      if (data.trainingName) {
        cursoEl.textContent =
          data.trainingName +
          (data.room ? " · " + data.room : "") +
          (data.startTime ? " · " + data.startTime : "");
        cursoEl.hidden = false;
      } else {
        cursoEl.hidden = true;
      }
    }
    if (stationLabelEl) stationLabelEl.textContent = data.stationLabel || "Equipo de registro";
    if (sessionStatusEl) sessionStatusEl.textContent = data.status || "ABIERTA";
    if (expirationEl && data.expiresAt) {
      expirationEl.textContent =
        "Vínculo válido hasta: " + new Date(data.expiresAt).toLocaleTimeString();
    }

    updateAvailability(data.availability);

    if (!data.acceptingRegistrations) {
      showUnavailable("La sesión actual no está aceptando registros en este momento.");
      return;
    }

    showSection("registration");
    var empInput = getElement("employee-id");
    if (empInput) {
      empInput.value = "";
      empInput.focus();
    }
  }

  function showUnavailable(message) {
    showSection("unavailable");
    var msgEl = getElement("unavailable-message");
    if (msgEl)
      msgEl.textContent = message || "Solicite apoyo a la persona responsable de la capacitación.";
    var quickOpenEl = getElement("kiosk-quick-open");
    if (quickOpenEl) quickOpenEl.hidden = false;
  }

  function initBootstrap() {
    token = extractToken();
    clearTokenFromHistory();
    startBootstrapCall();
  }

  function showLauncherMessage(message, isError) {
    var el = getElement("launcher-message");
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#e08a8a" : "rgba(226,230,236,0.55)";
  }

  function loadCatalog() {
    if (catalogLoaded || !kioskGrant) return;
    catalogLoaded = true;
    var dateInput = getElement("kiosk-date");
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
    var select = getElement("kiosk-training");
    if (select && !select.options.length) {
      showLauncherMessage("Sin cursos activos configurados; use el código de sesión.", true);
    }
  }

  function openLauncher() {
    if (kioskGrant) {
      showSection("launcher");
      loadCatalog();
      return;
    }
    showSection("unlock");
    var pinInput = getElement("kiosk-pin");
    if (pinInput) {
      pinInput.value = "";
      pinInput.focus();
    }
  }

  /**
   * Recibe el vinculo emitido por el codigo y no empieza a registrar: pinta
   * la ficha de la sesion y espera un acto explicito.
   *
   * El vinculo ya esta emitido cuando llegamos aqui, y no importa: vincular no
   * registra a nadie. Si quien capacita dice que no es su sesion, se descarta y
   * se vuelve al codigo sin haber tocado ninguna asistencia.
   */
  function startWithSession(data) {
    if (!data || !data.token) {
      showLauncherMessage("No se recibió el vínculo seguro de la sesión.", true);
      return;
    }
    tokenPorConfirmar = String(data.token);
    sesionPorConfirmar = data.session || null;

    // Sin ficha no hay nada que confirmar y obligar a confirmar a ciegas seria
    // peor que no preguntar: se sigue de largo como antes.
    if (!sesionPorConfirmar) {
      token = tokenPorConfirmar;
      tokenPorConfirmar = "";
      showSection("loading");
      startBootstrapCall();
      return;
    }

    pintarConfirmacion(sesionPorConfirmar, data.sessionCode);
    showSection("confirm");
  }

  /** Fecha ISO y hora a algo que se lee en una sala. */
  function textoDeCuando(fechaIso, hora) {
    var partes = String(fechaIso || "").split("-");
    var texto = fechaIso || "Sin fecha";
    if (partes.length === 3) {
      // Se arma en local y no con `new Date(iso)`, que interpreta la cadena
      // como UTC y en México la corre un dia hacia atras.
      var fecha = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
      if (!isNaN(fecha.getTime())) {
        texto = fecha.toLocaleDateString("es-MX", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
      }
    }
    return hora ? texto + ", " + hora : texto;
  }

  function pintarConfirmacion(sesion, codigoDeRespaldo) {
    var curso = getElement("confirm-training");
    var instructor = getElement("confirm-instructor");
    var cuando = getElement("confirm-when");
    var sala = getElement("confirm-room");
    var codigo = getElement("confirm-code");
    var aviso = getElement("confirm-warning");

    if (curso) curso.textContent = sesion.trainingName || "Curso sin nombre";
    if (instructor) instructor.textContent = sesion.instructor || "Sin instructor declarado";
    if (cuando) cuando.textContent = textoDeCuando(sesion.date, sesion.startTime);
    if (sala) sala.textContent = sesion.room || "Sin sala asignada";
    if (codigo) codigo.textContent = sesion.sessionCode || codigoDeRespaldo || "";

    // Una sesion que no esta abierta se vincula igual, pero no va a aceptar
    // registros. Decirlo aqui evita que la sala lo descubra con el primer
    // trabajador delante.
    if (aviso) {
      if (sesion.status && sesion.status !== "ABIERTA") {
        aviso.textContent =
          "Esta sesión está en estado " +
          sesion.status +
          ". No aceptará registros hasta que capacitación la abra.";
        aviso.hidden = false;
      } else {
        aviso.hidden = true;
      }
    }
  }

  function startBootstrapCall() {
    if (!token) {
      showSection("boot");
      return;
    }

    call("kioskBootstrap", { token: token })
      .then(function (res) {
        handleBootstrapSuccess(res.data);
      })
      .catch(function (err) {
        showUnavailable(err.message || "Error al validar la sesión.");
      });
  }

  function setupFormHandlers() {
    var regForm = getElement("registration-form");
    var empInput = getElement("employee-id");
    var empHelp = getElement("employee-help");
    var regBtn = getElement("register-button");
    var resultMsg = getElement("result-message");
    var resultTitle = getElement("result-title");
    var resultDetail = getElement("result-detail");
    var nextBtn = getElement("next-person");

    function resetFormState() {
      if (autoResetTimer) {
        clearTimeout(autoResetTimer);
        autoResetTimer = null;
      }
      if (resultMsg) resultMsg.hidden = true;
      if (regForm) regForm.hidden = false;
      if (empInput) {
        empInput.value = "";
        empInput.classList.remove("input-error");
        empInput.focus();
      }
      if (empHelp) {
        empHelp.classList.remove("error-text");
        empHelp.textContent = "Incluya los ceros iniciales, sin espacios ni guiones.";
      }
      if (regBtn) regBtn.disabled = false;
    }

    if (empInput) {
      empInput.addEventListener("input", function (e) {
        var digits = e.target.value.replace(/\D/g, "").slice(0, 5);
        e.target.value = digits;
        if (empInput.classList.contains("input-error")) {
          empInput.classList.remove("input-error");
          if (empHelp) {
            empHelp.classList.remove("error-text");
            empHelp.textContent = "Incluya los ceros iniciales, sin espacios ni guiones.";
          }
        }
      });
    }

    if (regForm) {
      regForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!empInput) return;
        var val = empInput.value.trim();

        if (val.length !== 5) {
          empInput.classList.add("input-error");
          if (empHelp) {
            empHelp.classList.add("error-text");
            empHelp.textContent = "Escriba los 5 dígitos del número de trabajador.";
          }
          return;
        }

        if (regBtn) regBtn.disabled = true;

        call("kioskRegister", { token: token, employeeId: val })
          .then(function (res) {
            if (regForm) regForm.hidden = true;
            if (resultMsg) resultMsg.hidden = false;
            if (resultTitle) resultTitle.textContent = "Asistencia registrada";
            if (resultDetail) resultDetail.textContent = "Trabajador " + val + " · gracias";
            if (nextBtn) nextBtn.hidden = false;

            autoResetTimer = setTimeout(resetFormState, 3500);
          })
          .catch(function (err) {
            if (regBtn) regBtn.disabled = false;
            empInput.classList.add("input-error");
            if (empHelp) {
              empHelp.classList.add("error-text");
              empHelp.textContent = err.message || "Error al procesar la solicitud.";
            }
          });
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", resetFormState);
    }

    var quickOpenForm = getElement("kiosk-quick-open-form");
    var quickInstructor = getElement("kiosk-quick-instructor");
    if (quickOpenForm) {
      quickOpenForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var instructor = quickInstructor ? quickInstructor.value.trim() : "";
        var instructorField = getElement("kiosk-instructor");
        if (instructorField && instructor) instructorField.value = instructor;
        openLauncher();
      });
    }

    var startBtn = getElement("kiosk-start-btn");
    if (startBtn) startBtn.addEventListener("click", openLauncher);

    var unlockCancel = getElement("kiosk-unlock-cancel");
    var confirmStart = getElement("confirm-start");
    var confirmBack = getElement("confirm-back");
    if (confirmStart) {
      confirmStart.addEventListener("click", function () {
        if (!tokenPorConfirmar) {
          showSection("launcher");
          return;
        }
        token = tokenPorConfirmar;
        tokenPorConfirmar = "";
        showSection("loading");
        startBootstrapCall();
      });
    }
    if (confirmBack) {
      confirmBack.addEventListener("click", function () {
        // El vinculo se tira: no se registro nada con el y volver al codigo debe
        // dejar el quiosco como estaba antes de teclearlo.
        tokenPorConfirmar = "";
        sesionPorConfirmar = null;
        var campo = getElement("kiosk-access-code");
        if (campo) {
          campo.value = "";
          campo.focus();
        }
        showLauncherMessage("Escriba el código de la sesión.", false);
        showSection("launcher");
      });
    }

    if (unlockCancel)
      unlockCancel.addEventListener("click", function () {
        showSection("boot");
      });

    var launcherBack = getElement("kiosk-launcher-back");
    if (launcherBack)
      launcherBack.addEventListener("click", function () {
        showSection("boot");
      });

    var unlockForm = getElement("kiosk-unlock-form");
    var pinInput = getElement("kiosk-pin");
    var unlockHelp = getElement("unlock-help");
    var unlockBtn = getElement("kiosk-unlock-btn");

    function resetUnlockHelp() {
      if (pinInput) pinInput.classList.remove("input-error");
      if (unlockHelp) {
        unlockHelp.classList.remove("error-text");
        unlockHelp.textContent = "Entre cuatro y doce dígitos. No se guarda en este equipo.";
      }
    }

    if (pinInput) {
      pinInput.addEventListener("input", function (e) {
        e.target.value = e.target.value.replace(/\D/g, "").slice(0, 12);
        resetUnlockHelp();
      });
    }

    if (unlockForm) {
      unlockForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var pin = pinInput ? pinInput.value.trim() : "";
        if (pin.length < 4) {
          if (pinInput) pinInput.classList.add("input-error");
          if (unlockHelp) {
            unlockHelp.classList.add("error-text");
            unlockHelp.textContent = "Escriba al menos cuatro dígitos.";
          }
          return;
        }
        if (unlockBtn) unlockBtn.disabled = true;
        call("kioskUnlock", { pin: pin })
          .then(function (res) {
            kioskGrant = String((res.data && res.data.grant) || "");
            kioskPin = pin;
            if (pinInput) pinInput.value = "";
            resetUnlockHelp();
            showSection("launcher");
            loadCatalog();
          })
          .catch(function (err) {
            if (pinInput) pinInput.classList.add("input-error");
            if (unlockHelp) {
              unlockHelp.classList.add("error-text");
              unlockHelp.textContent = unlockFailureMessage(err);
            }
          })
          .then(function () {
            if (unlockBtn) unlockBtn.disabled = false;
          });
      });
    }

    var codeInput = getElement("kiosk-access-code");
    if (codeInput) {
      codeInput.addEventListener("input", function (e) {
        var raw = e.target.value
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, "")
          .slice(0, 25);
        if (!raw.startsWith("KCM") && raw.replace(/-/g, "").length <= 8 && !raw.includes("-")) {
          var clean = raw.replace(/[^A-Z0-9]/g, "");
          e.target.value = clean.length > 4 ? clean.slice(0, 4) + "-" + clean.slice(4) : clean;
        } else {
          e.target.value = raw;
        }
        codeInput.classList.remove("input-error");
      });
    }

    var codeForm = getElement("kiosk-code-form");
    var codeBtn = getElement("kiosk-code-btn");
    if (codeForm) {
      codeForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var value = codeInput ? codeInput.value.trim() : "";
        // «KC1» ya es un código: el servidor lo completa a KC-0001.
        var cleanLen = value.replace(/[^A-Za-z0-9]/g, "").length;
        if (cleanLen < 3 || cleanLen > 25) {
          if (codeInput) codeInput.classList.add("input-error");
          showLauncherMessage(
            "Escriba el código de sesión (KC-0001) o el código corto (ABCD-2345).",
            true,
          );
          return;
        }
        if (codeBtn) codeBtn.disabled = true;
        showLauncherMessage("Validando el código de sesión…", false);
        call("kioskRedeemAccessCode", {
          grant: kioskGrant,
          accessCode: value,
          // La ruta de esta plataforma nombra `sessionCode` lo que el quiosco
          // La pantalla anterior lo llamaba codigo de acceso; se envian los dos nombres.
          sessionCode: value,
          stationLabel: getElement("kiosk-station") ? getElement("kiosk-station").value.trim() : "",
        })
          .then(function (res) {
            startWithSession(res.data);
          })
          .catch(function (err) {
            if (codeInput) codeInput.classList.add("input-error");
            showLauncherMessage(err.message || "No fue posible iniciar con ese código.", true);
          })
          .then(function () {
            if (codeBtn) codeBtn.disabled = false;
          });
      });
    }

    var launchForm = getElement("kiosk-launch-form");
    var launchBtn = getElement("kiosk-launch-btn");
    if (launchForm) {
      launchForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var training = getElement("kiosk-training");
        var instructor = getElement("kiosk-instructor");
        var date = getElement("kiosk-date");
        var duration = getElement("kiosk-duration");
        var station = getElement("kiosk-station");
        var instructorValue = instructor ? instructor.value.trim() : "";
        var trainingValue = training ? training.value : "";
        var dateValue = date ? date.value : "";
        var durationValue = Number(duration ? duration.value : 0);
        if (
          !trainingValue ||
          !instructorValue ||
          !dateValue ||
          !(durationValue >= 1 && durationValue <= 1440)
        ) {
          showLauncherMessage(
            "Complete curso, instructor, fecha y duración entre 1 y 1440 minutos.",
            true,
          );
          return;
        }
        if (launchBtn) launchBtn.disabled = true;
        showLauncherMessage("Abriendo la sesión de capacitación…", false);
        call("kioskLaunchSession", {
          pin: kioskPin,
          trainingId: trainingValue,
          instructor: instructorValue,
          date: dateValue,
          durationMinutes: durationValue,
          stationLabel: station ? station.value.trim() : "",
        })
          .then(function (res) {
            startWithSession(res.data);
          })
          .catch(function (err) {
            showLauncherMessage(err.message || "No fue posible abrir la sesión.", true);
          })
          .then(function () {
            if (launchBtn) launchBtn.disabled = false;
          });
      });
    }

    var closeSessionBtn = getElement("kiosk-close-session-btn");
    if (closeSessionBtn) {
      closeSessionBtn.addEventListener("click", function () {
        if (!confirm("Se cerrará la sesión en este equipo de registro.")) return;
        closeSessionBtn.disabled = true;
        call("kioskCloseSession", { token: token })
          .then(function () {
            token = "";
            catalogLoaded = false;
            showSection("boot");
            showLauncherMessage(
              "Sesión cerrada correctamente. Puedes abrir una nueva cuando lo necesites.",
              false,
            );
          })
          .catch(function (err) {
            showUnavailable(err.message || "No fue posible cerrar la sesión desde este equipo.");
          })
          .then(function () {
            closeSessionBtn.disabled = false;
          });
      });
    }
  }

  window.addEventListener("pagehide", function () {
    if (autoResetTimer) {
      clearTimeout(autoResetTimer);
      autoResetTimer = null;
    }
  });

  var initialized = false;
  function startApp() {
    if (initialized) return;
    initialized = true;
    setupFormHandlers();
    initBootstrap();
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("DOMContentLoaded", startApp);
  }
  if (
    typeof document !== "undefined" &&
    (document.readyState === "interactive" ||
      document.readyState === "complete" ||
      typeof document.addEventListener !== "function")
  ) {
    startApp();
  }
})();
