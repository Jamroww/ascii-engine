import type { IInputManager, InputState, Vec2 } from './types';

const MOVE_KEYS: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export class InputManager implements IInputManager {
  private readonly element: HTMLElement;
  private readonly pressed: Set<string> = new Set();
  private mouseNdc: Vec2 = { x: 0, y: 0 };
  private wheelDelta = 0;
  private attackQueued = false;
  private dashQueued = false;
  private interactQueued = false;
  private lightAbilityQueued = false;
  private cancelQueued = false;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (MOVE_KEYS.has(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat) {
      switch (event.code) {
        case 'Space':
          event.preventDefault();
          this.dashQueued = true;
          break;
        case 'KeyE':
          this.interactQueued = true;
          break;
        case 'KeyQ':
          this.lightAbilityQueued = true;
          break;
        case 'Escape':
          this.cancelQueued = true;
          break;
        default:
          break;
      }
    }
    this.pressed.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    this.mouseNdc = {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    };
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.wheelDelta += event.deltaY;
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button === 0) this.attackQueued = true;
  };

  private readonly handleBlur = (): void => {
    this.pressed.clear();
  };

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    element.addEventListener('mousemove', this.handleMouseMove);
    element.addEventListener('wheel', this.handleWheel, { passive: false });
    element.addEventListener('pointerdown', this.handlePointerDown);
  }

  getState(): InputState {
    let moveX = 0;
    let moveY = 0;

    if (this.pressed.has('KeyA') || this.pressed.has('ArrowLeft')) moveX -= 1;
    if (this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) moveX += 1;
    if (this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) moveY += 1;
    if (this.pressed.has('KeyS') || this.pressed.has('ArrowDown')) moveY -= 1;

    const length = Math.hypot(moveX, moveY);
    if (length > 1) {
      moveX /= length;
      moveY /= length;
    }

    const sprint = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');

    return {
      moveX,
      moveY,
      sprint,
      mouseNdc: { ...this.mouseNdc },
    };
  }

  /** True once per sword swing (left click only), then cleared. */
  takeAttack(): boolean {
    const value = this.attackQueued;
    this.attackQueued = false;
    return value;
  }

  /** True once per dash press (Space), then cleared. */
  consumeDash(): boolean {
    const value = this.dashQueued;
    this.dashQueued = false;
    return value;
  }

  /** True once per interact press (E), then cleared. */
  consumeInteract(): boolean {
    const value = this.interactQueued;
    this.interactQueued = false;
    return value;
  }

  /** True once per light-ability press (Q), then cleared. */
  consumeLightAbility(): boolean {
    const value = this.lightAbilityQueued;
    this.lightAbilityQueued = false;
    return value;
  }

  /** True once per cancel press (Escape), then cleared. */
  consumeCancel(): boolean {
    const value = this.cancelQueued;
    this.cancelQueued = false;
    return value;
  }

  /** Accumulated mouse-wheel delta since the last call, then cleared. */
  takeWheelDelta(): number {
    const value = this.wheelDelta;
    this.wheelDelta = 0;
    return value;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.element.removeEventListener('mousemove', this.handleMouseMove);
    this.element.removeEventListener('wheel', this.handleWheel);
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.pressed.clear();
  }
}
