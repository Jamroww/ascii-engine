import type { EntityKind } from '../data/levelTypes';
import type { EditorMode, PlaceTool, TerrainBrushKind } from './editorTypes';

export interface EditorPanelCallbacks {
  onModeChange(mode: EditorMode): void;
  onPlaceToolChange(tool: PlaceTool): void;
  onTerrainBrushChange(kind: TerrainBrushKind): void;
  onBrushRadiusChange(radius: number): void;
  onEntityKindChange(kind: EntityKind): void;
  onAssetChange(assetId: string): void;
  onShowCollidersChange(show: boolean): void;
  onExport(): void;
  onReset(): void;
}

const MODES: Array<{ id: EditorMode; label: string }> = [
  { id: 'place', label: 'Place Assets' },
  { id: 'terrain', label: 'Terrain & Grass Brushes' },
];

const PLACE_TOOLS: Array<{ id: PlaceTool; label: string }> = [
  { id: 'place', label: 'Place' },
  { id: 'select', label: 'Select' },
];

const TERRAIN_BRUSHES: Array<{ id: TerrainBrushKind; label: string }> = [
  { id: 'grass_add', label: 'Paint Grass' },
  { id: 'grass_erase', label: 'Erase Grass' },
  { id: 'path', label: 'Dirt Path' },
  { id: 'water', label: 'Water' },
  { id: 'land', label: 'Dry Land' },
  { id: 'blight_add', label: 'Blight' },
  { id: 'blight_clear', label: 'Cleanse' },
];

const ENTITY_KINDS: Array<{ id: EntityKind; label: string }> = [
  { id: 'building', label: 'Building' },
  { id: 'tree', label: 'Tree' },
  { id: 'boulder', label: 'Boulder' },
  { id: 'enemy', label: 'Enemy' },
  { id: 'npc', label: 'NPC' },
  { id: 'node', label: 'Node' },
  { id: 'shrine', label: 'Shrine' },
  { id: 'prop', label: 'Prop' },
];

const CSS = `
  .wf-editor {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 1000;
    width: 240px;
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 12px;
    background: #10141a;
    color: #cdd6e0;
    border: 1px solid #2b3642;
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
    font: 12px/1.45 'JetBrains Mono', 'Fira Code', monospace;
    user-select: none;
  }
  .wf-editor[hidden] { display: none; }
  .wf-editor__title {
    margin: 0 0 10px;
    font-size: 13px;
    letter-spacing: 1px;
    color: #8fae9a;
    text-transform: uppercase;
  }
  .wf-editor__row { display: flex; gap: 6px; margin-bottom: 10px; }
  .wf-editor__row button {
    flex: 1;
    padding: 5px 0;
    background: #1a212b;
    color: #cdd6e0;
    border: 1px solid #2b3642;
    border-radius: 6px;
    cursor: pointer;
  }
  .wf-editor__row button.is-active {
    background: #2c4a3a;
    border-color: #4c9a5f;
    color: #d9ffe6;
  }
  .wf-editor__section { margin-bottom: 10px; }
  .wf-editor__section[hidden] { display: none; }
  .wf-editor__field { margin-bottom: 8px; }
  .wf-editor__label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #8fa3b3;
    font-size: 11px;
    letter-spacing: 0.5px;
  }
  .wf-editor select, .wf-editor input[type='range'] { width: 100%; }
  .wf-editor select {
    margin-top: 3px;
    padding: 4px;
    background: #1a212b;
    color: #cdd6e0;
    border: 1px solid #2b3642;
    border-radius: 6px;
  }
  .wf-editor input[type='range'] { accent-color: #4c9a5f; }
  .wf-editor input[type='checkbox'] { accent-color: #4c9a5f; }
  .wf-editor__brush-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .wf-editor__brush-grid button {
    padding: 6px 4px;
    background: #1a212b;
    color: #cdd6e0;
    border: 1px solid #2b3642;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .wf-editor__brush-grid button.is-active {
    background: #2c4a3a;
    border-color: #4c9a5f;
    color: #d9ffe6;
  }
  .wf-editor__utils {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid #2b3642;
  }
  .wf-editor__utils button {
    padding: 6px;
    background: #1a212b;
    color: #cdd6e0;
    border: 1px solid #2b3642;
    border-radius: 6px;
    cursor: pointer;
  }
  .wf-editor__utils button:hover { background: #222c38; }
  .wf-editor__status {
    min-height: 30px;
    margin-top: 10px;
    padding: 6px 8px;
    background: #0a0e12;
    border: 1px solid #232d38;
    border-radius: 6px;
    color: #9fb4a5;
    white-space: pre-wrap;
  }
  .wf-editor__hint {
    margin-top: 8px;
    color: #5d6f7e;
    font-size: 10px;
    line-height: 1.5;
  }
`;

let styleInjected = false;

/** Compact dark sidebar. Pure view: renders controls and reports changes upward. */
export class EditorPanel {
  public readonly root: HTMLDivElement;

  private readonly modeButtons = new Map<EditorMode, HTMLButtonElement>();
  private readonly placeToolButtons = new Map<PlaceTool, HTMLButtonElement>();
  private readonly brushButtons = new Map<TerrainBrushKind, HTMLButtonElement>();

  private readonly placeSection: HTMLDivElement;
  private readonly terrainSection: HTMLDivElement;
  private readonly radiusInput: HTMLInputElement;
  private readonly radiusValue: HTMLSpanElement;
  private readonly kindSelect: HTMLSelectElement;
  private readonly assetSelect: HTMLSelectElement;
  private readonly collidersInput: HTMLInputElement;
  private readonly statusEl: HTMLDivElement;
  private readonly callbacks: EditorPanelCallbacks;

  constructor(callbacks: EditorPanelCallbacks) {
    this.callbacks = callbacks;
    if (!styleInjected) {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      styleInjected = true;
    }

    this.root = document.createElement('div');
    this.root.className = 'wf-editor';
    this.root.hidden = true;

    const title = document.createElement('div');
    title.className = 'wf-editor__title';
    title.textContent = 'Level Editor';
    this.root.appendChild(title);

    // Mode switch.
    const modeRow = document.createElement('div');
    modeRow.className = 'wf-editor__row';
    for (const mode of MODES) {
      const btn = document.createElement('button');
      btn.textContent = mode.label;
      btn.dataset.mode = mode.id;
      btn.addEventListener('click', () => this.setMode(mode.id));
      this.modeButtons.set(mode.id, btn);
      modeRow.appendChild(btn);
    }
    this.root.appendChild(modeRow);

    // --- Place Assets section ---
    this.placeSection = document.createElement('div');
    this.placeSection.className = 'wf-editor__section';

    const placeToolRow = document.createElement('div');
    placeToolRow.className = 'wf-editor__row';
    for (const tool of PLACE_TOOLS) {
      const btn = document.createElement('button');
      btn.textContent = tool.label;
      btn.dataset.placeTool = tool.id;
      btn.addEventListener('click', () => this.setPlaceTool(tool.id));
      this.placeToolButtons.set(tool.id, btn);
      placeToolRow.appendChild(btn);
    }
    this.placeSection.appendChild(placeToolRow);

    const kindField = document.createElement('div');
    kindField.className = 'wf-editor__field';
    const kindLabel = document.createElement('label');
    kindLabel.className = 'wf-editor__label';
    kindLabel.textContent = 'Entity kind';
    this.kindSelect = document.createElement('select');
    for (const k of ENTITY_KINDS) {
      const opt = document.createElement('option');
      opt.value = k.id;
      opt.textContent = k.label;
      this.kindSelect.appendChild(opt);
    }
    this.kindSelect.addEventListener('change', () => {
      this.callbacks.onEntityKindChange(this.kindSelect.value as EntityKind);
    });
    kindField.append(kindLabel, this.kindSelect);
    this.placeSection.appendChild(kindField);

    const assetField = document.createElement('div');
    assetField.className = 'wf-editor__field';
    const assetLabel = document.createElement('label');
    assetLabel.className = 'wf-editor__label';
    assetLabel.textContent = 'Asset';
    this.assetSelect = document.createElement('select');
    this.assetSelect.addEventListener('change', () => {
      this.callbacks.onAssetChange(this.assetSelect.value);
    });
    assetField.append(assetLabel, this.assetSelect);
    this.placeSection.appendChild(assetField);

    this.root.appendChild(this.placeSection);

    // --- Terrain & Grass Brushes section ---
    this.terrainSection = document.createElement('div');
    this.terrainSection.className = 'wf-editor__section';
    this.terrainSection.hidden = true;

    const brushGrid = document.createElement('div');
    brushGrid.className = 'wf-editor__brush-grid';
    for (const brush of TERRAIN_BRUSHES) {
      const btn = document.createElement('button');
      btn.textContent = brush.label;
      btn.dataset.brush = brush.id;
      btn.addEventListener('click', () => this.setTerrainBrush(brush.id));
      this.brushButtons.set(brush.id, btn);
      brushGrid.appendChild(btn);
    }
    this.terrainSection.appendChild(brushGrid);

    const radiusField = document.createElement('div');
    radiusField.className = 'wf-editor__field';
    const radiusLabel = document.createElement('label');
    radiusLabel.className = 'wf-editor__label';
    radiusLabel.textContent = 'Brush Radius ';
    this.radiusValue = document.createElement('span');
    this.radiusValue.textContent = '3.0';
    radiusLabel.appendChild(this.radiusValue);
    this.radiusInput = document.createElement('input');
    this.radiusInput.type = 'range';
    this.radiusInput.min = '1';
    this.radiusInput.max = '10';
    this.radiusInput.step = '0.5';
    this.radiusInput.value = '3';
    this.radiusInput.addEventListener('input', () => {
      const value = Number(this.radiusInput.value);
      this.radiusValue.textContent = value.toFixed(1);
      this.callbacks.onBrushRadiusChange(value);
    });
    radiusField.append(radiusLabel, this.radiusInput);
    this.terrainSection.appendChild(radiusField);

    this.root.appendChild(this.terrainSection);

    // --- Utilities ---
    const utils = document.createElement('div');
    utils.className = 'wf-editor__utils';

    const collidersLabel = document.createElement('label');
    collidersLabel.className = 'wf-editor__label';
    this.collidersInput = document.createElement('input');
    this.collidersInput.type = 'checkbox';
    this.collidersInput.addEventListener('change', () => {
      this.callbacks.onShowCollidersChange(this.collidersInput.checked);
    });
    collidersLabel.append(this.collidersInput, document.createTextNode(' Show Colliders'));
    utils.appendChild(collidersLabel);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export JSON';
    exportBtn.addEventListener('click', () => this.callbacks.onExport());
    utils.appendChild(exportBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Default';
    resetBtn.addEventListener('click', () => this.callbacks.onReset());
    utils.appendChild(resetBtn);

    this.root.appendChild(utils);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'wf-editor__status';
    this.statusEl.textContent = 'Editor off';
    this.root.appendChild(this.statusEl);

    const hint = document.createElement('div');
    hint.className = 'wf-editor__hint';
    hint.textContent = 'F2: Toggle Editor | WASD: Pan | LMB: Paint/Place | Del: Delete | R: Rotate';
    this.root.appendChild(hint);

    // Keep UI interactions from painting the map or zooming the camera.
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('wheel', (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => e.stopPropagation());

    this.setMode('place');
    this.setPlaceTool('place');
    this.setTerrainBrush('grass_add');
    document.body.appendChild(this.root);
  }

  public setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  public setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  public setEntityKind(kind: EntityKind): void {
    this.kindSelect.value = kind;
  }

  public updateAssetList(kind: EntityKind, ids: string[], selectedId: string): void {
    void kind;
    this.assetSelect.innerHTML = '';
    if (ids.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no assets)';
      this.assetSelect.appendChild(opt);
      this.assetSelect.disabled = true;
      return;
    }
    this.assetSelect.disabled = false;
    for (const id of ids) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      this.assetSelect.appendChild(opt);
    }
    this.assetSelect.value = ids.includes(selectedId) ? selectedId : ids[0];
  }

  public containsTarget(target: EventTarget | null): boolean {
    return target instanceof Node && this.root.contains(target);
  }

  public dispose(): void {
    this.root.remove();
  }

  private setMode(mode: EditorMode): void {
    for (const [m, btn] of this.modeButtons) btn.classList.toggle('is-active', m === mode);
    this.placeSection.hidden = mode !== 'place';
    this.terrainSection.hidden = mode !== 'terrain';
    this.callbacks.onModeChange(mode);
  }

  private setPlaceTool(tool: PlaceTool): void {
    for (const [t, btn] of this.placeToolButtons) btn.classList.toggle('is-active', t === tool);
    this.callbacks.onPlaceToolChange(tool);
  }

  private setTerrainBrush(kind: TerrainBrushKind): void {
    for (const [k, btn] of this.brushButtons) btn.classList.toggle('is-active', k === kind);
    this.callbacks.onTerrainBrushChange(kind);
  }
}
