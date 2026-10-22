import { useEffect, useState, type FormEvent } from "react";
import { COMPONENT_IDS, ECONOMY, getRecipe, HUMANS, INSTALLATIONS, RECIPES, SHIP_CLASSES, STOCK_IDS, type StockAmounts, type StockId } from "@imperium/content";

const ZERO_STOCK: StockAmounts = { metal: 0, volatiles: 0, crystal: 0, alloys: 0, rare_metals: 0, exotic: 0 };
import { PLANET_NAME_MAX, PLANET_NAME_MIN, type Colony, type Fleet, type I18nKey, type Planet, type StarSystemDetail } from "@imperium/shared";
import { minColonists, missingInstallations } from "@imperium/sim";
import { connection, useWorld } from "../net/world";
import { useAuth } from "../state/auth";
import { useClaims } from "../state/claims";
import { useGame, useT } from "../state/store";
import { fmtInt, fmtRate, liveHumans, livePopulation, liveStock, ownColonyAt, planetLabel } from "./colonies";
import { STOCK_COLORS } from "./common";
import { contentText } from "./fleets";
import { ShipThumb } from "./ShipThumb";
import { formatDuration, useServerNow } from "./useNow";
import { factionName } from "./aliens";
import { PlanetSiege } from "./SiegePanel";

/** Abreviatura de los recursos cuya inicial coincide con otro (metal / metales raros). */
const SHORT: Partial<Record<StockId, string>> = { rare_metals: "R", exotic: "X" };

/** Coste compacto: «M150 V20». */
function Cost({ cost, stock }: { cost: StockAmounts; stock: StockAmounts | null }) {
  const t = useT();
  return (
    <span className="cost mono small">
      {STOCK_IDS.filter((r) => cost[r] > 0).map((r) => (
        <span key={r} style={{ color: STOCK_COLORS[r], opacity: stock && stock[r] < cost[r] ? 0.45 : 1 }} title={t(`resource.${r}`)}>
          {SHORT[r] ?? t(`resource.${r}`).charAt(0)}
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
  const flagship = useWorld((s) => s.flagship);
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
          {emperorHere && flagship && <UnloadHold hold={flagship.hold} busy={busy} onUnload={() => void run(connection.command("flagship.unload", { colonyId: own.id }))} />}
          {emperorHere && <Disembark colony={own} aboard={aboard} now={now} busy={busy} onLand={(n) => void run(connection.command("colony.disembark", { colonyId: own.id, humans: n }))} />}
          {emperorHere && <Embark colony={own} aboard={liveHumans(humans, now)} now={now} busy={busy} onBoard={(n) => void run(connection.command("colony.embark", { colonyId: own.id, humans: n }))} />}
          <ColonyDetail
            colony={own}
            now={now}
            busy={busy}
            locale={locale}
            onBuild={(kind, itemId) => void run(connection.command("colony.build", { colonyId: own.id, kind, itemId }))}
            onCancel={(buildId) => void run(connection.command("colony.cancel", { colonyId: own.id, buildId }))}
            onDemolish={(installationId) => void run(connection.command("colony.demolish", { colonyId: own.id, installationId }))}
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

/** Descargar la bodega de la nave del Emperador (lo minado en el espacio profundo) en la colonia. */
function UnloadHold({ hold, busy, onUnload }: { hold: Partial<Record<StockId, number>>; busy: boolean; onUnload: () => void }) {
  const t = useT();
  const items = STOCK_IDS.filter((r) => (hold[r] ?? 0) >= 0.1);
  if (items.length === 0) return null;
  return (
    <div className="claim-form">
      <span className="muted small">
        {t("hold.label")}:{" "}
        {items.map((r, i) => (
          <span key={r}>
            {i > 0 && " · "}
            <span style={{ color: STOCK_COLORS[r] }}>{t(`resource.${r}`)}</span> {fmtInt(hold[r] ?? 0)}
          </span>
        ))}
      </span>
      <button className="btn" type="button" disabled={busy} onClick={onUnload}>
        {t("hold.unload")}
      </button>
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

/**
 * Embarcar humanos de la colonia en la nave del Emperador (presente en el
 * sistema): hasta llenar la nave y dejando siempre `HUMANS.colonyKeep` en la colonia.
 */
function Embark({ colony, aboard, now, busy, onBoard }: { colony: Colony; aboard: number; now: number; busy: boolean; onBoard: (n: number) => void }) {
  const t = useT();
  const spare = Math.max(0, Math.floor(livePopulation(colony, now) - HUMANS.colonyKeep));
  const room = Math.max(0, Math.floor(HUMANS.flagshipCapacity - aboard));
  const max = Math.min(spare, room);
  const [n, setN] = useState("");
  if (max < 1) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = Math.min(max, Math.max(1, Number.parseInt(n, 10) || max));
    onBoard(v);
    setN("");
  };
  return (
    <form className="claim-form" onSubmit={submit}>
      <label>
        <span className="muted small">{t("colony.embarkLabel", { max, keep: HUMANS.colonyKeep })}</span>
        <input type="number" min={1} max={max} placeholder={String(max)} value={n} onChange={(e) => setN(e.target.value.replace(/[^0-9]/g, ""))} />
      </label>
      <button className="btn" type="submit" disabled={busy}>
        {t("colony.embark")}
      </button>
    </form>
  );
}

export function ColonyDetail({
  colony,
  now,
  busy,
  locale,
  onBuild,
  onCancel,
  onDemolish,
}: {
  colony: Colony;
  now: number;
  busy: boolean;
  locale: Parameters<typeof contentText>[0];
  onBuild: (kind: "installation" | "ship" | "craft", itemId: string) => void;
  onCancel: (buildId: string) => void;
  onDemolish: (installationId: string) => void;
}) {
  const t = useT();
  // Derribar pide confirmación: el primer clic arma el botón y el segundo derriba.
  const [demolishing, setDemolishing] = useState<string | null>(null);
  const stock = liveStock(colony, now);
  const population = livePopulation(colony, now);
  const queued = (id: string) => colony.builds.filter((b) => b.kind === "installation" && b.itemId === id).length;
  const itemName = (kind: string, id: string) =>
    kind === "installation"
      ? t(`installation.${id}` as I18nKey)
      : kind === "craft"
        ? t("craft.batch", { n: getRecipe(id)?.output ?? 1, name: t(`component.${id}` as I18nKey) })
        : contentText(locale, `ship.${id}.name`);
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
          {(colony.installations.refinery ?? 0) > 0 && <> {t("colony.shortageRefinery")}</>}
          <br />
          <span className="small">{t("colony.shortageHint")}</span>
        </p>
      )}
      {colony.capital && <p className="muted small">{t("colony.capitalHint")}</p>}
      {colony.isolated && (
        <p className="auth-warning small" role="status">
          {t("colony.isolated", { pct: Math.round(ECONOMY.isolatedExtraction * 100), ly: ECONOMY.supplyRangeLy })}
        </p>
      )}

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
            <button
              className="link-btn small"
              disabled={busy}
              title={t("colony.demolishHint", { pct: Math.round(ECONOMY.demolishRefund * 100) })}
              onClick={() => {
                if (demolishing !== id) return setDemolishing(id);
                setDemolishing(null);
                onDemolish(id);
              }}
            >
              {t(demolishing === id ? "colony.demolishConfirm" : "colony.demolish")}
            </button>
          </li>
        ))}
        {Object.keys(colony.installations).length === 0 && <li className="muted small">{t("colony.noInstallations")}</li>}
      </ul>

      <h3>{t("colony.queue")}</h3>
      <ul className="emperor-list build-queue">
        {colony.builds.map((b) => (
          <li key={b.id}>
            <strong>{b.design ? b.design.name : itemName(b.kind, b.itemId)}</strong>
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
          const missing = missingInstallations(def.requires, colony.installations);
          return (
            <li key={def.id}>
              <button
                className="btn build-btn"
                disabled={busy || full || queueFull || missing.length > 0 || !affordable(def.cost)}
                onClick={() => onBuild("installation", def.id)}
              >
                <span className="ship-name">
                  {t(def.nameKey as I18nKey)}
                  {missing.length > 0 && !full && <span className="needs">{t("colony.needs", { list: missing.map((m) => t(`installation.${m}` as I18nKey)).join(", ") })}</span>}
                </span>
                <Cost cost={def.cost} stock={stock} />
                <span className="muted small mono">{t("colony.costHours", { h: def.buildTimeHours })}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Fabricación: inventario de componentes y recetas de la Fábrica. */}
      <h3>{t("craft.items")}</h3>
      <div className="deposits">
        {COMPONENT_IDS.filter((c) => (colony.items[c] ?? 0) > 0).map((c) => (
          <div key={c} className="deposit">
            <span className="deposit-name">{t(`component.${c}`)}</span>
            <span className="mono">{fmtInt(colony.items[c] ?? 0)}</span>
          </div>
        ))}
        {COMPONENT_IDS.every((c) => !(colony.items[c] ?? 0)) && <span className="muted small">{t("craft.noItems")}</span>}
      </div>
      {(colony.installations.factory ?? 0) > 0 ? (
        <>
          <h3>{t("craft.title")}</h3>
          <ul className="build-list">
            {RECIPES.map((r) => {
              const cost = { ...ZERO_STOCK, ...r.inputs };
              const missing = missingInstallations(r.requires, colony.installations);
              const parts = Object.entries(r.components ?? {}) as Array<[string, number]>;
              const enough = parts.every(([c, n]) => (colony.items[c] ?? 0) >= n);
              return (
                <li key={r.id}>
                  <button className="btn build-btn" disabled={busy || queueFull || missing.length > 0 || !affordable(cost) || !enough} onClick={() => onBuild("craft", r.id)}>
                    <span className="ship-name">
                      {t("craft.batch", { n: r.output, name: t(`component.${r.id}`) })}
                      {missing.length > 0 && <span className="needs">{t("colony.needs", { list: missing.map((m) => t(`installation.${m}` as I18nKey)).join(", ") })}</span>}
                      {parts.length > 0 && (
                        <span className={enough ? "needs muted" : "needs"}>{t("craft.needs", { list: parts.map(([c, n]) => `${n} ${t(`component.${c}` as I18nKey)}`).join(", ") })}</span>
                      )}
                    </span>
                    <Cost cost={cost} stock={stock} />
                    <span className="muted small mono">{t("colony.costHours", { h: r.hours })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="muted small">{t("craft.needFactory")}</p>
      )}

      {(colony.installations.shipyard ?? 0) > 0 && (
        <>
          <h3>{t("colony.buildShips")}</h3>
          <ul className="build-list">
            {SHIP_CLASSES.map((cls) => {
              const cost = { rare_metals: 0, exotic: 0, ...cls.cost };
              const missing = missingInstallations(cls.requires, colony.installations);
              return (
                <li key={cls.id}>
                  <button
                    className="btn build-btn"
                    disabled={busy || queueFull || missing.length > 0 || !affordable(cost)}
                    title={contentText(locale, cls.descriptionKey)}
                    onClick={() => onBuild("ship", cls.id)}
                  >
                    <ShipThumb classId={cls.id} />
                    <span className="ship-name">
                      {contentText(locale, cls.nameKey)}
                      {missing.length > 0 && <span className="needs">{t("colony.needs", { list: missing.map((m) => t(`installation.${m}` as I18nKey)).join(", ") })}</span>}
                    </span>
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
