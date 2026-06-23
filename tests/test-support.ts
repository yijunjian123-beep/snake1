import { Game } from "../src/game/Game.ts";
import type { GameUiElements, TouchControlElements } from "../src/game/types.ts";

type FakeRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

class FakeStorage {
  private readonly values = new Map<string, string>();

  public get length(): number {
    return this.values.size;
  }

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }

  public clear(): void {
    this.values.clear();
  }

  public key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }
}

function createStyle(): Record<string, unknown> & { setProperty(name: string, value: string): void; getPropertyValue(name: string): string } {
  const values = new Map<string, string>();
  const style = {
    setProperty(name: string, value: string): void {
      values.set(name, value);
    },
    getPropertyValue(name: string): string {
      return values.get(name) ?? "";
    },
  };

  return new Proxy(style, {
    get(target, property, receiver) {
      if (typeof property === "string" && values.has(property)) {
        return values.get(property);
      }

      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (typeof property === "string") {
        values.set(property, String(value));
      }

      return Reflect.set(target, property, value, receiver);
    },
  });
}

function createFakeGradient(): { addColorStop(offset: number, color: string): void } {
  return {
    addColorStop(): void {
      // No-op.
    },
  };
}

function createFakeContext(): CanvasRenderingContext2D {
  const target: Partial<CanvasRenderingContext2D> = {
    measureText(text: string): TextMetrics {
      return { width: Math.max(1, String(text).length * 10) } as TextMetrics;
    },
    createLinearGradient(): CanvasGradient {
      return createFakeGradient() as unknown as CanvasGradient;
    },
    createRadialGradient(): CanvasGradient {
      return createFakeGradient() as unknown as CanvasGradient;
    },
  };

  return new Proxy(target, {
    get(obj, property) {
      if (property in obj) {
        return Reflect.get(obj, property);
      }

      return (..._args: unknown[]): undefined => undefined;
    },
    set(obj, property, value) {
      Reflect.set(obj, property, value);
      return true;
    },
  }) as CanvasRenderingContext2D;
}

class FakeElement extends EventTarget {
  public readonly dataset: Record<string, string> = Object.create(null);
  public readonly style = createStyle();
  public textContent = "";
  public hidden = false;
  public disabled = false;
  private readonly attributes = new Map<string, string>();
  private readonly rect: FakeRect;
  private readonly pointerCaptures = new Set<number>();

  public constructor(rect: FakeRect = { left: 0, top: 0, width: 12, height: 12 }) {
    super();
    this.rect = rect;
  }

  public getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.rect;

    return {
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON(): unknown {
        return this;
      },
    } as DOMRect;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  public setPointerCapture(pointerId: number): void {
    this.pointerCaptures.add(pointerId);
  }

  public releasePointerCapture(pointerId: number): void {
    this.pointerCaptures.delete(pointerId);
  }

  public hasPointerCapture(pointerId: number): boolean {
    return this.pointerCaptures.has(pointerId);
  }
}

class FakeCanvas extends FakeElement {
  public width = 0;
  public height = 0;
  private readonly context = createFakeContext();

  public constructor(rect: FakeRect) {
    super(rect);
  }

  public getContext(type: string): CanvasRenderingContext2D | null {
    return type === "2d" ? this.context : null;
  }
}

class FakeDocument {
  public createElement(tagName: string): HTMLElement {
    if (tagName.toLowerCase() === "canvas") {
      return new FakeCanvas({ left: 0, top: 0, width: 960, height: 540 }) as unknown as HTMLCanvasElement;
    }

    return new FakeElement() as unknown as HTMLElement;
  }
}

class FakeWindow extends EventTarget {
  public readonly localStorage = new FakeStorage();
  public innerWidth: number;
  public innerHeight: number;
  public devicePixelRatio: number;
  public document: FakeDocument | null = null;

  public constructor(width: number, height: number, dpr: number) {
    super();
    this.innerWidth = width;
    this.innerHeight = height;
    this.devicePixelRatio = dpr;
  }

  public matchMedia(query: string): MediaQueryList {
    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener(): void {
        // No-op.
      },
      removeEventListener(): void {
        // No-op.
      },
      dispatchEvent(): boolean {
        return true;
      },
    } as MediaQueryList;
  }

  public requestAnimationFrame(callback: FrameRequestCallback): number {
    return globalThis.setTimeout(() => callback(Date.now()), 0) as unknown as number;
  }

  public cancelAnimationFrame(handle: number): void {
    globalThis.clearTimeout(handle);
  }
}

function createTouchControl(name: string): FakeElement {
  return new FakeElement({ left: 0, top: 0, width: name.length * 8 + 16, height: 48 });
}

export function createGameUi(): GameUiElements {
  const root = new FakeElement({ left: 0, top: 0, width: 960, height: 540 });
  const hudStrip = new FakeElement({ left: 0, top: 16, width: 760, height: 183 });
  const startPanel = new FakeElement({ left: 0, top: 0, width: 320, height: 220 });
  const lengthLabel = new FakeElement();
  const unlockTitleLabel = new FakeElement();
  const unlockValueLabel = new FakeElement();
  const tickerCurrentLabel = new FakeElement();
  const tickerNextLabel = new FakeElement();
  const stateLabel = new FakeElement();
  const fpsLabel = new FakeElement();
  const sizeLabel = new FakeElement();
  const startButton = new FakeElement() as unknown as HTMLButtonElement;
  const pauseButton = new FakeElement() as unknown as HTMLButtonElement;
  const container = createTouchControl("container");
  const joystick = createTouchControl("joystick");
  const joystickKnob = createTouchControl("knob");
  const joystickLine = createTouchControl("line");
  const boostButton = createTouchControl("boost") as unknown as HTMLButtonElement;

  return {
    root: root as unknown as HTMLElement,
    hudStrip: hudStrip as unknown as HTMLElement,
    startPanel: startPanel as unknown as HTMLElement,
    lengthLabel: lengthLabel as unknown as HTMLElement,
    unlockTitleLabel: unlockTitleLabel as unknown as HTMLElement,
    unlockValueLabel: unlockValueLabel as unknown as HTMLElement,
    tickerCurrentLabel: tickerCurrentLabel as unknown as HTMLElement,
    tickerNextLabel: tickerNextLabel as unknown as HTMLElement,
    stateLabel: stateLabel as unknown as HTMLElement,
    fpsLabel: fpsLabel as unknown as HTMLElement,
    sizeLabel: sizeLabel as unknown as HTMLElement,
    startButton,
    pauseButton,
    touchControls: {
      container: container as unknown as HTMLElement,
      joystick: joystick as unknown as HTMLElement,
      joystickKnob: joystickKnob as unknown as HTMLElement,
      joystickLine: joystickLine as unknown as HTMLElement,
      boostButton,
    },
  };
}

export function createPrng(seed: number): () => number {
  let state = seed >>> 0;

  return (): number => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GameHarness {
  game: Game;
  canvas: FakeCanvas;
  ui: GameUiElements;
  window: FakeWindow;
  cleanup(): void;
}

function installWindow(fakeWindow: FakeWindow): () => void {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const previousWindow = hadWindow ? (globalThis as { window: unknown }).window : undefined;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: fakeWindow,
  });

  return (): void => {
    if (hadWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: previousWindow,
      });
      return;
    }

    delete (globalThis as { window?: unknown }).window;
  };
}

function installDocument(fakeDocument: FakeDocument): () => void {
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, "document");
  const previousDocument = hadDocument ? (globalThis as { document: unknown }).document : undefined;

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: fakeDocument,
  });

  return (): void => {
    if (hadDocument) {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: previousDocument,
      });
      return;
    }

    delete (globalThis as { document?: unknown }).document;
  };
}

export function createGameHarness(): GameHarness {
  const windowLike = new FakeWindow(960, 540, 1);
  const documentLike = new FakeDocument();
  const restoreWindow = installWindow(windowLike);
  const restoreDocument = installDocument(documentLike);
  const canvas = new FakeCanvas({ left: 0, top: 0, width: 960, height: 540 });
  const ui = createGameUi();
  windowLike.document = documentLike;
  const game = new Game({
    canvas: canvas as unknown as HTMLCanvasElement,
    ui,
  });

  return {
    game,
    canvas,
    ui,
    window: windowLike,
    cleanup(): void {
      game.destroy();
      restoreDocument();
      restoreWindow();
    },
  };
}
