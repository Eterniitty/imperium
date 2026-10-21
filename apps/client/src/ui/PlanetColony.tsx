import { useEffect, useState, type FormEvent } from "react";
import { ECONOMY, INSTALLATIONS, SHIP_CLASSES, STOCK_IDS, type StockAmounts } from "@imperium/content";
import { PLANET_NAME_MAX, PLANET_NAME_MIN, type Colony, type Fleet, type I18nKey, type Planet, type StarSystemDetail } from "@imperium/shared";
import { minColonists } from "@imperium/sim";
import { connection, useWorld } from "../net/world";
import { useAuth } from "../state/auth";
import { useClaims } from "../state/claims";
import { useGame, useT } from "../state/store";
import { fmtInt, fmtRate, liveHumans, livePopulation, liveStock, ownColonyAt, planetLabel } from "./colonies";
import { RESOURCE_COLORS } from "./common";
import { contentText } from "./fleets";
import { formatDuration, useServerNow } from "./useNow";
import { factionName } from "./aliens";
import { PlanetSiege } from "./SiegePanel";

const STOCK_COLORS: Record<string, string> = { ...RESOURCE_COLORS, alloys: "#ff9f5a" };

/** Coste compacto: «M150 V20». */
function Cost({ cost, stock }: { cost: StockAmounts; stock: StockAmounts | null }) {
  const t = useT();
  return (
    <span className="cost mono small">
      {STOCK_IDS.filter((r) => cost[r] > 0).map((r) => (
        <span key={r} style={{ color: STOCK_COLORS[r], opacity: stock && stock[r] < cost[r] ? 0.45 : 1 }} title={t(`resource.${r}`)}>
          {t(`resource.${r}`).charAt(0)}
          {cost[r]}
        </span>
      ))}
    </span>
  );
}

/**
 * Dueño, nombre y colonia de un planeta: reclamarlo (con el Emperador o un
 * colonizador presentes), renombrarlo y, si es propio, su población,
 * existencias, producción, instalaciones y cola de construcción. Se usa en el
 * panel de sistema (mapa) y en el de planetas (vista de sistema).
 */
export function PlanetColony({ detail, planet }: { detail: StarSystemDetail; planet: Planet }) {
  const t = useT();
  const locale = useGame((s) => s.locale);
  const systemId = detail.summary.id;
  const colonies = useWorld((s) => s.colonies);
  const fleets = useWorld((s) => s.fleets);
  const humans = useWorld((s) => s.humans);
  const myId = useWorld((s) => s.myEmperorId);
  const emperor = useAuth((s) => s.emperor);
  const { claims, systemId: claimsFor } = useClaims();
  const now = useServerNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<I18nKey | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const need = minColonists(planet.habitability);
  const [landing, setLanding] = useState(String(need));

  // Al cambiar de planeta, se empieza de cero.
  useEffect(() => {
    setError(null);
    setRenaming(false);
    setLanding(String(need));
  }, [systemId, planet.index, need]);

  const own = ownColonyAt(colonies, systemId, planet.index);
  const claim = claimsFor === systemId ? claims[planet.index] : undefined;
  const owned = own !== undefined || (claim !== undefined && claim.ownerId !== myId);
  if (!emperor) return null;

  const run = async (op: Promise<I18nKey | null>) => {
    setBusy(true);
    setError(await op);
    setBusy(false);
  };

  // ¿Está aquí el Emperador (parado)?
  const travel = emperor.travel && emperor.travel.arriveAt > now ? emperor.travel : null;
  const emperorAt = emperor.travel && !travel ? emperor.travel.to.systemId : emperor.location.systemId;
  const emperorHere = !travel && emperorAt === systemId;
  const aboard = Math.floor(liveHumans(humans, now));
  // Flotas propias paradas aquí con un colonizador cargado.
  const colonizerFleets = (Object.values(fleets) as Fleet[])
    .filter((f) => !(f.travel && f.travel.arriveAt > now) && (f.travel ? f.travel.to.systemId : f.location.systemId) === systemId)
    .map((f) => ({ f, n: Math.max(0, ...f.ships.filter((s) => s.classId === "colonizer").map((s) => s.humans)) }))
    .filter(({ f }) => f.ships.some((s) => s.classId === "colonizer"))
    .sort((a, b) => a.f.number - b.f.number);

  const claimHere = (e: FormEvent) => {
    e.preventDefault();
    const n = Number.parseInt(landing, 10);
    void run(connection.command("colony.claim", { systemId, planetIndex: planet.index, humans: Number.isFinite(n) ? n : need }));
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!own) return;
    setBusy(true);
    const err = await connection.command("colony.rename", { colonyId: own.id, name });
    setBusy(false);
    setError(err);
    if (!err) setRenaming(false);
  };

  const errorText = error && t(error, { min: PLANET_NAME_MIN, max: PLANET_NAME_MAX });

  return (
    <div className="colony">
      <dl className="facts">
        <dt>{t("colony.owner")}</dt>
        <dd className={own ? "owner-own" : claim ? "owner-other" : "muted"}>
          {own ? t("colony.yours") : claim ? (claim.ownerFactionId ? factionName(locale, claim.ownerFactionId) : (claim.ownerName ?? t("colony.independent"))) : t("colony.free")}
        </dd>
      </dl>

      {/* Fase 9b: asedio en curso, o asediar una colonia ajena. */}
      {(own || claim) && <PlanetSiege systemId={systemId} colonyId={own?.id ?? claim!.colonyId} claim={claim} own={own !== undefined} />}

      {!owned && (
        <div className="colony-claim">
          {emperorHere && (
            <form className="claim-form" onSubmit={claimHere}>
              <label>
                <span className="muted small">{t("colony.humansToLand")}</span>
                <input type="number" min={need} max={aboard} value={landing} onChange={(e) => setLanding(e.target.value.replace(/[^0-9]/g, ""))} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy || aboard < need}>
                {t(busy ? "colony.claiming" : "colony.claim")}
              </button>
            </form>
          )}
          {emperorHere && <p className="muted small">{t("colony.minColonists", { n: need, have: aboard })}</p>}
          {colonizerFleets.map(({ f, n }) => (
            <button
              key={f.id}
              className="btn"
              disabled={busy || n < need}
              onClick={() => void run(connection.command("colony.claim", { systemId, planetIndex: planet.index, fleetId: f.id }))}
            >
              {t("colony.claimWithFleet", { name: t("fleet.name", { n: f.number }), n })}
            </button>
          ))}
          {!emperorHere && colonizerFleets.length === 0 && <p className="muted small">{t("colony.claimHint", { n: need })}</p>}
        </div>
      )}

      {own && (
        <>
          {renaming ? (
            <form className="claim-form" onSubmit={(e) => void saveName(e)}>
              <label>
                <span className="muted small">{t("colony.nameLabel")}</span>
                <input value={name} maxLength={PLANET_NAME_MAX} autoFocus onChange={(e) => setName(e.target.value)} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {t("colony.save")}
              </button>
              <button className="btn" type="button" onClick={() => setRenaming(false)}>
                {t("colony.cancel")}
              </button>
            </form>
          ) : (
            <div className="actions">
              <button
                className="btn"
                onClick={() => {
                  setName(planetLabel(planet, claim, own));
                  setError(null);
                  setRenaming(true);
                }}
              >
                {t("colony.rename")}
              </button>
            </div>
          )}
          {emperorHere && <Disembark colony={own} aboard={aboard} now={now} busy={busy} onLand={(n) => void run(connection.command("colony.disembark", { colonyId: own.id, humans: n }))} />}
          <ColonyDetail
            colony={own}
            now={now}
            busy={busy}
            locale={locale}
            onBuild={(kind, itemId) => void run(connection.command("colony.build", { colonyId: own.id, kind, itemId }))}
            onCancel={(buildId) => void run(connection.command("colony.cancel", { colonyId: own.id, buildId }))}
          />
        </>
      )}

      {errorText && (
        <p className="auth-error" role="alert">
          {errorText}
        </p>
      )}
    </div>
  );
}

/** Desembarcar humanos de la nave del Emperador (presente en el sistema) en la colonia, sin pasar de su tope. */
function Disembark({ colony, aboard, now, busy, onLand }: { colony: Colony; aboard: number; now: number; busy: boolean; onLand: (n: number) => void }) {
  const t = useT();
  const room = Math.max(0, Math.floor(colony.populationCap - livePopulation(colony, now)));
  const max = Math.min(aboard, room);
  const [n, setN] = useState("");
  if (max < 1) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = Math.min(max, Math.max(1, Number.parseInt(n, 10) || max));
    onLand(v);
    setN("");
  };
  return (
    <form className="claim-form" onSubmit={submit}>
      <label>
        <span className="muted small">{t("colony.disembarkLabel", { max })}</span>
        <input type="number" min={1} max={max} placeholder={String(max)} value={n} onChange={(e) => setN(e.target.value.replace(/[^0-9]/g, ""))} />
      </label>
      <button className="btn" type="submit" disabled={busy}>
        {t("colony.disembark")}
      </button>
    </form>
  );
}

function ColonyDetail({
  colony,
  now,
  busy,
  locale,
  onBuild,
  onCancel,
}: {
  colony: Colony;
  now: number;
  busy: boolean;
  locale: Parameters<typeof contentText>[0];
  onBuild: (kind: "installation" | "ship", itemId: string) => void;
  onCancel: (buildId: string) => void;
}) {
  const t = useT();
  const stock = liveStock(colony, now);
  const population = livePopulation(colony, now);
  const queued = (id: string) => colony.builds.filter((b) => b.kind === "installation" && b.itemId === id).length;
  const itemName = (kind: string, id: string) => (kind === "installation" ? t(`installation.${id}` as I18nKey) : contentText(locale, `ship.${id}.name`));
  const affordable = (cost: StockAmounts) => STOCK_IDS.every((r) => stock[r] >= cost[r]);
  const queueFull = colony.builds.length >= ECONOMY.maxQueue;

  return (
    <>
      <dl className="facts">
        <dt>{t("colony.population")}</dt>
        <dd className="mono">
          {t("colony.populationValue", { n: fmtInt(population), cap: fmtInt(colony.populationCap) })}
          {colony.populationPerHour !== 0 && <span className="muted small">{t("colony.perHour", { n: fmtRate(colony.populationPerHour) })}</span>}
        </dd>
        <dt>{t("colony.energy")}</dt>
        <dd className="small">{t("colony.energyValue", { produced: fmtRate(colony.energy.produced).replace("+", ""), consumed: fmtRate(colony.energy.consumed).replace("+", "") })}</dd>
        <dt>{t("colony.upkeep")}</dt>
        <dd className="small">
          {t("colony.upkeepValue", { n: fmtRate(colony.upkeepPerHour).replace("+", "") })}
          {colony.capital && <span className="tag capital">{t("colony.capital")}</span>}
        </dd>
      </dl>
      {colony.shortage && (
        <p className="auth-warning" role="alert">
          {t("colony.shortage")}
        </p>
      )}
      {colony.capital && <p className="muted small">{t("colony.capitalHint")}</p>}

      <h3>{t("colony.stock")}</h3>
      <div className="deposits">
        {STOCK_IDS.map((r) => (
          <div key={r} className="deposit">
            <span className="deposit-name" style={{ color: STOCK_COLORS[r] }}>
              {t(`resource.${r}`)}
            </span>
            <span className="mono">
              {fmtInt(stock[r])} <span className="muted">/ {fmtInt(colony.storage[r])}</span>{" "}
              <span className={colony.ratesPerHour[r] < 0 ? "rate neg" : "rate"}>{t("colony.perHour", { n: fmtRate(colony.ratesPerHour[r]) })}</span>
            </span>
          </div>
        ))}
      </div>

      <h3>{t("colony.installations")}</h3>
      <ul className="emperor-list">
        {Object.entries(colony.installations).map(([id, n]) => (
          <li key={id}>
            <strong>{itemName("installation", id)}</strong>
            <span className="muted small mono">× {n}</span>
          </li>
        ))}
        {Object.keys(colony.installations).length === 0 && <li className="muted small">{t("colony.noInstallations")}</li>}
      </ul>

      <h3>{t("colony.queue")}</h3>
      <ul className="emperor-list build-queue">
        {colony.builds.map((b) => (
          <li key={b.id}>
            <strong>{itemName(b.kind, b.itemId)}</strong>
            <span className="muted small mono">{b.finishAt ? formatDuration(b.finishAt - now) : t("colony.waiting")}</span>
            <button
              className="link-btn small"
              disabled={busy}
              title={t(b.startedAt ? "colony.cancelStartedHint" : "colony.cancelQueuedHint")}
              onClick={() => onCancel(b.id)}
            >
              {t("colony.cancelBuild")}
            </button>
          </li>
        ))}
        {colony.builds.length === 0 && <li className="muted small">{t("colony.queueEmpty")}</li>}
      </ul>

      <h3>{t("colony.buildInstallations")}</h3>
      <ul className="build-list">
        {INSTALLATIONS.map((def) => {
          const full = (colony.installations[def.id] ?? 0) + queued(def.id) >= def.maxPerColony;
          return (
            <li key={def.id}>
              <button className="btn build-btn" disabled={busy || full || queueFull || !affordable(def.cost)} onClick={() => onBuild("installation", def.id)}>
                <span>{t(def.nameKey as I18nKey)}</span>
                <Cost cost={def.cost} stock={stock} />
                <span className="muted small mono">{t("colony.costHours", { h: def.buildTimeHours })}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {(colony.installations.shipyard ?? 0) > 0 && (
        <>
          <h3>{t("colony.buildShips")}</h3>
          <ul className="build-list">
            {SHIP_CLASSES.map((cls) => {
              const cost = { ...cls.cost, alloys: 0 };
              return (
                <li key={cls.id}>
                  <button className="btn build-btn" disabled={busy || queueFull || !affordable(cost)} onClick={() => onBuild("ship", cls.id)}>
                    <span>{contentText(locale, cls.nameKey)}</span>
                    <Cost cost={cost} stock={stock} />
                    <span className="muted small mono">{t("colony.costHours", { h: cls.buildTimeHours })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
