import type { StarClass } from "@imperium/shared";
import { useT } from "../state/store";
import { starColorCss } from "./common";

const ORDER: StarClass[] = ["O", "B", "A", "F", "G", "K", "M", "RG", "WD", "NS", "BH"];

export function Legend() {
  const t = useT();
  return (
    <div className="legend panel hide-sm">
      <div className="legend-title">{t("legend.title")}</div>
      <ul>
        {ORDER.map((c) => (
          <li key={c}>
            <span className="dot" style={{ background: starColorCss(c) }} />
            {t(`star.${c}`)}
          </li>
        ))}
        {/* Fase 11: halos del color de cada especie alrededor de su territorio descubierto. */}
        <li>
          <span className="territory-swatch" />
          {t("legend.territory")}
        </li>
      </ul>
    </div>
  );
}
