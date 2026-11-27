import type { InventorySystem } from '../core/InventorySystem';
import type { ProgressionSystem, QuestStage } from '../core/ProgressionSystem';
import type { PaletteChannel, PaletteConfig } from '../core/LevelTheme';
import { getItem } from '../data/items';
import type { EquippableItem } from '../data/items';
import type { CustomPngAsset, CustomPngKind, CustomPngStyle } from '../data/levelTypes';

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
  getActiveLevelId: () => string;
  loadLevel: (id: string) => void;
  getPalette: () => PaletteConfig;
  setPaletteChannel: (channel: PaletteChannel, hex: string) => void;
  resetPalette: () => void;
}

/** Playtest stat tuning values (persisted by the Engine). */
export interface PlaytestTuning {
  maxHealth: number;
  maxStamina: number;
  healthRegen: number;
  staminaRegen: number;
}

/** A selectable custom level shown in the Level Select / Settings lists. */
export interface CustomLevelListItem {
  id: string;
  name: string;
}

/** Engine-backed services the modal uses for playtest tuning, assets & levels. */
export interface ModalServices {
  getTuning(): PlaytestTuning;
  setMaxHealth(v: number): void;
  setMaxStamina(v: number): void;
  setHealthRegen(v: number): void;
  setStaminaRegen(v: number): void;
  resetStats(): void;
  getCustomAssets(): CustomPngAsset[];
  registerPng(asset: CustomPngAsset): void;
  deletePng(id: string): void;
  exportLevel(): void;
  loadLevelFromJson(json: string): { ok: boolean; error?: string; id?: string };
  getCustomLevels(): CustomLevelListItem[];
  playCustomLevel(id: string): void;
  returnToTitle(): void;
}

type Tab = 'gear' | 'quests' | 'settings' | 'assets';

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
  private readonly services: ModalServices;
  private readonly bodyEl: HTMLDivElement;
  private readonly gearTabEl: HTMLButtonElement;
  private readonly questTabEl: HTMLButtonElement;
  private readonly settingsTabEl: HTMLButtonElement;
  private readonly assetsTabEl: HTMLButtonElement;

  private active = false;
  private tab: Tab = 'gear';

  // Pending PNG import form state (Populated when a file is picked).
  private pendingDataUrl = '';
  private pendingAspectRatio = 1;
  private pendingId = '';

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
    services: ModalServices,
  ) {
    this.inventory = inventory;
    this.progression = progression;
    this.cameraLean = cameraLean;
    this.settings = settings;
    this.services = services;

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
          <button class="inventory-modal__tab" data-tab="assets">Assets &amp; Levels</button>
        </div>
        <div class="inventory-modal__body"></div>
      </div>
    `;
    container.appendChild(this.element);

    this.bodyEl = this.element.querySelector('.inventory-modal__body') as HTMLDivElement;
    this.gearTabEl = this.element.querySelector('[data-tab="gear"]') as HTMLButtonElement;
    this.questTabEl = this.element.querySelector('[data-tab="quests"]') as HTMLButtonElement;
    this.settingsTabEl = this.element.querySelector('[data-tab="settings"]') as HTMLButtonElement;
    this.assetsTabEl = this.element.querySelector('[data-tab="assets"]') as HTMLButtonElement;

    this.element.querySelector('.inventory-modal__tabs')?.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const tab = target.closest('[data-tab]') as HTMLElement | null;
      if (!tab) return;
      if (tab.dataset.tab === 'quests') this.tab = 'quests';
      else if (tab.dataset.tab === 'settings') this.tab = 'settings';
      else if (tab.dataset.tab === 'assets') this.tab = 'assets';
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
      if (levelBtn?.dataset.level) {
        this.settings.loadLevel(levelBtn.dataset.level);
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

      const returnTitle = target.closest('[data-return-to-title]') as HTMLElement | null;
      if (returnTitle) {
        this.services.returnToTitle();
        return;
      }

      const resetStats = target.closest('[data-reset-stats]') as HTMLElement | null;
      if (resetStats) {
        this.services.resetStats();
        this.render();
        return;
      }

      const addPng = target.closest('[data-add-png]') as HTMLElement | null;
      if (addPng) {
        this.submitPngImport();
        return;
      }

      const deletePng = target.closest('[data-delete-png]') as HTMLElement | null;
      if (deletePng?.dataset.deletePng) {
        this.services.deletePng(deletePng.dataset.deletePng);
        this.render();
        return;
      }

      const exportLevel = target.closest('[data-export-level]') as HTMLElement | null;
      if (exportLevel) {
        this.services.exportLevel();
        return;
      }

      const playCustom = target.closest('[data-play-custom]') as HTMLElement | null;
      if (playCustom?.dataset.playCustom) {
        this.services.playCustomLevel(playCustom.dataset.playCustom);
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
    this.openTo('gear');
  }

  /** Open directly to a specific tab (used by the Start Screen buttons). */
  openTo(tab: Tab): void {
    this.active = true;
    this.tab = tab;
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
    this.assetsTabEl.classList.toggle('is-active', this.tab === 'assets');
    if (this.tab === 'gear') {
      this.bodyEl.innerHTML = this.renderGear();
    } else if (this.tab === 'quests') {
      this.bodyEl.innerHTML = this.renderQuests();
    } else if (this.tab === 'settings') {
      this.bodyEl.innerHTML = this.renderSettings();
      this.bindSettingsInteractions();
    } else {
      this.bodyEl.innerHTML = this.renderAssets();
      this.bindAssetsInteractions();
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
    const tuning = this.services.getTuning();

    const customLevels = this.services
      .getCustomLevels()
      .map(
        (lvl) =>
          `<button class="inventory-modal__level ${activeLevel === lvl.id ? 'is-active' : ''}" data-level="${lvl.id}">${lvl.name}</button>`
      )
      .join('');

    const channelsHtml =
      this.renderChannelGroup('Environment', ENVIRONMENT_CHANNELS) +
      this.renderChannelGroup('Lighting', LIGHTING_CHANNELS);

    const sliders = [
      this.renderStatSlider('maxHealth', 'Max Health', tuning.maxHealth, 50, 500, 10, ''),
      this.renderStatSlider('maxStamina', 'Max Stamina', tuning.maxStamina, 50, 500, 10, ''),
      this.renderStatSlider('healthRegen', 'Health Regen', tuning.healthRegen, 0, 25, 0.5, ' HP/s'),
      this.renderStatSlider('staminaRegen', 'Stamina Regen', tuning.staminaRegen, 5, 120, 5, ' ST/s'),
    ].join('');

    return `
      <div class="inventory-modal__settings">
        <div class="inventory-modal__slot-label">SETTINGS</div>

        <div class="inventory-modal__slot-label">LEVEL</div>
        <div class="inventory-modal__level-row">
          <button class="inventory-modal__level ${activeLevel === 'act1_harbor' ? 'is-active' : ''}" data-level="act1_harbor">[1] Harbor Village (Night)</button>
          <button class="inventory-modal__level ${activeLevel === 'act2_wheatfield' ? 'is-active' : ''}" data-level="act2_wheatfield">[2] Sunset Wheatfield (The Ronin)</button>
          ${customLevels}
        </div>

        <div class="inventory-modal__slot-label">CAMERA</div>
        <button class="inventory-modal__toggle" data-toggle-camera-lean type="button">
          <span class="inventory-modal__toggle-label">Camera Lean (A/D)</span>
          <span class="inventory-modal__toggle-state ${enabled ? 'is-on' : 'is-off'}">${state}</span>
        </button>

        <div class="inventory-modal__slot-label">PLAYTEST TUNING</div>
        <div class="inventory-modal__stat-sliders">
          ${sliders}
          <button class="inventory-modal__action" data-reset-stats type="button">Reset Stats</button>
        </div>

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

        <button class="inventory-modal__action" data-return-to-title type="button">[ Return to Title Screen ]</button>
      </div>
    `;
  }

  /** Render one playtest tuning slider row with a live numeric readout. */
  private renderStatSlider(
    key: string,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    unit: string,
  ): string {
    return `
      <div class="inventory-modal__stat-slider">
        <div class="inventory-modal__stat-slider-head">
          <span class="inventory-modal__stat-slider-label">${label}</span>
          <span class="inventory-modal__stat-slider-value" data-readout="${key}">${value}${unit}</span>
        </div>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-stat="${key}" />
      </div>
    `;
  }

  /** Render the Assets & Levels tab (PNG importer + level loader/exporter). */
  private renderAssets(): string {
    const assets = this.services.getCustomAssets();
    const assetRows =
      assets.length === 0
        ? '<div class="inventory-modal__empty">No custom PNG assets yet.</div>'
        : assets
            .map(
              (a) => `
                <div class="inventory-modal__custom-asset">
                  <img class="inventory-modal__custom-thumb" src="${a.dataUrl}" alt="${a.id}" />
                  <div class="inventory-modal__custom-meta">
                    <span class="inventory-modal__custom-id">${a.id}</span>
                    <span class="inventory-modal__custom-detail">${a.kind} · ${a.height}u · r${a.radius} · ${a.style}</span>
                  </div>
                  <button class="inventory-modal__action inventory-modal__action--danger" data-delete-png="${a.id}" type="button">Delete</button>
                </div>`
            )
            .join('');

    const customLevels = this.services
      .getCustomLevels()
      .map(
        (lvl) =>
          `<button class="inventory-modal__level" data-play-custom="${lvl.id}" type="button">${lvl.name}</button>`
      )
      .join('');

    return `
      <div class="inventory-modal__assets">
        <div class="inventory-modal__slot-label">PNG-TO-ASSET LIBRARY IMPORTER</div>
        <div class="inventory-modal__importer">
          <div class="inventory-modal__file-row">
            <label class="inventory-modal__file-label">
              <input type="file" accept="image/png,image/webp,image/jpeg" data-png-file />
              <span>Choose image…</span>
            </label>
            <img class="inventory-modal__file-thumb" data-png-thumb alt="preview" />
          </div>
          <div class="inventory-modal__field-row">
            <span class="inventory-modal__field-label">Asset ID</span>
            <input class="inventory-modal__hex" type="text" data-png-id spellcheck="false" />
          </div>
          <div class="inventory-modal__field-row">
            <span class="inventory-modal__field-label">Category</span>
            <select data-png-kind>
              <option value="prop">prop</option>
              <option value="building">building</option>
              <option value="npc">npc</option>
            </select>
          </div>
          <div class="inventory-modal__field-row">
            <span class="inventory-modal__field-label">World Height <b data-readout="height">2.5</b></span>
            <input type="range" min="0.8" max="10" step="0.1" value="2.5" data-png-height />
          </div>
          <div class="inventory-modal__field-row">
            <span class="inventory-modal__field-label">Collider Radius <b data-readout="radius">0.8</b></span>
            <input type="range" min="0" max="4" step="0.1" value="0.8" data-png-radius />
          </div>
          <div class="inventory-modal__field-row">
            <span class="inventory-modal__field-label">Geometry</span>
            <select data-png-style>
              <option value="card">card</option>
              <option value="crossed">crossed</option>
            </select>
          </div>
          <button class="inventory-modal__action" data-add-png type="button">[ Add to Asset Library ]</button>
        </div>

        <div class="inventory-modal__slot-label">REGISTERED CUSTOM PNG ASSETS</div>
        <div class="inventory-modal__custom-list">${assetRows}</div>

        <div class="inventory-modal__slot-label">LEVEL LOADER &amp; EXPORTER</div>
        <div class="inventory-modal__level-actions">
          <button class="inventory-modal__action" data-export-level type="button">[ Export Active Level (.json) ]</button>
          <label class="inventory-modal__action inventory-modal__file-action">
            <input type="file" accept="application/json,.json" data-level-file />
            <span>[ Load Level (.json) ]</span>
          </label>
        </div>
        <div class="inventory-modal__level-status" data-level-status></div>

        ${
          customLevels
            ? `<div class="inventory-modal__slot-label">CUSTOM LEVELS</div><div class="inventory-modal__level-row">${customLevels}</div>`
            : ''
        }
      </div>
    `;
  }

  /** Wire the PNG importer file picker, sliders, and level file picker. */
  private bindAssetsInteractions(): void {
    const fileInput = this.bodyEl.querySelector('[data-png-file]') as HTMLInputElement | null;
    const thumb = this.bodyEl.querySelector('[data-png-thumb]') as HTMLImageElement | null;
    const idInput = this.bodyEl.querySelector('[data-png-id]') as HTMLInputElement | null;
    const heightInput = this.bodyEl.querySelector('[data-png-height]') as HTMLInputElement | null;
    const radiusInput = this.bodyEl.querySelector('[data-png-radius]') as HTMLInputElement | null;
    const levelFile = this.bodyEl.querySelector('[data-level-file]') as HTMLInputElement | null;
    const levelStatus = this.bodyEl.querySelector('[data-level-status]') as HTMLElement | null;

    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await this.readFileAsDataUrl(file);
        this.pendingDataUrl = dataUrl;
        this.pendingAspectRatio = await this.getImageAspectRatio(dataUrl);
        if (thumb) thumb.src = dataUrl;
        const baseId = this.sanitizeId(file.name.replace(/\.(png|webp|jpe?g)$/i, ''));
        this.pendingId = baseId || `asset_${Date.now().toString(36)}`;
        if (idInput) idInput.value = this.pendingId;
      } catch {
        // Ignore unreadable files.
      }
    });

    const bindReadout = (input: HTMLInputElement | null, key: string, decimals: number): void => {
      input?.addEventListener('input', () => {
        const readout = this.bodyEl.querySelector(`[data-readout="${key}"]`) as HTMLElement | null;
        if (readout) readout.textContent = Number(input.value).toFixed(decimals);
      });
    };
    bindReadout(heightInput, 'height', 1);
    bindReadout(radiusInput, 'radius', 1);

    levelFile?.addEventListener('change', async () => {
      const file = levelFile.files?.[0];
      if (!file) return;
      const text = await file.text().catch(() => '');
      const result = this.services.loadLevelFromJson(text);
      if (levelStatus) {
        levelStatus.textContent = result.ok ? `Loaded "${file.name}"` : result.error ?? 'Load failed';
      }
      if (result.ok) {
        this.render();
        this.bindAssetsInteractions();
      }
    });
  }

  /** Read the pending importer form and register the asset (no auto-drop). */
  private submitPngImport(): void {
    if (!this.pendingDataUrl) return;

    const idInput = this.bodyEl.querySelector('[data-png-id]') as HTMLInputElement | null;
    const kindSelect = this.bodyEl.querySelector('[data-png-kind]') as HTMLSelectElement | null;
    const heightInput = this.bodyEl.querySelector('[data-png-height]') as HTMLInputElement | null;
    const radiusInput = this.bodyEl.querySelector('[data-png-radius]') as HTMLInputElement | null;
    const styleSelect = this.bodyEl.querySelector('[data-png-style]') as HTMLSelectElement | null;

    let id = this.sanitizeId(idInput?.value.trim() ?? '');
    if (!id) id = this.pendingId;
    if (!id) return;

    this.services.registerPng({
      id,
      kind: (kindSelect?.value ?? 'prop') as CustomPngKind,
      dataUrl: this.pendingDataUrl,
      height: parseFloat(heightInput?.value ?? '2.5'),
      radius: parseFloat(radiusInput?.value ?? '0.8'),
      style: (styleSelect?.value ?? 'card') as CustomPngStyle,
      aspectRatio: this.pendingAspectRatio,
    });

    this.pendingDataUrl = '';
    this.pendingAspectRatio = 1;
    this.render();
  }

  private sanitizeId(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  private getImageAspectRatio(dataUrl: string): Promise<number> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve(
          img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1
        );
      img.onerror = () => resolve(1);
      img.src = dataUrl;
    });
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

    // Playtest tuning sliders: update the Engine live + refresh the readout.
    const statInputs = this.bodyEl.querySelectorAll<HTMLInputElement>('input[data-stat]');
    for (const input of Array.from(statInputs)) {
      input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        const key = input.dataset.stat as keyof PlaytestTuning;
        if (key === 'maxHealth') this.services.setMaxHealth(value);
        else if (key === 'maxStamina') this.services.setMaxStamina(value);
        else if (key === 'healthRegen') this.services.setHealthRegen(value);
        else if (key === 'staminaRegen') this.services.setStaminaRegen(value);
        const readout = this.bodyEl.querySelector(`[data-readout="${key}"]`) as HTMLElement | null;
        if (readout) {
          const unit = key === 'healthRegen' ? ' HP/s' : key === 'staminaRegen' ? ' ST/s' : '';
          readout.textContent = `${value}${unit}`;
        }
      });
    }
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
