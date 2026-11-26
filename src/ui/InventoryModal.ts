import type { InventorySystem } from '../core/InventorySystem';
import type { ProgressionSystem, QuestStage } from '../core/ProgressionSystem';
import type { PaletteChannel, PaletteConfig } from '../core/LevelTheme';
import { getItem } from '../data/items';
import type { EquippableItem } from '../data/items';

interface QuestStep {
  label: string;
  done: boolean;
}

interface QuestView {
  name: string;
  state: 'active' | 'completed';
  steps: QuestStep[];
  note: string;
}

function buildTaintedCatch(stage: QuestStage): QuestView {
  const steps: QuestStep[] = [
    { label: 'Fight through the harbor alleyway.', done: stage !== 'alley_ambush' },
    { label: 'Speak with the survivors in the clearing.', done: stage === 'assault_castle' || stage === 'completed' },
    { label: 'Defeat the Castle Warden.', done: stage === 'completed' },
  ];
  return {
    name: 'Act 1 — Harbor to Castle',
    state: stage === 'completed' ? 'completed' : 'active',
    steps,
    note: '',
  };
}

function alignmentNote(corruption: number, virtue: number): string {
  if (corruption > virtue) return `Corrupt — ${corruption} CR / ${virtue} VR`;
  if (virtue > corruption) return `Virtuous — ${corruption} CR / ${virtue} VR`;
  return `Balanced — ${corruption} CR / ${virtue} VR`;
}

function formatPercent(fraction: number): string {
  const sign = fraction >= 0 ? '+' : '';
  return `${sign}${Math.round(fraction * 100)}%`;
}

function formatSpeed(multiplier: number): string {
  return formatPercent(multiplier - 1);
}

/** Live read/write hooks the modal uses to toggle camera lean on the Engine. */
export interface CameraLeanControls {
  getCameraLeanEnabled: () => boolean;
  setCameraLeanEnabled: (enabled: boolean) => void;
}

/** Level selection + palette hooks wired by the Engine. */
export interface SettingsControls {
  getActiveLevelId: () => 'act1_harbor' | 'act2_wheatfield';
  loadLevel: (id: 'act1_harbor' | 'act2_wheatfield') => void;
  getPalette: () => PaletteConfig;
  setPaletteChannel: (channel: PaletteChannel, hex: string) => void;
  resetPalette: () => void;
}

// --- HSV colour helpers ------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

type ChannelDef = { key: PaletteChannel; label: string };

/** Surface / void colours, cleanly separated from the light channels. */
const ENVIRONMENT_CHANNELS: ChannelDef[] = [
  { key: 'foliageBase', label: 'Foliage Base' },
  { key: 'foliageTip', label: 'Foliage Tip' },
  { key: 'groundColor', label: 'Ground' },
  { key: 'waterColor', label: 'Water' },
  { key: 'structureColor', label: 'Structures' },
  { key: 'asciiVoidColor', label: 'ASCII Void' },
];

/** Emissive / atmospheric light channels. */
const LIGHTING_CHANNELS: ChannelDef[] = [
  { key: 'sunColor', label: 'Sun / Moon' },
  { key: 'skyFillColor', label: 'Sky Fill' },
  { key: 'bloomTint', label: 'Bloom Tint' },
];

/**
 * Paused Gear & Quests overlay, toggled with I / Tab / Esc and closed with Esc.
 * The Settings tab adds a Level Selector, the camera-lean toggle, and a live HSV
 * colour wheel / palette studio that edits the active level's theme in real time.
 */
export class InventoryModal {
  public readonly element: HTMLDivElement;

  private readonly inventory: InventorySystem;
  private readonly progression: ProgressionSystem;
  private readonly cameraLean: CameraLeanControls;
  private readonly settings: SettingsControls;
  private readonly bodyEl: HTMLDivElement;
  private readonly gearTabEl: HTMLButtonElement;
  private readonly questTabEl: HTMLButtonElement;
  private readonly settingsTabEl: HTMLButtonElement;

  private active = false;
  private tab: 'gear' | 'quests' | 'settings' = 'gear';

  // Palette studio state (re-initialised on each channel switch).
  private paletteChannel: PaletteChannel = 'foliageBase';
  private paletteH = 0;
  private paletteS = 0;
  private paletteV = 1;

  constructor(
    container: HTMLElement,
    inventory: InventorySystem,
    progression: ProgressionSystem,
    cameraLean: CameraLeanControls,
    settings: SettingsControls,
  ) {
    this.inventory = inventory;
    this.progression = progression;
    this.cameraLean = cameraLean;
    this.settings = settings;

    this.element = document.createElement('div');
    this.element.className = 'inventory-modal';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="inventory-modal__frame">
        <div class="inventory-modal__header">
          <span class="inventory-modal__title">GEAR &amp; QUESTS</span>
          <span class="inventory-modal__hint">[Esc] Close</span>
        </div>
        <div class="inventory-modal__tabs">
          <button class="inventory-modal__tab" data-tab="gear">Gear &amp; Bag</button>
          <button class="inventory-modal__tab" data-tab="quests">Quests</button>
          <button class="inventory-modal__tab" data-tab="settings">Settings</button>
        </div>
        <div class="inventory-modal__body"></div>
      </div>
    `;
    container.appendChild(this.element);

    this.bodyEl = this.element.querySelector('.inventory-modal__body') as HTMLDivElement;
    this.gearTabEl = this.element.querySelector('[data-tab="gear"]') as HTMLButtonElement;
    this.questTabEl = this.element.querySelector('[data-tab="quests"]') as HTMLButtonElement;
    this.settingsTabEl = this.element.querySelector('[data-tab="settings"]') as HTMLButtonElement;

    this.element.querySelector('.inventory-modal__tabs')?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const tab = target.closest('[data-tab]') as HTMLElement | null;
      if (!tab) return;
      if (tab.dataset.tab === 'quests') this.tab = 'quests';
      else if (tab.dataset.tab === 'settings') this.tab = 'settings';
      else this.tab = 'gear';
      this.render();
    });

    this.bodyEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      const toggle = target.closest('[data-toggle-camera-lean]') as HTMLElement | null;
      if (toggle) {
        this.cameraLean.setCameraLeanEnabled(!this.cameraLean.getCameraLeanEnabled());
        this.render();
        return;
      }

      const levelBtn = target.closest('[data-level]') as HTMLElement | null;
      if (levelBtn) {
        const id = levelBtn.dataset.level as 'act1_harbor' | 'act2_wheatfield';
        this.settings.loadLevel(id);
        return;
      }

      const channel = target.closest('[data-channel]') as HTMLElement | null;
      if (channel && channel.dataset.channel) {
        this.paletteChannel = channel.dataset.channel as PaletteChannel;
        this.render();
        return;
      }

      const reset = target.closest('[data-reset-palette]') as HTMLElement | null;
      if (reset) {
        this.settings.resetPalette();
        this.render();
        return;
      }

      const copy = target.closest('[data-copy-palette]') as HTMLElement | null;
      if (copy) {
        this.copyPalette(copy as HTMLElement);
        return;
      }

      const item = target.closest('[data-equip]') as HTMLElement | null;
      if (!item || !item.dataset.equip) return;
      this.inventory.equip(item.dataset.equip);
      this.render();
    });
  }

  get isOpen(): boolean {
    return this.active;
  }

  open(): void {
    this.active = true;
    this.tab = 'gear';
    this.element.hidden = false;
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
    this.gearTabEl.classList.toggle('is-active', this.tab === 'gear');
    this.questTabEl.classList.toggle('is-active', this.tab === 'quests');
    this.settingsTabEl.classList.toggle('is-active', this.tab === 'settings');
    if (this.tab === 'gear') {
      this.bodyEl.innerHTML = this.renderGear();
    } else if (this.tab === 'quests') {
      this.bodyEl.innerHTML = this.renderQuests();
    } else {
      this.bodyEl.innerHTML = this.renderSettings();
      this.bindSettingsInteractions();
    }
  }

  private renderGear(): string {
    const stats = this.inventory.getCombatStats();
    const weapon = this.inventory.equippedWeapon;
    const armor = this.inventory.equippedArmor;
    const bag = this.inventory.bag
      .map((id) => getItem(id))
      .filter((item): item is EquippableItem => item !== undefined);

    const bagHtml =
      bag.length > 0
        ? bag
            .map(
              (item) =>
                `<button class="inventory-modal__item" data-equip="${item.id}">
                  <span class="inventory-modal__item-name">${item.name}</span>
                  <span class="inventory-modal__item-desc">${item.description}</span>
                </button>`
            )
            .join('')
        : '<div class="inventory-modal__empty">Bag is empty.</div>';

    return `
      <div class="inventory-modal__stats">
        <div class="inventory-modal__stat"><span class="inventory-modal__stat-k">DMG</span><span class="inventory-modal__stat-v">${stats.swordDamage}</span></div>
        <div class="inventory-modal__stat"><span class="inventory-modal__stat-k">DEF</span><span class="inventory-modal__stat-v">${formatPercent(stats.damageReduction)}</span></div>
        <div class="inventory-modal__stat"><span class="inventory-modal__stat-k">MAX HP</span><span class="inventory-modal__stat-v">${100 + stats.bonusMaxHp}</span></div>
        <div class="inventory-modal__stat"><span class="inventory-modal__stat-k">MAX ST</span><span class="inventory-modal__stat-v">${200 + stats.bonusMaxStamina}</span></div>
        <div class="inventory-modal__stat"><span class="inventory-modal__stat-k">SPD</span><span class="inventory-modal__stat-v">${formatSpeed(stats.speedMultiplier)}</span></div>
      </div>

      <div class="inventory-modal__slot">
        <div class="inventory-modal__slot-label">WEAPON</div>
        <div class="inventory-modal__slot-card">
          <span class="inventory-modal__slot-name">${weapon.name}</span>
          <span class="inventory-modal__slot-desc">${weapon.description}</span>
        </div>
      </div>

      <div class="inventory-modal__slot">
        <div class="inventory-modal__slot-label">ARMOR</div>
        <div class="inventory-modal__slot-card">
          <span class="inventory-modal__slot-name">${armor.name}</span>
          <span class="inventory-modal__slot-desc">${armor.description}</span>
        </div>
      </div>

      <div class="inventory-modal__bag">
        <div class="inventory-modal__slot-label">BAG — click to equip</div>
        ${bagHtml}
      </div>
    `;
  }

  private renderQuests(): string {
    const quest = buildTaintedCatch(this.progression.questStage);
    quest.note = alignmentNote(this.progression.corruption, this.progression.virtue);

    const stepsHtml = quest.steps
      .map(
        (step) =>
          `<li class="inventory-modal__step ${step.done ? 'is-done' : 'is-pending'}">${step.label}</li>`
      )
      .join('');

    return `
      <div class="inventory-modal__quest">
        <div class="inventory-modal__quest-name">
          ${quest.name}
          <span class="inventory-modal__quest-state">${quest.state === 'completed' ? 'COMPLETE' : 'ACTIVE'}</span>
        </div>
        <div class="inventory-modal__quest-note">${quest.note}</div>
        <ul class="inventory-modal__steps">${stepsHtml}</ul>
      </div>
    `;
  }

  private renderSettings(): string {
    const enabled = this.cameraLean.getCameraLeanEnabled();
    const state = enabled ? 'ON' : 'OFF';
    const activeLevel = this.settings.getActiveLevelId();

    const channelsHtml = this.renderChannelGroup('Environment', ENVIRONMENT_CHANNELS) +
      this.renderChannelGroup('Lighting', LIGHTING_CHANNELS);

    return `
      <div class="inventory-modal__settings">
        <div class="inventory-modal__slot-label">SETTINGS</div>

        <div class="inventory-modal__slot-label">LEVEL</div>
        <div class="inventory-modal__level-row">
          <button class="inventory-modal__level ${activeLevel === 'act1_harbor' ? 'is-active' : ''}" data-level="act1_harbor">[1] Harbor Village (Night)</button>
          <button class="inventory-modal__level ${activeLevel === 'act2_wheatfield' ? 'is-active' : ''}" data-level="act2_wheatfield">[2] Sunset Wheatfield (The Ronin)</button>
        </div>

        <div class="inventory-modal__slot-label">CAMERA</div>
        <button class="inventory-modal__toggle" data-toggle-camera-lean type="button">
          <span class="inventory-modal__toggle-label">Camera Lean (A/D)</span>
          <span class="inventory-modal__toggle-state ${enabled ? 'is-on' : 'is-off'}">${state}</span>
        </button>

        <div class="inventory-modal__slot-label">PALETTE STUDIO</div>
        <div class="inventory-modal__palette">
          ${channelsHtml}
          <div class="inventory-modal__wheel-row">
            <canvas class="inventory-modal__wheel" width="140" height="140"></canvas>
            <div class="inventory-modal__value-col">
              <span class="inventory-modal__value-label">VALUE</span>
              <input class="inventory-modal__value" type="range" min="0" max="1" step="0.01" />
            </div>
          </div>
          <div class="inventory-modal__hex-row">
            <span class="inventory-modal__hex-label">HEX</span>
            <input class="inventory-modal__hex" type="text" maxlength="7" spellcheck="false" />
          </div>
          <div class="inventory-modal__palette-actions">
            <button class="inventory-modal__action" data-reset-palette type="button">Reset Defaults</button>
            <button class="inventory-modal__action" data-copy-palette type="button">Copy Palette</button>
          </div>
        </div>
      </div>
    `;
  }

  /** Render a labelled group of palette channel pills. */
  private renderChannelGroup(label: string, channels: ChannelDef[]): string {
    const pills = channels
      .map(
        (c) =>
          `<button class="inventory-modal__channel ${c.key === this.paletteChannel ? 'is-active' : ''}" data-channel="${c.key}">${c.label}</button>`
      )
      .join('');
    return `
      <div class="inventory-modal__channel-group">
        <div class="inventory-modal__channel-group-label">${label}</div>
        <div class="inventory-modal__channels">${pills}</div>
      </div>
    `;
  }

  /** Wire the wheel / slider / hex input after the settings body is rendered. */
  private bindSettingsInteractions(): void {
    const canvas = this.bodyEl.querySelector('.inventory-modal__wheel') as HTMLCanvasElement | null;
    const slider = this.bodyEl.querySelector('.inventory-modal__value') as HTMLInputElement | null;
    const hexInput = this.bodyEl.querySelector('.inventory-modal__hex') as HTMLInputElement | null;
    if (!canvas || !slider || !hexInput) return;

    const current = this.settings.getPalette()[this.paletteChannel];
    const currentRgb = hexToRgb(current);
    const { h, s, v } = rgbToHsv(currentRgb.r, currentRgb.g, currentRgb.b);
    this.paletteH = h;
    this.paletteS = s;
    this.paletteV = v;
    slider.value = String(v);
    hexInput.value = current;

    this.drawWheel(canvas);

    let dragging = false;
    const apply = (hue: number, sat: number): void => {
      const { r, g, b } = hsvToRgb(hue, sat, this.paletteV);
      const hex = rgbToHex(r, g, b);
      this.paletteH = hue;
      this.paletteS = sat;
      this.settings.setPaletteChannel(this.paletteChannel, hex);
      hexInput.value = hex;
      this.drawWheel(canvas);
    };

    const updateFromPointer = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const radius = rect.width / 2;
      const dx = e.clientX - (rect.left + radius);
      const dy = e.clientY - (rect.top + radius);
      const sat = clamp(Math.hypot(dx, dy) / radius, 0, 1);
      const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      apply(hue, sat);
    };

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      updateFromPointer(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) updateFromPointer(e);
    });
    canvas.addEventListener('pointerup', () => {
      dragging = false;
    });

    slider.addEventListener('input', () => {
      this.paletteV = parseFloat(slider.value);
      apply(this.paletteH, this.paletteS);
    });

    hexInput.addEventListener('change', () => {
      const value = hexInput.value.trim();
      if (!/^#?[0-9a-fA-F]{6}$/.test(value)) {
        const fallback = hsvToRgb(this.paletteH, this.paletteS, this.paletteV);
        hexInput.value = rgbToHex(fallback.r, fallback.g, fallback.b);
        return;
      }
      const hex = value.startsWith('#') ? value : `#${value}`;
      const { r, g, b } = hexToRgb(hex);
      const hsv = rgbToHsv(r, g, b);
      this.paletteH = hsv.h;
      this.paletteS = hsv.s;
      this.paletteV = hsv.v;
      slider.value = String(hsv.v);
      this.settings.setPaletteChannel(this.paletteChannel, hex.toLowerCase());
      hexInput.value = hex.toLowerCase();
      this.drawWheel(canvas);
    });
  }

  private drawWheel(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width;
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const center = size / 2;
    const radius = center - 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const dist = Math.hypot(dx, dy);
        const idx = (y * size + x) * 4;
        if (dist > radius) {
          data[idx + 3] = 0;
          continue;
        }
        const sat = dist / radius;
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const { r, g, b } = hsvToRgb(hue, sat, this.paletteV);
        data[idx] = Math.round(r);
        data[idx + 1] = Math.round(g);
        data[idx + 2] = Math.round(b);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);

    const cx = center + Math.cos((this.paletteH * Math.PI) / 180) * this.paletteS * radius;
    const cy = center + Math.sin((this.paletteH * Math.PI) / 180) * this.paletteS * radius;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy);
    ctx.lineTo(cx + 6, cy);
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx, cy + 6);
    ctx.stroke();
  }

  private copyPalette(button: HTMLElement): void {
    const json = JSON.stringify(this.settings.getPalette(), null, 2);
    const done = (): void => {
      const original = button.textContent ?? 'Copy Palette';
      button.textContent = 'Copied!';
      window.setTimeout(() => {
        button.textContent = original;
      }, 900);
    };
    try {
      void navigator.clipboard.writeText(json).then(done, done);
    } catch {
      done();
    }
  }
}
