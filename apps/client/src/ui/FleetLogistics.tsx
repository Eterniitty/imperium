import { useState } from "react";
import { CARGO_STOCK_IDS } from "@imperium/content";
import type { Cargo, Colony, Fleet, I18nKey } from "@imperium/shared";
import { connection, useWorld } from "../net/world";
import { useT } from "../state/store";
import { fmtInt } from "./colonies";

const KINDS = [...CARGO_STOCK_IDS, "humans"] as const;
type Kind = (typeof KINDS)[number];

/** Total en la bodega (recursos juntos) y pasajeros. */
export function cargoSummary(f: Fleet): { resources: number; humans: number } {
  return { resources: CARGO_STOCK_IDS.reduce((a, r) => a + f.cargo[r], 0), humans: f.cargo.humans };
}

/**
 * Logística de una flota parada en un sistema con una colonia tuya: cargar y
 * descargar recursos y pasajeros, y rutas automáticas hacia otra colonia tuya.
 */
export function FleetLogistics({ fleet, colony }: { fleet: Fleet; colony: Colony }) {
  const t = useT();
  const colonies = useWorld((s) => s.colonies);
  const [amounts, setAmounts] = useState<Partial<Record<Kind, string>>>({});
  const [routeTo, setRouteTo] = useState("");
  const [carry, setCarry] = useState<Record<Kind, boolean>>({ metal: true, volatiles: false, crystal: false, alloys: false, humans: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const sum = cargoSummary(fleet);
  const others = (Object.values(colonies) as Colony[]).filter((c) => c.systemId !== colony.systemId);
  const name = (c: Colony | undefined) => (c ? (c.name ?? c.planetName) : "?");

  const run = async (p: Promise<I18nKey | null>) => {
    setBusy(true);
    setError(await p);
    setBusy(false);
  };
  const transfer = (direction: "load" | "unload") => {
    const parsed: Partial<Cargo> = {};
    for (const k of KINDS) {
      const v = Number.parseFloat(amounts[k] ?? "");
      if (Number.isFinite(v) && v > 0) parsed[k] = v;
    }
    void run(connection.command("fleet.transfer", { fleetId: fleet.id, colonyId: colony.id, direction, amounts: parsed })).then(() => setAmounts({}));
  };

  return (
    <div className="logistics">
      <p className="small">
        {t("logistics.hold", { used: fmtInt(sum.resources), cap: fmtInt(fleet.capacity.resources) })}
        {fleet.capacity.humans > 0 && ` · ${t("logistics.seats", { used: fmtInt(sum.humans), cap: fmtInt(fleet.capacity.humans) })}`}
      </p>
      {fleet.capacity.resources + fleet.capacity.humans > 0 && (
        <>
          <div className="logistics-grid">
            {KINDS.filter((k) => k !== "humans" || fleet.capacity.humans > 0).map((k) => (
              <label key={k}>
                <span className="muted small">
                  {t(k === "humans" ? "logistics.passengers" : `resource.${k}`)} <span className="mono">({fmtInt(fleet.cargo[k])})</span>
                </span>
                <input inputMode="numeric" value={amounts[k] ?? ""} placeholder="0" onChange={(e) => setAmounts({ ...amounts, [k]: e.target.value.replace(/[^0-9.]/g, "") })} />
              </label>
            ))}
          </div>
          <div className="actions">
            <button className="btn" disabled={busy} onClick={() => transfer("load")}>
              {t("logistics.load")}
            </button>
            <button className="btn" disabled={busy} onClick={() => transfer("unload")}>
              {t("logistics.unload")}
            </button>
          </div>

          {fleet.route ? (
            <p className="small">
              {t("logistics.routeActive", { from: name(colonies[fleet.route.fromColonyId]), to: name(colonies[fleet.route.toColonyId]) })}{" "}
              <button className="link-btn" disabled={busy} onClick={() => void run(connection.command("fleet.routeStop", { fleetId: fleet.id }))}>
                {t("logistics.routeStop")}
              </button>
            </p>
          ) : (
            others.length > 0 && (
              <div className="route-form">
                <label>
                  <span className="muted small">{t("logistics.routeTo")}</span>
                  <select className="auth-input" value={routeTo} onChange={(e) => setRouteTo(e.target.value)}>
                    <option value="">—</option>
                    {others.map((c) => (
                      <option key={c.id} value={c.id}>
                        {name(c)} · {c.systemName}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="route-carry">
                  {KINDS.filter((k) => k !== "humans" || fleet.capacity.humans > 0).map((k) => (
                    <label key={k} className="small">
                      <input type="checkbox" checked={carry[k]} onChange={(e) => setCarry({ ...carry, [k]: e.target.checked })} />{" "}
                      {t(k === "humans" ? "logistics.passengers" : `resource.${k}`)}
                    </label>
                  ))}
                </div>
                <button
                  className="btn"
                  disabled={busy || !routeTo}
                  onClick={() =>
                    void run(
                      connection.command("fleet.route", {
                        fleetId: fleet.id,
                        fromColonyId: colony.id,
                        toColonyId: routeTo,
                        carry: CARGO_STOCK_IDS.filter((r) => carry[r]),
                        humans: carry.humans,
                      }),
                    )
                  }
                >
                  {t("logistics.routeStart")}
                </button>
              </div>
            )
          )}
        </>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
