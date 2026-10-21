import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { openPhotoNotice } from "./photoNotice";
import {
  LOGIN_TOKEN_PARAM,
  type ApiError,
  type AuthAccount,
  type AuthMeResponse,
  type AuthPeekResponse,
  type CompanionRequestResponse,
  type Emperor,
  type EmperorResponse,
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
 * - naming: sesión abierta, pero la cuenta aún no tiene Emperador; se pide su nombre.
 * - waiting: sin Emperador y con una solicitud de alta con compañero enviada
 *   (esperando respuesta, o ya respondida: aceptada se crea sola).
 * - authenticated: sesión abierta y Emperador cargado.
 */
export type AuthStatus = "loading" | "offline" | "anonymous" | "sent" | "confirm" | "verifying" | "naming" | "waiting" | "authenticated";

export type CompanionRequest = NonNullable<CompanionRequestResponse["request"]>;

export interface AuthState {
  status: AuthStatus;
  account: AuthAccount | null;
  emperor: Emperor | null;
  sentTo: string | null;
  /** Enlace pendiente de confirmar: el token (solo en memoria) y el correo enmascarado. */
  pending: { token: string; email: string } | null;
  busy: boolean;
  error: I18nKey | null;
  /** Alta con compañero: la solicitud enviada (o null). */
  companion: CompanionRequest | null;

  init(): Promise<void>;
  requestLink(email: string, locale: Locale): Promise<void>;
  confirmLogin(): Promise<void>;
  cancelLogin(): void;
  reset(): void;
  logout(): Promise<void>;
  /** Borra la cuenta y todos sus datos. Devuelve el error, si lo hay. */
  deleteAccount(): Promise<I18nKey | null>;
  createEmperor(name: string): Promise<void>;
  /** Alta con compañero: pide aparecer cerca del Emperador `companion`. */
  requestCompanion(name: string, companion: string): Promise<void>;
  /** Vuelve a consultar la solicitud enviada; si la aceptaron, crea el Emperador. */
  refreshCompanion(): Promise<void>;
  /** Retira la solicitud; con `alone`, crea el Emperador en solitario con el nombre pedido. */
  cancelCompanion(alone: boolean): Promise<void>;
  /** Traslada al Emperador al sistema indicado. Devuelve el error, si lo hay. */
  /** Salto cuántico; `near`: llegar junto a ese compañero (memoria de posición). */
  moveEmperor(systemId: string, near?: string | null): Promise<I18nKey | null>;
  /** Sale del túnel cuántico a mitad de viaje (espacio profundo). */
  dropEmperor(): Promise<I18nKey | null>;
}

/** Resultado de una llamada a la API: el cuerpo, o el código de error traducible. */
type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: I18nKey };

export async function api<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<ApiResult<T>> {
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

/** Marca (en sessionStorage) para avisar en la portada de que la cuenta se borró. */
export const ACCOUNT_DELETED_FLAG = "imperium.accountDeleted";

let initialized = false;

/**
 * Estado de reposo según haya o no sesión abierta. Con sesión, carga el
 * Emperador: si la cuenta aún no tiene, toca nombrarlo.
 */
async function idle(account: AuthAccount | null): Promise<Partial<AuthState>> {
  if (!account) return { status: "anonymous", account: null, emperor: null };
  const res = await api<EmperorResponse>("GET", "/api/emperor");
  if (res.ok) return { status: "authenticated", account, emperor: res.data.emperor, companion: null };
  if (res.status === 404) {
    // Sin Emperador: puede haber enviado una solicitud de alta con compañero.
    const req = await api<CompanionRequestResponse>("GET", "/api/emperor/companion");
    const companion = req.ok ? req.data.request : null;
    return { status: companion ? "waiting" : "naming", account, emperor: null, companion };
  }
  if (res.status === 401) return { status: "anonymous", account: null, emperor: null, error: res.error };
  return { status: "offline", account: null, emperor: null };
}

export const authStore = createStore<AuthState>()((set, get) => ({
  status: "loading",
  account: null,
  emperor: null,
  sentTo: null,
  pending: null,
  busy: false,
  error: null,
  companion: null,

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
      return set({ ...(await idle(account)), error: peek.error });
    }
    set(await idle(account));
  },

  confirmLogin: async () => {
    const pending = get().pending;
    if (!pending) return;
    set({ status: "verifying", error: null });
    const res = await api<AuthMeResponse>("POST", "/api/auth/verify", { token: pending.token });
    if (res.ok) return set({ ...(await idle(res.data.account)), pending: null });
    // Sin red se conserva el enlace para reintentar; si no es válido, se descarta.
    if (res.status === 0) return set({ status: "confirm", error: res.error });
    set({ ...(await idle(get().account)), pending: null, error: res.error });
  },

  cancelLogin: () => {
    const { account, emperor } = get();
    set({ status: !account ? "anonymous" : emperor ? "authenticated" : get().companion ? "waiting" : "naming", pending: null, error: null });
  },

  requestLink: async (email, locale) => {
    set({ busy: true, error: null });
    const res = await api<{ ok: true }>("POST", "/api/auth/request", { email: email.trim(), locale, acceptTerms: true });
    if (res.ok) set({ busy: false, status: "sent", sentTo: email.trim() });
    else set({ busy: false, error: res.error });
  },

  reset: () => set({ status: "anonymous", sentTo: null, error: null }),

  logout: async () => {
    set({ busy: true });
    await api("POST", "/api/auth/logout");
    set({ busy: false, status: "anonymous", account: null, emperor: null, sentTo: null, error: null, companion: null });
  },

  deleteAccount: async () => {
    set({ busy: true });
    const res = await api("POST", "/api/account/delete", { confirm: true });
    if (!res.ok) {
      set({ busy: false });
      return res.error;
    }
    // Se recarga la página: cierra la conexión y el motor y vuelve a la portada, que lo confirma.
    sessionStorage.setItem(ACCOUNT_DELETED_FLAG, "1");
    window.location.reload();
    return null;
  },

  createEmperor: async (name) => {
    set({ busy: true, error: null });
    const res = await api<EmperorResponse>("POST", "/api/emperor", { name });
    if (res.ok) {
      set({ busy: false, status: "authenticated", emperor: res.data.emperor, companion: null });
      // Fin del alta: aviso de fotosensibilidad antes de entrar a jugar (una vez).
      openPhotoNotice();
      return;
    }
    // Si otra pestaña ya lo creó, se carga el existente.
    if (res.status === 409 && res.error === "error.emperor_exists") return set({ busy: false, ...(await idle(get().account)) });
    if (res.status === 401) return set({ busy: false, status: "anonymous", account: null, error: res.error });
    // Nombre cogido mientras esperaba: vuelve al formulario (la solicitud aceptada se conserva).
    set({ busy: false, status: "naming", error: res.error });
  },

  requestCompanion: async (name, companion) => {
    set({ busy: true, error: null });
    const res = await api<CompanionRequestResponse>("POST", "/api/emperor/companion", { name, companion });
    if (res.ok) return set({ busy: false, status: "waiting", companion: res.data.request });
    if (res.status === 409 && res.error === "error.emperor_exists") return set({ busy: false, ...(await idle(get().account)) });
    if (res.status === 401) return set({ busy: false, status: "anonymous", account: null, error: res.error });
    set({ busy: false, error: res.error });
  },

  refreshCompanion: async () => {
    if (get().busy) return;
    const res = await api<CompanionRequestResponse>("GET", "/api/emperor/companion");
    if (!res.ok) return;
    const companion = res.data.request;
    if (!companion) return set({ companion: null, status: "naming" });
    set({ companion });
    if (companion.status === "accepted") await get().createEmperor(companion.name);
  },

  cancelCompanion: async (alone) => {
    const name = get().companion?.name;
    set({ busy: true, error: null });
    if (alone && name) {
      // Crear en solitario ya retira la solicitud en el servidor.
      set({ busy: false });
      return get().createEmperor(name);
    }
    await api("POST", "/api/emperor/companion/cancel");
    set({ busy: false, status: "naming", companion: null });
  },

  // Importación diferida: la conexión importa este módulo.
  moveEmperor: async (systemId, near) => (await import("../net/world")).connection.command("emperor.move", near ? { systemId, near } : { systemId }),
  dropEmperor: async () => (await import("../net/world")).connection.command("emperor.drop", {}),
}));

export function useAuth<T>(selector: (s: AuthState) => T): T {
  return useStore(authStore, selector);
}
