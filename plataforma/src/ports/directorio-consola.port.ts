/**
 * Directorio de acceso a la consola.
 *
 * Es deliberadamente estrecho: la pantalla de acceso sólo necesita encontrar
 * una cuenta vigente por su nombre y anotar que entró. No hay alta, baja ni
 * cambio de contraseña por aquí —eso se hace contra la base, con actor y motivo
 * declarados— y no hay forma de listar cuentas: una puerta no enumera.
 *
 * La contraseña nunca cruza este puerto. Lo que devuelve es la derivación y su
 * sal; comparar es cosa del servicio de dominio.
 */

export interface CuentaDeConsola {
  readonly credencialId: string;
  /** Tal como se dio de alta, con sus mayúsculas. Es lo que se firma en la sesión. */
  readonly usuario: string;
  readonly nombreVisible: string;
  readonly credencialHash: string;
  readonly sal: string;
}

export interface ConsoleDirectoryPort {
  /** `undefined` si no existe o está revocada. La búsqueda ignora mayúsculas. */
  buscarPorUsuario(usuario: string): Promise<CuentaDeConsola | undefined>;
  /** Se llama sólo después de una entrada aceptada. */
  registrarAcceso(credencialId: string, cuando: string): Promise<void>;
}
