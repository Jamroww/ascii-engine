import deathQuotes from '../data/deathQuotes.json';

export interface DeathScreenCallbacks {
  onRetry(): void;
  onMainMenu(): void;
}

interface DeathQuote {
  text: string;
  author: string;
}

const QUOTES = deathQuotes as DeathQuote[];

const CSS = `
  .wf-death {
    position: absolute;
    inset: 0;
    z-index: 820;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    -webkit-font-smoothing: none;
    -moz-osx-font-smoothing: grayscale;
    background: radial-gradient(ellipse at 50% 42%, rgba(6,7,10,0.62), rgba(1,2,3,0.94));
    color: #e8e8e8;
    user-select: none;
    animation: wf-death-fade 0.9s ease both;
  }
  .wf-death[hidden] { display: none; }
  @keyframes wf-death-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .wf-death__frame {
    width: min(480px, calc(100vw - 32px));
    padding: 30px 30px 26px;
    text-align: center;
    background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='80' height='80' filter='url(%23n)' opacity='0.12'/%3E%3C/svg%3E"),
      repeating-conic-gradient(#0c0d10 0% 25%, #121318 0% 50%) 0 0 / 4px 4px;
    border: 3px solid;
    border-top-color: #5a5a5a;
    border-left-color: #5a5a5a;
    border-bottom-color: #0e0e0e;
    border-right-color: #0e0e0e;
    box-shadow: 6px 6px 0 #000, inset 2px 2px 0 #0e0e0e, inset -2px -2px 0 #2a2a2d;
    image-rendering: pixelated;
  }
  .wf-death__title {
    margin: 0 0 6px;
    font-size: 40px;
    font-weight: 700;
    letter-spacing: 8px;
    color: #ffffff;
    text-shadow: 2px 2px 0 #000;
  }
  .wf-death__subtitle {
    margin: 0 0 18px;
    min-height: 1.2em;
    font-size: 12px;
    letter-spacing: 1px;
    color: #b8a06a;
    text-shadow: 1px 1px 0 #000;
  }
  .wf-death__rule {
    height: 2px;
    margin: 0 0 16px;
    background: #0e0e0e;
    box-shadow: 0 1px 0 #3a3a3d;
  }
  .wf-death__quote {
    margin: 0 0 4px;
    font-size: 13px;
    line-height: 1.55;
    color: #cfcfcf;
    white-space: pre-line;
    text-shadow: 1px 1px 0 #000;
  }
  .wf-death__author {
    margin: 0 0 22px;
    font-size: 11px;
    letter-spacing: 1px;
    color: #9a9a9a;
  }
  .wf-death__actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .wf-death__action {
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
  .wf-death__action:hover {
    background: rgba(40, 40, 46, 0.95);
    border-top-color: #7a7a7a;
    border-left-color: #7a7a7a;
  }
  .wf-death__action--primary {
    border-top-color: #4a6b3a;
    border-left-color: #4a6b3a;
    background: rgba(14, 26, 14, 0.85);
  }
`;

let styleInjected = false;

/** Solemn dark "YOU FELL" overlay shown when the player dies. */
export class DeathScreen {
  public readonly element: HTMLDivElement;

  private readonly subtitleEl: HTMLDivElement;
  private readonly quoteEl: HTMLDivElement;
  private readonly authorEl: HTMLDivElement;
  private readonly callbacks: DeathScreenCallbacks;
  private lastQuoteIndex = -1;

  constructor(container: HTMLElement, callbacks: DeathScreenCallbacks) {
    this.callbacks = callbacks;

    if (!styleInjected) {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      styleInjected = true;
    }

    this.element = document.createElement('div');
    this.element.className = 'wf-death';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="wf-death__frame">
        <h1 class="wf-death__title">YOU FELL</h1>
        <div class="wf-death__subtitle"></div>
        <div class="wf-death__rule"></div>
        <p class="wf-death__quote"></p>
        <p class="wf-death__author"></p>
        <div class="wf-death__actions">
          <button class="wf-death__action wf-death__action--primary" data-action="retry" type="button">[ Retry Attempt ]</button>
          <button class="wf-death__action" data-action="menu" type="button">[ Main Menu ]</button>
        </div>
      </div>
    `;
    container.appendChild(this.element);

    this.subtitleEl = this.element.querySelector('.wf-death__subtitle') as HTMLDivElement;
    this.quoteEl = this.element.querySelector('.wf-death__quote') as HTMLDivElement;
    this.authorEl = this.element.querySelector('.wf-death__author') as HTMLDivElement;

    this.element.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest('[data-action]') as HTMLElement | null;
      if (action?.dataset.action === 'retry') this.callbacks.onRetry();
      else if (action?.dataset.action === 'menu') this.callbacks.onMainMenu();
    });
  }

  public show(subtitle?: string): void {
    this.subtitleEl.textContent = subtitle ?? '';
    this.subtitleEl.style.visibility = subtitle ? 'visible' : 'hidden';

    const quote = this.pickQuote();
    this.quoteEl.textContent = quote.text;
    this.authorEl.textContent = quote.author ? `— ${quote.author}` : '';
    this.authorEl.style.display = quote.author ? '' : 'none';

    this.element.hidden = false;
  }

  public hide(): void {
    this.element.hidden = true;
  }

  public dispose(): void {
    this.element.remove();
  }

  /** Draw a random quote, never repeating the previous one back-to-back. */
  private pickQuote(): DeathQuote {
    if (QUOTES.length === 0) return { text: '', author: '' };
    let index = this.lastQuoteIndex;
    if (QUOTES.length > 1) {
      while (index === this.lastQuoteIndex) {
        index = Math.floor(Math.random() * QUOTES.length);
      }
    } else {
      index = 0;
    }
    this.lastQuoteIndex = index;
    return QUOTES[index];
  }
}
