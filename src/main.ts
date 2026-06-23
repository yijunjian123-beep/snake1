import { Game } from "./game/Game";
import type { GameUiElements } from "./game/types";

function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

const canvas = queryRequired<HTMLCanvasElement>("#game-canvas");
const ui: GameUiElements = {
  root: queryRequired<HTMLElement>("#app"),
  startPanel: queryRequired<HTMLElement>("#start-panel"),
  scoreLabel: queryRequired<HTMLElement>("#score-label"),
  comboPanel: queryRequired<HTMLElement>("#combo-panel"),
  comboLabel: queryRequired<HTMLElement>("#combo-label"),
  comboCountLabel: queryRequired<HTMLElement>("#combo-count-label"),
  comboTimerLabel: queryRequired<HTMLElement>("#combo-timer-label"),
  comboTimerBar: queryRequired<HTMLElement>("#combo-timer-bar"),
  bestLabel: queryRequired<HTMLElement>("#best-label"),
  stateLabel: queryRequired<HTMLElement>("#state-label"),
  fpsLabel: queryRequired<HTMLElement>("#fps-label"),
  sizeLabel: queryRequired<HTMLElement>("#size-label"),
  startButton: queryRequired<HTMLButtonElement>("#start-button"),
  pauseButton: queryRequired<HTMLButtonElement>("#pause-button"),
  touchControls: {
    container: queryRequired<HTMLElement>("#touch-controls"),
    joystick: queryRequired<HTMLElement>("#joystick"),
    joystickKnob: queryRequired<HTMLElement>("#joystick-knob"),
    joystickLine: queryRequired<HTMLElement>("#joystick-line"),
    boostButton: queryRequired<HTMLButtonElement>("#boost-button"),
  },
};

const game = new Game({ canvas, ui });
game.start();

window.addEventListener("beforeunload", () => {
  game.destroy();
});
