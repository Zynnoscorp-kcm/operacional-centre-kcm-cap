import type { PhotoPlaceholder } from "./tipos.ts";

const PALETTE = [
  "#284870",
  "#1e3a8a",
  "#0369a1",
  "#0f766e",
  "#374151",
  "#1d4ed8",
  "#047857",
  "#4338ca",
];

export function generatePhotoPlaceholder(name: string, employeeId: string): PhotoPlaceholder {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  let initials = "TR";

  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const second = parts[1]?.[0] ?? "";
    initials = `${first}${second}`.toUpperCase();
  } else if (parts.length === 1 && parts[0]) {
    initials = parts[0].slice(0, 2).toUpperCase();
  }

  let hash = 0;
  for (let i = 0; i < employeeId.length; i++) {
    hash = (hash * 31 + employeeId.charCodeAt(i)) & 0xffffffff;
  }
  const colorIndex = Math.abs(hash) % PALETTE.length;
  const accentColor = PALETTE[colorIndex] ?? "#284870";

  return {
    initials,
    accentColor,
    ariaLabel: `Marcador de foto para trabajador ${employeeId}`,
  };
}
