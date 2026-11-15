/*
 * discord.js builders. Each produces Discord-shaped JSON from toJSON(), as
 * discord.js does, and the kit converts that JSON to the Hubs shape when it
 * sends (convert.ts). Setters for things Hubs cannot show throw at once, so
 * the line that needs changing is the one in the stack trace.
 */
import {
  ButtonStyle,
  Colors,
  ComponentType,
  TextInputStyle,
} from "./constants.js";
import { notSupported } from "./errors.js";

type Json = Record<string, any>;
export type ColorResolvable =
  | number
  | `#${string}`
  | readonly [number, number, number]
  | keyof typeof Colors
  | "Random";

export function resolveColor(
  color: ColorResolvable | null,
): number | undefined {
  if (color === null) return undefined;
  if (typeof color === "number") {
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
      throw new RangeError("A color is a whole number from 0 to 0xFFFFFF.");
    return color;
  }
  if (Array.isArray(color)) {
    const [r, g, b] = color as readonly number[];
    return resolveColor((r << 16) | (g << 8) | b);
  }
  if (typeof color === "string" && color.startsWith("#"))
    return resolveColor(Number.parseInt(color.slice(1), 16));
  if (color === "Random") return Math.floor(Math.random() * 0xffffff);
  if (typeof color === "string" && color in Colors)
    return Colors[color as keyof typeof Colors];
  throw new TypeError(`Unknown color: ${String(color)}.`);
}

const emojiOf = (emoji: unknown) => {
  if (emoji === undefined || emoji === null) return undefined;
  if (typeof emoji === "string") {
    if (/^<a?:\w+:\d+>$/.test(emoji) || /^\d{15,}$/.test(emoji))
      notSupported("Custom emoji", "Use a standard Unicode emoji.");
    return { name: emoji };
  }
  const value = emoji as { id?: string | null; name?: string | null };
  if (value.id) notSupported("Custom emoji", "Use a standard Unicode emoji.");
  return { name: String(value.name ?? "") };
};

// ------------------------------------------------------------ embeds

export class EmbedBuilder {
  readonly data: Json;
  constructor(data: Json = {}) {
    this.data = { ...data, fields: data.fields ? [...data.fields] : undefined };
    if (!this.data.fields) delete this.data.fields;
  }
  static from(other: EmbedBuilder | Json) {
    return new EmbedBuilder(
      other instanceof EmbedBuilder ? other.toJSON() : other,
    );
  }
  setTitle(title: string | null) {
    if (title === null) delete this.data.title;
    else this.data.title = title;
    return this;
  }
  setDescription(description: string | null) {
    if (description === null) delete this.data.description;
    else this.data.description = description;
    return this;
  }
  setURL(url: string | null) {
    if (url === null) delete this.data.url;
    else this.data.url = url;
    return this;
  }
  setColor(color: ColorResolvable | null) {
    const value = resolveColor(color);
    if (value === undefined) delete this.data.color;
    else this.data.color = value;
    return this;
  }
  setAuthor(author: { name: string; iconURL?: string; url?: string } | null) {
    if (author === null) {
      delete this.data.author;
      return this;
    }
    if (author.iconURL)
      notSupported(
        "An embed author icon",
        "Hubs never loads pictures from other sites in embeds.",
      );
    if (author.url)
      notSupported("An embed author link", "Put the link in the description.");
    this.data.author = { name: author.name };
    return this;
  }
  setFooter(footer: { text: string; iconURL?: string } | null) {
    if (footer === null) {
      delete this.data.footer;
      return this;
    }
    if (footer.iconURL)
      notSupported(
        "An embed footer icon",
        "Hubs never loads pictures from other sites in embeds.",
      );
    this.data.footer = { text: footer.text };
    return this;
  }
  setTimestamp(timestamp: Date | number | null = Date.now()) {
    if (timestamp === null) delete this.data.timestamp;
    else this.data.timestamp = new Date(timestamp).toISOString();
    return this;
  }
  addFields(
    ...fields: (
      | { name: string; value: string; inline?: boolean }
      | { name: string; value: string; inline?: boolean }[]
    )[]
  ) {
    this.data.fields = [...(this.data.fields ?? []), ...fields.flat()];
    return this;
  }
  setFields(
    ...fields: (
      | { name: string; value: string; inline?: boolean }
      | { name: string; value: string; inline?: boolean }[]
    )[]
  ) {
    this.data.fields = fields.flat();
    return this;
  }
  spliceFields(
    index: number,
    deleteCount: number,
    ...fields: { name: string; value: string; inline?: boolean }[]
  ) {
    const list = [...(this.data.fields ?? [])];
    list.splice(index, deleteCount, ...fields);
    this.data.fields = list;
    return this;
  }
  setImage(_url: string | null): this {
    return notSupported(
      "EmbedBuilder.setImage",
      "Hubs never loads pictures from other sites in embeds. Link to the picture instead.",
    );
  }
  setThumbnail(_url: string | null): this {
    return notSupported(
      "EmbedBuilder.setThumbnail",
      "Hubs never loads pictures from other sites in embeds. Link to the picture instead.",
    );
  }
  toJSON(): Json {
    return JSON.parse(JSON.stringify(this.data));
  }
}

// ------------------------------------------------------- components

export class ButtonBuilder {
  readonly data: Json;
  constructor(data: Json = {}) {
    this.data = { type: ComponentType.Button, ...data };
  }
  setCustomId(customId: string) {
    this.data.custom_id = customId;
    return this;
  }
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setStyle(style: number) {
    if (style === ButtonStyle.Premium)
      notSupported("Premium buttons", "Hubs has no app purchases.");
    this.data.style = style;
    return this;
  }
  setURL(url: string) {
    this.data.url = url;
    return this;
  }
  setEmoji(emoji: string | { id?: string | null; name?: string | null }) {
    this.data.emoji = emojiOf(emoji);
    return this;
  }
  setDisabled(disabled = true) {
    this.data.disabled = disabled;
    return this;
  }
  setSKUId(_sku: string): this {
    return notSupported("Premium buttons", "Hubs has no app purchases.");
  }
  toJSON(): Json {
    return { ...this.data };
  }
}

export class StringSelectMenuOptionBuilder {
  readonly data: Json;
  constructor(data: Json = {}) {
    this.data = { ...data };
  }
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setValue(value: string) {
    this.data.value = value;
    return this;
  }
  setDescription(description: string) {
    this.data.description = description;
    return this;
  }
  setDefault(isDefault = true) {
    this.data.default = isDefault;
    return this;
  }
  setEmoji(_emoji: unknown): this {
    return notSupported(
      "Emoji on select menu options",
      "Put the emoji in the label.",
    );
  }
  toJSON(): Json {
    return { ...this.data };
  }
}

type OptionInput = StringSelectMenuOptionBuilder | Json;
const optionJson = (option: OptionInput) =>
  option instanceof StringSelectMenuOptionBuilder
    ? option.toJSON()
    : { ...option };

export class StringSelectMenuBuilder {
  readonly data: Json;
  readonly options: Json[];
  constructor(data: Json = {}) {
    const { options, ...rest } = data;
    this.data = { type: ComponentType.StringSelect, ...rest };
    this.options = (options ?? []).map(optionJson);
  }
  setCustomId(customId: string) {
    this.data.custom_id = customId;
    return this;
  }
  setPlaceholder(placeholder: string) {
    this.data.placeholder = placeholder;
    return this;
  }
  setMinValues(min: number) {
    this.data.min_values = min;
    return this;
  }
  setMaxValues(max: number) {
    this.data.max_values = max;
    return this;
  }
  setDisabled(disabled = true) {
    this.data.disabled = disabled;
    return this;
  }
  addOptions(...options: (OptionInput | OptionInput[])[]) {
    this.options.push(...options.flat().map(optionJson));
    return this;
  }
  setOptions(...options: (OptionInput | OptionInput[])[]) {
    this.options.splice(
      0,
      this.options.length,
      ...options.flat().map(optionJson),
    );
    return this;
  }
  toJSON(): Json {
    return {
      ...this.data,
      options: this.options.map((option) => ({ ...option })),
    };
  }
}
/** discord.js v13 name for the same thing. */
export const SelectMenuBuilder = StringSelectMenuBuilder;

const selectNotSupported = (kind: string) =>
  class {
    constructor() {
      notSupported(
        `${kind} select menus`,
        "Use a StringSelectMenuBuilder, or a slash command option for people and channels.",
      );
    }
  };
export const UserSelectMenuBuilder = selectNotSupported("User");
export const RoleSelectMenuBuilder = selectNotSupported("Role");
export const ChannelSelectMenuBuilder = selectNotSupported("Channel");
export const MentionableSelectMenuBuilder = selectNotSupported("Mentionable");

export class TextInputBuilder {
  readonly data: Json;
  constructor(data: Json = {}) {
    this.data = { type: ComponentType.TextInput, ...data };
  }
  setCustomId(customId: string) {
    this.data.custom_id = customId;
    return this;
  }
  setLabel(label: string) {
    this.data.label = label;
    return this;
  }
  setStyle(style: number) {
    this.data.style = style;
    return this;
  }
  setPlaceholder(placeholder: string) {
    this.data.placeholder = placeholder;
    return this;
  }
  setMinLength(min: number) {
    this.data.min_length = min;
    return this;
  }
  setMaxLength(max: number) {
    this.data.max_length = max;
    return this;
  }
  setRequired(required = true) {
    this.data.required = required;
    return this;
  }
  setValue(value: string) {
    this.data.value = value;
    return this;
  }
  toJSON(): Json {
    return { style: TextInputStyle.Short, ...this.data };
  }
}

type ComponentInput = { toJSON(): Json } | Json;
const componentJson = (component: ComponentInput): Json =>
  typeof (component as { toJSON?: unknown }).toJSON === "function"
    ? (component as { toJSON(): Json }).toJSON()
    : { ...(component as Json) };

export class ActionRowBuilder<_T = unknown> {
  readonly components: ComponentInput[];
  constructor(data: { components?: ComponentInput[] } = {}) {
    this.components = [...(data.components ?? [])];
  }
  addComponents(...components: (ComponentInput | ComponentInput[])[]) {
    this.components.push(...components.flat());
    return this;
  }
  setComponents(...components: (ComponentInput | ComponentInput[])[]) {
    this.components.splice(0, this.components.length, ...components.flat());
    return this;
  }
  toJSON(): Json {
    return {
      type: ComponentType.ActionRow,
      components: this.components.map(componentJson),
    };
  }
}

export class ModalBuilder {
  readonly data: Json;
  readonly components: ComponentInput[];
  constructor(data: Json = {}) {
    const { components, ...rest } = data;
    this.data = { ...rest };
    this.components = [...(components ?? [])];
  }
  setCustomId(customId: string) {
    this.data.custom_id = customId;
    return this;
  }
  setTitle(title: string) {
    this.data.title = title;
    return this;
  }
  addComponents(...components: (ComponentInput | ComponentInput[])[]) {
    this.components.push(...components.flat());
    return this;
  }
  setComponents(...components: (ComponentInput | ComponentInput[])[]) {
    this.components.splice(0, this.components.length, ...components.flat());
    return this;
  }
  toJSON(): Json {
    return { ...this.data, components: this.components.map(componentJson) };
  }
}

// --------------------------------------------------- slash commands

class OptionBuilder {
  readonly data: Json;
  constructor(type: number) {
    this.data = { type };
  }
  setName(name: string) {
    this.data.name = name;
    return this;
  }
  setDescription(description: string) {
    this.data.description = description;
    return this;
  }
  setRequired(required = true) {
    this.data.required = required;
    return this;
  }
  setNameLocalizations(_value: unknown): this {
    return notSupported("Command localizations");
  }
  setDescriptionLocalizations(_value: unknown): this {
    return notSupported("Command localizations");
  }
  toJSON(): Json {
    return { ...this.data };
  }
}
class ChoiceOptionBuilder<T extends string | number> extends OptionBuilder {
  addChoices(...choices: { name: string; value: T }[]) {
    this.data.choices = [...(this.data.choices ?? []), ...choices];
    return this;
  }
  setChoices(...choices: { name: string; value: T }[]) {
    this.data.choices = [...choices];
    return this;
  }
  setAutocomplete(autocomplete = true) {
    this.data.autocomplete = autocomplete;
    return this;
  }
}
export class SlashCommandStringOption extends ChoiceOptionBuilder<string> {
  constructor() {
    super(3);
  }
  setMinLength(min: number) {
    this.data.min_length = min;
    return this;
  }
  setMaxLength(max: number) {
    this.data.max_length = max;
    return this;
  }
}
class NumericOption extends ChoiceOptionBuilder<number> {
  setMinValue(min: number) {
    this.data.min_value = min;
    return this;
  }
  setMaxValue(max: number) {
    this.data.max_value = max;
    return this;
  }
}
export class SlashCommandIntegerOption extends NumericOption {
  constructor() {
    super(4);
  }
}
export class SlashCommandNumberOption extends NumericOption {
  constructor() {
    super(10);
  }
}
export class SlashCommandBooleanOption extends OptionBuilder {
  constructor() {
    super(5);
  }
}
export class SlashCommandUserOption extends OptionBuilder {
  constructor() {
    super(6);
  }
}
export class SlashCommandChannelOption extends OptionBuilder {
  constructor() {
    super(7);
  }
  /** Text (0), voice (2) and announcement (5) channels map to Hubs kinds;
   * other types throw when the command is converted. */
  addChannelTypes(...types: (number | number[])[]) {
    this.data.channel_types = [
      ...(this.data.channel_types ?? []),
      ...types.flat(),
    ];
    return this;
  }
}
export class SlashCommandRoleOption extends OptionBuilder {
  constructor() {
    super(8);
  }
}
export class SlashCommandMentionableOption extends OptionBuilder {
  constructor() {
    super(9);
  }
}
/** A file the person picks; the bot gets a 10 minute address for it. */
export class SlashCommandAttachmentOption extends OptionBuilder {
  constructor() {
    super(11);
  }
}

type Configure<T> = T | ((option: T) => T);
const configured = <T>(make: () => T, input: Configure<T>) =>
  typeof input === "function" ? (input as (option: T) => T)(make()) : input;

/** The value options a command or a subcommand can hold. */
class OptionHolder {
  readonly options: { toJSON(): Json }[] = [];
  addStringOption(input: Configure<SlashCommandStringOption>) {
    this.options.push(configured(() => new SlashCommandStringOption(), input));
    return this;
  }
  addIntegerOption(input: Configure<SlashCommandIntegerOption>) {
    this.options.push(configured(() => new SlashCommandIntegerOption(), input));
    return this;
  }
  addNumberOption(input: Configure<SlashCommandNumberOption>) {
    this.options.push(configured(() => new SlashCommandNumberOption(), input));
    return this;
  }
  addBooleanOption(input: Configure<SlashCommandBooleanOption>) {
    this.options.push(configured(() => new SlashCommandBooleanOption(), input));
    return this;
  }
  addUserOption(input: Configure<SlashCommandUserOption>) {
    this.options.push(configured(() => new SlashCommandUserOption(), input));
    return this;
  }
  addChannelOption(input: Configure<SlashCommandChannelOption>) {
    this.options.push(configured(() => new SlashCommandChannelOption(), input));
    return this;
  }
  addRoleOption(input: Configure<SlashCommandRoleOption>) {
    this.options.push(configured(() => new SlashCommandRoleOption(), input));
    return this;
  }
  addMentionableOption(input: Configure<SlashCommandMentionableOption>) {
    this.options.push(
      configured(() => new SlashCommandMentionableOption(), input),
    );
    return this;
  }
  addAttachmentOption(input: Configure<SlashCommandAttachmentOption>) {
    this.options.push(
      configured(() => new SlashCommandAttachmentOption(), input),
    );
    return this;
  }
}

export class SlashCommandSubcommandBuilder extends OptionHolder {
  name = "";
  description = "";
  setName(name: string) {
    this.name = name;
    return this;
  }
  setDescription(description: string) {
    this.description = description;
    return this;
  }
  setNameLocalizations(_value: unknown): this {
    return notSupported("Command localizations");
  }
  setDescriptionLocalizations(_value: unknown): this {
    return notSupported("Command localizations");
  }
  toJSON(): Json {
    return {
      type: 1,
      name: this.name,
      description: this.description,
      options: this.options.map((option) => option.toJSON()),
    };
  }
}

export class SlashCommandSubcommandGroupBuilder {
  readonly options: SlashCommandSubcommandBuilder[] = [];
  name = "";
  description = "";
  setName(name: string) {
    this.name = name;
    return this;
  }
  setDescription(description: string) {
    this.description = description;
    return this;
  }
  setNameLocalizations(_value: unknown): this {
    return notSupported("Command localizations");
  }
  setDescriptionLocalizations(_value: unknown): this {
    return notSupported("Command localizations");
  }
  addSubcommand(input: Configure<SlashCommandSubcommandBuilder>) {
    this.options.push(
      configured(() => new SlashCommandSubcommandBuilder(), input),
    );
    return this;
  }
  toJSON(): Json {
    return {
      type: 2,
      name: this.name,
      description: this.description,
      options: this.options.map((option) => option.toJSON()),
    };
  }
}

/** Where a command works (contexts) and how it is installed. Shared by
 * slash and context menu commands. */
class CommandPlaces {
  contexts: number[] | null = null;
  integrationTypes: number[] | null = null;
  dmPermission: boolean | null = null;
  /** Hubs reads `true` as hub channels and direct messages. */
  setDMPermission(enabled: boolean | null | undefined): this {
    this.dmPermission = enabled ?? null;
    return this;
  }
  /** 0 hub channels, 1 direct messages, 2 group DMs (and DMs without the
   * bot). Direct messages need the bot in the conversation or added to the
   * person's account. */
  setContexts(...contexts: (number | number[])[]): this {
    this.contexts = contexts.flat();
    return this;
  }
  /** 0 installed in a hub, 1 added to a person's account. */
  setIntegrationTypes(...types: (number | number[])[]): this {
    this.integrationTypes = types.flat();
    return this;
  }
  /** @internal */
  placesJson(): Json {
    return {
      ...(this.contexts ? { contexts: this.contexts } : {}),
      ...(this.integrationTypes
        ? { integration_types: this.integrationTypes }
        : {}),
      ...(this.dmPermission !== null
        ? { dm_permission: this.dmPermission }
        : {}),
    };
  }
}

export class SlashCommandBuilder extends OptionHolder {
  name = "";
  description = "";
  defaultMemberPermissions: string | null = null;
  private readonly places = new CommandPlaces();
  setName(name: string) {
    this.name = name;
    return this;
  }
  setDescription(description: string) {
    this.description = description;
    return this;
  }
  setNameLocalizations(_value: unknown): this {
    return notSupported("Command localizations");
  }
  setDescriptionLocalizations(_value: unknown): this {
    return notSupported("Command localizations");
  }
  /** Hubs has two levels: `null` is everyone who can post in the channel;
   * any permission bits (including 0) mean the hub's owner and admins.
   * Hub admins can change it per command in Manage, Bots. */
  setDefaultMemberPermissions(
    permissions: bigint | number | string | null | undefined,
  ) {
    this.defaultMemberPermissions =
      permissions === null || permissions === undefined
        ? null
        : String(permissions);
    return this;
  }
  /** Hubs reads `true` as hub channels and direct messages. */
  setDMPermission(enabled: boolean | null | undefined): this {
    this.places.setDMPermission(enabled);
    return this;
  }
  /** 0 hub channels, 1 direct messages, 2 group DMs. */
  setContexts(...contexts: (number | number[])[]): this {
    this.places.setContexts(...contexts);
    return this;
  }
  /** 0 installed in a hub, 1 added to a person's account. */
  setIntegrationTypes(...types: (number | number[])[]): this {
    this.places.setIntegrationTypes(...types);
    return this;
  }
  setNSFW(nsfw = true): this {
    if (!nsfw) return this;
    return notSupported("Age restricted commands");
  }
  addSubcommand(input: Configure<SlashCommandSubcommandBuilder>) {
    this.options.push(
      configured(() => new SlashCommandSubcommandBuilder(), input),
    );
    return this;
  }
  addSubcommandGroup(input: Configure<SlashCommandSubcommandGroupBuilder>) {
    this.options.push(
      configured(() => new SlashCommandSubcommandGroupBuilder(), input),
    );
    return this;
  }
  toJSON(): Json {
    return {
      type: 1,
      name: this.name,
      description: this.description,
      options: this.options.map((option) => option.toJSON()),
      default_member_permissions: this.defaultMemberPermissions,
      ...this.places.placesJson(),
    };
  }
}

/** A message command (type 3) or user command (type 2): an item in the
 * Apps part of a message's menu or a person's profile. */
export class ContextMenuCommandBuilder extends CommandPlaces {
  name = "";
  type: 2 | 3 = 2;
  defaultMemberPermissions: string | null = null;
  setName(name: string) {
    this.name = name;
    return this;
  }
  setType(type: 2 | 3) {
    if (type !== 2 && type !== 3)
      throw new TypeError("Use 2 (user) or 3 (message).");
    this.type = type;
    return this;
  }
  setNameLocalizations(_value: unknown): this {
    return notSupported("Command localizations");
  }
  setDefaultMemberPermissions(
    permissions: bigint | number | string | null | undefined,
  ) {
    this.defaultMemberPermissions =
      permissions === null || permissions === undefined
        ? null
        : String(permissions);
    return this;
  }
  toJSON(): Json {
    return {
      type: this.type,
      name: this.name,
      default_member_permissions: this.defaultMemberPermissions,
      ...this.placesJson(),
    };
  }
}
