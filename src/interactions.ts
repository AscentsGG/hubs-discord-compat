/*
 * discord.js interactions over Hubs INTERACTION_CREATE events. Answers go to
 * the interaction callback (within 3 seconds), then follow-ups and edits to
 * the first answer for 15 minutes, as the interactions page of the Hubs
 * developer docs describes (https://thehubs.gg/developers/docs/interactions).
 */
import type { Client } from "./client.js";
import { Collection } from "./collection.js";
import { ComponentType, InteractionType } from "./constants.js";
import { toHubsMessage, toHubsModal } from "./convert.js";
import { HubsNotSupportedError, notSupported } from "./errors.js";
import { idempotencyKey } from "./rest.js";
import { Role } from "./structures.js";
import { Message } from "./structures.js";
import type { GuildMember, TextChannel, User } from "./structures.js";

type Json = Record<string, any>;
const rejectNotSupported = (feature: string, hint?: string): Promise<never> =>
  Promise.reject(new HubsNotSupportedError(feature, hint));

/** The body of a reply, follow-up or update, without kit-only fields. */
function messageData(options: unknown, keepEphemeral: boolean) {
  const body = toHubsMessage(options, "interaction");
  const out: Json = {};
  if (body.content !== undefined) out.content = body.content;
  if (body.embeds !== undefined) out.embeds = body.embeds;
  if (body.components !== undefined) out.components = body.components;
  if (keepEphemeral && body.ephemeral) out.ephemeral = true;
  if (!keepEphemeral && body.ephemeral)
    notSupported(
      "Making an edit or update ephemeral",
      "Choose ephemeral on the first reply.",
    );
  return { data: out, nonce: body.nonce };
}

export class BaseInteraction {
  readonly client: Client;
  readonly id: string;
  readonly applicationId: string;
  /** Null in a direct message or group DM. */
  readonly guildId: string | null;
  readonly channelId: string;
  readonly user: User;
  readonly member: GuildMember | null;
  readonly createdTimestamp: number;
  /** The Hubs interaction kind: command, autocomplete, component or modal_submit. */
  readonly kind: string;
  /** Where it was used: "hub", "dm" or "group_dm". */
  readonly context: string;
  /** @internal */
  readonly raw: Json;
  /** @internal Set for an interaction that came as an HTTP request: the
   * first answer becomes the response body instead of a callback call. */
  inlineAnswer: ((body: Json) => void) | null = null;
  constructor(client: Client, data: Json) {
    this.client = client;
    this.raw = data;
    this.id = String(data.id);
    this.kind = String(data.type);
    this.applicationId = String(data.applicationId);
    this.guildId = data.hubId ? String(data.hubId) : null;
    this.context = String(data.context ?? "hub");
    this.channelId = String(data.channelId);
    this.user = client.users.add(data.user);
    const guild = this.guildId ? client.guilds.cache.get(this.guildId) : null;
    this.member = guild
      ? guild.members.add(data.user, String(data.member?.role ?? "member"))
      : null;
    this.createdTimestamp = Date.parse(
      data.createdAt ?? new Date().toISOString(),
    );
  }
  get type() {
    return {
      command: InteractionType.ApplicationCommand,
      autocomplete: InteractionType.ApplicationCommandAutocomplete,
      component: InteractionType.MessageComponent,
      modal_submit: InteractionType.ModalSubmit,
    }[this.kind as "command"]!;
  }
  get createdAt() {
    return new Date(this.createdTimestamp);
  }
  get guild() {
    return this.guildId
      ? (this.client.guilds.cache.get(this.guildId) ?? null)
      : null;
  }
  get channel(): TextChannel {
    return this.client.channels.channelFor(this.channelId, this.guildId);
  }
  inGuild() {
    return this.guildId !== null;
  }
  inCachedGuild() {
    return this.guild !== null;
  }
  /** chat_input, user or message, for commands. */
  private get commandKind() {
    return String(this.raw.data?.type ?? "chat_input");
  }
  isCommand() {
    return this.kind === "command";
  }
  isChatInputCommand() {
    return this.kind === "command" && this.commandKind === "chat_input";
  }
  isContextMenuCommand() {
    return this.kind === "command" && this.commandKind !== "chat_input";
  }
  isUserContextMenuCommand() {
    return this.kind === "command" && this.commandKind === "user";
  }
  isMessageContextMenuCommand() {
    return this.kind === "command" && this.commandKind === "message";
  }
  isAutocomplete() {
    return this.kind === "autocomplete";
  }
  isMessageComponent() {
    return this.kind === "component";
  }
  isButton() {
    return (
      this.kind === "component" && this.raw.data?.componentType === "button"
    );
  }
  isStringSelectMenu() {
    return (
      this.kind === "component" && this.raw.data?.componentType === "select"
    );
  }
  isSelectMenu() {
    return this.isStringSelectMenu();
  }
  isAnySelectMenu() {
    return this.isStringSelectMenu();
  }
  isUserSelectMenu() {
    return false;
  }
  isRoleSelectMenu() {
    return false;
  }
  isChannelSelectMenu() {
    return false;
  }
  isMentionableSelectMenu() {
    return false;
  }
  isModalSubmit() {
    return this.kind === "modal_submit";
  }
  isRepliable() {
    return this.kind !== "autocomplete";
  }
  /** @internal */
  callback(body: Json) {
    if (this.inlineAnswer) {
      const answer = this.inlineAnswer;
      this.inlineAnswer = null;
      answer(body);
      return Promise.resolve(null);
    }
    return this.client.rest.post(`/interactions/${this.id}/callback`, body);
  }
}

/** What reply, deferReply, update and deferUpdate resolve with. */
export interface InteractionResponse {
  interaction: BaseInteraction;
  id: string;
}

class RepliableInteraction extends BaseInteraction {
  replied = false;
  deferred = false;
  ephemeral: boolean | null = null;
  private assertFresh() {
    if (this.replied || this.deferred)
      throw new Error(
        "This interaction was already answered (InteractionAlreadyReplied).",
      );
  }
  /** The first answer, within 3 seconds. */
  async reply(options: unknown): Promise<InteractionResponse> {
    this.assertFresh();
    const { data } = messageData(options, true);
    await this.callback({
      type: "reply",
      data: { content: "", embeds: [], components: [], ...data },
    });
    this.replied = true;
    this.ephemeral = data.ephemeral === true;
    return { interaction: this, id: this.id };
  }
  /** Shows "thinking" until editReply or followUp, for up to 15 minutes. */
  async deferReply(
    options: {
      ephemeral?: boolean;
      flags?: number;
      fetchReply?: boolean;
      withResponse?: boolean;
    } = {},
  ): Promise<InteractionResponse> {
    this.assertFresh();
    const ephemeral =
      toHubsMessage({ ...options }, "interaction").ephemeral === true;
    await this.callback({ type: "defer", data: { ephemeral } });
    this.deferred = true;
    this.ephemeral = ephemeral;
    return { interaction: this, id: this.id };
  }
  /** Changes the first answer (after a public defer, posts it). */
  async editReply(options: unknown) {
    if (!this.replied && !this.deferred)
      throw new Error(
        "Reply or defer before editing the reply (InteractionNotReplied).",
      );
    const { data } = messageData(options, false);
    const result = await this.client.rest.patch(
      `/interactions/${this.id}/original`,
      data,
    );
    this.replied = true;
    return this.asMessage(result);
  }
  /** Another answer, public or ephemeral, within 15 minutes. */
  async followUp(options: unknown) {
    if (!this.replied && !this.deferred)
      throw new Error(
        "Reply or defer before a follow-up (InteractionNotReplied).",
      );
    const { data, nonce } = messageData(options, true);
    const result = await this.client.rest.post(
      `/interactions/${this.id}/followups`,
      data,
      {
        "idempotency-key": idempotencyKey(nonce),
      },
    );
    return this.asMessage(result);
  }
  /** @internal A public answer comes back as a message; a private one as
   * `{ ephemeral: true, id }`, returned as is. */
  asMessage(result: any): Message | Json | null {
    if (result && result.author && result.channelId)
      return this.guildId
        ? this.channel.messages.add(result)
        : new Message(this.client, result);
    return result ?? null;
  }
  deleteReply(_message?: unknown): Promise<never> {
    return rejectNotSupported(
      "Deleting an interaction reply",
      "Edit the reply instead; private replies disappear for the person after an hour.",
    );
  }
  fetchReply(_message?: unknown): Promise<never> {
    return rejectNotSupported(
      "fetchReply",
      "followUp and editReply return the message; a public reply also arrives in messageCreate.",
    );
  }
  /** Opens a form (commands and components only). */
  async showModal(modal: unknown) {
    this.assertFresh();
    if (this.kind === "modal_submit")
      throw new Error("A modal cannot open another modal.");
    await this.callback({ type: "modal", data: toHubsModal(modal) });
    this.replied = true;
  }
  /** The bot's message (or private reply) a component was on. */
  async update(options: unknown): Promise<InteractionResponse> {
    this.assertFresh();
    if (this.kind !== "component" && this.kind !== "modal_submit")
      throw new Error(
        "Only component and modal interactions can update a message.",
      );
    const { data } = messageData(options, false);
    await this.callback({ type: "update", data });
    this.replied = true;
    return { interaction: this, id: this.id };
  }
  async deferUpdate(_options?: unknown): Promise<InteractionResponse> {
    this.assertFresh();
    if (this.kind !== "component" && this.kind !== "modal_submit")
      throw new Error(
        "Only component and modal interactions can defer an update.",
      );
    await this.callback({ type: "defer_update" });
    this.deferred = true;
    return { interaction: this, id: this.id };
  }
  sendPremiumRequired(): Promise<never> {
    return rejectNotSupported(
      "Premium purchases",
      "Hubs has no app purchases.",
    );
  }
  launchActivity(): Promise<never> {
    return rejectNotSupported(
      "Activities",
      "See Hosted apps in the Hubs docs.",
    );
  }
}

// ------------------------------------------------------------- options

export class CommandInteractionOptionResolver {
  readonly data: Json[];
  private readonly interaction: BaseInteraction;
  private readonly group: string | null = null;
  private readonly subcommand: string | null = null;
  /** The options of the chosen subcommand, or the command's own. */
  private readonly hoisted: Json[];
  constructor(interaction: BaseInteraction, options: Json[]) {
    this.interaction = interaction;
    this.data = options;
    let hoisted = options;
    if (hoisted[0]?.type === "subcommand_group") {
      this.group = String(hoisted[0].name);
      hoisted = hoisted[0].options ?? [];
    }
    if (hoisted[0]?.type === "subcommand") {
      this.subcommand = String(hoisted[0].name);
      hoisted = hoisted[0].options ?? [];
    }
    this.hoisted = hoisted;
  }
  get(name: string, required = false) {
    const option = this.hoisted.find((item) => item.name === name) ?? null;
    if (!option && required)
      throw new TypeError(`The option "${name}" is required.`);
    return option;
  }
  private typed(name: string, type: string, required: boolean) {
    const option = this.get(name, required);
    if (!option) return null;
    if (option.type !== type)
      throw new TypeError(
        `The option "${name}" is a ${option.type}, not a ${type}.`,
      );
    return option.value;
  }
  getString(name: string, required = false): string | null {
    return this.typed(name, "string", required);
  }
  getInteger(name: string, required = false): number | null {
    return this.typed(name, "integer", required);
  }
  getNumber(name: string, required = false): number | null {
    return this.typed(name, "number", required);
  }
  getBoolean(name: string, required = false): boolean | null {
    return this.typed(name, "boolean", required);
  }
  getUser(name: string, required = false): User | null {
    const value = this.typed(name, "user", required);
    return value ? this.interaction.client.users.add(value) : null;
  }
  /** The member from the cache (all members after guild.members.fetch()). */
  getMember(name: string): GuildMember | null {
    const value = this.typed(name, "user", false);
    return value
      ? (this.interaction.guild?.members.cache.get(String(value.id)) ?? null)
      : null;
  }
  getChannel(name: string, required = false): TextChannel | null {
    const value = this.typed(name, "channel", required);
    if (!value) return null;
    return this.interaction.client.channels
      .channelFor(String(value.id), this.interaction.guildId)
      .patch({ name: value.name, kind: value.kind });
  }
  getFocused(full = false) {
    const option = this.hoisted.find((item) => item.focused);
    if (!option) throw new TypeError("No option is focused.");
    return full
      ? {
          name: option.name,
          type: option.type,
          value: option.value,
          focused: true,
        }
      : option.value;
  }
  getSubcommand(required = true): string | null {
    if (required && !this.subcommand)
      throw new TypeError("This command was used without a subcommand.");
    return this.subcommand;
  }
  getSubcommandGroup(required = false): string | null {
    if (required && !this.group)
      throw new TypeError("This command was used without a subcommand group.");
    return this.group;
  }
  private roleFrom(value: Json) {
    const guild = this.interaction.guild;
    return guild
      ? new Role(guild, String(value.id), String(value.name), 0)
      : null;
  }
  /** A hub community role: `{ id, name }` as a Role. */
  getRole(name: string, required = false): Role | null {
    const value = this.typed(name, "role", required);
    return value ? this.roleFrom(value) : null;
  }
  /** Someone in the hub (a User) or one of its roles (a Role). */
  getMentionable(name: string, required = false): User | Role | null {
    const value = this.typed(name, "mentionable", required);
    if (!value) return null;
    if (value.kind === "role") return this.roleFrom(value);
    const { kind: _kind, ...user } = value;
    return this.interaction.client.users.add(user);
  }
  /** A file the person gave the command. `url` works for 10 minutes and
   * needs no token; download it then if you keep it. */
  getAttachment(name: string, required = false): Attachment | null {
    const value = this.typed(name, "attachment", required);
    return value ? toAttachment(value, this.interaction.client) : null;
  }
  getMessage(_name: string, _required?: boolean): never {
    return notSupported(
      "Message options",
      "Use a message command (a context menu command of type 3); its targetMessage is the message picked.",
    );
  }
}

/** A file someone gave a command, shaped like discord.js's Attachment. */
export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** An absolute address, good until expiresAt. */
  url: string;
  proxyURL: string;
  expiresAt: Date;
}
function toAttachment(value: Json, client: Client): Attachment {
  const url = /^https?:/.test(String(value.url))
    ? String(value.url)
    : `${client.rest.baseUrl}${String(value.url)}`;
  return {
    id: String(value.id),
    name: String(value.name),
    contentType: String(value.contentType),
    size: Number(value.size),
    url,
    proxyURL: url,
    expiresAt: new Date(String(value.expiresAt)),
  };
}

export class ChatInputCommandInteraction extends RepliableInteraction {
  get commandId() {
    return String(this.raw.data?.id ?? "");
  }
  get commandName() {
    return String(this.raw.data?.name ?? "");
  }
  get commandType() {
    return 1;
  }
  get commandGuildId() {
    return null;
  }
  readonly options = new CommandInteractionOptionResolver(
    this,
    this.raw.data?.options ?? [],
  );
  toString() {
    return `/${this.commandName}`;
  }
}

/** A message or user command, from the Apps part of a menu. */
export class ContextMenuCommandInteraction extends RepliableInteraction {
  get commandId() {
    return String(this.raw.data?.id ?? "");
  }
  get commandName() {
    return String(this.raw.data?.name ?? "");
  }
  get commandType() {
    return this.raw.data?.type === "message" ? 3 : 2;
  }
  get commandGuildId() {
    return null;
  }
  get targetId() {
    return String(this.raw.data?.targetId ?? "");
  }
}
export class UserContextMenuCommandInteraction extends ContextMenuCommandInteraction {
  get targetUser(): User {
    return this.client.users.add(this.raw.data?.user ?? { id: this.targetId });
  }
  /** The member from the cache, with their hub role (hubs only). */
  get targetMember(): GuildMember | null {
    const guild = this.guild;
    const user = this.raw.data?.user;
    if (!guild || !user) return null;
    return guild.members.add(
      user,
      String(this.raw.data?.member?.role ?? "member"),
    );
  }
}
export class MessageContextMenuCommandInteraction extends ContextMenuCommandInteraction {
  /** The message picked: its id, text, author and time. */
  get targetMessage(): Message {
    const data = this.raw.data?.message ?? { id: this.targetId };
    const shaped = {
      id: String(data.id),
      channelId: this.channelId,
      hubId: this.guildId,
      ...(data.author
        ? {
            content: String(data.content ?? ""),
            author: data.author,
            createdAt: data.createdAt,
            editedAt: data.editedAt ?? null,
          }
        : {}),
    };
    // Direct messages have no hub channel to cache the message in.
    if (!this.guildId) return new Message(this.client, shaped);
    const cached = this.channel.messages.cache.get(shaped.id);
    if (cached) return cached;
    return data.author
      ? this.channel.messages.add(shaped)
      : this.client.partialMessage(shaped);
  }
}

export class AutocompleteInteraction extends BaseInteraction {
  responded = false;
  get commandId() {
    return String(this.raw.data?.id ?? "");
  }
  get commandName() {
    return String(this.raw.data?.name ?? "");
  }
  readonly options = new CommandInteractionOptionResolver(
    this,
    this.raw.data?.options ?? [],
  );
  /** Up to 25 suggestions. */
  async respond(choices: { name: string; value: string | number }[]) {
    if (this.responded)
      throw new Error("This autocomplete was already answered.");
    await this.callback({
      type: "autocomplete",
      data: {
        choices: choices.map((choice) => {
          if (
            (choice as Json).name_localizations ||
            (choice as Json).nameLocalizations
          )
            notSupported("Command localizations");
          return { name: String(choice.name), value: choice.value };
        }),
      },
    });
    this.responded = true;
  }
}

export class MessageComponentInteraction extends RepliableInteraction {
  get customId() {
    return String(this.raw.data?.customId ?? "");
  }
  get componentType() {
    return this.raw.data?.componentType === "select"
      ? ComponentType.StringSelect
      : ComponentType.Button;
  }
  /** The message the control was on: the cached message, or one with only
   * its id. Private replies carry `ephemeral: true`. */
  get message(): Message {
    const id = String(this.raw.message?.id ?? "");
    return (
      this.channel.messages.cache.get(id) ??
      this.client.partialMessage({
        id,
        channelId: this.channelId,
        hubId: this.guildId,
      })
    );
  }
  get messageIsEphemeral() {
    return this.raw.message?.ephemeral === true;
  }
}
export class ButtonInteraction extends MessageComponentInteraction {}
export class StringSelectMenuInteraction extends MessageComponentInteraction {
  get values(): string[] {
    return [...(this.raw.data?.values ?? [])];
  }
}

export class ModalSubmitFields {
  readonly fields: Collection<
    string,
    { customId: string; value: string; type: number }
  >;
  constructor(fields: Json[]) {
    this.fields = new Collection(
      fields.map((field) => [
        String(field.customId),
        {
          customId: String(field.customId),
          value: String(field.value ?? ""),
          type: ComponentType.TextInput,
        },
      ]),
    );
  }
  getField(customId: string) {
    const field = this.fields.get(customId);
    if (!field) throw new TypeError(`No field "${customId}" in this form.`);
    return field;
  }
  getTextInputValue(customId: string) {
    return this.getField(customId).value;
  }
}
export class ModalSubmitInteraction extends RepliableInteraction {
  get customId() {
    return String(this.raw.data?.customId ?? "");
  }
  readonly fields = new ModalSubmitFields(this.raw.data?.fields ?? []);
  isFromMessage() {
    return !!this.raw.message?.id;
  }
}

export function createInteraction(client: Client, data: Json) {
  switch (data.type) {
    case "command":
      return data.data?.type === "message"
        ? new MessageContextMenuCommandInteraction(client, data)
        : data.data?.type === "user"
          ? new UserContextMenuCommandInteraction(client, data)
          : new ChatInputCommandInteraction(client, data);
    case "autocomplete":
      return new AutocompleteInteraction(client, data);
    case "component":
      return data.data?.componentType === "select"
        ? new StringSelectMenuInteraction(client, data)
        : new ButtonInteraction(client, data);
    case "modal_submit":
      return new ModalSubmitInteraction(client, data);
    default:
      return new BaseInteraction(client, data);
  }
}
