import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

/**
 * Aviso de fotosensibilidad: se abre una vez justo después de crear el
 * Emperador (antes de entrar a jugar) y cuando el jugador lo pide desde
 * Ajustes. No se muestra en ningún otro momento.
 */
export const photoNoticeStore = createStore<{ open: boolean }>()(() => ({ open: false }));

export function openPhotoNotice(): void {
  photoNoticeStore.setState({ open: true });
}

export function closePhotoNotice(): void {
  photoNoticeStore.setState({ open: false });
}

export function usePhotoNoticeOpen(): boolean {
  return useStore(photoNoticeStore, (s) => s.open);
}
