/*
 * The discord.js Client on Hubs: login with a Hubs bot token, the live
 * gateway, caches of hubs (guilds), channels, members and users, and
 * Discord-named events.
 */
import { EventEmitter } from "node:events";
import { Collection } from "./collection.js";
import {
  GatewayIntentBits,
  HUBS_INTENT_NAMES,
  SUPPORTED_INTENTS,
} from "./constants.js";
import { HubsAPIError, notSupported } from "./errors.js";
import { HubsGateway, type WebSocketConstructor } from "./gateway.js";
import { createInteraction } from "./interactions.js";
import { assertHubsToken, HubsRest, resolveBaseUrl } from "./rest.js";
import {
  ClientUser,
  CommandManager,
  Guild,
  GuildMember,
  MappedCollection,
  Message,
  MessageReaction,
  TextChannel,
  User,
} from "./structures.js";

type Json = Record<string, any>;
type IntentInput =
  number | string | readonly (number | string)[] | { bitfield: number };

/** discord.js's IntentsBitField, enough for `new IntentsBitField([...])`. */
export class IntentsBitField {
  bitfield: number;
  constructor(bits: IntentInput = 0) {
    this.bitfield = resolveIntents(bits);
  }
  add(...bits: IntentInput[]) {
    for (const bit of bits) this.bitfield |= resolveIntents(bit);
    return this;
  }
  remove(...bits: IntentInput[]) {
    for (const bit of bits) this.bitfield &= ~resolveIntents(bit);
    return this;
  }
  has(bit: IntentInput) {
    const wanted = resolveIntents(bit);
    return (this.bitfield & wanted) === wanted;
  }
  static Flags = GatewayIntentBits;
}
export function resolveIntents(input: IntentInput): number {
  if (typeof input === "number") return input;
  if (typeof input === "string") {
    const bit = (GatewayIntentBits as Record<string, number>)[input];
    if (bit === undefined) throw new TypeError(`Unknown intent: ${input}.`);
    return bit;
  }
  if (Array.isArray(input))
    return input.reduce((sum: number, item) => sum | resolveIntents(item), 0);
  if (input && typeof (input as { bitfield?: unknown }).bitfield === "number")
    return (input as { bitfield: number }).bitfield;
  throw new TypeError(
    "Intents are a number, a list of intents or an IntentsBitField.",
  );
}
const intentName = (bit: number) =>
  Object.entries(GatewayIntentBits).find(([, value]) => value === bit)?.[0] ??
  `1 << ${Math.log2(bit)}`;

export interface HubsClientOptions {
  /** The Hubs site. Default: HUBS_BASE_URL, then https://thehubs.gg. */
  baseUrl?: string;
  /** Discord id to Hubs id, so config with old Discord ids keeps working. */
  idMap?: Record<string, string>;
  /** Discord id to a Hubs name: a hub name, a channel name, a hub role
   * (owner, admin, member, guest) or a member's handle. */
  names?: {
    guilds?: Record<string, string>;
    channels?: Record<string, string>;
    roles?: Record<string, string>;
    members?: Record<string, string>;
  };
  /** This client's shard: [shard id, shard count]. Default [0, 1]. */
  shard?: [number, number];
  WebSocket?: WebSocketConstructor;
  fetch?: typeof fetch;
}
export interface ClientOptions {
  intents: IntentInput;
  partials?: readonly number[];
  hubs?: HubsClientOptions;
  rest?: { api?: string; version?: string };
  shards?: number | readonly number[];
  shardCount?: number;
  [key: string]: unknown;
}
/** Options that only tune discord.js's caches and timing; the kit's own
 * caches need no tuning, so they are accepted. */
const TUNING = new Set([
  "sweepers",
  "makeCache",
  "failIfNotExists",
  "closeTimeout",
  "waitGuildTimeout",
  "enforceNonce",
  "jsonTransformer",
  "ws",
]);
const KNOWN = new Set([
  "intents",
  "partials",
  "hubs",
  "rest",
  "shards",
  "shardCount",
]);

type NameKind = "guilds" | "channels" | "roles" | "members";

export class Client extends EventEmitter {
  readonly options: ClientOptions;
  readonly intents: number;
  readonly rest: HubsRest;
  readonly baseUrl: string;
  user: ClientUser | null = null;
  application: { id: string; name: string; commands: CommandManager } | null =
    null;
  readyTimestamp: number | null = null;
  token: string | null = null;
  readonly guilds: GuildManager;
  readonly channels: ChannelManager;
  readonly users: UserManager;
  private gateway: HubsGateway | null = null;
  constructor(options: ClientOptions) {
    super();
    if (!options || options.intents === undefined)
      throw new TypeError(
        "Pass intents, for example { intents: [GatewayIntentBits.Guilds] }.",
      );
    for (const key of Object.keys(options)) {
      if (key === "allowedMentions")
        notSupported(
          "allowedMentions",
          "Hubs bots never ping @everyone or roles; remove the option.",
        );
      if (key === "presence")
        notSupported(
          "Bot activities and presence",
          "Hubs shows bots without a status line; remove the option.",
        );
      if (!KNOWN.has(key) && !TUNING.has(key))
        throw new TypeError(`Unknown client option: ${key}.`);
    }
    const intents = resolveIntents(options.intents);
    const extra = intents & ~SUPPORTED_INTENTS;
    if (extra) {
      const names = [];
      for (let bit = 1; bit <= extra; bit <<= 1)
        if (extra & bit) names.push(intentName(bit));
      notSupported(
        `The intent${names.length > 1 ? "s" : ""} ${names.join(", ")}`,
        "Hubs supports Guilds, GuildMembers, GuildMessages, GuildMessageReactions and MessageContent.",
      );
    }
    this.options = options;
    this.intents = intents;
    this.baseUrl = resolveBaseUrl({
      baseUrl: options.hubs?.baseUrl,
      api: options.rest?.api,
    });
    this.rest = new HubsRest({
      baseUrl: this.baseUrl,
      fetch: options.hubs?.fetch,
    });
    this.guilds = new GuildManager(this);
    this.channels = new ChannelManager(this);
    this.users = new UserManager(this);
  }
  /** The Hubs intent names this client asks for. */
  get hubsIntents() {
    return Object.entries(HUBS_INTENT_NAMES)
      .filter(([bit]) => this.intents & Number(bit))
      .map(([, name]) => name);
  }
  get readyAt() {
    return this.readyTimestamp === null ? null : new Date(this.readyTimestamp);
  }
  get uptime() {
    return this.readyTimestamp === null
      ? null
      : Date.now() - this.readyTimestamp;
  }
  get ws() {
    return { ping: this.gateway?.ping ?? -1, status: this.isReady() ? 0 : 1 };
  }
  isReady() {
    return this.readyTimestamp !== null;
  }
  /** A Discord id or name from the idMap and names options, as a Hubs id. */
  resolveId(kind: NameKind, key: string, guild?: Guild): string | undefined {
    const mapped = this.options.hubs?.idMap?.[key];
    if (mapped) return mapped;
    const name = this.options.hubs?.names?.[kind]?.[key];
    if (!name) return undefined;
    switch (kind) {
      case "guilds":
        return this.guilds.cache.find((g) => g.name === name)?.id;
      case "channels":
        return (guild ? guild.channels.cache : this.channels.cache).find(
          (c) => c.name === name,
        )?.id;
      case "roles":
        return name;
      case "members":
        return this.users.cache.find((u) => u.username === name)?.id;
    }
  }
  /** @internal A 404-style error for something not found. */
  unknown(kind: string, id: string) {
    return new HubsAPIError(
      `Unknown ${kind}: ${id}.`,
      404,
      `UNKNOWN_${kind.toUpperCase()}`,
      "GET",
      "",
    );
  }
  /** @internal */
  partialMessage(data: Json) {
    return new Message(this, data);
  }
  /** Signs in with a Hubs bot token and connects to live events. Resolves
   * with the token once the client is ready. */
  async login(token: string | undefined = process.env.HUBS_BOT_TOKEN) {
    assertHubsToken(token);
    this.token = token;
    this.rest.setToken(token);
    const me = await this.rest.get("/users/@me");
    this.user = new ClientUser(this, { ...me, bot: true });
    this.users.cache.set(this.user.id, this.user);
    this.application = {
      id: String(me.application.id),
      name: String(me.application.name),
      commands: new CommandManager(this, null),
    };
    const { hubs } = await this.rest.get("/hubs");
    for (const hub of hubs) this.guilds.add(hub);
    const gateway = await this.rest.get("/gateway/bot");
    const shard = this.options.hubs?.shard ?? [
      typeof this.options.shards === "number" ? this.options.shards : 0,
      this.options.shardCount ?? 1,
    ];
    if (Array.isArray(this.options.shards) && this.options.shards.length > 1)
      notSupported(
        "Several shards in one client",
        "Run one Client per shard with hubs.shard.",
      );
    const socket = new HubsGateway({
      url: String(gateway.url),
      token,
      intents: this.intents,
      shard: shard as [number, number],
      WebSocket: this.options.hubs?.WebSocket,
    });
    this.gateway = socket;
    socket.on("debug", (message) => this.emit("debug", message));
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      socket.on("fatal", (code: number, reason: string) => {
        const error = new HubsAPIError(
          `The Hubs gateway closed the connection (${code}${reason ? `: ${reason}` : ""}).`,
          code,
          `GATEWAY_${code}`,
          "GATEWAY",
          String(gateway.url),
        );
        if (!settled) {
          settled = true;
          reject(error);
        } else this.emit("error", error);
      });
      socket.on("dispatch", (type: string, data: Json) => {
        this.dispatch(type, data)
          .then(() => {
            if (type === "READY" && !settled) {
              settled = true;
              resolve(token);
            }
          })
          .catch((error) => this.emit("error", error));
      });
      socket.connect();
    });
  }
  async destroy() {
    this.gateway?.destroy();
    this.gateway = null;
    this.readyTimestamp = null;
  }
  /** @internal For tests: drops the socket so the client resumes. */
  dropConnection() {
    this.gateway?.drop();
  }
  private async prefetch(guild: Guild) {
    try {
      if (guild.scopes.includes("channels:read")) await guild.channels.fetch();
      if (
        guild.scopes.includes("members:read") &&
        this.intents & GatewayIntentBits.GuildMembers
      )
        await guild.members.fetch();
    } catch (error) {
      this.emit(
        "debug",
        `Could not load ${guild.name}: ${(error as Error).message}`,
      );
    }
  }
  private async dispatch(type: string, d: Json) {
    switch (type) {
      case "READY": {
        for (const hub of d.hubs ?? []) this.guilds.add(hub);
        await Promise.all(
          [...this.guilds.cache.values()].map((guild) => this.prefetch(guild)),
        );
        this.readyTimestamp = Date.now();
        this.emit("ready", this);
        this.emit("clientReady", this);
        return;
      }
      case "RESUMED":
        this.emit("shardResume", 0, 0);
        return;
      case "HUB_CREATE": {
        const guild = this.guilds.add(d);
        await this.prefetch(guild);
        this.emit("guildCreate", guild);
        return;
      }
      case "HUB_UPDATE": {
        const guild = this.guilds.cache.get(String(d.id));
        const old = guild ? clone(guild) : null;
        const updated = this.guilds.add(d);
        this.emit("guildUpdate", old ?? updated, updated);
        return;
      }
      case "HUB_DELETE": {
        const guild = this.guilds.remove(String(d.id));
        if (guild) this.emit("guildDelete", guild);
        return;
      }
      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE": {
        const guild = this.guilds.ensure(String(d.hubId));
        const existing = guild.channels.cache.get(String(d.id));
        const old = existing && !existing.partial ? clone(existing) : null;
        const channel = guild.channels.add(d);
        if (type === "CHANNEL_CREATE") this.emit("channelCreate", channel);
        else this.emit("channelUpdate", old ?? channel, channel);
        return;
      }
      case "CHANNEL_DELETE": {
        const guild = this.guilds.ensure(String(d.hubId));
        const channel =
          guild.channels.remove(String(d.id)) ??
          new TextChannel(guild, { id: d.id });
        this.emit("channelDelete", channel);
        return;
      }
      case "HUB_MEMBER_ADD": {
        const guild = this.guilds.ensure(String(d.hubId));
        this.emit(
          "guildMemberAdd",
          guild.members.add(d.user, String(d.role ?? "member")),
        );
        return;
      }
      case "HUB_MEMBER_REMOVE": {
        const guild = this.guilds.ensure(String(d.hubId));
        const id = String(d.user?.id);
        const member =
          guild.members.cache.get(id) ??
          new GuildMember(guild, this.users.add(d.user ?? { id }), "member");
        guild.members.cache.delete(id);
        this.emit("guildMemberRemove", member);
        return;
      }
      case "MESSAGE_CREATE": {
        const channel = this.channels.channelFor(
          String(d.channelId),
          String(d.hubId),
        );
        this.emit("messageCreate", channel.messages.add(d));
        return;
      }
      case "MESSAGE_UPDATE": {
        const channel = this.channels.channelFor(
          String(d.channelId),
          String(d.hubId),
        );
        const existing = channel.messages.cache.get(String(d.id));
        const old = existing
          ? clone(existing)
          : this.partialMessage({
              id: d.id,
              channelId: d.channelId,
              hubId: d.hubId,
            });
        this.emit("messageUpdate", old, channel.messages.add(d));
        return;
      }
      case "MESSAGE_DELETE": {
        const channel = this.channels.channelFor(
          String(d.channelId),
          String(d.hubId),
        );
        const message =
          channel.messages.cache.get(String(d.id)) ??
          this.partialMessage({
            id: d.id,
            channelId: d.channelId,
            hubId: d.hubId,
          });
        channel.messages.cache.delete(String(d.id));
        this.emit("messageDelete", message);
        return;
      }
      case "MESSAGE_REACTION_ADD":
      case "MESSAGE_REACTION_REMOVE": {
        const channel = this.channels.channelFor(
          String(d.channelId),
          String(d.hubId),
        );
        const message =
          channel.messages.cache.get(String(d.messageId)) ??
          this.partialMessage({
            id: d.messageId,
            channelId: d.channelId,
            hubId: d.hubId,
          });
        const emoji = String(d.emoji);
        const mine = String(d.userId) === this.user?.id;
        let reaction = message.reactions.cache.get(emoji);
        const adding = type === "MESSAGE_REACTION_ADD";
        if (!reaction) {
          reaction = new MessageReaction(
            message,
            emoji,
            message.partial ? null : 0,
            false,
          );
          message.reactions.cache.set(emoji, reaction);
        }
        if (reaction.count !== null)
          reaction.count = Math.max(0, reaction.count + (adding ? 1 : -1));
        if (mine) reaction.me = adding;
        const user =
          this.users.cache.get(String(d.userId)) ??
          this.users.add({ id: d.userId });
        this.emit(
          adding ? "messageReactionAdd" : "messageReactionRemove",
          reaction,
          user,
        );
        return;
      }
      case "INTERACTION_CREATE":
        // Interactions from direct messages have no hub.
        if (d.hubId) this.guilds.ensure(String(d.hubId));
        this.emit("interactionCreate", createInteraction(this, d));
        return;
    }
  }
}
/** A shallow copy, for the "old" side of update events. */
function clone<T extends object>(value: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(value)), value);
}

export class GuildManager {
  readonly client: Client;
  readonly cache: MappedCollection<Guild>;
  constructor(client: Client) {
    this.client = client;
    this.cache = new MappedCollection<Guild>((key) =>
      client.resolveId("guilds", key),
    );
  }
  /** @internal */
  add(data: Json) {
    const existing = this.cache.get(String(data.id));
    if (existing) return existing.patch(data);
    const guild = new Guild(this.client, data);
    this.cache.set(guild.id, guild);
    return guild;
  }
  /** @internal A hub from an event, even before it is cached. */
  ensure(id: string) {
    return this.cache.get(id) ?? this.add({ id });
  }
  /** @internal */
  remove(id: string) {
    const guild = this.cache.get(id);
    if (!guild) return undefined;
    for (const channelId of guild.channels.cache.keys())
      this.client.channels.cache.delete(channelId);
    this.cache.delete(guild.id);
    return guild;
  }
  /** Every hub the bot is installed in, or one. */
  async fetch(id?: string): Promise<any> {
    const { hubs } = await this.client.rest.get("/hubs");
    for (const hub of hubs) this.add(hub);
    if (id === undefined) return new Collection(this.cache);
    const guild = this.cache.get(id);
    if (!guild) throw this.client.unknown("Guild", id);
    return guild;
  }
  resolve(guild: string | Guild) {
    return typeof guild === "string" ? (this.cache.get(guild) ?? null) : guild;
  }
}

export class ChannelManager {
  readonly client: Client;
  readonly cache: MappedCollection<TextChannel>;
  constructor(client: Client) {
    this.client = client;
    this.cache = new MappedCollection<TextChannel>((key) =>
      client.resolveId("channels", key),
    );
  }
  /** @internal The channel, or a partial one in its hub. */
  channelFor(id: string, guildId: string | null): TextChannel {
    const cached = this.cache.get(id);
    if (cached) return cached;
    if (!guildId) throw this.client.unknown("Channel", id);
    return this.client.guilds.ensure(guildId).channels.add({ id });
  }
  /** One channel by id. Loads the hub channel lists when it is not cached. */
  async fetch(id: string, options: { force?: boolean } = {}) {
    const cached = this.cache.get(id);
    if (cached && !cached.partial && !options.force) return cached;
    for (const guild of this.client.guilds.cache.values())
      if (guild.scopes.includes("channels:read")) await guild.channels.fetch();
    const channel = this.cache.get(id);
    if (!channel || channel.partial) throw this.client.unknown("Channel", id);
    return channel;
  }
  resolve(channel: string | TextChannel) {
    return typeof channel === "string"
      ? (this.cache.get(channel) ?? null)
      : channel;
  }
}

export class UserManager {
  readonly client: Client;
  readonly cache: MappedCollection<User>;
  constructor(client: Client) {
    this.client = client;
    this.cache = new MappedCollection<User>((key) =>
      client.resolveId("members", key),
    );
  }
  /** @internal */
  add(data: Json): User {
    const id = String(data.id);
    const existing = this.cache.get(id);
    if (existing) return existing.patch(data);
    const user = new User(this.client, data);
    this.cache.set(id, user);
    return user;
  }
  /** A user seen in a hub. Hubs has no lookup of any account by id. */
  async fetch(id: string) {
    const cached = this.cache.get(id);
    if (cached && !cached.partial) return cached;
    for (const guild of this.client.guilds.cache.values())
      if (guild.scopes.includes("members:read")) await guild.members.fetch();
    const user = this.cache.get(id);
    if (!user || user.partial) throw this.client.unknown("User", id);
    return user;
  }
  send(_user: unknown, _options: unknown): Promise<never> {
    return new User(this.client, { id: "" }).send(undefined);
  }
}
