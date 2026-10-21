import { useState } from "react";
import { FLEET_TACTIC_IDS } from "@imperium/content";
import type { Fleet, FleetTactic, I18nKey } from "@imperium/shared";
import { connection } from "../net/world";
import { useT } from "../state/store";

/** Táctica de una flota en las batallas por rondas (orden `fleet.tactic`; vale a distancia y en plena batalla). */
export function TacticPicker({ fleet, label }: { fleet: Fleet; label?: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const change = async (tactic: FleetTactic) => {
    setBusy(true);
    setError(await connection.command("fleet.tactic", { fleetId: fleet.id, tactic }));
    setBusy(false);
  };
  return (
    <label className="small tactic-picker" title={t(`tactic.${fleet.tactic}.hint`)}>
      {label ?? t("tactic.label")}{" "}
      <select value={fleet.tactic} disabled={busy} onChange={(e) => void change(e.target.value as FleetTactic)} onClick={(e) => e.stopPropagation()}>
        {FLEET_TACTIC_IDS.map((id) => (
          <option key={id} value={id}>
            {t(`tactic.${id}`)}
          </option>
        ))}
      </select>
      {error && <span className="auth-error small"> {t(error)}</span>}
    </label>
  );
}
