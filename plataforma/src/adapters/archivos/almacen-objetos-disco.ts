import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

import type { ObjectStorePort } from "../postgres/preliberacion.ts";

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
    await writeFile(destino, content, { mode: 0o600 });
  }

  async get(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.#resolver(path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
