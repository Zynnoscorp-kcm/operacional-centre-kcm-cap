/**
 * Almacén de objetos en disco para las evidencias de preliberación.
 *
 * Los reportes son PDF con nombres y números de trabajador, así que no viajan a
 * un bucket público ni al repositorio: viven bajo una carpeta privada del
 * servidor, declarada en `KCM_STORAGE_DIR`.
 *
 * La ruta que llega del dominio se sanea antes de tocar el disco. Sin eso, un
 * `path` con `..` escribiría fuera de la carpeta declarada, que es la única
 * frontera de privacidad que este adaptador tiene.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

import type { ObjectStorePort } from "./postgres/preliberacion.ts";

export class FileObjectStore implements ObjectStorePort {
  readonly #raiz: string;

  constructor(raiz: string) {
    this.#raiz = resolve(raiz);
  }

  #resolver(ruta: string): string {
    const limpia = normalize(ruta).replace(/^([./\\])+/u, "");
    if (isAbsolute(limpia)) {
      throw new Error("La ruta de un objeto no puede ser absoluta.");
    }
    const destino = resolve(join(this.#raiz, limpia));
    if (destino !== this.#raiz && !destino.startsWith(this.#raiz + sep)) {
      throw new Error("La ruta de un objeto no puede salir del almacén declarado.");
    }
    return destino;
  }

  async put(path: string, content: Uint8Array, _contentType: string): Promise<void> {
    const destino = this.#resolver(path);
    await mkdir(dirname(destino), { recursive: true });
    // 0600: el proceso escribe y lee; nadie más en la máquina.
    await writeFile(destino, content, { mode: 0o600 });
  }

  async get(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#resolver(path)));
    } catch (error) {
      // Un objeto ausente es una respuesta válida del puerto; cualquier otro
      // fallo —permisos, disco— debe propagarse en lugar de parecer un vacío.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
