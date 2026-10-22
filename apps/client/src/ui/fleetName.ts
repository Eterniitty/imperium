import type { Fleet } from "@imperium/shared";

/** Nombre de una flota: el que le puso su dueño o, si no tiene, «Flota N». */
export function fleetName(f: Pick<Fleet, "number" | "name">, tr: (key: "fleet.name", params: { n: number }) => string): string {
  return f.name?.trim() || tr("fleet.name", { n: f.number });
}
