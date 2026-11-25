export interface DialogueContent {
  speaker: string;
  lines: string[];
}

/**
 * Bottom-center DOM dialogue overlay. Pure view: the engine owns input routing
 * (E / Space / click to advance, Escape to close) and drives `advance()` /
 * `close()` while the game world is paused.
 */
export class DialogueBox {
  public readonly element: HTMLDivElement;

  private readonly speakerEl: HTMLDivElement;
  private readonly lineEl: HTMLDivElement;

  private active = false;
  private lines: string[] = [];
  private index = 0;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'dialogue-box';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="dialogue-box__speaker"></div>
      <div class="dialogue-box__line"></div>
      <div class="dialogue-box__hint">[E / Click] Continue</div>
    `;
    container.appendChild(this.element);

    this.speakerEl = this.element.querySelector('.dialogue-box__speaker') as HTMLDivElement;
    this.lineEl = this.element.querySelector('.dialogue-box__line') as HTMLDivElement;
  }

  get isOpen(): boolean {
    return this.active;
  }

  open(content: DialogueContent): void {
    this.lines = content.lines.length > 0 ? content.lines : ['…'];
    this.index = 0;
    this.active = true;
    this.element.hidden = false;
    this.speakerEl.textContent = content.speaker;
    this.render();
  }

  /** Advance to the next line, closing cleanly past the last one. */
  advance(): void {
    if (!this.active) return;
    this.index += 1;
    if (this.index >= this.lines.length) {
      this.close();
      return;
    }
    this.render();
  }

  close(): void {
    this.active = false;
    this.element.hidden = true;
  }

  dispose(): void {
    this.element.remove();
  }

  private render(): void {
    this.lineEl.textContent = this.lines[this.index];
  }
}
