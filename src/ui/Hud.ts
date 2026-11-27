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
  parryReady: boolean;
  /** 0..1 */
  parryCooldownFraction: number;
  parryCooldownSeconds: number;
  /** Flask charges remaining this attempt. */
  flaskCharges: number;
  flaskMax: number;
  /** Boss bar (top-center) — visible only while in aggro range of the boss. */
  bossVisible: boolean;
  bossName: string;
  bossSubtitle: string;
  /** 0..1 */
  bossHpFraction: number;
}

const PORTRAIT_SIZE = 64;
const TOAST_DURATION_MS = 3200;
const FLASH_DURATION_MS = 1600;
/** Discrete segments the vitals meters snap to (chunky stepped pixel bars). */
const BAR_SEGMENTS = 16;

// Pixelated Heart + Boot badges paired with the HP / Stamina meters.
const HEART_ICON = `
  <svg class="hud-stat__icon" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true">
    <path d="M5 9 L1 5 L1 3 Q1 1 3 1 Q4 1 5 2 Q6 1 7 1 Q9 1 9 3 L9 5 Z" fill="currentColor"/>
  </svg>
`;

const BOOT_ICON = `
  <svg class="hud-stat__icon" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true">
    <path d="M1 9 L1 6 L3 6 L3 3 L7 3 L9 5 L9 7 L7 7 L7 9 Z" fill="currentColor"/>
  </svg>
`;

// Inline crisp pixelated rock-and-root frame drawn behind the sidebar content.
// A craggy dark-slate backing hugs the upper compartments while a winding
// gnarled root (with tiny leaves) runs down the right edge and tapers toward
// the bottom-left, leaving the lower viewport open.
const FRAME_SVG = `
  <svg class="hud-frame" viewBox="0 0 200 740" preserveAspectRatio="none" aria-hidden="true">
    <path class="hud-frame__slate" d="M4 4 H192 V100 H186 V156 H192 V212 H184 V268 H190 V324 H178 V380 H164 V432 H142 V478 H114 V516 H82 V548 H48 V576 H16 V596 H6 V606 H4 Z" />
    <path class="hud-frame__slate-lite" d="M12 26 H168 V56 H160 V74 H168 V88 H12 Z" />
    <path class="hud-frame__slate-lite" d="M16 148 H150 V172 H16 Z" />
    <path class="hud-frame__slate-lite" d="M14 300 H142 V324 H14 Z" />
    <path class="hud-frame__root" d="M192 8 L176 42 L182 82 L168 120 L174 160 L160 200 L166 242 L152 284 L158 324 L140 362 L120 398 L96 430 L70 458 L44 484 L22 508 L10 532 L6 544" />
    <path class="hud-frame__root-hi" d="M190 12 L174 44 L180 84 L166 122 L172 162 L158 202 L164 244 L150 286 L156 326 L138 364 L118 400 L94 432 L68 460 L42 486 L20 510 L8 534" />
    <path class="hud-frame__twig" d="M168 120 L146 112 L128 116" />
    <path class="hud-frame__twig" d="M152 284 L132 292 L114 286" />
    <path class="hud-frame__twig" d="M120 398 L140 408 L158 404" />
    <path class="hud-frame__twig" d="M44 484 L26 490 L14 486" />
    <g class="hud-frame__leaf" fill="#4a6b3a">
      <path d="M146 112 l5 -4 l5 4 l-5 4 z" />
      <path d="M128 116 l4 -3 l4 3 l-4 3 z" />
      <path d="M132 292 l4 -3 l4 3 l-4 3 z" />
      <path d="M114 286 l3 -3 l3 3 l-3 3 z" />
      <path d="M140 408 l4 -3 l4 3 l-4 3 z" />
      <path d="M26 490 l4 -3 l4 3 l-4 3 z" />
      <path d="M70 458 l3 -3 l3 3 l-3 3 z" />
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

  private readonly toastEl: HTMLDivElement;
  private readonly interactEl: HTMLDivElement;

  private readonly dashBadge: HTMLDivElement;
  private readonly dashSweep: HTMLDivElement;
  private readonly dashName: HTMLSpanElement;
  private readonly dashState: HTMLSpanElement;

  private readonly burstBadge: HTMLDivElement;
  private readonly burstSweep: HTMLDivElement;
  private readonly burstState: HTMLSpanElement;

  private readonly parryBadge: HTMLDivElement;
  private readonly parrySweep: HTMLDivElement;
  private readonly parryState: HTMLSpanElement;

  private readonly flaskBadge: HTMLDivElement;
  private readonly flaskState: HTMLSpanElement;

  private readonly bossBar: HTMLDivElement;
  private readonly bossName: HTMLSpanElement;
  private readonly bossSub: HTMLSpanElement;
  private readonly bossFill: HTMLDivElement;

  private readonly inventoryButton: HTMLButtonElement;

  private toastTimer: number | null = null;
  private flashTimer: number | null = null;
  private inventoryHandler: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'hud';
    this.element.innerHTML = `
      <div class="hud-toast"></div>
      <div class="hud-interact" hidden></div>
      <div class="hud-bossbar" hidden>
        <div class="hud-bossbar__title"><span class="hud-bossbar__name"></span><span class="hud-bossbar__sub"></span></div>
        <div class="hud-bossbar__meter"><div class="hud-bossbar__fill"></div></div>
      </div>
      <div class="hud-panel">
        ${FRAME_SVG}
        <div class="hud-panel__inner">
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
                <span class="hud-stat__badge hud-stat__badge--heart">${HEART_ICON}</span>
                <span class="hud-stat__label">HP</span>
                <span class="hud-stat__value hud-stat__value--health">100%</span>
              </div>
              <div class="hud-meter"><div class="hud-meter__fill hud-meter__fill--health"></div></div>
            </div>
            <div class="hud-stat hud-stat--stamina">
              <div class="hud-stat__row">
                <span class="hud-stat__badge hud-stat__badge--boot">${BOOT_ICON}</span>
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
            <div class="hud-ability hud-ability--parry">
              <div class="hud-ability__sweep"></div>
              <div class="hud-ability__row">
                <span class="hud-ability__key">[RMB]</span>
                <span class="hud-ability__name">Parry</span>
              </div>
              <div class="hud-ability__state hud-ability__state--parry">RDY</div>
            </div>
            <div class="hud-ability hud-ability--flask">
              <div class="hud-ability__row">
                <span class="hud-ability__key">[R]</span>
                <span class="hud-ability__name">Flask</span>
              </div>
              <div class="hud-ability__state hud-ability__state--flask">3/3</div>
            </div>
            <button class="hud-ability hud-inventory-button" type="button">
              <div class="hud-ability__row">
                <span class="hud-ability__key">[I]</span>
                <span class="hud-ability__name">Gear / Quests</span>
              </div>
              <div class="hud-ability__state hud-ability__state--inventory">OPEN</div>
            </button>
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

    this.healthFill = this.element.querySelector('.hud-meter__fill--health') as HTMLDivElement;
    this.staminaFill = this.element.querySelector('.hud-meter__fill--stamina') as HTMLDivElement;
    this.corruptionFill = this.element.querySelector('.hud-meter__fill--corruption') as HTMLDivElement;
    this.virtueFill = this.element.querySelector('.hud-meter__fill--virtue') as HTMLDivElement;

    this.healthValue = this.element.querySelector('.hud-stat__value--health') as HTMLSpanElement;
    this.staminaValue = this.element.querySelector('.hud-stat__value--stamina') as HTMLSpanElement;
    this.corruptionValue = this.element.querySelector('.hud-stat__value--corruption') as HTMLSpanElement;
    this.virtueValue = this.element.querySelector('.hud-stat__value--virtue') as HTMLSpanElement;

    this.toastEl = this.element.querySelector('.hud-toast') as HTMLDivElement;
    this.interactEl = this.element.querySelector('.hud-interact') as HTMLDivElement;

    this.dashBadge = this.element.querySelector('.hud-ability--dash') as HTMLDivElement;
    this.dashSweep = this.dashBadge.querySelector('.hud-ability__sweep') as HTMLDivElement;
    this.dashName = this.dashBadge.querySelector('.hud-ability__name--dash') as HTMLSpanElement;
    this.dashState = this.dashBadge.querySelector('.hud-ability__state--dash') as HTMLSpanElement;

    this.burstBadge = this.element.querySelector('.hud-ability--burst') as HTMLDivElement;
    this.burstSweep = this.burstBadge.querySelector('.hud-ability__sweep') as HTMLDivElement;
    this.burstState = this.burstBadge.querySelector('.hud-ability__state--burst') as HTMLSpanElement;

    this.parryBadge = this.element.querySelector('.hud-ability--parry') as HTMLDivElement;
    this.parrySweep = this.parryBadge.querySelector('.hud-ability__sweep') as HTMLDivElement;
    this.parryState = this.parryBadge.querySelector('.hud-ability__state--parry') as HTMLSpanElement;

    this.flaskBadge = this.element.querySelector('.hud-ability--flask') as HTMLDivElement;
    this.flaskState = this.flaskBadge.querySelector('.hud-ability__state--flask') as HTMLSpanElement;

    this.bossBar = this.element.querySelector('.hud-bossbar') as HTMLDivElement;
    this.bossName = this.element.querySelector('.hud-bossbar__name') as HTMLSpanElement;
    this.bossSub = this.element.querySelector('.hud-bossbar__sub') as HTMLSpanElement;
    this.bossFill = this.element.querySelector('.hud-bossbar__fill') as HTMLDivElement;

    this.inventoryButton = this.element.querySelector('.hud-inventory-button') as HTMLButtonElement;
    this.inventoryButton.addEventListener('click', () => this.inventoryHandler?.());
  }

  /** Wire the sidebar [I] button to the engine's inventory toggle. */
  public setInventoryHandler(handler: () => void): void {
    this.inventoryHandler = handler;
  }

  /** Briefly flash the [I] button when a quest updates. */
  public flashInventoryButton(): void {
    this.inventoryButton.classList.add('is-flashing');
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.inventoryButton.classList.remove('is-flashing');
      this.flashTimer = null;
    }, FLASH_DURATION_MS);
  }

  /** Show/hide the full HUD (hidden on the Start Screen and Death Screen). */
  public setVisible(visible: boolean): void {
    this.element.hidden = !visible;
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

    // Parry plate: always unlocked, gated only by its cooldown.
    this.updateBadge(
      this.parryBadge,
      this.parrySweep,
      this.parryState,
      state.parryReady,
      state.parryCooldownFraction,
      state.parryCooldownSeconds
    );

    // Flask plate: shows remaining charges, dimmed when empty.
    const flaskEmpty = state.flaskCharges <= 0;
    this.flaskState.textContent = `${state.flaskCharges}/${state.flaskMax}`;
    this.flaskBadge.classList.toggle('is-empty', flaskEmpty);

    // Boss bar (top-center, Doom-styled monochrome).
    this.bossBar.hidden = !state.bossVisible;
    this.bossName.textContent = state.bossName;
    this.bossSub.textContent = state.bossSubtitle;
    this.setBar(this.bossFill, state.bossHpFraction);
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
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
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
