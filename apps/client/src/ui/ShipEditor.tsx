import { useEffect, useMemo, useState } from "react";
import { fitsSlot, getHull, hullAtLeast, HULLS, PARTS, type HullSlot, type PartCost } from "@imperium/content";
import { SHIP_DESIGNS_MAX, type Colony, type I18nKey, type ShipDesignRecord, type ShipDesignsResponse } from "@imperium/shared";
import { designStats, validateDesign, type DesignProblem } from "@imperium/sim";
import { connection, useWorld } from "../net/world";
import { api } from "../state/auth";
import { gameStore, useGame, useT } from "../state/store";
import { fmtInt } from "./colonies";

interface Draft {
  id?: string;
  name: string;
  hullId: string;
  parts: Record<string, string>;
}

const blank = (): Draft => ({ name: "", hullId: HULLS[0]!.id, parts: {} });

/** «drive2» → «Motor 2»: el nombre del anclaje con su número. */
function slotLabel(t: ReturnType<typeof useT>, id: string): string {
  const m = /^([a-z]+)(\d*)$/.exec(id);
  const base = m?.[1] ?? id;
  const key = `slot.${base}` as I18nKey;
  return `${t(key)}${m?.[2] ? ` ${m[2]}` : ""}`;
}

/** Piezas que encajan en un anclaje de un casco (tipo, tamaño y clase mínima). */
function partsFor(slot: HullSlot, hullClass: Parameters<typeof hullAtLeast>[0]) {
  return PARTS.filter((p) => slot.kinds.includes(p.kind) && fitsSlot(p.size, slot.size) && (!p.minHull || hullAtLeast(hullClass, p.minHull)));
}

const COST_KEYS: Array<keyof PartCost> = ["credits", "metal", "crystal", "alloys", "rare_metals", "exotic"];

/**
 * Astillero (editor de naves, fase E3, `docs/editor-naves.md`): eliges un
 * casco y encajas una pieza en cada anclaje, como un Lego; las estadísticas,
 * los problemas («sin reactor no funciona») y el coste salen en vivo de las
 * mismas reglas que usa el servidor (`@imperium/sim` shipDesign.ts). Los
 * diseños se guardan en el servidor (`/api/designs`).
 */
export function ShipEditor() {
  const t = useT();
  const open = useGame((s) => s.shipEditorOpen);
  const [designs, setDesigns] = useState<ShipDesignRecord[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [message, setMessage] = useState<{ ok: boolean; key: I18nKey } | null>(null);
  const [busy, setBusy] = useState(false);
  const colonies = useWorld((s) => s.colonies);
  const [colonyId, setColonyId] = useState<string>("");
  const close = () => gameStore.getState().setShipEditorOpen(false);

  useEffect(() => {
    if (!open) return;
    void api<ShipDesignsResponse>("GET", "/api/designs").then((r) => {
      if (r.ok) setDesigns(r.data.designs);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  const hull = getHull(draft.hullId) ?? HULLS[0]!;
  const stats = useMemo(() => designStats(draft), [draft]);
  const problems = useMemo(() => validateDesign(draft), [draft]);
  const buildable = problems.every((p) => p.level !== "error");
  const num = (n: number) => fmtInt(n);

  if (!open) return null;

  const partName = (id: string) => {
    const p = PARTS.find((x) => x.id === id);
    return p ? t(p.nameKey as I18nKey) : id;
  };
  const problemText = (p: DesignProblem): string => {
    const params: Record<string, string | number> = {};
    if ("slot" in p) params.slot = slotLabel(t, p.slot);
    if ("part" in p) params.part = partName(p.part);
    if ("min" in p) params.min = p.min;
    if ("use" in p) {
      params.use = p.use;
      params.gen = p.gen;
    }
    return t(`shipEditor.problem.${p.code}` as I18nKey, params);
  };

  const setHull = (hullId: string) => {
    const next = getHull(hullId);
    if (!next) return;
    // Se conservan las piezas que siguen encajando en un anclaje del mismo nombre.
    const parts: Record<string, string> = {};
    for (const [slotId, partId] of Object.entries(draft.parts)) {
      const s = next.slots.find((x) => x.id === slotId);
      if (s && partsFor(s, next.class).some((p) => p.id === partId)) parts[slotId] = partId;
    }
    setDraft({ ...draft, hullId, parts });
  };
  const setPart = (slotId: string, partId: string) => {
    const parts = { ...draft.parts };
    if (partId) parts[slotId] = partId;
    else delete parts[slotId];
    setDraft({ ...draft, parts });
  };

  const save = async () => {
    setBusy(true);
    const name = draft.name.trim() || t(hull.nameKey as I18nKey);
    const r = await api<ShipDesignsResponse>("POST", "/api/designs/save", { ...(draft.id ? { id: draft.id } : {}), name, hullId: draft.hullId, parts: draft.parts });
    setBusy(false);
    if (!r.ok) return setMessage({ ok: false, key: r.error as I18nKey });
    setDesigns(r.data.designs);
    if (r.data.saved) setDraft({ id: r.data.saved.id, name: r.data.saved.name, hullId: r.data.saved.hullId, parts: { ...r.data.saved.parts } });
    setMessage({ ok: true, key: "shipEditor.saved" });
  };
  const remove = async () => {
    if (!draft.id) return setDraft(blank());
    setBusy(true);
    const r = await api<ShipDesignsResponse>("POST", "/api/designs/delete", { id: draft.id });
    setBusy(false);
    if (!r.ok) return setMessage({ ok: false, key: r.error as I18nKey });
    setDesigns(r.data.designs);
    setDraft(blank());
    setMessage(null);
  };

  // Construir: solo un diseño guardado y sin cambios, en una colonia con astillero (y dique para los cascos grandes).
  const saved = designs.find((d) => d.id === draft.id);
  const unchanged = !!saved && saved.name === draft.name && saved.hullId === draft.hullId && JSON.stringify(saved.parts) === JSON.stringify(draft.parts);
  const yards = (Object.values(colonies) as Colony[]).filter((c) => (c.installations.shipyard ?? 0) > 0 && (hull.builtAt !== "drydock" || (c.installations.drydock ?? 0) > 0));
  const yard = yards.find((c) => c.id === colonyId) ?? yards[0];
  const build = async () => {
    if (!yard || !draft.id) return;
    setBusy(true);
    const error = await connection.command("colony.build", { colonyId: yard.id, kind: "design", itemId: draft.id });
    setBusy(false);
    setMessage(error ? { ok: false, key: error } : { ok: true, key: "shipEditor.ordered" });
  };

  const cost = stats.cost;
  const statRows: Array<[I18nKey, string]> = [
    ["shipEditor.stat.mass", `${num(stats.massT)} t`],
    ["shipEditor.stat.power", `${num(stats.powerUseMW)} / ${num(stats.powerGenMW)} MW`],
    ["shipEditor.stat.accel", `${stats.accel} m/s²`],
    ["shipEditor.stat.cruise", `${num(stats.cruiseMs)} m/s`],
    ["shipEditor.stat.pulse", `${Math.round(stats.pulseFactor * 100)} %`],
    ["shipEditor.stat.turn", `${stats.turnDegPerSec} °/s`],
    [
      "shipEditor.stat.jump",
      stats.riftLyPerHour === null ? t("shipEditor.stat.noJump") : `${num(stats.jumpRangeLy ?? 0)} a.l. · ${num(stats.riftLyPerHour)} a.l./h · ${stats.chargeSec} s`,
    ],
    ["shipEditor.stat.hull", num(stats.hull)],
    ["shipEditor.stat.shield", stats.shield ? `${num(stats.shield)} (+${stats.shieldRegen}/s)` : "—"],
    ["shipEditor.stat.dps", num(stats.dps)],
    ["shipEditor.stat.cargo", num(stats.cargo)],
    ["shipEditor.stat.humans", num(stats.humans)],
    ["shipEditor.stat.fighters", num(stats.fighters)],
    ["shipEditor.stat.scan", stats.scanLy ? `${stats.scanLy} a.l.` : "—"],
  ];

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="settings economy ship-editor panel" role="dialog" aria-labelledby="ship-editor-title" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2 id="ship-editor-title">{t("shipEditor.title")}</h2>
          <button className="icon-btn" aria-label={t("settings.close")} onClick={close}>
            ×
          </button>
        </div>
        <div className="ship-editor-body">
          <aside className="ship-editor-list">
            <h3>{t("shipEditor.designs")}</h3>
            <p className="muted small">{t("shipEditor.limit", { n: designs.length, max: SHIP_DESIGNS_MAX })}</p>
            <button className="btn btn-primary" onClick={() => (setDraft(blank()), setMessage(null))}>
              {t("shipEditor.new")}
            </button>
            {designs.length === 0 && <p className="muted small">{t("shipEditor.none")}</p>}
            <ul>
              {designs.map((d) => (
                <li key={d.id}>
                  <button
                    className={d.id === draft.id ? "link-btn active" : "link-btn"}
                    onClick={() => (setDraft({ id: d.id, name: d.name, hullId: d.hullId, parts: { ...d.parts } }), setMessage(null))}
                  >
                    {d.name}
                  </button>
                  <span className="muted small"> · {t((getHull(d.hullId)?.nameKey ?? "shipEditor.hull") as I18nKey)}</span>
                </li>
              ))}
            </ul>
          </aside>

          <section className="ship-editor-main">
            <div className="ship-editor-row">
              <label>
                {t("shipEditor.name")}
                <input className="auth-input" maxLength={40} value={draft.name} placeholder={t(hull.nameKey as I18nKey)} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label>
                {t("shipEditor.hull")}
                <select className="auth-input" value={draft.hullId} onChange={(e) => setHull(e.target.value)}>
                  {HULLS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {t(h.nameKey as I18nKey)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <h3>{t("shipEditor.slots")}</h3>
            <table className="ship-editor-slots">
              <tbody>
                {hull.slots.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">
                      {slotLabel(t, s.id)}
                      <div className="muted small">
                        {t("shipEditor.size", { size: s.size })} · {s.kinds.map((k) => t(`partKind.${k}` as I18nKey)).join(", ")}
                      </div>
                    </th>
                    <td>
                      <select className="auth-input" value={draft.parts[s.id] ?? ""} onChange={(e) => setPart(s.id, e.target.value)}>
                        <option value="">{t("shipEditor.empty")}</option>
                        {partsFor(s, hull.class).map((p) => (
                          <option key={p.id} value={p.id}>
                            {t(p.nameKey as I18nKey)} · {p.size} · {p.massT} t{p.drawMW ? ` · ${p.drawMW} MW` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions">
              <button className="btn" disabled={busy} onClick={() => setDraft({ ...draft, id: undefined, name: t("shipEditor.copyOf", { name: draft.name || t(hull.nameKey as I18nKey) }) })}>
                {t("shipEditor.duplicate")}
              </button>
              <button className="btn" disabled={busy} onClick={() => void remove()}>
                {t("shipEditor.delete")}
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
                {t("shipEditor.save")}
              </button>
            </div>
            {message && <p className={message.ok ? "small ship-ok" : "small ship-bad"}>{t(message.key)}</p>}
            <h3>{t("shipEditor.build")}</h3>
            {yards.length === 0 ? (
              <p className="muted small">{t(hull.builtAt === "drydock" ? "shipEditor.noDrydock" : "shipEditor.noShipyard")}</p>
            ) : (
              <div className="ship-editor-row">
                <select className="auth-input" value={yard?.id ?? ""} onChange={(e) => setColonyId(e.target.value)}>
                  {yards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.name ?? c.planetName) + " · " + c.systemName}
                    </option>
                  ))}
                </select>
                <button className="btn btn-primary" disabled={busy || !buildable || !unchanged} title={unchanged ? "" : t("shipEditor.saveFirst")} onClick={() => void build()}>
                  {t("shipEditor.buildHere", { hours: hull.buildTimeHours })}
                </button>
              </div>
            )}
            {!unchanged && <p className="muted small">{t("shipEditor.saveFirst")}</p>}
          </section>

          <aside className="ship-editor-stats">
            <h3>{t("shipEditor.stats")}</h3>
            <dl>
              {statRows.map(([k, v]) => (
                <div key={k}>
                  <dt>{t(k)}</dt>
                  <dd className="mono">{v}</dd>
                </div>
              ))}
            </dl>
            <h3>{t("shipEditor.problems")}</h3>
            <p className={buildable ? "ship-ok small" : "ship-bad small"}>{t(buildable ? "shipEditor.buildable" : "shipEditor.notBuildable")}</p>
            {problems.length === 0 ? (
              <p className="muted small">{t("shipEditor.ok")}</p>
            ) : (
              <ul className="ship-problems">
                {problems.map((p, i) => (
                  <li key={i} className={p.level}>
                    {problemText(p)}
                  </li>
                ))}
              </ul>
            )}
            <h3>{t("shipEditor.cost")}</h3>
            <p className="mono small">
              {COST_KEYS.filter((k) => cost[k] > 0)
                .map((k) => (k === "credits" ? `₢ ${num(cost[k])}` : `${t(`resource.${k}` as I18nKey)} ${num(cost[k])}`))
                .join(" · ")}
            </p>
            {Object.keys(stats.components).length > 0 && (
              <p className="small">
                {t("shipEditor.components")}:{" "}
                {(Object.entries(stats.components) as Array<[string, number]>).map(([c, n], i) => (
                  <span key={c} className={yard && (yard.items[c] ?? 0) >= n ? "ship-ok" : "ship-bad"}>
                    {i > 0 ? " · " : ""}
                    {n} {t(`component.${c}` as I18nKey)}
                  </span>
                ))}
              </p>
            )}
            <p className="muted small">{t("shipEditor.builtAt", { where: t(`installation.${hull.builtAt}` as I18nKey) })}</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
