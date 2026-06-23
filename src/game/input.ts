import type {
  InputAction,
  InputCommand,
  InputController,
  InputControllerOptions,
  InputListener,
  TouchControlElements,
  Unsubscribe,
} from "./types";

const KEY_ACTIONS: ReadonlyMap<string, InputAction> = new Map([
  ["Enter", "start"],
  ["Space", "pause"],
  ["ShiftLeft", "speed-brake"],
  ["ShiftRight", "speed-brake"],
  ["KeyP", "pause"],
  ["KeyR", "restart"],
  ["ArrowUp", "move-up"],
  ["KeyW", "move-up"],
  ["ArrowRight", "move-right"],
  ["KeyD", "move-right"],
  ["ArrowDown", "move-down"],
  ["KeyS", "move-down"],
  ["ArrowLeft", "move-left"],
  ["KeyA", "move-left"],
]);

const JOYSTICK_MAX_DISTANCE = 44;
const JOYSTICK_DEAD_ZONE = 14;

interface ActiveJoystick {
  pointerId: number;
  originX: number;
  originY: number;
}

function clampJoystickDelta(deltaX: number, deltaY: number): { x: number; y: number; distance: number } {
  const rawDistance = Math.hypot(deltaX, deltaY);

  if (rawDistance <= JOYSTICK_MAX_DISTANCE) {
    return { x: deltaX, y: deltaY, distance: rawDistance };
  }

  const scale = JOYSTICK_MAX_DISTANCE / rawDistance;

  return {
    x: deltaX * scale,
    y: deltaY * scale,
    distance: JOYSTICK_MAX_DISTANCE,
  };
}

function actionFromJoystickDelta(deltaX: number, deltaY: number): InputAction | null {
  const distance = Math.hypot(deltaX, deltaY);

  if (distance < JOYSTICK_DEAD_ZONE) {
    return null;
  }

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX > 0 ? "move-right" : "move-left";
  }

  return deltaY > 0 ? "move-down" : "move-up";
}

function setJoystickVisuals(controls: TouchControlElements, deltaX: number, deltaY: number): void {
  const clamped = clampJoystickDelta(deltaX, deltaY);
  const angle = Math.atan2(clamped.y, clamped.x);

  controls.container.dataset.touching = "true";
  controls.joystick.dataset.active = "true";
  controls.joystick.style.setProperty("--stick-x", `${clamped.x}px`);
  controls.joystick.style.setProperty("--stick-y", `${clamped.y}px`);
  controls.joystick.style.setProperty("--line-angle", `${angle}rad`);
  controls.joystick.style.setProperty("--line-length", `${clamped.distance}px`);
  controls.joystickKnob.style.filter = `brightness(${(1 + clamped.distance / JOYSTICK_MAX_DISTANCE * 0.22).toFixed(2)})`;
  controls.joystickLine.style.opacity = clamped.distance > JOYSTICK_DEAD_ZONE ? "1" : "0";
}

function resetJoystickVisuals(controls: TouchControlElements): void {
  controls.container.dataset.touching = "false";
  controls.joystick.dataset.active = "false";
  controls.joystick.style.setProperty("--stick-x", "0px");
  controls.joystick.style.setProperty("--stick-y", "0px");
  controls.joystick.style.setProperty("--line-angle", "0rad");
  controls.joystick.style.setProperty("--line-length", "0px");
  controls.joystickKnob.style.filter = "brightness(1)";
  controls.joystickLine.style.opacity = "0";
}

function setBoostVisuals(controls: TouchControlElements, active: boolean): void {
  controls.container.dataset.boosting = active ? "true" : "false";
  controls.boostButton.dataset.active = active ? "true" : "false";
  controls.boostButton.setAttribute("aria-pressed", active ? "true" : "false");
}

export function createInputController(options: InputControllerOptions = {}): InputController {
  const target = options.target ?? window;
  const controls = options.touchControls;
  const listeners = new Set<InputListener>();
  let activeJoystick: ActiveJoystick | null = null;
  let activeJoystickAction: InputAction | null = null;
  let boostPointerId: number | null = null;

  const emit = (command: InputCommand): void => {
    for (const listener of listeners) {
      listener(command);
    }
  };

  const handleKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.repeat) {
      return;
    }

    const action = KEY_ACTIONS.get(event.code);

    if (!action) {
      return;
    }

    event.preventDefault();
    emit({ action, kind: "pressed", source: "keyboard" });
  };

  const handleKeyUp = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }

    const action = KEY_ACTIONS.get(event.code);

    if (!action) {
      return;
    }

    event.preventDefault();
    emit({ action, kind: "released", source: "keyboard" });
  };

  const updateJoystick = (event: PointerEvent): void => {
    if (!controls || !activeJoystick || activeJoystick.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - activeJoystick.originX;
    const deltaY = event.clientY - activeJoystick.originY;
    const action = actionFromJoystickDelta(deltaX, deltaY);

    event.preventDefault();
    setJoystickVisuals(controls, deltaX, deltaY);

    if (activeJoystickAction && activeJoystickAction !== action) {
      emit({ action: activeJoystickAction, kind: "released", source: "pointer" });
    }

    activeJoystickAction = action;

    if (action) {
      emit({ action, kind: "pressed", source: "pointer" });
    }
  };

  const handleJoystickPointerDown = (event: Event): void => {
    if (!controls || !(event instanceof PointerEvent) || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    if (activeJoystick) {
      event.preventDefault();
      return;
    }

    const bounds = controls.joystick.getBoundingClientRect();
    activeJoystick = {
      pointerId: event.pointerId,
      originX: bounds.left + bounds.width / 2,
      originY: bounds.top + bounds.height / 2,
    };

    event.preventDefault();
    controls.joystick.setPointerCapture(event.pointerId);
    activeJoystickAction = null;
    updateJoystick(event);
  };

  const handleJoystickPointerMove = (event: Event): void => {
    if (!(event instanceof PointerEvent)) {
      return;
    }

    updateJoystick(event);
  };

  const releaseJoystick = (event: Event): void => {
    if (!controls || !(event instanceof PointerEvent) || !activeJoystick || activeJoystick.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    activeJoystick = null;

    if (activeJoystickAction) {
      emit({ action: activeJoystickAction, kind: "released", source: "pointer" });
      activeJoystickAction = null;
    }

    resetJoystickVisuals(controls);

    if (controls.joystick.hasPointerCapture(event.pointerId)) {
      controls.joystick.releasePointerCapture(event.pointerId);
    }
  };

  const handleJoystickLostCapture = (event: Event): void => {
    if (!controls || !(event instanceof PointerEvent) || !activeJoystick || activeJoystick.pointerId !== event.pointerId) {
      return;
    }

    activeJoystick = null;

    if (activeJoystickAction) {
      emit({ action: activeJoystickAction, kind: "released", source: "pointer" });
      activeJoystickAction = null;
    }

    resetJoystickVisuals(controls);
  };

  const handleBoostPointerDown = (event: Event): void => {
    if (!controls || !(event instanceof PointerEvent) || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    event.preventDefault();

    if (boostPointerId !== null) {
      return;
    }

    boostPointerId = event.pointerId;
    controls.boostButton.setPointerCapture(event.pointerId);
    setBoostVisuals(controls, true);
    emit({ action: "boost", kind: "pressed", source: "pointer" });
  };

  const releaseBoost = (event: Event): void => {
    if (!controls || !(event instanceof PointerEvent) || boostPointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    boostPointerId = null;
    setBoostVisuals(controls, false);
    emit({ action: "boost", kind: "released", source: "pointer" });

    if (controls.boostButton.hasPointerCapture(event.pointerId)) {
      controls.boostButton.releasePointerCapture(event.pointerId);
    }
  };

  const handleBoostLostCapture = (event: Event): void => {
    if (!controls || !(event instanceof PointerEvent) || boostPointerId !== event.pointerId) {
      return;
    }

    boostPointerId = null;
    setBoostVisuals(controls, false);
    emit({ action: "boost", kind: "released", source: "pointer" });
  };

  target.addEventListener("keydown", handleKeyDown);
  target.addEventListener("keyup", handleKeyUp);

  if (controls) {
    resetJoystickVisuals(controls);
    setBoostVisuals(controls, false);
    controls.joystick.addEventListener("pointerdown", handleJoystickPointerDown);
    controls.joystick.addEventListener("pointermove", handleJoystickPointerMove);
    controls.joystick.addEventListener("pointerup", releaseJoystick);
    controls.joystick.addEventListener("pointercancel", releaseJoystick);
    controls.joystick.addEventListener("lostpointercapture", handleJoystickLostCapture);
    controls.boostButton.addEventListener("pointerdown", handleBoostPointerDown);
    controls.boostButton.addEventListener("pointerup", releaseBoost);
    controls.boostButton.addEventListener("pointercancel", releaseBoost);
    controls.boostButton.addEventListener("lostpointercapture", handleBoostLostCapture);
  }

  return {
    subscribe(listener: InputListener): Unsubscribe {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    destroy(): void {
      target.removeEventListener("keydown", handleKeyDown);
      target.removeEventListener("keyup", handleKeyUp);

      if (controls) {
        controls.joystick.removeEventListener("pointerdown", handleJoystickPointerDown);
        controls.joystick.removeEventListener("pointermove", handleJoystickPointerMove);
        controls.joystick.removeEventListener("pointerup", releaseJoystick);
        controls.joystick.removeEventListener("pointercancel", releaseJoystick);
        controls.joystick.removeEventListener("lostpointercapture", handleJoystickLostCapture);
        controls.boostButton.removeEventListener("pointerdown", handleBoostPointerDown);
        controls.boostButton.removeEventListener("pointerup", releaseBoost);
        controls.boostButton.removeEventListener("pointercancel", releaseBoost);
        controls.boostButton.removeEventListener("lostpointercapture", handleBoostLostCapture);
      }

      listeners.clear();
    },
  };
}
