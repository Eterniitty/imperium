import { useEffect, useState } from "react";
import type { CrisisStatus, I18nKey } from "@imperium/shared";
import { api } from "../state/auth";
import { useT } from "../state/store";
import { formatDuration, useServerNow } from "./useNow";

/** Cada cuánto se pregunta por la crisis galáctica activa. */
const POLL_MS = 60_000;

/** Crisis galáctica activa en la barra superior: nombre, lo que falta y, al pasar el ratón, qué hace. */
export function CrisisBanner() {
  const t = useT();
  const now = useServerNow();
  const [status, setStatus] = useState<CrisisStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      void api<CrisisStatus>("GET", "/api/crisis").then((r) => {
        if (alive && r.ok) setStatus(r.data);
      });
    check();
    const id = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  const c = status?.active;
  if (!c || c.endsAt <= now) return null;
  return (
    <span className="crisis-chip hide-sm" title={t(`crisis.${c.id}.hint` as I18nKey)} role="status">
      ⚠ {t(`crisis.${c.id}` as I18nKey)} · {formatDuration(c.endsAt - now)}
    </span>
  );
}
