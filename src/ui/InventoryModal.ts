import type { InventorySystem } from '../core/InventorySystem';
import type { ProgressionSystem, QuestStage } from '../core/ProgressionSystem';
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

/**
 * Paused Gear & Quests overlay, toggled with I / Tab / Esc and closed with Esc.
 * It reads live state straight from the InventorySystem + ProgressionSystem and
 * re-renders on equip, so the engine only owns the open/close input routing.
 */
export class InventoryModal {
  public readonly element: HTMLDivElement;

  private readonly inventory: InventorySystem;
  private readonly progression: ProgressionSystem;
  private readonly cameraLean: CameraLeanControls;
  private readonly bodyEl: HTMLDivElement;
  private readonly gearTabEl: HTMLButtonElement;
  private readonly questTabEl: HTMLButtonElement;
  private readonly settingsTabEl: HTMLButtonElement;

  private active = false;
  private tab: 'gear' | 'quests' | 'settings' = 'gear';

  constructor(
    container: HTMLElement,
    inventory: InventorySystem,
    progression: ProgressionSystem,
    cameraLean: CameraLeanControls,
  ) {
    this.inventory = inventory;
    this.progression = progression;
    this.cameraLean = cameraLean;

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
    return `
      <div class="inventory-modal__settings">
        <div class="inventory-modal__slot-label">SETTINGS</div>
        <button class="inventory-modal__toggle" data-toggle-camera-lean type="button">
          <span class="inventory-modal__toggle-label">Camera Lean (A/D)</span>
          <span class="inventory-modal__toggle-state ${enabled ? 'is-on' : 'is-off'}">${state}</span>
        </button>
        <p class="inventory-modal__settings-note">
          Sways the camera into strafing movement. Off keeps the view rock-steady.
        </p>
      </div>
    `;
  }
}
