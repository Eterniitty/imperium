/**
 * Llamadas de la Wiki a la API del juego (mismo dominio: la cookie de sesión
 * del juego vale aquí). Si la API no responde, la Wiki sigue funcionando con
 * los textos del repositorio.
 */
import type {
  ApiError,
  I18nKey,
  Locale,
  WikiGroup,
  WikiHistoryResponse,
  WikiPageResponse,
  WikiRevisionResponse,
  WikiSaveResponse,
  WikiStateResponse,
} from "@imperium/shared";

export type WikiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: I18nKey };

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<WikiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, status: 0, error: "error.network" };
  }
  const json = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (res.ok && json) return { ok: true, data: json };
  const code = json?.error;
  return { ok: false, status: res.status, error: code ? (`error.${code}` as I18nKey) : "error.internal" };
}

export const wikiApi = {
  state: () => call<WikiStateResponse>("GET", "/api/wiki"),
  history: (slug: string, locale: Locale) => call<WikiHistoryResponse>("GET", `/api/wiki/history?slug=${encodeURIComponent(slug)}&locale=${locale}`),
  revision: (id: number) => call<WikiRevisionResponse>("GET", `/api/wiki/revisions/${id}`),
  save: (body: { slug: string; locale: Locale; body: string; note: string; baseRevisionId: number | null }) => call<WikiSaveResponse>("POST", "/api/wiki/save", body),
  restore: (revisionId: number, note = "") => call<WikiSaveResponse>("POST", "/api/wiki/restore", { revisionId, note }),
  create: (body: { slug: string; group: WikiGroup; locale: Locale; title: string }) => call<WikiPageResponse>("POST", "/api/wiki/create", body),
  meta: (body: { slug: string; hidden?: boolean; group?: WikiGroup }) => call<WikiPageResponse>("POST", "/api/wiki/meta", body),
};
