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

const PORTRAIT_SIZE = 64;
const TOAST_DURATION_MS = 3200;
/** Discrete segments the vitals meters snap to (chunky stepped pixel bars). */
const BAR_SEGMENTS = 16;

// Decorative monochrome thorny vines draped across the vitals well.
const VINES_SVG = `
  <svg class="hud-vines" viewBox="0 0 150 320" preserveAspectRatio="none" aria-hidden="true">
    <g fill="none" stroke-linecap="round">
      <path class="hud-vine hud-vine--main" d="M9 312 C 28 266, 11 226, 35 188 S 24 128, 42 96 S 32 44, 54 9" />
      <path class="hud-vine hud-vine--main" d="M141 9 C 122 56, 139 96, 115 138 S 126 186, 108 224 S 121 270, 96 312" />
      <path class="hud-vine hud-vine--twig" d="M35 188 C 50 172, 68 164, 86 168" />
      <path class="hud-vine hud-vine--twig" d="M115 138 C 100 122, 82 116, 64 120" />
      <path class="hud-vine hud-vine--twig" d="M42 96 C 56 82, 74 76, 90 80" />
    </g>
    <g class="hud-thorns" fill="#cfcfcf">
      <path d="M35 188 q 8 -6 16 0 q -8 6 -16 0 z" />
      <path d="M115 138 q -8 -6 -16 0 q 8 6 16 0 z" />
      <path d="M42 96 q 8 -5 14 1 q -7 5 -14 -1 z" />
      <path d="M108 224 q -8 -5 -14 1 q 7 5 14 -1 z" />
    </g>
    <g class="hud-thorns" stroke="#8a8a8a" stroke-width="1" fill="none">
      <path d="M24 128 l -5 -3 M30 130 l 4 -5" />
      <path d="M126 186 l 5 -3 M120 188 l -4 -5" />
      <path d="M11 226 l -5 -2 M19 228 l 4 -4" />
      <path d="M139 96 l 5 -2 M132 98 l -4 -4" />
    </g>
  </svg>
`;

export class Hud {
  public readonly element: HTMLDivElement;

  private readonly portraitCtx: CanvasRenderingContext2D;
  private readonly portraitImage: ImageData;

  private readonly healthFill: HTMLDivElement;
  private readonly staminaFill: HTMLDivElement;
  private readonly corruptionFill: HTMLDivElement;
  private readonly virtueFill: HTMLDivElement;

  private readonly healthValue: HTMLSpanElement;
  private readonly staminaValue: HTMLSpanElement;
  private readonly corruptionValue: HTMLSpanElement;
  private readonly virtueValue: HTMLSpanElement;

  private readonly objectiveEl: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly interactEl: HTMLDivElement;

  private readonly dashBadge: HTMLDivElement;
  private readonly dashSweep: HTMLDivElement;
  private readonly dashName: HTMLSpanElement;
  private readonly dashState: HTMLSpanElement;

  private readonly burstBadge: HTMLDivElement;
  private readonly burstSweep: HTMLDivElement;
  private readonly burstState: HTMLSpanElement;

  private toastTimer: number | null = null;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'hud';
    this.element.innerHTML = `
      <div class="hud-toast"></div>
      <div class="hud-interact" hidden></div>
      <div class="hud-panel">
        <div class="hud-panel__title">WILTED<br />FLOWER</div>

        <div class="hud-well hud-well--portrait">
          <div class="hud-well__heading">TRAVELER</div>
          <div class="hud-portrait-frame">
            <span class="hud-rivet hud-rivet--tl"></span>
            <span class="hud-rivet hud-rivet--tr"></span>
            <span class="hud-rivet hud-rivet--bl"></span>
            <span class="hud-rivet hud-rivet--br"></span>
            <canvas class="hud-portrait" width="${PORTRAIT_SIZE}" height="${PORTRAIT_SIZE}"></canvas>
          </div>
        </div>

        <div class="hud-well hud-well--vitals">
          <div class="hud-well__heading">VITALS</div>
          <div class="hud-stat hud-stat--health">
            <div class="hud-stat__row">
              <span class="hud-stat__label">HP</span>
              <span class="hud-stat__value hud-stat__value--health">100%</span>
            </div>
            <div class="hud-meter"><div class="hud-meter__fill hud-meter__fill--health"></div></div>
          </div>
          <div class="hud-stat hud-stat--stamina">
            <div class="hud-stat__row">
              <span class="hud-stat__label">ST</span>
              <span class="hud-stat__value hud-stat__value--stamina">200</span>
            </div>
            <div class="hud-meter"><div class="hud-meter__fill hud-meter__fill--stamina"></div></div>
          </div>
          <div class="hud-stat hud-stat--corruption">
            <div class="hud-stat__row">
              <span class="hud-stat__label">CR</span>
              <span class="hud-stat__value hud-stat__value--corruption">0</span>
            </div>
            <div class="hud-meter"><div class="hud-meter__fill hud-meter__fill--corruption"></div></div>
          </div>
          <div class="hud-stat hud-stat--virtue">
            <div class="hud-stat__row">
              <span class="hud-stat__label">VR</span>
              <span class="hud-stat__value hud-stat__value--virtue">0</span>
            </div>
            <div class="hud-meter"><div class="hud-meter__fill hud-meter__fill--virtue"></div></div>
          </div>
          ${VINES_SVG}
        </div>

        <div class="hud-well hud-well--abilities">
          <div class="hud-well__heading">ABILITIES</div>
          <div class="hud-ability hud-ability--dash">
            <div class="hud-ability__sweep"></div>
            <div class="hud-ability__row">
              <span class="hud-ability__key">[SPC]</span>
              <span class="hud-ability__name hud-ability__name--dash">Dash</span>
            </div>
            <div class="hud-ability__state hud-ability__state--dash">RDY</div>
          </div>
          <div class="hud-ability hud-ability--burst">
            <div class="hud-ability__sweep"></div>
            <div class="hud-ability__row">
              <span class="hud-ability__key">[Q]</span>
              <span class="hud-ability__name">Radiant Burst</span>
            </div>
            <div class="hud-ability__state hud-ability__state--burst">RDY</div>
          </div>
        </div>

        <div class="hud-well hud-well--objective">
          <div class="hud-well__heading">OBJECTIVE</div>
          <div class="hud-objective-text"></div>
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

    this.healthFill = this.element.querySelector('.hud-meter__fill--health') as HTMLDivElement;
    this.staminaFill = this.element.querySelector('.hud-meter__fill--stamina') as HTMLDivElement;
    this.corruptionFill = this.element.querySelector('.hud-meter__fill--corruption') as HTMLDivElement;
    this.virtueFill = this.element.querySelector('.hud-meter__fill--virtue') as HTMLDivElement;

    this.healthValue = this.element.querySelector('.hud-stat__value--health') as HTMLSpanElement;
    this.staminaValue = this.element.querySelector('.hud-stat__value--stamina') as HTMLSpanElement;
    this.corruptionValue = this.element.querySelector('.hud-stat__value--corruption') as HTMLSpanElement;
    this.virtueValue = this.element.querySelector('.hud-stat__value--virtue') as HTMLSpanElement;

    this.objectiveEl = this.element.querySelector('.hud-objective-text') as HTMLDivElement;
    this.toastEl = this.element.querySelector('.hud-toast') as HTMLDivElement;
    this.interactEl = this.element.querySelector('.hud-interact') as HTMLDivElement;

    this.dashBadge = this.element.querySelector('.hud-ability--dash') as HTMLDivElement;
    this.dashSweep = this.dashBadge.querySelector('.hud-ability__sweep') as HTMLDivElement;
    this.dashName = this.dashBadge.querySelector('.hud-ability__name--dash') as HTMLSpanElement;
    this.dashState = this.dashBadge.querySelector('.hud-ability__state--dash') as HTMLSpanElement;

    this.burstBadge = this.element.querySelector('.hud-ability--burst') as HTMLDivElement;
    this.burstSweep = this.burstBadge.querySelector('.hud-ability__sweep') as HTMLDivElement;
    this.burstState = this.burstBadge.querySelector('.hud-ability__state--burst') as HTMLSpanElement;
  }

  public update(state: HudState): void {
    this.setBar(this.healthFill, state.health / state.maxHealth);
    this.setBar(this.staminaFill, state.stamina / state.maxStamina);
    this.setBar(this.corruptionFill, state.corruption);
    this.setBar(this.virtueFill, state.virtue);

    this.healthValue.textContent = `${Math.round((state.health / state.maxHealth) * 100)}%`;
    this.staminaValue.textContent = `${Math.round(state.stamina)}`;
    this.corruptionValue.textContent = `${Math.round(state.corruption * 100)}`;
    this.virtueValue.textContent = `${Math.round(state.virtue * 100)}`;

    this.healthFill.classList.toggle('is-low', state.health / state.maxHealth < 0.3);
    this.staminaFill.classList.toggle('is-low', state.stamina / state.maxStamina < 0.2);

    this.objectiveEl.textContent = state.objective;

    // Dash plate: name switches to Blight Dash once unlocked.
    this.dashName.textContent = state.dashUnlocked ? 'Blight Dash' : 'Dash';
    this.dashBadge.classList.toggle('is-unlocked', state.dashUnlocked);
    this.updateBadge(
      this.dashBadge,
      this.dashSweep,
      this.dashState,
      state.dashReady,
      state.dashCooldownFraction,
      state.dashCooldownSeconds
    );

    // Radiant Burst plate: dimmed until virtue unlocks it.
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
    // Quantize to discrete segments so bars read as chunky stepped pixel blocks.
    const stepped = Math.round(clamped * BAR_SEGMENTS) / BAR_SEGMENTS;
    fill.style.width = `${stepped * 100}%`;
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
      stateEl.textContent = 'RDY';
      stateEl.classList.add('is-ready');
    } else {
      stateEl.textContent = `${seconds.toFixed(1)}s`;
      stateEl.classList.remove('is-ready');
    }
  }
}
