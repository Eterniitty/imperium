import { useEffect, useState } from "react";
import {
  GUNSHIP,
  SHIP_EMBLEMS,
  SHIP_MARK_NAME_MAX,
  SHIP_MARK_NUMBER_MAX,
  SHIP_PATTERNS,
  SHIP_PROPORTIONS,
  SHIP_TEMPLATES,
  normalizeShipCustomization,
  type ShipCustomization,
  type ShipExtra,
} from "@imperium/content";
import type { I18nKey } from "@imperium/shared";
import { useT } from "../state/store";
import { menuSound } from "./MainMenu";

type Tab = "paint" | "parts" | "shape" | "marks";

const ROOM_COLORS: Record<string, string> = { cockpit: "#4fa8ff", corridor: "#b4bac2", quarters: "#c792ff", galley: "#7fd88a", cargo: "#e3b24e", engineering: "#ff7a4a", airlock: "#6fe0d0" };

/**
 * Editor de la nave en el hangar (petición del 24-10-2026): se personaliza una
 * nave ya hecha —pintura, piezas por zona, proporciones y marcas en el casco—
 * con vista previa en vivo. `draft` es lo que se ve; «Guardar» lo confirma.
 */
export function ShipCustomizer({
  draft,
  interior,
  onChange,
  onInterior,
  onSave,
  onCancel,
}: {
  draft: ShipCustomization;
  interior: boolean;
  onChange(next: ShipCustomization): void;
  onInterior(on: boolean): void;
  onSave(): void;
  onCancel(): void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("paint");
  const tpl = SHIP_TEMPLATES[draft.template] ?? GUNSHIP;
  const update = (patch: (c: ShipCustomization) => ShipCustomization) => onChange(normalizeShipCustomization(patch(structuredClone(draft))));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") (e.stopPropagation(), onCancel());
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel]);

  const choice = <T extends string>(value: T, options: readonly T[], prefix: string, set: (v: T) => void) => (
    <div className="custom-choices" role="radiogroup">
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={o === value} className={o === value ? "custom-choice active" : "custom-choice"} onClick={() => (menuSound("select"), set(o))} onMouseEnter={() => menuSound("hover")}>
          {t(`${prefix}.${o}` as I18nKey)}
        </button>
      ))}
    </div>
  );

  return (
    <aside className="customizer panel" aria-labelledby="customizer-title">
      <header className="customizer-head">
        <h2 id="customizer-title">{t("custom.title")}</h2>
        <p className="muted small">{t("custom.shipInfo", { length: tpl.lengthM, crew: tpl.crew, beds: tpl.beds })}</p>
      </header>
      <nav className="customizer-tabs" role="tablist">
        {(["paint", "parts", "shape", "marks"] as const).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "customizer-tab active" : "customizer-tab"} onClick={() => (menuSound("hover"), setTab(id))}>
            {t(`custom.tab.${id}` as I18nKey)}
          </button>
        ))}
      </nav>

      <div className="customizer-body">
        {tab === "paint" && (
          <>
            {(["primary", "secondary", "accent", "lights"] as const).map((k) => (
              <label key={k} className="custom-row">
                <span>{t(`custom.color.${k}` as I18nKey)}</span>
                <input type="color" value={draft.colors[k]} onChange={(e) => update((c) => ((c.colors[k] = e.target.value), c))} />
              </label>
            ))}
            <h3>{t("custom.pattern")}</h3>
            {choice(draft.pattern, SHIP_PATTERNS, "custom.pattern", (v) => update((c) => ((c.pattern = v), c)))}
          </>
        )}

        {tab === "parts" && (
          <>
            <h3>{t("custom.zone.nose")}</h3>
            {choice(draft.parts.nose, tpl.noses, "custom.nose", (v) => update((c) => ((c.parts.nose = v), c)))}
            <h3>{t("custom.zone.wings")}</h3>
            {choice(draft.parts.wings, tpl.wings, "custom.wings", (v) => update((c) => ((c.parts.wings = v), c)))}
            <h3>{t("custom.zone.engines")}</h3>
            {choice(draft.parts.engines, tpl.engines, "custom.engines", (v) => update((c) => ((c.parts.engines = v), c)))}
            <h3>{t("custom.zone.extras")}</h3>
            <div className="custom-choices">
              {tpl.extras.map((x: ShipExtra) => {
                const on = draft.parts.extras.includes(x);
                return (
                  <button
                    key={x}
                    aria-pressed={on}
                    className={on ? "custom-choice active" : "custom-choice"}
                    onMouseEnter={() => menuSound("hover")}
                    onClick={() => (menuSound("select"), update((c) => ((c.parts.extras = on ? c.parts.extras.filter((e) => e !== x) : [...c.parts.extras, x]), c)))}
                  >
                    {t(`custom.extra.${x}` as I18nKey)}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {tab === "shape" && (
          <>
            {(["nose", "wingSpan", "engineSize"] as const).map((k) => {
              const [lo, hi] = SHIP_PROPORTIONS[k];
              return (
                <label key={k} className="custom-row custom-slider">
                  <span>
                    {t(`custom.prop.${k}` as I18nKey)} <b>{Math.round(draft.proportions[k] * 100)} %</b>
                  </span>
                  <input type="range" min={lo} max={hi} step={0.01} value={draft.proportions[k]} onChange={(e) => update((c) => ((c.proportions[k] = Number(e.target.value)), c))} />
                </label>
              );
            })}
            <p className="muted small">{t("custom.shapeHint")}</p>
          </>
        )}

        {tab === "marks" && (
          <>
            <label className="custom-row">
              <span>{t("custom.mark.number")}</span>
              <input className="auth-input" maxLength={SHIP_MARK_NUMBER_MAX} value={draft.marks.number} onChange={(e) => update((c) => ((c.marks.number = e.target.value), c))} />
            </label>
            <label className="custom-row">
              <span>{t("custom.mark.name")}</span>
              <input className="auth-input" maxLength={SHIP_MARK_NAME_MAX} value={draft.marks.name} placeholder={t("custom.mark.namePlaceholder")} onChange={(e) => update((c) => ((c.marks.name = e.target.value), c))} />
            </label>
            <h3>{t("custom.mark.emblem")}</h3>
            {choice(draft.marks.emblem, SHIP_EMBLEMS, "custom.emblem", (v) => update((c) => ((c.marks.emblem = v), c)))}
          </>
        )}
      </div>

      <label className="custom-row custom-interior">
        <input type="checkbox" checked={interior} onChange={(e) => onInterior(e.target.checked)} />
        <span>{t("custom.interior")}</span>
      </label>
      {interior && (
        <ul className="custom-rooms">
          {tpl.rooms.map((r) => (
            <li key={r.id}>
              <i style={{ background: ROOM_COLORS[r.kind] }} />
              {t(`custom.room.${r.kind}` as I18nKey)} · {r.size[0]} × {r.size[2]} m
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{t("custom.cameraHint")}</p>

      <footer className="customizer-actions">
        <button className="btn btn-primary" onClick={() => (menuSound("select"), onSave())}>
          {t("custom.save")}
        </button>
        <button className="btn" onClick={() => (menuSound("select"), onCancel())}>
          {t("custom.cancel")}
        </button>
        <button className="link-btn" onClick={() => onChange(normalizeShipCustomization(tpl.defaults))}>
          {t("custom.defaults")}
        </button>
      </footer>
    </aside>
  );
}
