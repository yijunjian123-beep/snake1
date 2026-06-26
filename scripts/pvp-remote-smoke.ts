import WebSocket from "ws";

import type { ServerToClientMessage } from "../src/pvp/net/protocol.js";

interface RemoteSmokeConfig {
  readonly healthUrl: string;
  readonly metricsUrl: string;
  readonly wsUrl: string;
  readonly origin?: string;
  readonly timeoutMs: number;
  readonly skipWs: boolean;
  readonly requireWss: boolean;
}

interface WsSmokeResult {
  readonly welcomeReceived: boolean;
  readonly pongReceived: boolean;
  readonly latencyMs: number;
}

const DEFAULT_BASE_URL = "http://43.135.51.107:8787";
const DEFAULT_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));

  const health = await fetchJson(config.healthUrl, config.timeoutMs);
  assertBoolean(health.ok, "health.ok");
  assertNumber(health.uptime, "health.uptime");
  assertNumber(health.connections, "health.connections");

  const metrics = await fetchJson(config.metricsUrl, config.timeoutMs);
  assertNumber(metrics.connections, "metrics.connections");
  assertNumber(metrics.rooms, "metrics.rooms");
  assertNumber(metrics.queueSize, "metrics.queueSize");
  assertNumber(metrics.playingRooms, "metrics.playingRooms");
  assertNumber(metrics.maxConnections, "metrics.maxConnections");
  assertNumber(metrics.maxRooms, "metrics.maxRooms");
  assertNumber(metrics.maxQueue, "metrics.maxQueue");

  let wsResult: WsSmokeResult | null = null;

  if (!config.skipWs) {
    if (config.requireWss && new URL(config.wsUrl).protocol !== "wss:") {
      throw new Error(`expected a wss:// websocket URL, got ${config.wsUrl}`);
    }

    wsResult = await connectWebSocket(config);
  }

  console.log("PVP remote smoke summary");
  console.log(`health: ${config.healthUrl}`);
  console.log(`metrics: ${config.metricsUrl}`);
  console.log(`websocket: ${config.skipWs ? "skipped" : config.wsUrl}`);
  console.log(`origin: ${config.origin ?? "(none)"}`);
  console.log(`health ok: ${String(health.ok)}`);
  console.log(`metrics connections/rooms/queue: ${metrics.connections}/${metrics.rooms}/${metrics.queueSize}`);

  if (wsResult !== null) {
    console.log(`websocket welcome/pong: ${wsResult.welcomeReceived}/${wsResult.pongReceived}`);
    console.log(`websocket ping latency: ${wsResult.latencyMs} ms`);
  }
}

function parseArgs(argv: readonly string[]): RemoteSmokeConfig {
  let baseUrl = DEFAULT_BASE_URL;
  let healthUrl: string | undefined;
  let metricsUrl: string | undefined;
  let wsUrl: string | undefined;
  let origin: string | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let skipWs = false;
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
      case "--health-url":
        healthUrl = takeValue();
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
      case "--skip-ws":
        skipWs = true;
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
    healthUrl: healthUrl ?? buildHttpEndpoint(baseUrl, "/health"),
    metricsUrl: metricsUrl ?? buildHttpEndpoint(baseUrl, "/metrics.json"),
    wsUrl: wsUrl ?? buildWsEndpoint(baseUrl),
    origin,
    timeoutMs,
    skipWs,
    requireWss,
  };
}

function printHelp(): void {
  console.log(`Usage:
  npm run smoke:pvp-remote -- --base-url http://43.135.51.107:8787 --origin http://localhost:5173
  npm run smoke:pvp-remote -- --base-url https://pvp.example.com --ws-url wss://pvp.example.com/ws --origin https://<user>.github.io --require-wss

Options:
  --base-url       Base HTTP/HTTPS URL used to derive /health, /metrics.json, and /ws.
  --health-url     Full health endpoint URL.
  --metrics-url    Full metrics endpoint URL.
  --ws-url         Full WebSocket URL.
  --origin         Origin header for the WebSocket handshake.
  --skip-ws        Only check HTTP endpoints.
  --require-wss    Fail unless the WebSocket URL uses wss://.
  --timeout-ms     Per-step timeout in milliseconds.
`);
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

function connectWebSocket(config: RemoteSmokeConfig): Promise<WsSmokeResult> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(config.wsUrl, {
      handshakeTimeout: config.timeoutMs,
      origin: config.origin,
    });
    const startedAt = Date.now();
    const clientTime = startedAt;
    let welcomeReceived = false;
    let settled = false;

    const timeout = setTimeout(() => {
      fail(new Error(`websocket smoke timed out after ${config.timeoutMs} ms`));
    }, config.timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", fail);
      socket.off("close", onClose);
      socket.off("unexpected-response", onUnexpectedResponse);
    };

    const succeed = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.close(1000, "remote-smoke-complete");
      resolve({
        welcomeReceived,
        pongReceived: true,
        latencyMs: Date.now() - startedAt,
      });
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
      }

      reject(error);
    };

    const onMessage = (data: WebSocket.RawData): void => {
      const message = parseMessage(data);

      if (message === null) {
        fail(new Error("websocket returned an invalid JSON message"));
        return;
      }

      switch (message.type) {
        case "welcome":
          welcomeReceived = true;
          send(socket, {
            type: "hello",
            clientVersion: "remote-smoke",
          });
          send(socket, {
            type: "ping",
            clientTime,
          });
          return;
        case "pong":
          if (!welcomeReceived) {
            fail(new Error("websocket returned pong before welcome"));
            return;
          }

          if (message.clientTime !== clientTime) {
            fail(new Error("websocket returned pong with the wrong clientTime"));
            return;
          }

          succeed();
          return;
        case "error":
          fail(new Error(`websocket server returned ${message.code}: ${message.message}`));
          return;
        case "serverShutdown":
          fail(new Error("websocket server is shutting down"));
          return;
        default:
          return;
      }
    };

    const onClose = (code: number, reason: Buffer): void => {
      if (!settled) {
        fail(new Error(`websocket closed before smoke completed: ${code} ${reason.toString()}`.trim()));
      }
    };

    const onUnexpectedResponse = (_request: unknown, response: { readonly statusCode?: number }): void => {
      fail(new Error(`websocket upgrade failed with HTTP ${response.statusCode ?? "unknown"}`));
    };

    socket.on("message", onMessage);
    socket.on("error", fail);
    socket.on("close", onClose);
    socket.on("unexpected-response", onUnexpectedResponse);
  });
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

function assertBoolean(value: unknown, name: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
}

function assertNumber(value: unknown, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPositiveInteger(value: string, name: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PVP remote smoke failed: ${message}`);
  process.exitCode = 1;
});
