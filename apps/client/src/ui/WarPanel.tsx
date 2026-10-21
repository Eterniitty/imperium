import { engineRef } from "../engineRef";
import { useCallback, useEffect, useState } from "react";
import { ALIEN_AI } from "@imperium/content";
import type { AlienSighting, AlienStanding, Battle, ContactsResponse, Fleet, FleetContact, I18nKey, ShipCounts } from "@imperium/shared";
import { connection, useWorld } from "../net/world";
import { refreshAliens, useAliens } from "../state/aliens";
import { api } from "../state/auth";
import { useGame, useT } from "../state/store";
import { factionName, speciesColor, speciesName } from "./aliens";
import { contentText } from "./fleets";
import { formatDuration, useServerNow } from "./useNow";
import { SiegeList } from "./SiegePanel";

/** Créditos que borran todo el rencor de una facción (como poco, el tributo mínimo). */
function tributeCost(s: AlienStanding): number {
  return Math.max(ALIEN_AI.grudge.minTribute, Math.ceil(s.grudge * ALIEN_AI.grudge.tributeCreditsPerPoint));
}

/** Cada cuánto se piden los contactos mientras el panel está abierto. */
const CONTACTS_REFRESH_MS = 30_000;

/**
 * Guerra (Fase 9a): batallas de flotas propias (en curso y recientes, por
 * rondas en el servidor) y contactos (flotas enemigas en tránsito que detectan
 * tus sensores) con la orden de interceptarlas.
 */
export function WarPanel() {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const battles = useWorld((s) => s.battles);
  const sieges = useWorld((s) => s.sieges);
  const fleets = useWorld((s) => s.fleets);
  const now = useServerNow();
  const [open, setOpen] = useState(true);
  const [contacts, setContacts] = useState<FleetContact[]>([]);
  const [sightings, setSightings] = useState<AlienSighting[]>([]);
  const standings = useAliens((s) => s.standings);
  const hostileAt = useAliens((s) => s.hostileAt);
  const [error, setError] = useState<I18nKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const res = await api<ContactsResponse>("GET", "/api/contacts");
    if (res.ok) {
      setContacts(res.data.contacts);
      setSightings(res.data.sightings ?? []);
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const id = setInterval(() => void refresh(), CONTACTS_REFRESH_MS);
    return () => clearInterval(id);
  }, [open, refresh]);

  const list = (Object.values(battles) as Battle[]).sort((a, b) => b.startedAt - a.startedAt);
  const visible = contacts.filter((c) => c.arriveAt > now);
  // Flotas que pueden salir a interceptar: paradas (también las que combaten: huirían).
  const idle = (Object.values(fleets) as Fleet[])
    .filter((f) => !(f.travel && f.travel.arriveAt > now))
    .sort((a, b) => a.number - b.number);
  if (list.length === 0 && visible.length === 0 && sightings.length === 0 && standings.length === 0 && Object.keys(sieges).length === 0) return null;
  const enemyLabel = (name: string, factionId: string | null | undefined) => (factionId ? t("aliens.contact", { faction: factionName(locale, factionId) }) : name);

  // Fase 11: tributo para borrar el rencor de una facción (diplomacia básica).
  const tribute = async (s: AlienStanding) => {
    setBusy(true);
    setError(await connection.command("alien.tribute", { factionId: s.factionId, credits: tributeCost(s) }));
    setBusy(false);
    void refreshAliens();
  };

  const counts = (c: ShipCounts) =>
    Object.entries(c)
      .map(([id, n]) => t("ship.count", { count: n, name: contentText(locale, `ship.${id}.name`) }))
      .join(" · ") || t("war.noShips");

  const intercept = async (contact: FleetContact) => {
    const fleetId = chosen[contact.fleetId] ?? idle[0]?.id;
    if (!fleetId) return;
    setBusy(true);
    setError(await connection.command("fleet.intercept", { fleetId, targetFleetId: contact.fleetId }));
    setBusy(false);
  };

  return (
    <div className="fleets war panel hide-sm">
      <button className="help-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t("war.title")} {open ? "▾" : "▸"}
      </button>
      {open && (
        <>
          {/* Fase 9b: asedios propios y contra tus colonias. */}
          <SiegeList />
          {list.length > 0 && (
            <ul className="fleet-list">
              {list.map((b) => {
                const last = b.rounds.at(-1);
                return (
                  <li key={b.id} className={`battle battle-${b.outcome}`}>
                    <strong>{t("war.vs", { enemy: enemyLabel(b.enemyName, b.enemyFactionId), system: b.systemName })}</strong>
                    <span className="small">
                      {b.outcome === "ongoing" ? t("war.outcome.ongoing", { n: b.round }) : t(`war.outcome.${b.outcome}`)}
                      {b.nextRoundAt !== null && <> · {t("war.nextRound", { time: formatDuration(b.nextRoundAt - now) })}</>}
                    </span>
                    {b.outcome === "ongoing" && (
                      <>
                        <span className="small">{t("war.own", { ships: counts(b.own) })}</span>
                        <span className="small">{t("war.foe", { ships: counts(b.foe) })}</span>
                      </>
                    )}
                    {last && <span className="muted small">{t("war.lastRound", { dealt: last.dealt, taken: last.taken })}</span>}
                    {b.outcome === "ongoing" && <span className="muted small">{t("war.fleeHint")}</span>}
                    {b.outcome === "ongoing" && (
                      <button className="link-btn small" data-testid="battle-3d" onClick={() => engineRef.current?.showBattle(b.id)}>
                        {t("war.view3d")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="war-contacts">
            <span className="small">
              {t("war.contacts")}{" "}
              <button className="link-btn" onClick={() => void refresh()}>
                {t("war.refresh")}
              </button>
            </span>
            {visible.length === 0 ? (
              <span className="muted small">{t("war.noContacts")}</span>
            ) : (
              <ul className="fleet-list">
                {visible.map((c) => (
                  <li key={c.fleetId} className="contact">
                    <span className="small">
                      {t("war.contact", { emperor: enemyLabel(c.emperorName, c.factionId), n: c.ships, from: c.from.systemName, to: c.to.systemName })}
                    </span>
                    <span className="muted small">{t("war.contactEta", { time: formatDuration(c.arriveAt - now) })}</span>
                    {idle.length > 0 && (
                      <span className="small">
                        <select
                          aria-label={t("war.interceptWith")}
                          value={chosen[c.fleetId] ?? idle[0]!.id}
                          onChange={(e) => setChosen({ ...chosen, [c.fleetId]: e.target.value })}
                        >
                          {idle.map((f) => (
                            <option key={f.id} value={f.id}>
                              {t("fleet.name", { n: f.number })}
                            </option>
                          ))}
                        </select>{" "}
                        <button className="link-btn" disabled={busy} onClick={() => void intercept(c)}>
                          {t("war.intercept")}
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Fase 11: flotas alienígenas paradas al alcance de tus sensores. */}
          <div className="war-contacts">
            <span className="small">{t("aliens.sightings")}</span>
            {sightings.length === 0 ? (
              <span className="muted small">{t("aliens.noSightings")}</span>
            ) : (
              <ul className="fleet-list">
                {sightings.map((s) => (
                  <li key={s.fleetId} className="contact">
                    <span className="small">
                      <span className="dot" style={{ background: speciesColor(s.speciesId) }} /> {t("aliens.sighting", { faction: factionName(locale, s.factionId), system: s.systemName })}
                    </span>
                    <span className="muted small">
                      {counts(s.ships)}
                      {s.inBattle && <> · {t("aliens.inBattle")}</>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Facciones conocidas y tu relación con ellas. */}
          <div className="war-contacts alien-standings">
            <span className="small">{t("aliens.known")}</span>
            {standings.length === 0 ? (
              <span className="muted small">{t("aliens.none")}</span>
            ) : (
              <ul className="fleet-list">
                {standings.map((s) => (
                  <li key={s.factionId} className="contact">
                    <span className="small">
                      <span className="dot" style={{ background: speciesColor(s.speciesId) }} /> <strong>{factionName(locale, s.factionId)}</strong>{" "}
                      <span className="muted">({speciesName(locale, s.speciesId)})</span>
                    </span>
                    <span className={`small ${s.hostile ? "alien-hostile" : ""}`}>
                      {t(s.hostile ? "aliens.hostile" : s.grudge > 0 ? "aliens.wary" : "aliens.neutral")}
                      {s.grudge > 0 && <> · {t("aliens.grudge", { n: s.grudge.toFixed(2), max: hostileAt })}</>}
                    </span>
                    {s.grudge > 0 && s.acceptsTribute && (
                      <span className="small">
                        <button className="link-btn" disabled={busy} onClick={() => void tribute(s)} title={t("aliens.tributeHint", { per: ALIEN_AI.grudge.tributeCreditsPerPoint })}>
                          {t("aliens.tribute", { credits: tributeCost(s) })}
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {t(error)}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
