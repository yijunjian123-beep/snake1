import assert from "node:assert/strict";
import test from "node:test";

import { createInputController } from "../src/game/input.ts";
import type { InputCommand } from "../src/game/types.ts";
import { createGameHarness } from "./test-support.ts";

class FakeKeyboardEvent extends Event {
  public readonly code: string;
  public readonly repeat: boolean;

  public constructor(type: string, init: { code: string; repeat?: boolean }) {
    super(type, { bubbles: true, cancelable: true });
    this.code = init.code;
    this.repeat = init.repeat ?? false;
  }
}

class FakePointerEvent extends Event {
  public readonly pointerId: number;
  public readonly pointerType: string;
  public readonly button: number;
  public readonly clientX: number;
  public readonly clientY: number;

  public constructor(
    type: string,
    init: {
      pointerId: number;
      pointerType?: string;
      button?: number;
      clientX?: number;
      clientY?: number;
    },
  ) {
    super(type, { bubbles: true, cancelable: true });
    this.pointerId = init.pointerId;
    this.pointerType = init.pointerType ?? "touch";
    this.button = init.button ?? 0;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
  }
}

function installInputEventGlobals(): () => void {
  const hadKeyboardEvent = Object.prototype.hasOwnProperty.call(globalThis, "KeyboardEvent");
  const previousKeyboardEvent = hadKeyboardEvent ? (globalThis as Record<string, unknown>).KeyboardEvent : undefined;
  const hadPointerEvent = Object.prototype.hasOwnProperty.call(globalThis, "PointerEvent");
  const previousPointerEvent = hadPointerEvent ? (globalThis as Record<string, unknown>).PointerEvent : undefined;

  Object.defineProperty(globalThis, "KeyboardEvent", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: FakeKeyboardEvent,
  });
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: FakePointerEvent,
  });

  return (): void => {
    if (hadKeyboardEvent) {
      Object.defineProperty(globalThis, "KeyboardEvent", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: previousKeyboardEvent,
      });
    } else {
      delete (globalThis as Record<string, unknown>).KeyboardEvent;
    }

    if (hadPointerEvent) {
      Object.defineProperty(globalThis, "PointerEvent", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: previousPointerEvent,
      });
    } else {
      delete (globalThis as Record<string, unknown>).PointerEvent;
    }
  };
}

test("keyboard controls ignore repeats and emit press/release pairs", () => {
  const restoreGlobals = installInputEventGlobals();
  const harness = createGameHarness();
  const commands: InputCommand[] = [];
  const controller = createInputController({
    target: harness.window,
    touchControls: harness.ui.touchControls,
  });

  try {
    const unsubscribe = controller.subscribe((command) => {
      commands.push(command);
    });

    harness.window.dispatchEvent(new FakeKeyboardEvent("keydown", { code: "KeyW" }));
    harness.window.dispatchEvent(new FakeKeyboardEvent("keydown", { code: "KeyW", repeat: true }));
    harness.window.dispatchEvent(new FakeKeyboardEvent("keyup", { code: "KeyW" }));

    unsubscribe();

    assert.deepEqual(commands, [
      { action: "move-up", kind: "pressed", source: "keyboard" },
      { action: "move-up", kind: "released", source: "keyboard" },
    ]);
  } finally {
    controller.destroy();
    harness.cleanup();
    restoreGlobals();
  }
});

test("joystick pointer input switches directions and releases cleanly", () => {
  const restoreGlobals = installInputEventGlobals();
  const harness = createGameHarness();
  const commands: InputCommand[] = [];
  const controller = createInputController({
    target: harness.window,
    touchControls: harness.ui.touchControls,
  });

  try {
    controller.subscribe((command) => {
      commands.push(command);
    });

    const joystick = harness.ui.touchControls.joystick;

    joystick.dispatchEvent(new FakePointerEvent("pointerdown", {
      pointerId: 11,
      clientX: 70,
      clientY: 24,
    }));
    joystick.dispatchEvent(new FakePointerEvent("pointermove", {
      pointerId: 11,
      clientX: 40,
      clientY: 60,
    }));
    joystick.dispatchEvent(new FakePointerEvent("pointerup", {
      pointerId: 11,
      clientX: 40,
      clientY: 60,
    }));

    assert.deepEqual(commands, [
      { action: "move-right", kind: "pressed", source: "pointer" },
      { action: "move-right", kind: "released", source: "pointer" },
      { action: "move-down", kind: "pressed", source: "pointer" },
      { action: "move-down", kind: "released", source: "pointer" },
    ]);
    assert.equal(harness.ui.touchControls.container.dataset.touching, "false");
    assert.equal(harness.ui.touchControls.joystick.dataset.active, "false");
    assert.equal(harness.ui.touchControls.joystickLine.style.opacity, "0");
    assert.equal(harness.ui.touchControls.joystick.hasPointerCapture(11), false);
  } finally {
    controller.destroy();
    harness.cleanup();
    restoreGlobals();
  }
});

test("boost button pointer input toggles pressed state", () => {
  const restoreGlobals = installInputEventGlobals();
  const harness = createGameHarness();
  const commands: InputCommand[] = [];
  const controller = createInputController({
    target: harness.window,
    touchControls: harness.ui.touchControls,
  });

  try {
    controller.subscribe((command) => {
      commands.push(command);
    });

    const boostButton = harness.ui.touchControls.boostButton;

    boostButton.dispatchEvent(new FakePointerEvent("pointerdown", {
      pointerId: 22,
      clientX: 10,
      clientY: 10,
    }));

    assert.equal(boostButton.getAttribute("aria-pressed"), "true");
    assert.equal(boostButton.dataset.active, "true");

    boostButton.dispatchEvent(new FakePointerEvent("pointerup", {
      pointerId: 22,
      clientX: 10,
      clientY: 10,
    }));

    assert.deepEqual(commands, [
      { action: "boost", kind: "pressed", source: "pointer" },
      { action: "boost", kind: "released", source: "pointer" },
    ]);
    assert.equal(boostButton.getAttribute("aria-pressed"), "false");
    assert.equal(boostButton.dataset.active, "false");
    assert.equal(boostButton.hasPointerCapture(22), false);
  } finally {
    controller.destroy();
    harness.cleanup();
    restoreGlobals();
  }
});
