/*
 * discord.js structures over Hubs data. A Guild is a Hubs hub (a place), a
 * TextChannel is a chat or announcement channel, a GuildMember is a hub
 * member and a Role is the member's hub role (owner, admin, member or
 * guest). Ids are Hubs ids; the client's idMap and names options let a
 * ported bot keep its old Discord ids in config.
 */
import type { Client } from "./client.js";
import { Collection } from "./collection.js";
import { ChannelType } from "./constants.js";
import { toHubsCommand, toHubsMessage } from "./convert.js";
import { HubsNotSupportedError, notSupported } from "./errors.js";
import { idempotencyKey } from "./rest.js";

type Json = Record<string, any>;
const MESSAGE_CACHE = 200;
/** Async methods reject (rather than throw) with HubsNotSupportedError. */
const rejectNotSupported = (feature: string, hint?: string): Promise<never> =>
  Promise.reject(new HubsNotSupportedError(feature, hint));

/** A Collection whose get and has also accept a mapped Discord id or name. */
export class MappedCollection<V> extends Collection<string, V> {
  constructor(private readonly resolve: (key: string) => string | undefined) {
    super();
  }
  override get(key: string) {
    if (super.has(key)) return super.get(key);
    const mapped = this.resolve(key);
    return mapped !== undefined && mapped !== key
      ? super.get(mapped)
      : undefined;
  }
  override has(key: string) {
    return this.get(key) !== undefined;
  }
}

// -------------------------------------------------------------- users

export class User {
  readonly client: Client;
  id: string;
  username: string;
  globalName: string;
  bot: boolean;
  avatar: string | null;
  readonly partial: boolean;
  constructor(client: Client, data: Json) {
    this.client = client;
    this.id = String(data.id);
    this.username = String(data.handle ?? "");
    this.globalName = String(data.displayName ?? data.handle ?? "");
    this.bot = data.bot === true;
    this.avatar = data.avatarUrl ? String(data.avatarUrl) : null;
    this.partial = data.handle === undefined;
  }
  /** @internal */
  patch(data: Json) {
    if (data.handle !== undefined) this.username = String(data.handle);
    if (data.displayName !== undefined)
      this.globalName = String(data.displayName);
    if (data.bot !== undefined) this.bot = data.bot === true;
    if (data.avatarUrl !== undefined)
      this.avatar = data.avatarUrl ? String(data.avatarUrl) : null;
    return this;
  }
  get displayName() {
    return this.globalName || this.username;
  }
  /** Hubs has no discriminators; the tag is the handle. */
  get tag() {
    return this.username;
  }
  avatarURL() {
    return this.avatar
      ? new URL(this.avatar, this.client.baseUrl).toString()
      : null;
  }
  displayAvatarURL() {
    return this.avatarURL();
  }
  /** Hubs mentions people by handle. */
  toString() {
    return `@${this.username}`;
  }
  send(_options: unknown): Promise<never> {
    return rejectNotSupported(
      "Direct messages from bots",
      "Reply in the channel, or use an ephemeral interaction reply.",
    );
  }
  createDM(): Promise<never> {
    return this.send(undefined);
  }
  async fetch() {
    return this;
  }
}

export class ClientUser extends User {
  setActivity(..._args: unknown[]): never {
    return notSupported(
      "Bot activities and presence",
      "Hubs shows bots without a status line; remove the call.",
    );
  }
  setPresence(..._args: unknown[]): never {
    return notSupported(
      "Bot activities and presence",
      "Hubs shows bots without a status line; remove the call.",
    );
  }
  setStatus(..._args: unknown[]): never {
    return notSupported(
      "Bot activities and presence",
      "Hubs shows bots without a status line; remove the call.",
    );
  }
  setUsername(_name: string): Promise<never> {
    return rejectNotSupported(
      "Changing the bot's name from code",
      "Change it in the Hubs developer portal.",
    );
  }
  setAvatar(_avatar: unknown): Promise<never> {
    return rejectNotSupported(
      "Changing the bot's picture from code",
      "Change it in the Hubs developer portal.",
    );
  }
}

// -------------------------------------------------------------- roles

/** Hub roles, from the most to the least powerful. */
export const HUB_ROLES = ["owner", "admin", "member", "guest"] as const;

export class Role {
  readonly guild: Guild;
  /** The hub role's name ("owner", "admin", "member", "guest"), or the
   * hub id for @everyone, as on Discord. */
  readonly id: string;
  readonly name: string;
  readonly position: number;
  constructor(guild: Guild, id: string, name: string, position: number) {
    this.guild = guild;
    this.id = id;
    this.name = name;
    this.position = position;
  }
  get members() {
    return this.guild.members.cache.filter((member) =>
      member.roles.cache.has(this.id),
    );
  }
  comparePositionTo(role: Role) {
    return this.position - role.position;
  }
  toString() {
    return this.name === "@everyone" ? "@everyone" : `@${this.name}`;
  }
  edit(_data: unknown): Promise<never> {
    return rejectNotSupported(
      "Editing roles from a bot",
      "Hub admins manage roles in Manage, Structure and roles.",
    );
  }
  delete(): Promise<never> {
    return rejectNotSupported("Deleting roles from a bot");
  }
}

export class RoleManager {
  readonly guild: Guild;
  readonly cache: MappedCollection<Role>;
  constructor(guild: Guild) {
    this.guild = guild;
    this.cache = new MappedCollection<Role>((key) =>
      guild.client.resolveId("roles", key),
    );
    this.cache.set(guild.id, new Role(guild, guild.id, "@everyone", 0));
    HUB_ROLES.forEach((name, index) =>
      this.cache.set(
        name,
        new Role(guild, name, name, HUB_ROLES.length - index),
      ),
    );
  }
  get everyone() {
    return this.cache.get(this.guild.id)!;
  }
  fetch(): Promise<MappedCollection<Role>>;
  fetch(id: string): Promise<Role | null>;
  async fetch(id?: string) {
    return id === undefined ? this.cache : (this.cache.get(id) ?? null);
  }
  resolve(role: string | Role) {
    return typeof role === "string" ? (this.cache.get(role) ?? null) : role;
  }
  create(_data: unknown): Promise<never> {
    return rejectNotSupported(
      "Creating roles from a bot",
      "Hub admins manage roles in Manage, Structure and roles.",
    );
  }
}

// ------------------------------------------------------------ members

const MODERATION_HINT =
  "Hubs bots have no moderation powers yet. Post to a staff channel or ask a hub admin; see the porting guide for what is planned.";

export class GuildMember {
  readonly guild: Guild;
  readonly user: User;
  /** The member's hub role: owner, admin, member or guest. */
  hubRole: string;
  nickname: string | null = null;
  constructor(guild: Guild, user: User, hubRole: string) {
    this.guild = guild;
    this.user = user;
    this.hubRole = hubRole;
  }
  get id() {
    return this.user.id;
  }
  get client() {
    return this.guild.client;
  }
  get displayName() {
    return this.user.displayName;
  }
  get partial() {
    return false;
  }
  get roles() {
    const member = this;
    const cache = new MappedCollection<Role>((key) =>
      member.client.resolveId("roles", key),
    );
    const everyone = member.guild.roles.everyone;
    cache.set(everyone.id, everyone);
    const own = member.guild.roles.cache.get(member.hubRole);
    if (own) cache.set(own.id, own);
    return {
      cache,
      get highest() {
        return own ?? everyone;
      },
      add: (..._args: unknown[]) =>
        rejectNotSupported(
          "Giving roles from a bot",
          "Hub admins give roles in Manage.",
        ),
      remove: (..._args: unknown[]) =>
        rejectNotSupported(
          "Taking roles from a bot",
          "Hub admins change roles in Manage.",
        ),
      set: (..._args: unknown[]) =>
        rejectNotSupported(
          "Setting roles from a bot",
          "Hub admins change roles in Manage.",
        ),
    };
  }
  /** True for the hub's owner and admins. */
  get isHubAdmin() {
    return this.hubRole === "owner" || this.hubRole === "admin";
  }
  get permissions(): never {
    return notSupported(
      "Discord permission bits on members",
      'Check member.roles.cache.has("admin") or member.isHubAdmin instead.',
    );
  }
  permissionsIn(_channel: unknown): never {
    return notSupported(
      "Discord permission bits on members",
      'Check member.roles.cache.has("admin") or member.isHubAdmin instead.',
    );
  }
  /** A bot cannot moderate on Hubs, so these are always false. */
  get kickable() {
    return false;
  }
  get bannable() {
    return false;
  }
  get moderatable() {
    return false;
  }
  get manageable() {
    return false;
  }
  kick(_reason?: string): Promise<never> {
    return rejectNotSupported("Kicking members from a bot", MODERATION_HINT);
  }
  ban(_options?: unknown): Promise<never> {
    return rejectNotSupported("Banning members from a bot", MODERATION_HINT);
  }
  timeout(_ms: number | null, _reason?: string): Promise<never> {
    return rejectNotSupported("Timing out members from a bot", MODERATION_HINT);
  }
  disableCommunicationUntil(_until: unknown, _reason?: string): Promise<never> {
    return rejectNotSupported("Timing out members from a bot", MODERATION_HINT);
  }
  setNickname(_nick: string | null): Promise<never> {
    return rejectNotSupported(
      "Nicknames",
      "Hubs shows each person's own display name.",
    );
  }
  send(options: unknown) {
    return this.user.send(options);
  }
  toString() {
    return this.user.toString();
  }
  async fetch() {
    return this.guild.members.fetch(this.id);
  }
}

export class GuildMemberManager {
  readonly guild: Guild;
  readonly cache: MappedCollection<GuildMember>;
  constructor(guild: Guild) {
    this.guild = guild;
    this.cache = new MappedCollection<GuildMember>((key) =>
      guild.client.resolveId("members", key),
    );
  }
  /** @internal */
  add(data: Json, role: string) {
    const user = this.guild.client.users.add(data);
    const existing = this.cache.get(user.id);
    if (existing) {
      existing.hubRole = role;
      return existing;
    }
    const member = new GuildMember(this.guild, user, role);
    this.cache.set(user.id, member);
    return member;
  }
  /** The bot's own member. */
  get me() {
    const user = this.guild.client.user;
    return user
      ? (this.cache.get(user.id) ?? new GuildMember(this.guild, user, "member"))
      : null;
  }
  async fetchMe() {
    return this.me;
  }
  /** Every member (paged from the members list), one member by id, or
   * `{ user: id }`. Needs the members:read scope. */
  async fetch(
    options?:
      | string
      | {
          user?: string | string[];
          query?: string;
          limit?: number;
          force?: boolean;
        },
  ): Promise<any> {
    if (options && typeof options === "object" && options.query !== undefined)
      return rejectNotSupported(
        "Searching members by name",
        "Fetch all members and filter them.",
      );
    const wanted =
      typeof options === "string"
        ? options
        : options &&
            typeof options === "object" &&
            typeof options.user === "string"
          ? options.user
          : undefined;
    if (wanted !== undefined) {
      const cached = this.cache.get(wanted);
      if (cached && !(typeof options === "object" && options.force))
        return cached;
    }
    await this.fetchAll();
    if (wanted !== undefined) {
      const member = this.cache.get(wanted);
      if (!member) throw this.guild.client.unknown("Member", wanted);
      return member;
    }
    return this.cache;
  }
  private async fetchAll() {
    const seen = new Set<string>();
    let after: string | null = null;
    do {
      const query: string = after ? `?limit=100&after=${after}` : "?limit=100";
      const page = await this.guild.client.rest.get(
        `/hubs/${this.guild.id}/members${query}`,
      );
      for (const row of page.members) {
        seen.add(String(row.id));
        this.add(row, String(row.role));
      }
      after = page.nextAfter;
    } while (after);
    for (const id of [...this.cache.keys()])
      if (!seen.has(id)) this.cache.delete(id);
  }
  resolve(member: string | GuildMember | User) {
    if (member instanceof GuildMember) return member;
    return (
      this.cache.get(typeof member === "string" ? member : member.id) ?? null
    );
  }
  kick(_user: unknown, _reason?: string): Promise<never> {
    return rejectNotSupported("Kicking members from a bot", MODERATION_HINT);
  }
  ban(_user: unknown, _options?: unknown): Promise<never> {
    return rejectNotSupported("Banning members from a bot", MODERATION_HINT);
  }
  unban(_user: unknown): Promise<never> {
    return rejectNotSupported("Unbanning members from a bot", MODERATION_HINT);
  }
  search(_options: unknown): Promise<never> {
    return rejectNotSupported(
      "Searching members by name",
      "Fetch all members and filter them.",
    );
  }
  prune(_options?: unknown): Promise<never> {
    return rejectNotSupported("Pruning members from a bot", MODERATION_HINT);
  }
}

// ----------------------------------------------------------- channels

export class TextChannel {
  readonly client: Client;
  readonly id: string;
  guild: Guild;
  name: string;
  topic: string | null;
  position: number;
  /** "chat" or "announcements". */
  kind: string;
  /** Whether the bot's role may post here. */
  canPost: boolean;
  partial: boolean;
  readonly messages: MessageManager;
  constructor(guild: Guild, data: Json) {
    this.client = guild.client;
    this.guild = guild;
    this.id = String(data.id);
    this.name = String(data.name ?? "");
    this.topic = data.topic ? String(data.topic) : null;
    this.position = Number(data.position ?? 0);
    this.kind = String(data.kind ?? "chat");
    this.canPost = data.canPost !== false;
    this.partial = data.name === undefined;
    this.messages = new MessageManager(this);
  }
  /** @internal */
  patch(data: Json) {
    if (data.name !== undefined) this.name = String(data.name);
    if (data.topic !== undefined)
      this.topic = data.topic ? String(data.topic) : null;
    if (data.position !== undefined) this.position = Number(data.position);
    if (data.kind !== undefined) this.kind = String(data.kind);
    if (data.canPost !== undefined) this.canPost = data.canPost !== false;
    if (data.name !== undefined) this.partial = false;
    return this;
  }
  get type() {
    return this.kind === "announcements"
      ? ChannelType.GuildAnnouncement
      : ChannelType.GuildText;
  }
  get guildId() {
    return this.guild.id;
  }
  isTextBased() {
    return true;
  }
  isSendable() {
    return this.canPost;
  }
  isThread() {
    return false;
  }
  isVoiceBased() {
    return false;
  }
  isDMBased() {
    return false;
  }
  toString() {
    return `#${this.name}`;
  }
  async send(options: unknown) {
    const body = toHubsMessage(options, "send");
    const { nonce, ...rest } = body;
    const data = await this.client.rest.post(
      `/channels/${this.id}/messages`,
      rest,
      {
        "idempotency-key": idempotencyKey(nonce),
      },
    );
    return this.messages.add(data);
  }
  async fetch() {
    await this.guild.channels.fetch();
    return this;
  }
  bulkDelete(_messages: unknown): Promise<never> {
    return rejectNotSupported(
      "Deleting other people's messages from a bot",
      MODERATION_HINT,
    );
  }
  sendTyping(): Promise<never> {
    return rejectNotSupported(
      "Typing indicators from bots",
      "Defer an interaction reply to show that the bot is working.",
    );
  }
  setName(_name: string): Promise<never> {
    return rejectNotSupported(
      "Changing channels from a bot",
      "Hub admins edit channels in Manage.",
    );
  }
  setTopic(_topic: string): Promise<never> {
    return rejectNotSupported(
      "Changing channels from a bot",
      "Hub admins edit channels in Manage.",
    );
  }
  setRateLimitPerUser(_seconds: number): Promise<never> {
    return rejectNotSupported(
      "Changing slow mode from a bot",
      "Hub admins set slow mode in Manage.",
    );
  }
  edit(_data: unknown): Promise<never> {
    return rejectNotSupported(
      "Changing channels from a bot",
      "Hub admins edit channels in Manage.",
    );
  }
  delete(): Promise<never> {
    return rejectNotSupported(
      "Deleting channels from a bot",
      "Hub admins delete channels in Manage.",
    );
  }
  permissionsFor(_member: unknown): never {
    return notSupported(
      "Discord permission bits on channels",
      "Use channel.canPost for the bot, and member.roles for people.",
    );
  }
  createWebhook(_options: unknown): Promise<never> {
    return rejectNotSupported(
      "Channel webhooks from a bot",
      "Hub admins make webhooks in Manage, Developer.",
    );
  }
  createInvite(_options?: unknown): Promise<never> {
    return rejectNotSupported("Invites from a bot");
  }
  createMessageCollector(_options?: unknown): never {
    return notSupported(
      "Message collectors",
      "Listen for messageCreate on the client and filter by channel.",
    );
  }
  createMessageComponentCollector(_options?: unknown): never {
    return notSupported(
      "Component collectors",
      "Handle interactionCreate on the client and match the customId.",
    );
  }
  awaitMessages(_options?: unknown): Promise<never> {
    return rejectNotSupported(
      "Message collectors",
      "Listen for messageCreate on the client and filter by channel.",
    );
  }
  get threads(): never {
    return notSupported("Threads from bots");
  }
}

export class GuildChannelManager {
  readonly guild: Guild;
  readonly cache: MappedCollection<TextChannel>;
  constructor(guild: Guild) {
    this.guild = guild;
    this.cache = new MappedCollection<TextChannel>((key) =>
      guild.client.resolveId("channels", key, guild),
    );
  }
  /** @internal */
  add(data: Json) {
    const existing = this.cache.get(String(data.id));
    if (existing) return existing.patch(data);
    const channel = new TextChannel(this.guild, data);
    this.cache.set(channel.id, channel);
    this.guild.client.channels.cache.set(channel.id, channel);
    return channel;
  }
  /** @internal */
  remove(id: string) {
    const channel = this.cache.get(id);
    this.cache.delete(id);
    this.guild.client.channels.cache.delete(id);
    return channel;
  }
  /** Every channel the bot can open (needs channels:read), or one. */
  async fetch(id?: string): Promise<any> {
    const { channels } = await this.guild.client.rest.get(
      `/hubs/${this.guild.id}/channels`,
    );
    const seen = new Set<string>();
    for (const row of channels) {
      seen.add(String(row.id));
      this.add(row);
    }
    for (const key of [...this.cache.keys()])
      if (!seen.has(key)) this.remove(key);
    if (id === undefined) return this.cache;
    const channel = this.cache.get(id);
    if (!channel) throw this.guild.client.unknown("Channel", id);
    return channel;
  }
  create(_options: unknown): Promise<never> {
    return rejectNotSupported(
      "Creating channels from a bot",
      "Hub admins add channels in Manage.",
    );
  }
}

// ------------------------------------------------------------- hubs

export class Guild {
  readonly client: Client;
  readonly id: string;
  name: string;
  /** Scopes and permissions the hub granted the bot. */
  scopes: string[];
  permissions: string[];
  readonly channels: GuildChannelManager;
  readonly members: GuildMemberManager;
  readonly roles: RoleManager;
  readonly commands: CommandManager;
  constructor(client: Client, data: Json) {
    this.client = client;
    this.id = String(data.id);
    this.name = String(data.name ?? "");
    this.scopes = [...(data.scopes ?? [])];
    this.permissions = [...(data.permissions ?? [])];
    this.channels = new GuildChannelManager(this);
    this.members = new GuildMemberManager(this);
    this.roles = new RoleManager(this);
    this.commands = new CommandManager(client, this.id);
  }
  /** @internal */
  patch(data: Json) {
    if (data.name !== undefined) this.name = String(data.name);
    if (data.scopes) this.scopes = [...data.scopes];
    if (data.permissions) this.permissions = [...data.permissions];
    return this;
  }
  get available() {
    return true;
  }
  /** Members seen so far (all of them after members.fetch()). */
  get memberCount() {
    return this.members.cache.size;
  }
  async fetchOwner() {
    const members = await this.members.fetch();
    const owner = members.find(
      (member: GuildMember) => member.hubRole === "owner",
    );
    if (!owner) throw this.client.unknown("Member", "owner");
    return owner;
  }
  async fetch() {
    await this.client.guilds.fetch();
    return this;
  }
  toString() {
    return this.name;
  }
  get bans(): never {
    return notSupported("Hub bans from a bot", MODERATION_HINT);
  }
  get invites(): never {
    return notSupported("Invites from a bot");
  }
  get emojis(): never {
    return notSupported("Custom emoji", "Use standard Unicode emoji.");
  }
  get scheduledEvents(): never {
    return notSupported("Hub events from a bot yet");
  }
  get autoModerationRules(): never {
    return notSupported(
      "AutoMod rules from a bot",
      "Hub admins set content rules in Manage.",
    );
  }
  fetchAuditLogs(_options?: unknown): Promise<never> {
    return rejectNotSupported("Reading the hub audit trail from a bot");
  }
  leave(): Promise<never> {
    return rejectNotSupported(
      "A bot leaving a hub by itself",
      "A hub admin removes it in Manage, Bots.",
    );
  }
}

// ----------------------------------------------------------- messages

export class MessageManager {
  readonly channel: TextChannel;
  readonly cache = new Collection<string, Message>();
  constructor(channel: TextChannel) {
    this.channel = channel;
  }
  /** @internal */
  add(data: Json) {
    const existing = this.cache.get(String(data.id));
    if (existing) return existing.patch(data);
    const message = new Message(this.channel.client, data, this.channel);
    this.cache.set(message.id, message);
    if (this.cache.size > MESSAGE_CACHE)
      this.cache.delete(this.cache.firstKey()!);
    return message;
  }
  /** One message by id, or a page: `{ limit, before }`. Needs messages:read. */
  async fetch(
    options?:
      | string
      | {
          message?: string;
          limit?: number;
          before?: string;
          after?: string;
          around?: string;
          cache?: boolean;
        },
  ): Promise<any> {
    const id = typeof options === "string" ? options : options?.message;
    if (id) {
      const data = await this.channel.client.rest.get(
        `/channels/${this.channel.id}/messages/${id}`,
      );
      return this.add(data);
    }
    if (
      options &&
      typeof options === "object" &&
      (options.after || options.around)
    )
      return rejectNotSupported(
        "Fetching messages after or around a message",
        "Page back with before.",
      );
    const paging = typeof options === "object" ? options : {};
    const query = new URLSearchParams({ limit: String(paging.limit ?? 50) });
    if (paging.before) query.set("before", paging.before);
    const page = await this.channel.client.rest.get(
      `/channels/${this.channel.id}/messages?${query}`,
    );
    const out = new Collection<string, Message>();
    for (const row of page.messages) out.set(String(row.id), this.add(row));
    return out;
  }
  delete(message: string | Message) {
    const id = typeof message === "string" ? message : message.id;
    return this.channel.client.rest
      .delete(`/channels/${this.channel.id}/messages/${id}`)
      .then(() => undefined);
  }
}

export class MessageReaction {
  readonly message: Message;
  readonly emoji: { name: string; id: null; toString(): string };
  count: number | null;
  me: boolean;
  constructor(
    message: Message,
    emoji: string,
    count: number | null,
    me: boolean,
  ) {
    this.message = message;
    this.emoji = { name: emoji, id: null, toString: () => emoji };
    this.count = count;
    this.me = me;
  }
  get client() {
    return this.message.client;
  }
  get users(): {
    remove(user?: string | User): Promise<MessageReaction>;
    fetch(): Promise<never>;
  } {
    const reaction = this;
    return {
      remove: (user?: string | User) => {
        const id =
          typeof user === "string"
            ? user
            : (user?.id ?? reaction.client.user?.id);
        if (id !== reaction.client.user?.id)
          return rejectNotSupported(
            "Removing other people's reactions from a bot",
            MODERATION_HINT,
          );
        return reaction.client.rest
          .delete(
            `/channels/${reaction.message.channelId}/messages/${reaction.message.id}/reactions/${encodeURIComponent(reaction.emoji.name)}`,
          )
          .then(() => reaction);
      },
      fetch: () =>
        rejectNotSupported(
          "Listing who reacted",
          "Track reactions from messageReactionAdd.",
        ),
    };
  }
  remove(): Promise<never> {
    return rejectNotSupported(
      "Removing other people's reactions from a bot",
      MODERATION_HINT,
    );
  }
}

export class Message {
  readonly client: Client;
  readonly id: string;
  readonly channelId: string;
  readonly guildId: string | null;
  author: User;
  content = "";
  createdTimestamp = 0;
  editedTimestamp: number | null = null;
  embeds: Json[] = [];
  components: Json[] = [];
  attachments = new Collection<
    string,
    { id: string; name: string; contentType: string; size: number }
  >();
  reactions = { cache: new Collection<string, MessageReaction>() };
  reference: {
    messageId: string;
    channelId: string;
    guildId: string | null;
  } | null = null;
  applicationId: string | null = null;
  /** Set on a bot message that answers someone's command. */
  interactionMetadata: {
    user: { id: string };
    commandName: string | null;
  } | null = null;
  partial: boolean;
  constructor(client: Client, data: Json, channel?: TextChannel) {
    this.client = client;
    this.id = String(data.id);
    this.channelId = String(data.channelId ?? channel?.id ?? "");
    this.guildId = data.hubId
      ? String(data.hubId)
      : (channel?.guild.id ?? null);
    this.author = data.author
      ? client.users.add(data.author)
      : new User(client, { id: "" });
    this.partial = data.author === undefined;
    this.patch(data);
  }
  /** @internal */
  patch(data: Json) {
    if (data.author) {
      this.author = this.client.users.add(data.author);
      this.partial = false;
    }
    if (data.content !== undefined) this.content = String(data.content);
    if (data.createdAt) this.createdTimestamp = Date.parse(data.createdAt);
    if (data.editedAt !== undefined)
      this.editedTimestamp = data.editedAt ? Date.parse(data.editedAt) : null;
    if (data.embeds) this.embeds = data.embeds;
    if (data.components) this.components = data.components;
    if (data.attachments) {
      this.attachments = new Collection();
      for (const file of data.attachments)
        this.attachments.set(String(file.id), {
          id: String(file.id),
          name: String(file.name),
          contentType: String(file.mimeType),
          size: Number(file.size),
        });
    }
    if (data.reactions) {
      this.reactions.cache = new Collection();
      for (const reaction of data.reactions)
        this.reactions.cache.set(
          reaction.emoji,
          new MessageReaction(
            this,
            reaction.emoji,
            Number(reaction.count),
            reaction.me === true,
          ),
        );
    }
    if (data.replyToId !== undefined)
      this.reference = data.replyToId
        ? {
            messageId: String(data.replyToId),
            channelId: this.channelId,
            guildId: this.guildId,
          }
        : null;
    if (data.applicationId !== undefined)
      this.applicationId = data.applicationId;
    if (data.interaction)
      this.interactionMetadata = {
        user: { id: String(data.interaction.userId) },
        commandName: data.interaction.command ?? null,
      };
    return this;
  }
  get createdAt() {
    return new Date(this.createdTimestamp);
  }
  get editedAt() {
    return this.editedTimestamp === null
      ? null
      : new Date(this.editedTimestamp);
  }
  get guild() {
    return this.guildId
      ? (this.client.guilds.cache.get(this.guildId) ?? null)
      : null;
  }
  get channel(): TextChannel {
    return this.client.channels.channelFor(this.channelId, this.guildId);
  }
  get member() {
    return this.guild?.members.cache.get(this.author.id) ?? null;
  }
  /** People mentioned by @handle, from the members seen so far. */
  get mentions() {
    const users = new Collection<string, User>();
    for (const match of this.content.matchAll(
      /(^|[^\w])@([A-Za-z0-9_.]{2,32})/g,
    )) {
      const user = this.client.users.cache.find(
        (u) => u.username.toLowerCase() === match[2].toLowerCase(),
      );
      if (user) users.set(user.id, user);
    }
    const me = this.client.user;
    return {
      users,
      members: this.guild
        ? users
            .map((user) => this.guild!.members.cache.get(user.id))
            .filter(Boolean)
        : [],
      everyone: false,
      has: (target: string | User) =>
        users.has(typeof target === "string" ? target : target.id),
      get repliedUser() {
        return null;
      },
      /** Whether the bot's own handle is mentioned. */
      get me() {
        return !!me && users.has(me.id);
      },
    };
  }
  get url() {
    return `${this.client.baseUrl}/channels/${this.channelId}/${this.id}`;
  }
  get editable() {
    return this.author.id === this.client.user?.id;
  }
  get deletable() {
    return this.author.id === this.client.user?.id;
  }
  get pinnable() {
    return false;
  }
  inGuild() {
    return this.guildId !== null;
  }
  /** Replies in the same channel, linked to this message. */
  async reply(options: unknown) {
    const body: Json =
      typeof options === "string"
        ? { content: options }
        : { ...(options as Json) };
    if (body.reply) notSupported("reply options inside message.reply");
    return this.channel.send({ ...body, reply: { messageReference: this.id } });
  }
  /** Edits one of the bot's own messages. */
  async edit(options: unknown) {
    if (!this.editable)
      return rejectNotSupported(
        "Editing other people's messages",
        "A bot can only edit its own messages.",
      );
    const body = toHubsMessage(options, "edit");
    delete body.nonce;
    const data = await this.client.rest.patch(
      `/channels/${this.channelId}/messages/${this.id}`,
      body,
    );
    return this.patch(data);
  }
  /** Deletes one of the bot's own messages. */
  async delete() {
    if (!this.deletable)
      return rejectNotSupported(
        "Deleting other people's messages from a bot",
        MODERATION_HINT,
      );
    await this.client.rest.delete(
      `/channels/${this.channelId}/messages/${this.id}`,
    );
    this.channel.messages.cache.delete(this.id);
    return this;
  }
  /** Adds the bot's reaction with a Unicode emoji. */
  async react(emoji: string | { name?: string | null; id?: string | null }) {
    const name = typeof emoji === "string" ? emoji : emoji.name;
    if (
      (typeof emoji === "object" && emoji.id) ||
      (typeof emoji === "string" && /^<a?:\w+:\d+>$/.test(emoji))
    )
      return rejectNotSupported(
        "Custom emoji",
        "Use a standard Unicode emoji.",
      );
    if (!name) throw new TypeError("Name an emoji to react with.");
    await this.client.rest.put(
      `/channels/${this.channelId}/messages/${this.id}/reactions/${encodeURIComponent(name)}`,
    );
    const reaction =
      this.reactions.cache.get(name) ??
      new MessageReaction(this, name, 0, false);
    reaction.count = (reaction.me ? 0 : 1) + (reaction.count ?? 0);
    reaction.me = true;
    this.reactions.cache.set(name, reaction);
    return reaction;
  }
  async fetch() {
    return this.channel.messages.fetch(this.id);
  }
  async fetchReference() {
    if (!this.reference) throw new Error("This message is not a reply.");
    return this.channel.messages.fetch(this.reference.messageId);
  }
  pin(): Promise<never> {
    return rejectNotSupported("Pinning from a bot");
  }
  unpin(): Promise<never> {
    return rejectNotSupported("Pinning from a bot");
  }
  crosspost(): Promise<never> {
    return rejectNotSupported("Crossposting");
  }
  startThread(_options: unknown): Promise<never> {
    return rejectNotSupported("Threads from bots");
  }
  removeAttachments(): Promise<never> {
    return rejectNotSupported("Removing attachments from a bot");
  }
  suppressEmbeds(_suppress?: boolean): Promise<never> {
    return rejectNotSupported("Suppressing embeds");
  }
  createReactionCollector(_options?: unknown): never {
    return notSupported(
      "Reaction collectors",
      "Listen for messageReactionAdd on the client.",
    );
  }
  awaitReactions(_options?: unknown): Promise<never> {
    return rejectNotSupported(
      "Reaction collectors",
      "Listen for messageReactionAdd on the client.",
    );
  }
  createMessageComponentCollector(_options?: unknown): never {
    return notSupported(
      "Component collectors",
      "Handle interactionCreate on the client and match the customId.",
    );
  }
  awaitMessageComponent(_options?: unknown): Promise<never> {
    return rejectNotSupported(
      "Component collectors",
      "Handle interactionCreate on the client and match the customId.",
    );
  }
  toString() {
    return this.content;
  }
}

// -------------------------------------------------------- commands

/** Global commands (client.application.commands) or one hub's
 * (guild.commands). Hubs replaces the whole list on each write. */
export class CommandManager {
  readonly client: Client;
  readonly guildId: string | null;
  readonly cache = new Collection<string, Json>();
  constructor(client: Client, guildId: string | null) {
    this.client = client;
    this.guildId = guildId;
  }
  private path(guildId?: string | null) {
    const hub = guildId ?? this.guildId;
    return hub
      ? `/hubs/${this.client.resolveId("guilds", hub) ?? hub}/commands`
      : "/applications/@me/commands";
  }
  private store(commands: Json[]) {
    this.cache.clear();
    for (const command of commands)
      this.cache.set(String(command.id), {
        ...command,
        commandName: command.name,
      });
    return this.cache;
  }
  /** Replaces the list. `guildId` (as in discord.js) targets one hub. */
  async set(commands: unknown[], guildId?: string) {
    const { commands: saved } = await this.client.rest.put(
      this.path(guildId),
      commands.map(toHubsCommand),
    );
    return guildId && guildId !== this.guildId
      ? new Collection<string, Json>(saved.map((c: Json) => [String(c.id), c]))
      : this.store(saved);
  }
  fetch(options?: { guildId?: string }): Promise<Collection<string, Json>>;
  fetch(id: string): Promise<Json>;
  async fetch(
    options?: string | { guildId?: string },
  ): Promise<Collection<string, Json> | Json> {
    const guildId = typeof options === "object" ? options.guildId : undefined;
    const { commands } = await this.client.rest.get(this.path(guildId));
    const list =
      guildId && guildId !== this.guildId
        ? new Collection<string, Json>(
            commands.map((c: Json) => [String(c.id), c]),
          )
        : this.store(commands);
    if (typeof options === "string") {
      const one = list.get(options);
      if (!one) throw this.client.unknown("Command", options);
      return one;
    }
    return list;
  }
  /** Adds or replaces one command by name (fetches, then sets the list). */
  async create(command: unknown, guildId?: string) {
    const converted = toHubsCommand(command);
    const { commands } = await this.client.rest.get(this.path(guildId));
    const next = [
      ...commands.filter((c: Json) => c.name !== converted.name).map(strip),
      converted,
    ];
    const { commands: saved } = await this.client.rest.put(
      this.path(guildId),
      next,
    );
    if (!guildId || guildId === this.guildId) this.store(saved);
    return saved.find((c: Json) => c.name === converted.name);
  }
  async delete(command: string | Json, guildId?: string) {
    const id = typeof command === "string" ? command : String(command.id);
    const { commands } = await this.client.rest.get(this.path(guildId));
    const next = commands
      .filter((c: Json) => c.id !== id && c.name !== id)
      .map(strip);
    const { commands: saved } = await this.client.rest.put(
      this.path(guildId),
      next,
    );
    if (!guildId || guildId === this.guildId) this.store(saved);
    return null;
  }
  edit(command: string | Json, data: unknown, guildId?: string) {
    const name =
      typeof command === "string"
        ? (this.cache.get(command)?.name ?? command)
        : command.name;
    const json =
      typeof (data as Json)?.toJSON === "function"
        ? (data as Json).toJSON()
        : (data as Json);
    return this.create({ ...json, name }, guildId);
  }
  get permissions(): never {
    return notSupported(
      "Command permissions",
      "Check interaction.member.roles in your handler.",
    );
  }
}
const strip = (command: Json) => ({
  name: command.name,
  description: command.description,
  ...(command.options?.length ? { options: command.options } : {}),
});
