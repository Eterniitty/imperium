import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  LOGIN_TOKEN_PARAM,
  type ApiError,
  type AuthAccount,
  type AuthMeResponse,
  type I18nKey,
  type Locale,
} from "@imperium/shared";

/**
 * Estado del acceso:
 * - loading: comprobando si hay sesión.
 * - offline: no hay servidor; el universo se sigue generando en el navegador.
 * - anonymous: hay servidor pero no sesión; se pide el correo.
 * - sent: enlace enviado, a la espera de que el jugador lo abra.
 * - verifying: canjeando el enlace que trae la URL.
 * - authenticated: sesión abierta.
 */
export type AuthStatus = "loading" | "offline" | "anonymous" | "sent" | "verifying" | "authenticated";

export interface AuthState {
  status: AuthStatus;
  account: AuthAccount | null;
  sentTo: string | null;
  busy: boolean;
  error: I18nKey | null;

  init(): Promise<void>;
  requestLink(email: string, locale: Locale): Promise<void>;
  reset(): void;
  logout(): Promise<void>;
}

/** Resultado de una llamada a la API: el cuerpo, o el código de error traducible. */
type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: I18nKey };

async function api<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<ApiResult<T>> {
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
  if (res.status === 204) return { ok: true, data: undefined as T };
  const json = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (res.ok && json) return { ok: true, data: json };
  const code = json?.error;
  return { ok: false, status: res.status, error: code ? `error.${code}` : "error.internal" };
}

/** Saca el token de acceso de la URL y lo borra, para que no quede en el historial. */
function takeLoginToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(LOGIN_TOKEN_PARAM);
  if (!token) return null;
  url.searchParams.delete(LOGIN_TOKEN_PARAM);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return token;
}

let initialized = false;

export const authStore = createStore<AuthState>()((set) => ({
  status: "loading",
  account: null,
  sentTo: null,
  busy: false,
  error: null,

  init: async () => {
    // Una sola vez: el enlace es de un solo uso y React en modo estricto monta dos veces.
    if (initialized) return;
    initialized = true;

    const token = takeLoginToken();
    if (token) {
      set({ status: "verifying" });
      const res = await api<AuthMeResponse>("POST", "/api/auth/verify", { token });
      if (res.ok) return set({ status: "authenticated", account: res.data.account, error: null });
      // Enlace no válido: se sigue con la comprobación normal para mostrar el error en su contexto.
      set({ error: res.error });
    }

    const me = await api<AuthMeResponse>("GET", "/api/auth/me");
    if (me.ok) return set({ status: "authenticated", account: me.data.account });
    // 401: hay servidor pero no sesión. Cualquier otra cosa (sin red, proxy sin servidor): sin conexión.
    set({ status: me.status === 401 ? "anonymous" : "offline" });
  },

  requestLink: async (email, locale) => {
    set({ busy: true, error: null });
    const res = await api<{ ok: true }>("POST", "/api/auth/request", { email: email.trim(), locale });
    if (res.ok) set({ busy: false, status: "sent", sentTo: email.trim() });
    else set({ busy: false, error: res.error });
  },

  reset: () => set({ status: "anonymous", sentTo: null, error: null }),

  logout: async () => {
    set({ busy: true });
    await api("POST", "/api/auth/logout");
    set({ busy: false, status: "anonymous", account: null, sentTo: null, error: null });
  },
}));

export function useAuth<T>(selector: (s: AuthState) => T): T {
  return useStore(authStore, selector);
}
