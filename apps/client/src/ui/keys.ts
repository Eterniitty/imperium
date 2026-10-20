import { keyLabel, useSettings, type Action } from "../state/settings";
import { useGame } from "../state/store";

/** Nombre de la primera tecla asignada a cada acción, para los textos de ayuda. */
export function useKeyLabels(): Record<Action, string> {
  const bindings = useSettings((s) => s.bindings);
  const locale = useGame((s) => s.locale);
  const out = {} as Record<Action, string>;
  for (const [action, codes] of Object.entries(bindings) as Array<[Action, string[]]>) {
    out[action] = codes[0] ? keyLabel(codes[0], locale) : "—";
  }
  return out;
}
