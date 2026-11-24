
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

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (MOVE_KEYS.has(event.code)) {
      event.preventDefault();
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

  private readonly handleBlur = (): void => {
    this.pressed.clear();
  };

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    element.addEventListener('mousemove', this.handleMouseMove);
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

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.element.removeEventListener('mousemove', this.handleMouseMove);
    this.pressed.clear();
  }
}