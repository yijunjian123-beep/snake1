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
  buildVersionLabel: queryRequired<HTMLElement>("#build-version-label"),
  pvpConnectionLabel: queryRequired<HTMLElement>("#pvp-connection-label"),
  panelPrimaryLabel: queryRequired<HTMLElement>("#panel-primary-label"),
  panelPrimaryValue: queryRequired<HTMLElement>("#panel-primary-value"),
  panelSecondaryLabel: queryRequired<HTMLElement>("#panel-secondary-label"),
  panelMetaLabel: queryRequired<HTMLElement>("#panel-meta-label"),
  entryActions: queryRequired<HTMLElement>("#entry-actions"),
  pveButton: queryRequired<HTMLButtonElement>("#pve-button"),
  pvpButton: queryRequired<HTMLButtonElement>("#pvp-button"),
  pvpRoomPanel: queryRequired<HTMLElement>("#pvp-room-panel"),
  roomQueueStats: queryRequired<HTMLElement>("#room-queue-stats"),
  queueWaitLabel: queryRequired<HTMLElement>("#queue-wait-label"),
  queueOnlineLabel: queryRequired<HTMLElement>("#queue-online-label"),
  queueCountLabel: queryRequired<HTMLElement>("#queue-count-label"),
  roomPlayersLabel: queryRequired<HTMLElement>("#room-players-label"),
  roomCodeField: queryRequired<HTMLElement>("#room-code-field"),
  roomCodeInput: queryRequired<HTMLInputElement>("#room-code-input"),
  pvpSoloButton: queryRequired<HTMLButtonElement>("#pvp-solo-button"),
  randomMatchButton: queryRequired<HTMLButtonElement>("#random-match-button"),
  createRoomButton: queryRequired<HTMLButtonElement>("#create-room-button"),
  joinRoomButton: queryRequired<HTMLButtonElement>("#join-room-button"),
  readyRoomButton: queryRequired<HTMLButtonElement>("#ready-room-button"),
  cancelMatchmakingButton: queryRequired<HTMLButtonElement>("#cancel-matchmaking-button"),
  copyRoomCodeButton: queryRequired<HTMLButtonElement>("#copy-room-code-button"),
  roomBackButton: queryRequired<HTMLButtonElement>("#room-back-button"),
  roomStatusLabel: queryRequired<HTMLElement>("#room-status-label"),
  settlementActions: queryRequired<HTMLElement>("#settlement-actions"),
  continueButton: queryRequired<HTMLButtonElement>("#continue-button"),
  mainMenuButton: queryRequired<HTMLButtonElement>("#main-menu-button"),
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
  debugLocalTickLabel: queryRequired<HTMLElement>("#debug-local-tick-label"),
  debugRemoteInputLagLabel: queryRequired<HTMLElement>("#debug-remote-input-lag-label"),
  debugBufferedInputsLabel: queryRequired<HTMLElement>("#debug-buffered-inputs-label"),
  debugConnectionStateLabel: queryRequired<HTMLElement>("#debug-connection-state-label"),
  debugPlayerSlotLabel: queryRequired<HTMLElement>("#debug-player-slot-label"),
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
