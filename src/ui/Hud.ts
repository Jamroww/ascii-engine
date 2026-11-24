export interface HudStats {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
}

const PORTRAIT_SIZE = 128;

export class Hud {
  public readonly element: HTMLDivElement;

  private readonly portraitCtx: CanvasRenderingContext2D;
  private readonly portraitImage: ImageData;
  private readonly healthFill: HTMLDivElement;
  private readonly staminaFill: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'hud';
    this.element.innerHTML = `
      <div class="hud-panel">
        <div class="hud-portrait-frame">
          <canvas class="hud-portrait" width="${PORTRAIT_SIZE}" height="${PORTRAIT_SIZE}"></canvas>
        </div>
        <div class="hud-bars">
          <div class="hud-bar hud-bar--health">
            <span class="hud-bar-label">HP</span>
            <div class="hud-bar-track"><div class="hud-bar-fill hud-bar-fill--health"></div></div>
          </div>
          <div class="hud-bar hud-bar--stamina">
            <span class="hud-bar-label">ST</span>
            <div class="hud-bar-track"><div class="hud-bar-fill hud-bar-fill--stamina"></div></div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(this.element);

    const canvas = this.element.querySelector('.hud-portrait') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D context for HUD portrait');
    }
    this.portraitCtx = ctx;
    this.portraitImage = ctx.createImageData(PORTRAIT_SIZE, PORTRAIT_SIZE);

    this.healthFill = this.element.querySelector('.hud-bar-fill--health') as HTMLDivElement;
    this.staminaFill = this.element.querySelector('.hud-bar-fill--stamina') as HTMLDivElement;
  }

  public update(stats: HudStats): void {
    const h = Math.max(0, Math.min(1, stats.health / stats.maxHealth));
    const s = Math.max(0, Math.min(1, stats.stamina / stats.maxStamina));

    this.healthFill.style.width = `${h * 100}%`;
    this.staminaFill.style.width = `${s * 100}%`;
    this.healthFill.classList.toggle('is-low', h < 0.3);
    this.staminaFill.classList.toggle('is-low', s < 0.2);
  }

  public drawPortrait(pixels: Uint8Array): void {
    // gl.readPixels is bottom-up; the 2D canvas is top-down, so flip rows.
    const rowBytes = PORTRAIT_SIZE * 4;
    const data = this.portraitImage.data;
    for (let y = 0; y < PORTRAIT_SIZE; y++) {
      const src = (PORTRAIT_SIZE - 1 - y) * rowBytes;
      data.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
    }
    this.portraitCtx.putImageData(this.portraitImage, 0, 0);
  }

  public dispose(): void {
    this.element.remove();
  }
}
