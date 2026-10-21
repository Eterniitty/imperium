import { useEffect, useState } from "react";
import { shipThumbnail } from "../engine/shipThumbnails";

/**
 * Miniatura de una clase de nave (el mismo modelo procedural del motor 3D). Se
 * dibuja después del primer pintado para no frenar la interfaz; sin WebGL, nada.
 */
export function ShipThumb({ classId, size = 48 }: { classId: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const id = requestAnimationFrame(() => {
      if (alive) setUrl(shipThumbnail(classId));
    });
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, [classId]);
  return <span className="ship-thumb" style={{ width: size, height: size * 0.6 }}>{url && <img src={url} alt="" draggable={false} />}</span>;
}
