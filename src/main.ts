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
  hudStrip: queryRequired<HTMLElement>(".hud-strip"),
  startPanel: queryRequired<HTMLElement>("#start-panel"),
  panelPrimaryLabel: queryRequired<HTMLElement>("#panel-primary-label"),
  panelPrimaryValue: queryRequired<HTMLElement>("#panel-primary-value"),
  panelSecondaryLabel: queryRequired<HTMLElement>("#panel-secondary-label"),
  panelMetaLabel: queryRequired<HTMLElement>("#panel-meta-label"),
  lifeHearts: [
    queryRequired<HTMLElement>("#life-heart-1"),
    queryRequired<HTMLElement>("#life-heart-2"),
    queryRequired<HTMLElement>("#life-heart-3"),
  ],
  lengthLabel: queryRequired<HTMLElement>("#length-label"),
  unlockTitleLabel: queryRequired<HTMLElement>("#unlock-title-label"),
  unlockValueLabel: queryRequired<HTMLElement>("#unlock-value-label"),
  tickerCurrentLabel: queryRequired<HTMLElement>("#ticker-current-label"),
  tickerNextLabel: queryRequired<HTMLElement>("#ticker-next-label"),
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
