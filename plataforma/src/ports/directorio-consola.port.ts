export interface CuentaDeConsola {
  readonly credencialId: string;
  readonly usuario: string;
  readonly nombreVisible: string;
  readonly credencialHash: string;
  readonly sal: string;
}

export interface ConsoleDirectoryPort {
  buscarPorUsuario(usuario: string): Promise<CuentaDeConsola | undefined>;
  registrarAcceso(credencialId: string, cuando: string): Promise<void>;
}
