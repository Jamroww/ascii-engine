export interface HudState {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  /** 0..1 */
  corruption: number;
  /** 0..1 */
  virtue: number;
  /** Blight Dash unlock (label/colour switch). */
  dashUnlocked: boolean;
  dashReady: boolean;
  /** 0..1 */
  dashCooldownFraction: number;
  dashCooldownSeconds: number;
  radiantUnlocked: boolean;
  radiantReady: boolean;
  /** 0..1 */
  radiantCooldownFraction: number;
  radiantCooldownSeconds: number;
  objective: string;
}

const PORTRAIT_SIZE = 128;
const TOAST_DURATION_MS = 3200;

export class Hud {
  public readonly element: HTMLDivElement;

  private readonly portraitCtx: CanvasRenderingContext2D;
  private readonly portraitImage: ImageData;

  private readonly healthFill: HTMLDivElement;
  private readonly staminaFill: HTMLDivElement;
  private readonly corruptionFill: HTMLDivElement;
  private readonly virtueFill: HTMLDivElement;

  private readonly objectiveEl: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly interactEl: HTMLDivElement;

  private readonly dashBadge: HTMLDivElement;
  private readonly dashSweep: HTMLDivElement;
  private readonly dashLabel: HTMLSpanElement;
  private readonly dashState: HTMLSpanElement;

  private readonly burstBadge: HTMLDivElement;
  private readonly burstSweep: HTMLDivElement;
  private readonly burstLabel: HTMLSpanElement;
  private readonly burstState: HTMLSpanElement;

  private toastTimer: number | null = null;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'hud';
    this.element.innerHTML = `
      <div class="hud-objective"></div>
      <div class="hud-toast"></div>
      <div class="hud-interact" hidden></div>
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
          <div class="hud-bar hud-bar--corruption">
            <span class="hud-bar-label">CR</span>
            <div class="hud-bar-track"><div class="hud-bar-fill hud-bar-fill--corruption"></div></div>
          </div>
          <div class="hud-bar hud-bar--virtue">
            <span class="hud-bar-label">VR</span>
            <div class="hud-bar-track"><div class="hud-bar-fill hud-bar-fill--virtue"></div></div>
          </div>
        </div>
        <div class="hud-badges">
          <div class="hud-badge hud-badge--dash">
            <div class="hud-badge__sweep"></div>
            <div class="hud-badge__row">
              <span class="hud-badge__label">[Space] Dash</span>
              <span class="hud-badge__state"></span>
            </div>
          </div>
          <div class="hud-badge hud-badge--burst">
            <div class="hud-badge__sweep"></div>
            <div class="hud-badge__row">
              <span class="hud-badge__label">[Q] Radiant Burst</span>
              <span class="hud-badge__state"></span>
            </div>
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
    this.corruptionFill = this.element.querySelector('.hud-bar-fill--corruption') as HTMLDivElement;
    this.virtueFill = this.element.querySelector('.hud-bar-fill--virtue') as HTMLDivElement;

    this.objectiveEl = this.element.querySelector('.hud-objective') as HTMLDivElement;
    this.toastEl = this.element.querySelector('.hud-toast') as HTMLDivElement;
    this.interactEl = this.element.querySelector('.hud-interact') as HTMLDivElement;

    this.dashBadge = this.element.querySelector('.hud-badge--dash') as HTMLDivElement;
    this.dashSweep = this.dashBadge.querySelector('.hud-badge__sweep') as HTMLDivElement;
    this.dashLabel = this.dashBadge.querySelector('.hud-badge__label') as HTMLSpanElement;
    this.dashState = this.dashBadge.querySelector('.hud-badge__state') as HTMLSpanElement;

    this.burstBadge = this.element.querySelector('.hud-badge--burst') as HTMLDivElement;
    this.burstSweep = this.burstBadge.querySelector('.hud-badge__sweep') as HTMLDivElement;
    this.burstLabel = this.burstBadge.querySelector('.hud-badge__label') as HTMLSpanElement;
    this.burstState = this.burstBadge.querySelector('.hud-badge__state') as HTMLSpanElement;
  }

  public update(state: HudState): void {
    this.setBar(this.healthFill, state.health / state.maxHealth);
    this.setBar(this.staminaFill, state.stamina / state.maxStamina);
    this.setBar(this.corruptionFill, state.corruption);
    this.setBar(this.virtueFill, state.virtue);

    this.healthFill.classList.toggle('is-low', state.health / state.maxHealth < 0.3);
    this.staminaFill.classList.toggle('is-low', state.stamina / state.maxStamina < 0.2);

    this.objectiveEl.textContent = state.objective;

    // Dash badge: label + colour switch to Blight Dash once unlocked.
    this.dashLabel.textContent = state.dashUnlocked ? '[Space] Blight Dash' : '[Space] Dash';
    this.dashBadge.classList.toggle('is-unlocked', state.dashUnlocked);
    this.updateBadge(
      this.dashBadge,
      this.dashSweep,
      this.dashState,
      state.dashReady,
      state.dashCooldownFraction,
      state.dashCooldownSeconds
    );

    // Radiant Burst badge: dimmed until virtue unlocks it.
    this.burstLabel.textContent = '[Q] Radiant Burst';
    this.burstBadge.classList.toggle('is-unlocked', state.radiantUnlocked);
    if (state.radiantUnlocked) {
      this.updateBadge(
        this.burstBadge,
        this.burstSweep,
        this.burstState,
        state.radiantReady,
        state.radiantCooldownFraction,
        state.radiantCooldownSeconds
      );
    } else {
      this.burstSweep.style.width = '0%';
      this.burstBadge.classList.remove('is-on-cooldown');
      this.burstState.textContent = 'LOCKED';
      this.burstState.classList.remove('is-ready');
    }
  }

  /** Show a transient banner near the top of the screen. */
  public showToast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
      this.toastTimer = null;
    }, TOAST_DURATION_MS);
  }

  /** Bottom-center contextual prompt; pass null to hide it. */
  public setInteractPrompt(text: string | null): void {
    if (text) {
      this.interactEl.textContent = text;
      this.interactEl.hidden = false;
    } else {
      this.interactEl.hidden = true;
    }
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
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.element.remove();
  }

  private setBar(fill: HTMLDivElement, fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    fill.style.width = `${clamped * 100}%`;
  }

  private updateBadge(
    badge: HTMLDivElement,
    sweep: HTMLDivElement,
    stateEl: HTMLSpanElement,
    ready: boolean,
    fraction: number,
    seconds: number
  ): void {
    sweep.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    badge.classList.toggle('is-on-cooldown', !ready);
    if (ready) {
      stateEl.textContent = 'READY';
      stateEl.classList.add('is-ready');
    } else {
      stateEl.textContent = `${seconds.toFixed(1)}s`;
      stateEl.classList.remove('is-ready');
    }
  }
}
