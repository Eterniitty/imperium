import { settingsStore, type Action } from "../state/settings";
import { gameStore } from "../state/store";

/**
 * Estado del teclado. Ignora las teclas pulsadas mientras se escribe en la
 * interfaz. Las vistas preguntan por acciones (`action("forward")`), no por
 * teclas: así las teclas se pueden cambiar en los ajustes.
 */
export class Keyboard {
  private down = new Set<string>();
  private onKeyPress: (code: string) => void;

  constructor(onKeyPress: (code: string) => void) {
    this.onKeyPress = onKeyPress;
    window.addEventListener("keydown", this.handleDown);
    window.addEventListener("keyup", this.handleUp);
    window.addEventListener("blur", this.clear);
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    // También mientras se elige una tecla en los ajustes.
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || !!t.closest("[data-capturing-key]"));
  }

  private handleDown = (e: KeyboardEvent) => {
    // Con el menú de ajustes abierto, las teclas son del menú (Esc lo cierra), no del juego.
    if (this.isTyping(e) || gameStore.getState().settingsOpen || gameStore.getState().shipEditorOpen) return;
    // Pilotando, Tab cambia de blanco (si tiene esa tecla) y no mueve el foco de la página.
    if (e.code === "Tab" && gameStore.getState().view === "system" && settingsStore.getState().bindings.targetNext.includes("Tab")) e.preventDefault();
    if (!e.repeat) this.onKeyPress(e.code);
    this.down.add(e.code);
  };

  private handleUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private clear = () => this.down.clear();

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** ¿Está pulsada alguna de las teclas asignadas a la acción? */
  action(action: Action): boolean {
    return settingsStore.getState().bindings[action].some((code) => this.down.has(code));
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleDown);
    window.removeEventListener("keyup", this.handleUp);
    window.removeEventListener("blur", this.clear);
  }
}
