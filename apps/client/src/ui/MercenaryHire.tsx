import { useState } from "react";
import { getShipClass, MERCENARIES } from "@imperium/content";
import type { Fleet, I18nKey } from "@imperium/shared";
import { connection, useWorld } from "../net/world";
import { useGame, useT } from "../state/store";
import { contentText } from "./fleets";

/**
 * Contratar mercenarios (`MERCENARIES`) en el sistema donde está la nave del
 * Emperador: cada oferta con sus naves, precio y duración del contrato.
 */
export function MercenaryHire() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const wallet = useWorld((s) => s.wallet);
  const fleets = useWorld((s) => s.fleets);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const active = (Object.values(fleets) as Fleet[]).filter((f) => f.mercenaryUntil !== null).length;
  const credits = wallet?.credits ?? 0;
  const full = active >= MERCENARIES.maxActive;
  const hire = async (offerId: string) => {
    setBusy(true);
    setError(await connection.command("mercenary.hire", { offerId }));
    setBusy(false);
  };
  return (
    <div className="mercenary-hire">
      <h3>{t("mercenary.title")}</h3>
      <p className="muted small">{t("mercenary.hint", { max: MERCENARIES.maxActive })}</p>
      <ul className="emperor-list">
        {MERCENARIES.offers.map((o) => (
          <li key={o.id} className="fleet">
            <span>
              <strong>{t(o.nameKey as I18nKey)}</strong>
              <span className="muted small">
                {" "}
                · {o.ships.map(([id, n]) => `${n}× ${contentText(locale, getShipClass(id)!.nameKey)}`).join(", ")} · {t("mercenary.hours", { h: o.hours })}
              </span>
            </span>
            <button className="btn small" disabled={busy || full || credits < o.credits} onClick={() => void hire(o.id)}>
              {t("mercenary.hire", { cost: o.credits })}
            </button>
          </li>
        ))}
      </ul>
      {full && <p className="muted small">{t("mercenary.limit", { max: MERCENARIES.maxActive })}</p>}
      {error && (
        <p className="auth-error small" role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}
