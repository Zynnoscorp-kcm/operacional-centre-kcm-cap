import type { RoomId } from "../../domain/salas/tipos.ts";

const CLASES: Readonly<Record<RoomId, string>> = {
  KLEENEX: "sala-kleenex",
  PETALO: "sala-petalo",
  VOGUE: "sala-vogue",
  MARLI: "sala-marli",
  DELSEY: "sala-delsey",
  SALA_DRAGONES: "sala-dragones",
  SALA_GERENCIA: "sala-gerencia",
};

export function claseDeSala(roomId: string): string {
  return CLASES[roomId as RoomId] ?? "";
}
