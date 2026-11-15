/*
 * The HTTP side: calls the Hubs developer API with `Authorization: Bot`,
 * waits out a 429 using Retry-After, and turns error answers into
 * HubsAPIError. Also exports discord.js-style REST and Routes, so a
 * deploy-commands script ports by changing its import and base URL.
 */
import { createHash, randomUUID } from "node:crypto";
import { toHubsCommand, toHubsMessage } from "./convert.js";
import { HubsAPIError, notSupported } from "./errors.js";

export const DEFAULT_BASE_URL = "https://thehubs.gg";
export const API_PREFIX = "/api/developer/v1";

export interface HubsRestOptions {
  /** The Hubs site, for example https://thehubs.gg. */
  baseUrl?: string;
  /** discord.js's name for the same thing. A path is ignored. */
  api?: string;
  /** Accepted for discord.js compatibility; Hubs has one API version. */
  version?: string;
  /** How many times to wait out a 429 before giving up. Default 3. */
  retries?: number;
  /** The longest single wait for a 429, in seconds. Default 60. */
  maxRetryAfter?: number;
  fetch?: typeof fetch;
}

export function resolveBaseUrl(
  options: { baseUrl?: string; api?: string } = {},
) {
  const raw =
    options.baseUrl ??
    (options.api ? new URL(options.api).origin : undefined) ??
    process.env.HUBS_BASE_URL ??
    DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

export function assertHubsToken(token: unknown): asserts token is string {
  if (typeof token !== "string" || !token)
    throw new TypeError(
      "No bot token. Pass your Hubs bot token (it starts with hbot_) or set HUBS_BOT_TOKEN.",
    );
  if (!/^hbot_[0-9A-Za-z]{46}$/.test(token))
    throw new TypeError(
      "That is not a Hubs bot token. Hubs tokens start with hbot_; make one in the Hubs developer portal. A Discord token does not work on Hubs.",
    );
}

export class HubsRest {
  readonly baseUrl: string;
  private token: string | null = null;
  private readonly retries: number;
  private readonly maxRetryAfter: number;
  private readonly fetcher: typeof fetch;
  constructor(options: HubsRestOptions = {}) {
    this.baseUrl = resolveBaseUrl(options);
    this.retries = options.retries ?? 3;
    this.maxRetryAfter = options.maxRetryAfter ?? 60;
    this.fetcher = options.fetch ?? fetch;
  }
  setToken(token: string) {
    assertHubsToken(token);
    this.token = token;
    return this;
  }
  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<any> {
    if (!this.token)
      throw new Error("Set a token before calling the Hubs API.");
    const url = `${this.baseUrl}${API_PREFIX}${path}`;
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetcher(url, {
        method,
        headers: {
          authorization: `Bot ${this.token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (response.status === 429 && attempt < this.retries) {
        const wait = Number(response.headers.get("retry-after") ?? "1");
        await response.arrayBuffer().catch(() => undefined);
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(this.maxRetryAfter, Math.max(0, wait)) * 1000,
          ),
        );
        continue;
      }
      const text = await response.text();
      const parsed = text ? safeJson(text) : null;
      if (!response.ok) {
        const message =
          (parsed && typeof parsed.error === "string" && parsed.error) ||
          (parsed && typeof parsed.message === "string" && parsed.message) ||
          `Hubs answered ${response.status}.`;
        throw new HubsAPIError(
          message,
          response.status,
          parsed && typeof parsed.code === "string" ? parsed.code : null,
          method,
          url,
        );
      }
      return parsed;
    }
  }
  get(path: string) {
    return this.request("GET", path);
  }
  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request("POST", path, body, headers);
  }
  put(path: string, body?: unknown) {
    return this.request("PUT", path, body);
  }
  patch(path: string, body?: unknown) {
    return this.request("PATCH", path, body);
  }
  delete(path: string) {
    return this.request("DELETE", path);
  }
}
/** The Idempotency-Key Hubs needs on a send: from discord.js's `nonce` when
 * there is one (so a retry with the same nonce is one message), otherwise
 * fresh. */
export function idempotencyKey(nonce?: unknown) {
  if (nonce === undefined || nonce === null || nonce === "")
    return randomUUID();
  const text = String(nonce);
  return /^[A-Za-z0-9._-]{1,100}$/.test(text)
    ? `nonce:${text.padEnd(2, "_")}`
    : `nonce:${createHash("sha256").update(text).digest("hex").slice(0, 40)}`;
}
const safeJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// ----------------------------------------------- discord.js REST and Routes

const COMMANDS = /^\/(applications\/@me|hubs\/[^/]+)\/commands$/;
const MESSAGES = /^\/channels\/[^/]+\/messages$/;
const MESSAGE = /^\/channels\/[^/]+\/messages\/[^/]+$/;

/** Discord route helpers that have a Hubs path. Other helpers throw. */
export const Routes = new Proxy(
  {
    /** The application id is implied by the token on Hubs. */
    applicationCommands: (_applicationId?: string) =>
      "/applications/@me/commands",
    applicationGuildCommands: (_applicationId: string, guildId: string) =>
      `/hubs/${guildId}/commands`,
    channelMessages: (channelId: string) => `/channels/${channelId}/messages`,
    channelMessage: (channelId: string, messageId: string) =>
      `/channels/${channelId}/messages/${messageId}`,
    channelMessageOwnReaction: (
      channelId: string,
      messageId: string,
      emoji: string,
    ) =>
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
    guildMembers: (guildId: string) => `/hubs/${guildId}/members`,
    guildChannels: (guildId: string) => `/hubs/${guildId}/channels`,
    user: (id = "@me") => {
      if (id !== "@me")
        notSupported(
          "Fetching other users by id",
          "Use guild.members.fetch().",
        );
      return "/users/@me";
    },
    gatewayBot: () => "/gateway/bot",
    interactionCallback: (interactionId: string, _token?: string) =>
      `/interactions/${interactionId}/callback`,
  } as Record<string, (...args: any[]) => string>,
  {
    get(target, key) {
      if (typeof key === "string" && key in target) return target[key];
      if (typeof key !== "string") return undefined;
      return () =>
        notSupported(
          `Routes.${key}`,
          "Only the routes listed in the porting guide map to Hubs.",
        );
    },
  },
);

/** discord.js's REST class: `new REST({ version: "10" }).setToken(token)`,
 * then `rest.put(Routes.applicationCommands(id), { body })`. Discord-shaped
 * command and message bodies are converted to the Hubs shape. */
export class REST {
  private readonly rest: HubsRest;
  constructor(options: HubsRestOptions = {}) {
    this.rest = new HubsRest(options);
  }
  setToken(token: string) {
    this.rest.setToken(token);
    return this;
  }
  private convert(method: string, path: string, body: unknown) {
    if (body === undefined) return undefined;
    if (COMMANDS.test(path) && method === "PUT")
      return (body as unknown[]).map(toHubsCommand);
    if (MESSAGES.test(path) && method === "POST") {
      const { nonce, ...message } = toHubsMessage(body);
      void nonce;
      return message;
    }
    if (MESSAGE.test(path) && method === "PATCH")
      return toHubsMessage(body, "edit");
    return body;
  }
  private async call(
    method: string,
    path: string,
    options: { body?: unknown } = {},
  ) {
    const body = this.convert(method, path, options.body);
    if (method === "POST" && MESSAGES.test(path)) {
      const nonce = (options.body as { nonce?: unknown } | undefined)?.nonce;
      return this.rest.request(method, path, body, {
        "idempotency-key": idempotencyKey(nonce),
      });
    }
    if (method === "POST" && COMMANDS.test(path))
      notSupported(
        "Creating one command with POST",
        "Hubs replaces the whole list: use rest.put with every command.",
      );
    const result = await this.rest.request(method, path, body);
    return COMMANDS.test(path) && result?.commands ? result.commands : result;
  }
  get(path: string) {
    return this.call("GET", path);
  }
  post(path: string, options?: { body?: unknown }) {
    return this.call("POST", path, options);
  }
  put(path: string, options?: { body?: unknown }) {
    return this.call("PUT", path, options);
  }
  patch(path: string, options?: { body?: unknown }) {
    return this.call("PATCH", path, options);
  }
  delete(path: string) {
    return this.call("DELETE", path);
  }
}
