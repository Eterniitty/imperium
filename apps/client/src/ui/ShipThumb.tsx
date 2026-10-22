import { useEffect, useState } from "react";
import type { ShipDesignSnapshot } from "@imperium/shared";
import { designThumbnail, shipThumbnail } from "../engine/shipThumbnails";

/**
 * Miniatura de una clase de nave (el mismo modelo procedural del motor 3D). Se
 * dibuja después del primer pintado para no frenar la interfaz; sin WebGL, nada.
 */
export function ShipThumb({ classId, size = 48, design }: { classId: string; size?: number; design?: Pick<ShipDesignSnapshot, "hullId" | "parts"> }) {
  const [url, setUrl] = useState<string | null>(null);
  const designKey = design ? `${design.hullId}|${JSON.stringify(design.parts)}` : "";
  useEffect(() => {
    let alive = true;
    const id = requestAnimationFrame(() => {
      if (alive) setUrl(design ? designThumbnail(design) : shipThumbnail(classId));
    });
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, [classId, designKey]);
  return <span className="ship-thumb" style={{ width: size, height: size * 0.6 }}>{url && <img src={url} alt="" draggable={false} />}</span>;
}
