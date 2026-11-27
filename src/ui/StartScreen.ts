export interface StartScreenLevel {
  id: string;
  label: string;
  subtitle: string;
}

export interface StartScreenCallbacks {
  onSelectLevel(id: string): void;
  onOpenOptions(): void;
  onOpenAssets(): void;
  getCustomLevels(): Array<{ id: string; name: string }>;
}

const CSS = `
  .wf-start {
    position: absolute;
    inset: 0;
    z-index: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    -webkit-font-smoothing: none;
    -moz-osx-font-smoothing: grayscale;
    background: radial-gradient(ellipse at 50% 40%, rgba(8,10,16,0.55), rgba(2,3,5,0.88));
    color: #e8e8e8;
    user-select: none;
  }
  .wf-start[hidden] { display: none; }
  .wf-start__frame {
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    scrollbar-width: none;
    padding: 26px 26px 22px;
    background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='80' height='80' filter='url(%23n)' opacity='0.12'/%3E%3C/svg%3E"),
      repeating-conic-gradient(#101114 0% 25%, #17181c 0% 50%) 0 0 / 4px 4px;
    border: 3px solid;
    border-top-color: #7a7a7a;
    border-left-color: #7a7a7a;
    border-bottom-color: #0e0e0e;
    border-right-color: #0e0e0e;
    box-shadow: 6px 6px 0 #000, inset 2px 2px 0 #0e0e0e, inset -2px -2px 0 #3a3a3d;
    image-rendering: pixelated;
  }
  .wf-start__frame::-webkit-scrollbar { display: none; }
  .wf-start__title {
    margin: 0 0 6px;
    text-align: center;
    font-size: 34px;
    font-weight: 700;
    letter-spacing: 6px;
    color: #ffffff;
    text-shadow: 2px 2px 0 #000, 0 0 18px rgba(160, 200, 255, 0.25);
  }
  .wf-start__subtitle {
    margin: 0 0 22px;
    text-align: center;
    font-size: 11px;
    letter-spacing: 2px;
    color: #9a9a9a;
    text-transform: uppercase;
  }
  .wf-start__label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2px;
    color: #cfcfcf;
    margin: 14px 0 8px;
  }
  .wf-start__levels {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .wf-start__level {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 11px 13px;
    font: inherit;
    text-align: left;
    color: #e8e8e8;
    background: rgba(20, 20, 24, 0.85);
    border: 2px solid;
    border-top-color: #5a5a5a;
    border-left-color: #5a5a5a;
    border-bottom-color: #0e0e0e;
    border-right-color: #0e0e0e;
    cursor: pointer;
  }
  .wf-start__level:hover {
    background: rgba(40, 40, 46, 0.95);
    border-top-color: #7a7a7a;
    border-left-color: #7a7a7a;
  }
  .wf-start__level-label {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #ffffff;
  }
  .wf-start__level-subtitle {
    font-size: 10px;
    letter-spacing: 0.5px;
    color: #9a9a9a;
  }
  .wf-start__empty {
    font-size: 11px;
    color: #6a6a6a;
    padding: 8px 2px;
  }
  .wf-start__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 18px;
  }
  .wf-start__action {
    width: 100%;
    padding: 11px 13px;
    font: inherit;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #e8e8e8;
    background: rgba(20, 20, 24, 0.85);
    border: 2px solid;
    border-top-color: #5a5a5a;
    border-left-color: #5a5a5a;
    border-bottom-color: #0e0e0e;
    border-right-color: #0e0e0e;
    cursor: pointer;
  }
  .wf-start__action:hover {
    background: rgba(40, 40, 46, 0.95);
    border-top-color: #7a7a7a;
    border-left-color: #7a7a7a;
  }
`;

let styleInjected = false;

/** Title screen overlaying the live, slowly-breathing 3D ASCII backdrop. */
export class StartScreen {
  public readonly element: HTMLDivElement;

  private readonly levelsEl: HTMLDivElement;
  private readonly callbacks: StartScreenCallbacks;

  constructor(container: HTMLElement, callbacks: StartScreenCallbacks) {
    this.callbacks = callbacks;

    if (!styleInjected) {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      styleInjected = true;
    }

    this.element = document.createElement('div');
    this.element.className = 'wf-start';
    this.element.innerHTML = `
      <div class="wf-start__frame">
        <h1 class="wf-start__title">WILTED FLOWER</h1>
        <p class="wf-start__subtitle">a playable ascii engine</p>
        <div class="wf-start__label">LEVEL SELECT</div>
        <div class="wf-start__levels"></div>
        <div class="wf-start__actions">
          <button class="wf-start__action" data-action="options" type="button">Options</button>
          <button class="wf-start__action" data-action="assets" type="button">Asset Studio &amp; Level Loader</button>
        </div>
      </div>
    `;
    container.appendChild(this.element);

    this.levelsEl = this.element.querySelector('.wf-start__levels') as HTMLDivElement;

    this.element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const levelBtn = target.closest('[data-level]') as HTMLElement | null;
      if (levelBtn?.dataset.level) {
        this.callbacks.onSelectLevel(levelBtn.dataset.level);
        return;
      }
      const action = target.closest('[data-action]') as HTMLElement | null;
      if (action?.dataset.action === 'options') this.callbacks.onOpenOptions();
      else if (action?.dataset.action === 'assets') this.callbacks.onOpenAssets();
    });

    this.refreshLevels();
  }

  /** Rebuild the level list (built-in + any custom levels via the Loader). */
  public refreshLevels(): void {
    const builtIn: StartScreenLevel[] = [
      { id: 'act1_harbor', label: '[1] Harbor Village', subtitle: 'Act 1 — Night Harbor & Castle' },
      { id: 'act2_wheatfield', label: '[2] Sunset Wheatfield', subtitle: 'Showcase Duel — The Ronin' },
    ];
    const custom: StartScreenLevel[] = this.callbacks.getCustomLevels().map((lvl) => ({
      id: lvl.id,
      label: lvl.name,
      subtitle: 'Custom Level',
    }));

    const levels = [...builtIn, ...custom];
    if (levels.length === 0) {
      this.levelsEl.innerHTML = '<div class="wf-start__empty">No levels available.</div>';
      return;
    }

    this.levelsEl.innerHTML = levels
      .map(
        (level) => `
          <button class="wf-start__level" data-level="${level.id}" type="button">
            <span class="wf-start__level-label">${level.label}</span>
            <span class="wf-start__level-subtitle">${level.subtitle}</span>
          </button>`
      )
      .join('');
  }

  public show(): void {
    this.element.hidden = false;
    this.refreshLevels();
  }

  public hide(): void {
    this.element.hidden = true;
  }

  public dispose(): void {
    this.element.remove();
  }
}
