import { useState } from "react";
import type { StarClass } from "@imperium/shared";
import { useT } from "../state/store";
import { starColorCss } from "./common";

const ORDER: StarClass[] = ["O", "B", "A", "F", "G", "K", "M", "RG", "WD", "NS", "BH"];

/** Plegada o no (se recuerda en este navegador). */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem("aeon.legendCollapsed") === "1";
  } catch {
    return false;
  }
}

export function Legend() {
  const t = useT();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem("aeon.legendCollapsed", collapsed ? "0" : "1");
    } catch {
      // Sin almacenamiento: solo dura esta sesión.
    }
  };
  return (
    <div className={collapsed ? "legend panel hide-sm collapsed" : "legend panel hide-sm"}>
      <button type="button" className="legend-title" aria-expanded={!collapsed} onClick={toggle}>
        {t("legend.title")} <span className="legend-chevron">▾</span>
      </button>
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
