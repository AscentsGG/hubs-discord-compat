/*
 * The live event connection: HELLO, IDENTIFY (with the token in IDENTIFY,
 * since the WebSocket built into Node cannot set headers), heartbeats,
 * RESUME after a dropped connection, RECONNECT and INVALID_SESSION, all as
 * the gateway page of the Hubs developer docs describes
 * (https://thehubs.gg/developers/docs/gateway).
 */
import { EventEmitter } from "node:events";

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;
/** Close codes after which a resume never works. */
const FATAL = new Set([4004, 4010, 4013, 4014]);
const FRESH = new Set([4007]);

export interface GatewayFrame {
  op: number;
  t?: string;
  s?: number;
  d?: any;
}
type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: any) => void): void;
};
export type WebSocketConstructor = new (url: string) => SocketLike;

export interface GatewayOptions {
  url: string;
  token: string;
  intents: number;
  shard: [number, number];
  WebSocket?: WebSocketConstructor;
  /** Most reconnect attempts in a row before giving up. Default 8. */
  maxReconnects?: number;
}

export class HubsGateway extends EventEmitter {
  sessionId: string | null = null;
  seq: number | null = null;
  ping = -1;
  private socket: SocketLike | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private acked = true;
  private sentAt = 0;
  private destroyed = false;
  private failures = 0;
  private readonly Socket: WebSocketConstructor;
  constructor(private readonly options: GatewayOptions) {
    super();
    const Socket =
      options.WebSocket ??
      ((globalThis as { WebSocket?: WebSocketConstructor }).WebSocket as
        WebSocketConstructor | undefined);
    if (!Socket)
      throw new Error(
        "This Node has no built in WebSocket. Use Node 22 or later, or pass hubs.WebSocket.",
      );
    this.Socket = Socket;
  }
  connect() {
    if (this.destroyed) return;
    const socket = new this.Socket(this.options.url);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      let frame: GatewayFrame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.receive(frame);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.closed(Number(event.code ?? 1006), String(event.reason ?? ""));
    });
    socket.addEventListener("error", () => {
      this.emit("debug", "Gateway socket error.");
    });
  }
  private send(frame: GatewayFrame) {
    if (this.socket && this.socket.readyState === 1)
      this.socket.send(JSON.stringify(frame));
  }
  private receive(frame: GatewayFrame) {
    switch (frame.op) {
      case OP.HELLO:
        this.startHeartbeat(Number(frame.d?.heartbeatInterval ?? 41_250));
        if (this.sessionId && this.seq !== null)
          this.send({
            op: OP.RESUME,
            d: {
              token: this.options.token,
              sessionId: this.sessionId,
              seq: this.seq,
            },
          });
        else
          this.send({
            op: OP.IDENTIFY,
            d: {
              token: this.options.token,
              intents: this.options.intents,
              shard: this.options.shard,
            },
          });
        return;
      case OP.HEARTBEAT_ACK:
        this.acked = true;
        this.ping = Date.now() - this.sentAt;
        return;
      case OP.HEARTBEAT:
        this.beat();
        return;
      case OP.RECONNECT:
        this.emit("debug", "The gateway asked for a reconnect.");
        this.socket?.close(4000, "Reconnect requested");
        return;
      case OP.INVALID_SESSION:
        this.emit("debug", "The gateway said the session is invalid.");
        if (!frame.d) {
          this.sessionId = null;
          this.seq = null;
        }
        this.socket?.close(4000, "Invalid session");
        return;
      case OP.DISPATCH:
        if (typeof frame.s === "number") this.seq = frame.s;
        if (frame.t === "READY") {
          this.sessionId = String(frame.d?.sessionId ?? "");
          this.failures = 0;
        }
        if (frame.t === "RESUMED") this.failures = 0;
        this.emit("dispatch", frame.t, frame.d);
        return;
    }
  }
  private startHeartbeat(interval: number) {
    this.stopHeartbeat();
    this.acked = true;
    this.heartbeat = setInterval(() => {
      if (!this.acked) {
        this.emit("debug", "No heartbeat answer; reconnecting.");
        this.socket?.close(4000, "Zombie connection");
        return;
      }
      this.beat();
    }, interval);
    this.heartbeat.unref?.();
  }
  private beat() {
    this.acked = false;
    this.sentAt = Date.now();
    this.send({ op: OP.HEARTBEAT, d: this.seq });
  }
  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
  private closed(code: number, reason: string) {
    this.stopHeartbeat();
    this.socket = null;
    if (this.destroyed) return;
    this.emit("debug", `Gateway closed ${code} ${reason}`.trim());
    if (FATAL.has(code)) {
      this.destroyed = true;
      this.emit("fatal", code, reason);
      return;
    }
    if (FRESH.has(code)) {
      this.sessionId = null;
      this.seq = null;
    }
    this.failures += 1;
    if (this.failures > (this.options.maxReconnects ?? 8)) {
      this.destroyed = true;
      this.emit("fatal", code, "Gave up reconnecting.");
      return;
    }
    const wait = Math.min(30_000, 250 * 2 ** (this.failures - 1));
    const timer = setTimeout(() => this.connect(), wait);
    timer.unref?.();
  }
  /** Drops the socket the way a network failure would (for tests). */
  drop() {
    this.socket?.close(4000, "Dropped");
  }
  destroy() {
    this.destroyed = true;
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "Client destroyed");
  }
}
