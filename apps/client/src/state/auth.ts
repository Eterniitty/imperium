import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  LOGIN_TOKEN_PARAM,
  type ApiError,
  type AuthAccount,
  type AuthMeResponse,
  type AuthPeekResponse,
  type I18nKey,
  type Locale,
} from "@imperium/shared";

/**
 * Estado del acceso:
 * - loading: comprobando si hay sesión.
 * - offline: no hay servidor; el universo se sigue generando en el navegador.
 * - anonymous: hay servidor pero no sesión; se pide el correo.
 * - sent: enlace enviado, a la espera de que el jugador lo abra.
 * - confirm: la URL trae un enlace; se muestra a qué cuenta lleva y se pide confirmación.
 * - verifying: canjeando el enlace.
 * - authenticated: sesión abierta.
 */
export type AuthStatus = "loading" | "offline" | "anonymous" | "sent" | "confirm" | "verifying" | "authenticated";

export interface AuthState {
  status: AuthStatus;
  account: AuthAccount | null;
  sentTo: string | null;
  /** Enlace pendiente de confirmar: el token (solo en memoria) y el correo enmascarado. */
  pending: { token: string; email: string } | null;
  busy: boolean;
  error: I18nKey | null;

  init(): Promise<void>;
  requestLink(email: string, locale: Locale): Promise<void>;
  confirmLogin(): Promise<void>;
  cancelLogin(): void;
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

/**
 * Saca el token de acceso del fragmento de la URL (`#login=...`) y lo borra de
 * la barra de direcciones. El fragmento no se envía a ningún servidor.
 */
function takeLoginToken(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get(LOGIN_TOKEN_PARAM);
  if (!token) return null;
  params.delete(LOGIN_TOKEN_PARAM);
  const rest = params.toString();
  window.history.replaceState(null, "", window.location.pathname + window.location.search + (rest ? `#${rest}` : ""));
  return token;
}

let initialized = false;

/** Estado de reposo según haya o no sesión abierta. */
const idle = (account: AuthAccount | null) => ({ status: account ? ("authenticated" as const) : ("anonymous" as const), account });

export const authStore = createStore<AuthState>()((set, get) => ({
  status: "loading",
  account: null,
  sentTo: null,
  pending: null,
  busy: false,
  error: null,

  init: async () => {
    // Una sola vez: el enlace es de un solo uso y React en modo estricto monta dos veces.
    if (initialized) return;
    initialized = true;

    const token = takeLoginToken();
    const me = await api<AuthMeResponse>("GET", "/api/auth/me");
    // 401: hay servidor pero no sesión. Cualquier otra cosa (sin red, proxy sin servidor): sin conexión.
    if (!me.ok && me.status !== 401) return set({ status: "offline" });
    const account = me.ok ? me.data.account : null;

    if (token) {
      // No se canjea sin preguntar: un enlace ajeno metería al jugador en otra cuenta.
      const peek = await api<AuthPeekResponse>("POST", "/api/auth/peek", { token });
      if (peek.ok) return set({ status: "confirm", account, pending: { token, email: peek.data.email } });
      return set({ ...idle(account), error: peek.error });
    }
    set(idle(account));
  },

  confirmLogin: async () => {
    const pending = get().pending;
    if (!pending) return;
    set({ status: "verifying", error: null });
    const res = await api<AuthMeResponse>("POST", "/api/auth/verify", { token: pending.token });
    if (res.ok) return set({ status: "authenticated", account: res.data.account, pending: null });
    // Sin red se conserva el enlace para reintentar; si no es válido, se descarta.
    if (res.status === 0) return set({ status: "confirm", error: res.error });
    set({ ...idle(get().account), pending: null, error: res.error });
  },

  cancelLogin: () => set({ ...idle(get().account), pending: null, error: null }),

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
