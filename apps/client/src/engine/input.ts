/** Estado del teclado. Ignora las teclas pulsadas mientras se escribe en la interfaz. */
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
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  private handleDown = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
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

  dispose(): void {
    window.removeEventListener("keydown", this.handleDown);
    window.removeEventListener("keyup", this.handleUp);
    window.removeEventListener("blur", this.clear);
  }
}
