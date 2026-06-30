import WebSocket from "ws";

import type { PlayerSlot, RoomCode, ServerToClientMessage } from "../src/pvp/net/protocol.js";

interface RemoteMatchSmokeConfig {
  readonly metricsUrl: string;
  readonly wsUrl: string;
  readonly origin?: string;
  readonly timeoutMs: number;
  readonly requireWss: boolean;
}

interface ClientState {
  readonly label: string;
  readonly socket: WebSocket;
  welcomed: boolean;
  queued: boolean;
  matchFound: boolean;
  gameStarted: boolean;
  roomCode: RoomCode | null;
  playerSlot: PlayerSlot | null;
}

interface MatchSmokeResult {
  readonly roomCode: RoomCode;
  readonly firstSlot: PlayerSlot;
  readonly secondSlot: PlayerSlot;
  readonly elapsedMs: number;
  readonly beforeMetrics: MetricsSummary;
  readonly afterMetrics: MetricsSummary;
}

interface MetricsSummary {
  readonly connections: number;
  readonly queueSize: number;
  readonly countdownRooms: number;
  readonly playingRooms: number;
  readonly rooms: number;
  readonly rejectedByRoomCapacity: number;
}

const DEFAULT_BASE_URL = "http://43.135.51.107:8787";
const DEFAULT_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));

  if (config.requireWss && new URL(config.wsUrl).protocol !== "wss:") {
    throw new Error(`expected a wss:// websocket URL, got ${config.wsUrl}`);
  }

  const beforeMetrics = await fetchMetrics(config.metricsUrl, config.timeoutMs);
  const result = await runMatchSmoke(config, beforeMetrics);

  console.log("PVP remote two-client match smoke summary");
  console.log(`websocket: ${config.wsUrl}`);
  console.log(`origin: ${config.origin ?? "(none)"}`);
  console.log(`matched room: ${result.roomCode}`);
  console.log(`player slots: ${result.firstSlot}/${result.secondSlot}`);
  console.log(`elapsed: ${result.elapsedMs} ms`);
  console.log(
    `metrics before connections/queue/countdown/playing/rooms/rejectedByRoomCapacity: `
      + `${result.beforeMetrics.connections}/${result.beforeMetrics.queueSize}/${result.beforeMetrics.countdownRooms}/`
      + `${result.beforeMetrics.playingRooms}/${result.beforeMetrics.rooms}/${result.beforeMetrics.rejectedByRoomCapacity}`,
  );
  console.log(
    `metrics after connections/queue/countdown/playing/rooms/rejectedByRoomCapacity: `
      + `${result.afterMetrics.connections}/${result.afterMetrics.queueSize}/${result.afterMetrics.countdownRooms}/`
      + `${result.afterMetrics.playingRooms}/${result.afterMetrics.rooms}/${result.afterMetrics.rejectedByRoomCapacity}`,
  );
}

function parseArgs(argv: readonly string[]): RemoteMatchSmokeConfig {
  let baseUrl = DEFAULT_BASE_URL;
  let metricsUrl: string | undefined;
  let wsUrl: string | undefined;
  let origin: string | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let requireWss = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === undefined) {
      continue;
    }

    const [flag, inlineValue] = arg.startsWith("--") && arg.includes("=")
      ? arg.split("=", 2)
      : [arg, undefined];

    const takeValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }

      const next = argv[index + 1];
      if (next === undefined) {
        throw new Error(`missing value for ${flag}`);
      }

      index += 1;
      return next;
    };

    switch (flag) {
      case "--base-url":
        baseUrl = takeValue();
        break;
      case "--metrics-url":
        metricsUrl = takeValue();
        break;
      case "--ws-url":
        wsUrl = takeValue();
        break;
      case "--origin":
        origin = takeValue();
        break;
      case "--timeout-ms":
        timeoutMs = readPositiveInteger(takeValue(), "timeout-ms");
        break;
      case "--require-wss":
        requireWss = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }

  return {
    metricsUrl: metricsUrl ?? buildHttpEndpoint(baseUrl, "/metrics.json"),
    wsUrl: wsUrl ?? buildWsEndpoint(baseUrl),
    origin,
    timeoutMs,
    requireWss,
  };
}

function printHelp(): void {
  console.log(`Usage:
  npm run smoke:pvp-remote-match -- --base-url https://pvp.example.com --origin https://<user>.github.io --require-wss
  npm run smoke:pvp-remote-match -- --metrics-url https://pvp.example.com/metrics.json --ws-url wss://pvp.example.com/ws --origin https://<user>.github.io

Options:
  --base-url       Base HTTP/HTTPS URL used to derive /metrics.json and /ws.
  --metrics-url    Full metrics endpoint URL.
  --ws-url         Full WebSocket URL.
  --origin         Origin header for the WebSocket handshake.
  --require-wss    Fail unless the WebSocket URL uses wss://.
  --timeout-ms     Whole-smoke timeout in milliseconds.
`);
}

async function runMatchSmoke(
  config: RemoteMatchSmokeConfig,
  beforeMetrics: MetricsSummary,
): Promise<MatchSmokeResult> {
  const startedAt = Date.now();
  let settled = false;
  let first: ClientState | null = null;
  let second: ClientState | null = null;

  return await new Promise<MatchSmokeResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      fail(new Error(`two-client matchmaking smoke timed out after ${config.timeoutMs} ms: ${formatClientStates(first, second)}`));
    }, config.timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      closeClient(first);
      closeClient(second);
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const maybeSucceed = (): void => {
      if (first === null || second === null || !first.gameStarted || !second.gameStarted) {
        return;
      }

      if (first.roomCode === null || second.roomCode === null || first.roomCode !== second.roomCode) {
        fail(new Error(`clients matched different rooms: ${first.roomCode ?? "(none)"} / ${second.roomCode ?? "(none)"}`));
        return;
      }

      if (first.playerSlot === null || second.playerSlot === null || first.playerSlot === second.playerSlot) {
        fail(new Error(`clients received invalid player slots: ${first.playerSlot ?? "(none)"} / ${second.playerSlot ?? "(none)"}`));
        return;
      }

      void fetchMetrics(config.metricsUrl, config.timeoutMs)
        .then((afterMetrics) => {
          if (settled || first === null || second === null || first.roomCode === null || first.playerSlot === null || second.playerSlot === null) {
            return;
          }

          settled = true;
          cleanup();
          resolve({
            roomCode: first.roomCode,
            firstSlot: first.playerSlot,
            secondSlot: second.playerSlot,
            elapsedMs: Date.now() - startedAt,
            beforeMetrics,
            afterMetrics,
          });
        })
        .catch(fail);
    };

    const handleMessage = (client: ClientState, data: WebSocket.RawData): void => {
      const message = parseMessage(data);

      if (message === null) {
        fail(new Error(`${client.label} received an invalid JSON message`));
        return;
      }

      switch (message.type) {
        case "welcome":
          client.welcomed = true;
          send(client.socket, {
            type: "hello",
            clientVersion: "remote-match-smoke",
          });
          send(client.socket, { type: "matchmakingJoin" });
          return;
        case "queueState":
          client.queued = message.position !== undefined;
          return;
        case "matchFound":
          client.matchFound = true;
          client.roomCode = message.roomCode;
          client.playerSlot = message.playerSlot;
          return;
        case "countdown":
          return;
        case "gameStart":
          if (!client.matchFound) {
            fail(new Error(`${client.label} received gameStart before matchFound`));
            return;
          }

          client.gameStarted = true;
          maybeSucceed();
          return;
        case "error":
          fail(new Error(`${client.label} received ${message.code}: ${message.message}`));
          return;
        case "serverShutdown":
          fail(new Error(`${client.label} received serverShutdown`));
          return;
        case "pong":
        case "roomCreated":
        case "roomJoined":
        case "roomState":
        case "opponentLeft":
        case "reconnectResult":
        case "peerInput":
        case "snapshot":
        case "gameOver":
          return;
      }
    };

    const createClient = (label: string): ClientState => {
      const socket = new WebSocket(config.wsUrl, {
        handshakeTimeout: config.timeoutMs,
        origin: config.origin,
      });
      const client: ClientState = {
        label,
        socket,
        welcomed: false,
        queued: false,
        matchFound: false,
        gameStarted: false,
        roomCode: null,
        playerSlot: null,
      };

      socket.on("message", (data) => {
        handleMessage(client, data);
      });
      socket.on("error", (error) => {
        fail(new Error(`${label} socket error: ${error.message}`));
      });
      socket.on("close", (code, reason) => {
        if (!settled) {
          fail(new Error(`${label} socket closed before match completed: ${code} ${reason.toString()}`.trim()));
        }
      });
      socket.on("unexpected-response", (_request, response) => {
        fail(new Error(`${label} websocket upgrade failed with HTTP ${response.statusCode ?? "unknown"}`));
      });

      return client;
    };

    first = createClient("client-1");
    second = createClient("client-2");
  });
}

function closeClient(client: ClientState | null): void {
  if (client === null) {
    return;
  }

  if (client.socket.readyState === WebSocket.OPEN || client.socket.readyState === WebSocket.CONNECTING) {
    client.socket.close(1000, "remote-match-smoke-complete");
  }
}

function formatClientStates(first: ClientState | null, second: ClientState | null): string {
  return [first, second]
    .map((client) => client === null
      ? "(not-created)"
      : `${client.label}{welcomed=${String(client.welcomed)},queued=${String(client.queued)},matchFound=${String(client.matchFound)},gameStarted=${String(client.gameStarted)},roomCode=${client.roomCode ?? "none"},slot=${client.playerSlot ?? "none"},readyState=${client.socket.readyState}}`)
    .join(" ");
}

async function fetchMetrics(url: string, timeoutMs: number): Promise<MetricsSummary> {
  const metrics = await fetchJson(url, timeoutMs);

  return {
    connections: numberValue(metrics.connections),
    queueSize: numberValue(metrics.queueSize),
    countdownRooms: numberValue(metrics.countdownRooms),
    playingRooms: numberValue(metrics.playingRooms),
    rooms: numberValue(metrics.rooms),
    rejectedByRoomCapacity: numberValue(metrics.rejectedByRoomCapacity),
  };
}

async function fetchJson(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }

    const json = await response.json();

    if (!isRecord(json)) {
      throw new Error(`${url} did not return a JSON object`);
    }

    return json;
  } finally {
    clearTimeout(timer);
  }
}

function buildHttpEndpoint(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function buildWsEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseMessage(data: WebSocket.RawData): ServerToClientMessage | null {
  const text = rawDataToText(data);

  if (text === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;

    if (isRecord(parsed) && typeof parsed.type === "string") {
      return parsed as ServerToClientMessage;
    }
  } catch {
    return null;
  }

  return null;
}

function rawDataToText(data: WebSocket.RawData): string | null {
  if (typeof data === "string") {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return null;
}

function send(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function readPositiveInteger(value: string, name: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PVP remote match smoke failed: ${message}`);
  process.exitCode = 1;
});
