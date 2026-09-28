/**
 * Punto de entrada del perfil de nube.
 *
 * Existe porque el alojamiento no arranca la plataforma como la arranca una
 * máquina: no ejecuta `npm start` ni abre un puerto, sino que carga este
 * módulo y le entrega cada petición a su manejador exportado. El manejador
 * construye la plataforma una vez por instancia con `construir()` de
 * `main.ts` —el único lugar del árbol que decide persistencia— y le pasa la
 * petición al servidor HTTP de Fastify sin escuchar en ningún puerto.
 *
 * Es `.js` a propósito. El resto del árbol corre TypeScript nativo porque Node
 * borra los tipos al cargar el módulo, pero aquí quien carga no es Node
 * directamente: es el empaquetador del alojamiento, que no promete ese borrado
 * ni resolver los imports con extensión `.ts` escrita. Un archivo sin tipos no
 * depende de ninguna de las dos cosas.
 *
 * Las tres variables que se fijan aquí no son ajustes, son la declaración de
 * dónde está corriendo:
 *
 * - `KCM_ROLE=nube` baja los topes de carga por debajo de los 4.5 MB en que
 *   corta el alojamiento, exige la llave de sesión compartida y retira el
 *   botón de apagado. Se impone y no se lee del panel porque este archivo *es*
 *   el perfil de nube.
 * - `KCM_PORT`, `KCM_HOST` y `KCM_ALLOW_PUBLIC_BIND` no abren nada: aquí no se
 *   escucha. Existen porque `loadConfig` los valida igual que en una máquina.
 *
 * Y tres valores por omisión que el panel puede sobrescribir:
 *
 * - `KCM_ENV=production`: una instancia publicada nunca es de desarrollo.
 * - `KCM_TRUST_PROXY=1`: Vercel pone un salto delante. Sin él la plataforma no
 *   ve que la petición llegó por HTTPS ni la IP real de quien intenta entrar.
 * - `KCM_DB_POOL_MAX=3`: cada instancia abre su propio pool y el conector de
 *   Supabase tiene un cupo compartido; diez por instancia lo agotan pronto.
 *
 * `KCM_SESSION_SECRET` no tiene valor aquí: es un secreto y se declara en el
 * panel. Sin él el arranque falla, porque cada instancia sortearía su propia
 * llave y la sesión de la consola se perdería al cambiar de instancia.
 */

process.env.KCM_ROLE = "nube";
// `loadConfig` valida puerto e interfaz aunque aquí no se escuche en ninguno.
process.env.KCM_PORT ??= process.env.PORT || "3000";
process.env.KCM_HOST ??= "0.0.0.0";
process.env.KCM_ALLOW_PUBLIC_BIND ??= "1";
process.env.KCM_ENV ??= "production";
process.env.KCM_TRUST_PROXY ??= "1";
process.env.KCM_DB_POOL_MAX ??= "3";

/** La plataforma de esta instancia. Se construye con la primera petición. */
let plataforma;

function obtenerPlataforma() {
  plataforma ??= import("../plataforma/src/main.ts")
    .then(async ({ construir }) => {
      const { app } = await construir();
      await app.ready();
      return app;
    })
    .catch((error) => {
      // Un arranque fallido no se queda cacheado: la petición siguiente reintenta.
      plataforma = undefined;
      throw error;
    });
  return plataforma;
}

export default async function manejador(peticion, respuesta) {
  const app = await obtenerPlataforma();
  app.server.emit("request", peticion, respuesta);
}
