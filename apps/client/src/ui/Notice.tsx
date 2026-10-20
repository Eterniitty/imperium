import { useGame, useT } from "../state/store";

/** Aviso breve centrado arriba (sale de un sistema, error de un salto…). */
export function Notice() {
  const t = useT();
  const notice = useGame((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="notice panel" role="status" key={notice.id}>
      {t(notice.key, notice.params)}
    </div>
  );
}
