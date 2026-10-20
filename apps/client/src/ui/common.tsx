import type { Planet, ResourceDeposits, ResourceId } from "@imperium/shared";
import { STAR_CLASSES } from "@imperium/procgen";
import type { StarClass } from "@imperium/shared";
import { useT } from "../state/store";

export const RESOURCE_ORDER: ResourceId[] = ["metal", "volatiles", "crystal"];

export const RESOURCE_COLORS: Record<ResourceId | "energy", string> = {
  metal: "#b9c3cf",
  volatiles: "#5fd3c6",
  crystal: "#c792ff",
  energy: "#ffc857",
};

export function starColorCss(c: StarClass): string {
  return `#${STAR_CLASSES[c].color.toString(16).padStart(6, "0")}`;
}

/** Riqueza 0–3 como tres barras. */
export function Richness({ value, color }: { value: number; color: string }) {
  return (
    <span className="richness" aria-label={`${value}/3`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className="pip" style={{ background: i <= value ? color : undefined }} />
      ))}
    </span>
  );
}

export function Deposits({ deposits }: { deposits: ResourceDeposits }) {
  const t = useT();
  return (
    <div className="deposits">
      {RESOURCE_ORDER.map((r) => (
        <div key={r} className={deposits[r] === 0 ? "deposit empty" : "deposit"}>
          <span className="deposit-name">{t(`resource.${r}`)}</span>
          <Richness value={deposits[r]} color={RESOURCE_COLORS[r]} />
        </div>
      ))}
    </div>
  );
}

/** Resumen compacto: los recursos presentes en un planeta, como iniciales de color. */
export function DepositChips({ planet }: { planet: Planet }) {
  const t = useT();
  return (
    <span className="chips">
      {RESOURCE_ORDER.filter((r) => planet.deposits[r] > 0).map((r) => (
        <span key={r} className="chip" style={{ color: RESOURCE_COLORS[r], borderColor: RESOURCE_COLORS[r] }} title={t(`resource.${r}`)}>
          {t(`resource.${r}`).charAt(0)}
          {planet.deposits[r]}
        </span>
      ))}
    </span>
  );
}

export function Meter({ value, color }: { value: number; color: string }) {
  return (
    <span className="meter">
      <span className="meter-fill" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
    </span>
  );
}
