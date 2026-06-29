import { performance } from "node:perf_hooks";

import WebSocket from "ws";

import type { Direction, ServerToClientMessage } from "../src/pvp/net/protocol.js";

interface LoadTestConfig {
  url: string;
  metricsUrl: string;
  clients: number;
  durationSec: number;
  inputRate: number;
  rampUpSec: number;
  pingIntervalMs: number;
  metricsPollMs: number;
  metricsTimeoutMs: number;
  origin: string;
}

interface LoadTestStats {
  connectionsOpened: number;
  welcomes: number;
  queueJoins: number;
  matchFound: number;
  gameStarts: number;
  gameOvers: number;
  disconnects: number;
  errorsByCode: Map<string, number>;
  matchWaitMs: number[];
  pingRttsMs: number[];
  metricsSnapshots: MetricsSnapshot[];
  metricsFetchFailures: number;
  unknownErrorCount: number;
  fatalErrors: string[];
  peakActiveRooms: number;
  peakPlayingRooms: number;
  peakCountdownRooms: number;
  peakRooms: number;
  peakQueueSize: number;
}

interface MetricsSnapshot {
  readonly timestamp: number;
  readonly connections: number;
  readonly rooms: number;
  readonly queueSize: number;
  readonly countdownRooms: number;
  readonly playingRooms: number;
  readonly finishedRooms: number;
  readonly totalMatches: number;
  readonly totalGameStarts: number;
  readonly totalGameOvers: number;
  readonly uptime: number;
  readonly memoryRss: number;
  readonly messagesInPerSec: number;
  readonly messagesOutPerSec: number;
}

interface ClientState {
  readonly index: number;
  readonly url: string;
  socket: WebSocket;
  openedAt?: number;
  welcomedAt?: number;
  queueJoinedAt?: number;
  queueConfirmed: boolean;
  matchFoundAt?: number;
  gameStartAt?: number;
  startTick?: number;
  tickRate?: number;
  inputDelayTicks?: number;
  seq: number;
  lastDirection: Direction;
  phase: "connecting" | "waiting" | "queued" | "playing" | "finished" | "closed";
  nextInputAt: number;
  nextPingAt: number;
  pendingPingClientTime?: number;
  pendingPingSentAt?: number;
  requeueTimer?: NodeJS.Timeout;
  closing: boolean;
  closed: boolean;
}

const DEFAULT_CONFIG: LoadTestConfig = {
  url: "ws://localhost:8787/ws",
  metricsUrl: "http://localhost:8787/metrics.json",
  clients: 200,
  durationSec: 120,
  inputRate: 10,
  rampUpSec: 10,
  pingIntervalMs: 5_000,
  metricsPollMs: 2_000,
  metricsTimeoutMs: 5_000,
  origin: "http://localhost:5173",
};

const KNOWN_ERROR_CODES = new Set([
  "invalid_message",
  "unsupported_version",
  "invalid_session",
  "room_not_found",
  "room_full",
  "room_capacity_reached",
  "not_in_room",
  "already_in_room",
  "queue_full",
  "capacity_reached",
  "invalid_state",
  "service_busy",
  "rate_limited",
  "server_busy",
  "server_shutdown",
  "internal_error",
]);

const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  up: "down",
  right: "left",
  down: "up",
  left: "right",
};

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const stats = createStats();
  const startedAt = performance.now();
  const endAt = startedAt + config.durationSec * 1000;
  const clients: ClientState[] = [];
  const timers: NodeJS.Timeout[] = [];
  let stopping = false;
  let fatalError: Error | null = null;
  let activeMetricsPoll = false;

  const onFatal = (error: unknown): void => {
    if (fatalError !== null) {
      return;
    }

    fatalError = error instanceof Error ? error : new Error(String(error));
    stats.fatalErrors.push(fatalError.message);
    console.error(JSON.stringify({
      event: "fatal_error",
      message: fatalError.message,
    }));
  };

  process.once("uncaughtException", onFatal);
  process.once("unhandledRejection", onFatal);

  for (let index = 0; index < config.clients; index += 1) {
    const delayMs = config.clients === 1
      ? 0
      : Math.round((index / (config.clients - 1)) * config.rampUpSec * 1000);

    const timer = setTimeout(() => {
      if (stopping || fatalError !== null) {
        return;
      }

      const client = createClient(index, config, stats, clients, endAt);
      clients.push(client);
    }, delayMs);

    timer.unref();
    timers.push(timer);
  }

  const scheduler = setInterval(() => {
    if (stopping || fatalError !== null) {
      return;
    }

    const now = performance.now();

    for (const client of clients) {
      if (client.closed || client.closing || client.socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      maybeSendPing(client, config, now);
      maybeSendInput(client, config, now);
    }
  }, 50);
  scheduler.unref();
  timers.push(scheduler);

  const metricsPoller = setInterval(() => {
    if (stopping || fatalError !== null || activeMetricsPoll) {
      return;
    }

    activeMetricsPoll = true;
    void pollMetrics(config, stats)
      .catch((error: unknown) => {
        stats.metricsFetchFailures += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({
          event: "metrics_fetch_error",
          message,
        }));
        if (fatalError === null) {
          fatalError = error instanceof Error ? error : new Error(message);
        }
      })
      .finally(() => {
        activeMetricsPoll = false;
      });
  }, config.metricsPollMs);
  metricsPoller.unref();
  timers.push(metricsPoller);

  await sleep(config.durationSec * 1000);

  stopping = true;

  await pollMetrics(config, stats);

  await closeClients(clients);

  for (const timer of timers) {
    clearInterval(timer);
    clearTimeout(timer);
  }

  process.removeListener("uncaughtException", onFatal);
  process.removeListener("unhandledRejection", onFatal);

  printReport(config, stats, clients.length);

  if (fatalError !== null) {
    process.exitCode = 1;
    return;
  }

  const successRate = clients.length === 0 ? 0 : stats.welcomes / clients.length;
  const expectedRooms = Math.floor(clients.length / 2);
  const pingP95 = percentile(stats.pingRttsMs, 0.95);
  const unknownErrors = stats.unknownErrorCount;

  if (successRate < 0.98) {
    process.exitCode = 1;
  }

  if (config.clients >= 100 && stats.peakActiveRooms < Math.max(1, Math.floor(expectedRooms * 0.9))) {
    process.exitCode = 1;
  }

  if (unknownErrors > 0) {
    process.exitCode = 1;
  }

  if (pingP95 > 300) {
    console.warn(`warning: p95 ping/pong is ${pingP95.toFixed(1)} ms`);
  }
}

function createStats(): LoadTestStats {
  return {
    connectionsOpened: 0,
    welcomes: 0,
    queueJoins: 0,
    matchFound: 0,
    gameStarts: 0,
    gameOvers: 0,
    disconnects: 0,
    errorsByCode: new Map<string, number>(),
    matchWaitMs: [],
    pingRttsMs: [],
    metricsSnapshots: [],
    metricsFetchFailures: 0,
    unknownErrorCount: 0,
    fatalErrors: [],
    peakActiveRooms: 0,
    peakPlayingRooms: 0,
    peakCountdownRooms: 0,
    peakRooms: 0,
    peakQueueSize: 0,
  };
}

function createClient(
  index: number,
  config: LoadTestConfig,
  stats: LoadTestStats,
  clients: ClientState[],
  endAt: number,
): ClientState {
  const socket = new WebSocket(config.url, {
    origin: config.origin,
  });

  const client: ClientState = {
    index,
    url: config.url,
    socket,
    queueConfirmed: false,
    seq: 0,
    lastDirection: index % 2 === 0 ? "right" : "left",
    phase: "connecting",
    nextInputAt: performance.now(),
    nextPingAt: performance.now() + config.pingIntervalMs,
    closing: false,
    closed: false,
  };

  socket.on("open", () => {
    if (client.closed || client.closing) {
      return;
    }

    client.openedAt = performance.now();
    stats.connectionsOpened += 1;
    send(socket, {
      type: "hello",
      clientVersion: "0.1.0",
    });
  });

  socket.on("message", (data) => {
    if (client.closed) {
      return;
    }

    const parsed = parseMessage(data);

    if (parsed === null) {
      recordError(stats, "invalid_message");
      return;
    }

    handleServerMessage(client, parsed, config, stats, endAt);
  });

  socket.on("error", (error) => {
    if (client.closed || client.closing) {
      return;
    }

    recordError(stats, "socket_error");
    console.error(JSON.stringify({
      event: "socket_error",
      index: client.index,
      message: error.message,
    }));
  });

  socket.on("close", (code, reason) => {
    client.closed = true;
    if (!client.closing) {
      stats.disconnects += 1;
    }

    console.log(JSON.stringify({
      event: "client_close",
      index: client.index,
      code,
      reason: reason.toString(),
    }));
  });

  return client;
}

function handleServerMessage(
  client: ClientState,
  message: ServerToClientMessage,
  config: LoadTestConfig,
  stats: LoadTestStats,
  endAt: number,
): void {
  const now = performance.now();

  switch (message.type) {
    case "welcome":
      stats.welcomes += 1;
      client.welcomedAt = now;
      client.phase = "waiting";
      client.nextInputAt = now;
      client.nextPingAt = now + config.pingIntervalMs;
      send(client.socket, {
        type: "matchmakingJoin",
      });
      client.queueJoinedAt = now;
      client.queueConfirmed = false;
      client.phase = "queued";
      return;
    case "queueState":
      if (!client.queueConfirmed && client.queueJoinedAt !== undefined) {
        client.queueConfirmed = true;
        stats.queueJoins += 1;
      }
      return;
    case "matchFound":
      stats.matchFound += 1;
      client.matchFoundAt = now;
      client.phase = "queued";
      if (client.queueJoinedAt !== undefined) {
        stats.matchWaitMs.push(Math.max(0, now - client.queueJoinedAt));
      }
      client.lastDirection = client.lastDirection;
      return;
    case "countdown":
      return;
    case "gameStart":
      stats.gameStarts += 1;
      client.phase = "playing";
      client.gameStartAt = now;
      client.startTick = message.startTick;
      client.tickRate = message.tickRate;
      client.inputDelayTicks = message.inputDelayTicks;
      client.nextInputAt = now;
      client.nextPingAt = now + config.pingIntervalMs;
      if (client.requeueTimer !== undefined) {
        clearTimeout(client.requeueTimer);
        client.requeueTimer = undefined;
      }
      return;
    case "gameOver":
      stats.gameOvers += 1;
      client.phase = "finished";
      if (now < endAt - 100) {
        scheduleRequeue(client);
      }
      return;
    case "error":
      recordError(stats, message.code);
      return;
    case "pong":
      if (client.pendingPingClientTime === message.clientTime && client.pendingPingSentAt !== undefined) {
        stats.pingRttsMs.push(Math.max(0, now - client.pendingPingSentAt));
        client.pendingPingClientTime = undefined;
        client.pendingPingSentAt = undefined;
      }
      return;
    case "serverShutdown":
      recordError(stats, "server_shutdown");
      return;
    default:
      return;
  }
}

function maybeSendInput(client: ClientState, config: LoadTestConfig, now: number): void {
  if (client.phase !== "playing" || client.gameStartAt === undefined || client.startTick === undefined || client.tickRate === undefined) {
    return;
  }

  const intervalMs = Math.max(1, Math.round(1000 / config.inputRate));

  while (now >= client.nextInputAt) {
    const direction = chooseDirection(client.lastDirection);
    client.seq += 1;
    client.lastDirection = direction;
    send(client.socket, {
      type: "input",
      seq: client.seq,
      tick: estimateTick(client, now),
      direction,
    });
    client.nextInputAt += intervalMs;
  }
}

function maybeSendPing(client: ClientState, config: LoadTestConfig, now: number): void {
  if (client.pendingPingClientTime !== undefined || now < client.nextPingAt) {
    return;
  }

  const clientTime = Math.floor(now);
  client.pendingPingClientTime = clientTime;
  client.pendingPingSentAt = now;
  client.nextPingAt = now + config.pingIntervalMs;
  send(client.socket, {
    type: "ping",
    clientTime,
  });
}

function scheduleRequeue(client: ClientState): void {
  if (client.requeueTimer !== undefined || client.closed || client.closing) {
    return;
  }

  client.requeueTimer = setTimeout(() => {
    client.requeueTimer = undefined;

    if (client.closed || client.closing || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    send(client.socket, { type: "leaveRoom" });

    setTimeout(() => {
      if (client.closed || client.closing || client.socket.readyState !== WebSocket.OPEN) {
        return;
      }

      client.queueJoinedAt = performance.now();
      client.queueConfirmed = false;
      client.phase = "queued";
      send(client.socket, { type: "matchmakingJoin" });
    }, 100).unref();
  }, 0);

  client.requeueTimer.unref();
}

function estimateTick(client: ClientState, now: number): number {
  if (client.gameStartAt === undefined || client.startTick === undefined || client.tickRate === undefined) {
    return 0;
  }

  const elapsedSeconds = Math.max(0, (now - client.gameStartAt) / 1000);
  return client.startTick + Math.floor(elapsedSeconds * client.tickRate) + 1;
}

function chooseDirection(current: Direction): Direction {
  const options: Direction[] = ["up", "right", "down", "left"].filter(
    (direction) => direction !== OPPOSITE_DIRECTIONS[current],
  ) as Direction[];
  return options[Math.floor(Math.random() * options.length)] ?? current;
}

function send(socket: WebSocket, message: ServerToClientMessage | Record<string, unknown>): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function parseMessage(data: unknown): ServerToClientMessage | null {
  const text = rawDataToText(data);

  if (text === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as ServerToClientMessage;
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { readonly type?: unknown }).type === "string") {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function rawDataToText(data: unknown): string | null {
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

function recordError(stats: LoadTestStats, code: string): void {
  const normalized = KNOWN_ERROR_CODES.has(code) ? code : "unknown";
  stats.errorsByCode.set(normalized, (stats.errorsByCode.get(normalized) ?? 0) + 1);

  if (normalized === "unknown") {
    stats.unknownErrorCount += 1;
  }
}

async function pollMetrics(config: LoadTestConfig, stats: LoadTestStats): Promise<void> {
  const response = await fetchWithTimeout(config.metricsUrl, config.metricsTimeoutMs);

  if (!response.ok) {
    throw new Error(`metrics request failed with ${response.status}`);
  }

  const metrics = await response.json() as Record<string, unknown>;
  const snapshot: MetricsSnapshot = {
    timestamp: Date.now(),
    connections: numberValue(metrics.connections),
    rooms: numberValue(metrics.rooms),
    queueSize: numberValue(metrics.queueSize),
    countdownRooms: numberValue(metrics.countdownRooms),
    playingRooms: numberValue(metrics.playingRooms),
    finishedRooms: numberValue(metrics.finishedRooms),
    totalMatches: numberValue(metrics.totalMatches),
    totalGameStarts: numberValue(metrics.totalGameStarts),
    totalGameOvers: numberValue(metrics.totalGameOvers),
    uptime: numberValue(metrics.uptime),
    memoryRss: numberValue(metrics.memoryRss),
    messagesInPerSec: numberValue(metrics.messagesInPerSec),
    messagesOutPerSec: numberValue(metrics.messagesOutPerSec),
  };

  stats.metricsSnapshots.push(snapshot);
  stats.peakActiveRooms = Math.max(stats.peakActiveRooms, snapshot.countdownRooms + snapshot.playingRooms);
  stats.peakCountdownRooms = Math.max(stats.peakCountdownRooms, snapshot.countdownRooms);
  stats.peakPlayingRooms = Math.max(stats.peakPlayingRooms, snapshot.playingRooms);
  stats.peakRooms = Math.max(stats.peakRooms, snapshot.rooms);
  stats.peakQueueSize = Math.max(stats.peakQueueSize, snapshot.queueSize);

  console.log(JSON.stringify({
    event: "metrics_sample",
    connections: snapshot.connections,
    rooms: snapshot.rooms,
    queueSize: snapshot.queueSize,
    countdownRooms: snapshot.countdownRooms,
    playingRooms: snapshot.playingRooms,
    totalMatches: snapshot.totalMatches,
    totalGameStarts: snapshot.totalGameStarts,
    totalGameOvers: snapshot.totalGameOvers,
  }));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function closeClients(clients: readonly ClientState[]): Promise<void> {
  await Promise.all(clients.map(async (client) => {
    if (client.closed) {
      return;
    }

    client.closing = true;
    if (client.socket.readyState === WebSocket.OPEN || client.socket.readyState === WebSocket.CONNECTING) {
      client.socket.close(1000, "load-test-end");
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        client.socket.terminate();
        resolve();
      }, 3_000);

      timer.unref();

      client.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }));
}

function printReport(config: LoadTestConfig, stats: LoadTestStats, launchedClients: number): void {
  const pingP50 = percentile(stats.pingRttsMs, 0.5);
  const pingP95 = percentile(stats.pingRttsMs, 0.95);
  const pingP99 = percentile(stats.pingRttsMs, 0.99);
  const avgWait = average(stats.matchWaitMs);

  console.log("");
  console.log("PVP load test summary");
  console.log(`clients: ${launchedClients}`);
  console.log(`duration: ${config.durationSec}s`);
  console.log(`connections opened: ${stats.connectionsOpened}`);
  console.log(`welcomes: ${stats.welcomes}`);
  console.log(`queue joins: ${stats.queueJoins}`);
  console.log(`matchFound: ${stats.matchFound}`);
  console.log(`gameStart: ${stats.gameStarts}`);
  console.log(`gameOver: ${stats.gameOvers}`);
  console.log(`disconnects: ${stats.disconnects}`);
  console.log(`avg matchmaking wait: ${avgWait.toFixed(1)} ms`);
  console.log(`ping rtt p50/p95/p99: ${pingP50.toFixed(1)} / ${pingP95.toFixed(1)} / ${pingP99.toFixed(1)} ms`);
  console.log(`peak rooms: ${stats.peakRooms}`);
  console.log(`peak active rooms: ${stats.peakActiveRooms}`);
  console.log(`peak playingRooms: ${stats.peakPlayingRooms}`);
  console.log(`peak countdownRooms: ${stats.peakCountdownRooms}`);
  console.log(`peak queueSize: ${stats.peakQueueSize}`);
  console.log(`metrics fetch failures: ${stats.metricsFetchFailures}`);
  console.log(`unknown errors: ${stats.unknownErrorCount}`);
  console.log(`errors: ${JSON.stringify(Object.fromEntries(stats.errorsByCode))}`);

  const lastSnapshot = stats.metricsSnapshots[stats.metricsSnapshots.length - 1];

  if (lastSnapshot !== undefined) {
    console.log(`server metrics: ${JSON.stringify(lastSnapshot)}`);
  }
}

function parseArgs(argv: readonly string[]): LoadTestConfig {
  const config: LoadTestConfig = {
    ...DEFAULT_CONFIG,
  };

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
      case "--url":
        config.url = takeValue();
        config.metricsUrl = buildMetricsUrl(config.url);
        break;
      case "--metrics-url":
        config.metricsUrl = takeValue();
        break;
      case "--clients":
        config.clients = readPositiveInteger(takeValue(), "clients");
        break;
      case "--duration":
        config.durationSec = readPositiveInteger(takeValue(), "duration");
        break;
      case "--input-rate":
        config.inputRate = readPositiveInteger(takeValue(), "input-rate");
        break;
      case "--ramp-up":
        config.rampUpSec = readPositiveInteger(takeValue(), "ramp-up");
        break;
      case "--origin":
        config.origin = takeValue();
        break;
      case "--metrics-timeout":
        config.metricsTimeoutMs = readPositiveInteger(takeValue(), "metrics-timeout");
        break;
      default:
        if (!flag.startsWith("--")) {
          throw new Error(`unexpected argument: ${flag}`);
        }
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  config.metricsUrl = config.metricsUrl ?? buildMetricsUrl(config.url);
  return config;
}

function buildMetricsUrl(wsUrl: string): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/metrics.json";
  url.search = "";
  url.hash = "";
  return url.toString();
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

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((total, value) => total + value, 0);
  return sum / values.length;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
