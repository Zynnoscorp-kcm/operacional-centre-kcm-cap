process.env.KCM_ROLE = "nube";
process.env.KCM_PORT ??= process.env.PORT || "3000";
process.env.KCM_HOST ??= "0.0.0.0";
process.env.KCM_ALLOW_PUBLIC_BIND ??= "1";
process.env.KCM_ENV ??= "production";
process.env.KCM_TRUST_PROXY ??= "1";
process.env.KCM_DB_POOL_MAX ??= "3";

let plataforma;

function obtenerPlataforma() {
  plataforma ??= import("../plataforma/src/main.ts")
    .then(async ({ construir }) => {
      const { app } = await construir();
      await app.ready();
      return app;
    })
    .catch((error) => {
      plataforma = undefined;
      throw error;
    });
  return plataforma;
}

export default async function manejador(peticion, respuesta) {
  const app = await obtenerPlataforma();
  app.server.emit("request", peticion, respuesta);
}
