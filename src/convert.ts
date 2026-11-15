/*
 * Turns Discord-shaped payloads (builder output or raw JSON in Discord's
 * snake_case) into the Hubs bot API shapes
 * (https://thehubs.gg/developers/docs/api). Anything with no Hubs
 * equivalent throws HubsNotSupportedError, never drops quietly.
 */
import { MessageFlags } from "./constants.js";
import { notSupported } from "./errors.js";

type Json = Record<string, any>;
const json = (value: unknown): Json =>
  value && typeof (value as { toJSON?: unknown }).toJSON === "function"
    ? (value as { toJSON(): Json }).toJSON()
    : { ...(value as Json) };
const pick = (data: Json, snake: string, camel: string) =>
  data[snake] !== undefined ? data[snake] : data[camel];

// -------------------------------------------------------- commands

const OPTION_TYPES: Record<number, string> = {
  1: "subcommand",
  2: "subcommand_group",
  3: "string",
  4: "integer",
  5: "boolean",
  6: "user",
  7: "channel",
  8: "role",
  9: "mentionable",
  10: "number",
  11: "attachment",
};
const UNSUPPORTED_OPTION: Record<number, [string, string]> = {};
/** Discord channel types with a Hubs kind. */
const CHANNEL_KINDS: Record<number, string> = {
  0: "chat",
  2: "voice",
  5: "announcements",
};
const HUBS_CHANNEL_KINDS = new Set(Object.values(CHANNEL_KINDS));

/** A Hubs option type from a Discord number or a Hubs name. */
function optionType(type: unknown) {
  if (typeof type === "string" && Object.values(OPTION_TYPES).includes(type))
    return type;
  const number = Number(type);
  if (UNSUPPORTED_OPTION[number]) notSupported(...UNSUPPORTED_OPTION[number]);
  const name = OPTION_TYPES[number];
  if (!name)
    throw new TypeError(`Unknown command option type: ${String(type)}.`);
  return name;
}
function channelKinds(types: unknown[]) {
  return types.map((type) => {
    if (typeof type === "string" && HUBS_CHANNEL_KINDS.has(type)) return type;
    const kind = CHANNEL_KINDS[Number(type)];
    if (!kind)
      notSupported(
        `The channel type ${String(type)} in a channel option`,
        "Hubs channel options take text (0), voice (2) and announcement (5) channels.",
      );
    return kind;
  });
}
function toHubsOption(raw: unknown): Json {
  const option = json(raw);
  if (option.name_localizations || option.description_localizations)
    notSupported("Command localizations");
  const converted: Json = {
    type: optionType(option.type),
    name: String(option.name),
    description: String(option.description ?? ""),
  };
  if (
    converted.type === "subcommand" ||
    converted.type === "subcommand_group"
  ) {
    converted.options = (option.options ?? []).map(toHubsOption);
    return converted;
  }
  if (option.required) converted.required = true;
  if (option.choices?.length)
    converted.choices = option.choices.map((choice: Json) => {
      if (choice.name_localizations) notSupported("Command localizations");
      return { name: String(choice.name), value: choice.value };
    });
  if (option.autocomplete) converted.autocomplete = true;
  for (const [snake, camel] of [
    ["min_value", "minValue"],
    ["max_value", "maxValue"],
    ["min_length", "minLength"],
    ["max_length", "maxLength"],
  ]) {
    const value = pick(option, snake, camel);
    if (value !== undefined && value !== null) converted[camel] = value;
  }
  const types = pick(option, "channel_types", "channelTypes");
  if (Array.isArray(types) && types.length)
    converted.channelTypes = [...new Set(channelKinds(types))];
  return converted;
}

/** Discord command types with a Hubs one: slash (1), user (2), message (3). */
const COMMAND_TYPES: Record<number, string> = {
  1: "chat_input",
  2: "user",
  3: "message",
};
/** Discord interaction contexts: a server (0), the bot's DM (1), and
 * group DMs and DMs that are not with the bot (2). */
const CONTEXTS: Record<number, string[]> = {
  0: ["hub"],
  1: ["dm"],
  2: ["dm", "group_dm"],
};
function commandContexts(data: Json): string[] | undefined {
  const contexts = data.contexts;
  if (Array.isArray(contexts) && contexts.length) {
    const out = new Set<string>();
    for (const value of contexts) {
      const mapped = CONTEXTS[Number(value)];
      if (!mapped)
        throw new TypeError(`Unknown interaction context: ${String(value)}.`);
      for (const context of mapped) out.add(context);
    }
    return ["hub", "dm", "group_dm"].filter((context) => out.has(context));
  }
  if (pick(data, "dm_permission", "dmPermission") === true)
    return ["hub", "dm"];
  return undefined;
}
export function toHubsCommand(input: unknown): Json {
  const data = json(input);
  const type = data.type === undefined ? 1 : Number(data.type);
  if (!COMMAND_TYPES[type])
    notSupported(
      "Entry point commands",
      "Use a slash command that answers with a link to the hosted app.",
    );
  if (data.name_localizations || data.description_localizations)
    notSupported("Command localizations");
  if (data.nsfw === true) notSupported("Age restricted commands");
  // Installing for a person (1) is how Hubs reaches direct messages too:
  // people add the bot to their account. Nothing else needs saying.
  const integrationTypes = pick(data, "integration_types", "integrationTypes");
  if (
    Array.isArray(integrationTypes) &&
    integrationTypes.some((value: unknown) => ![0, 1].includes(Number(value)))
  )
    throw new TypeError("Unknown integration type.");
  const out: Json = {
    name: String(data.name),
    description: String(data.description ?? ""),
  };
  if (type !== 1) out.type = COMMAND_TYPES[type];
  const contexts = commandContexts(data);
  if (contexts) out.contexts = contexts;
  const options = (data.options ?? []).map(toHubsOption);
  if (options.length) out.options = options;
  // Hubs has two levels where Discord has permission bits: any bits at all
  // (including "0") mean the hub's owner and admins only, the safer side.
  // Hub admins can open or close each command in Manage, Bots, and allow
  // or deny it by role and by channel.
  const permissions = pick(
    data,
    "default_member_permissions",
    "defaultMemberPermissions",
  );
  if (permissions !== undefined && permissions !== null) out.access = "admins";
  return out;
}

// ---------------------------------------------------------- embeds

const EMBED_KEYS = new Set([
  "type",
  "title",
  "description",
  "url",
  "color",
  "author",
  "fields",
  "footer",
  "timestamp",
]);
export function toHubsEmbed(input: unknown): Json {
  const data = json(input);
  for (const key of ["image", "thumbnail", "video"])
    if (data[key])
      notSupported(
        `An embed ${key}`,
        "Hubs never loads pictures from other sites in embeds. Link to it instead.",
      );
  if (data.provider) notSupported("An embed provider");
  for (const key of Object.keys(data))
    if (!EMBED_KEYS.has(key) && data[key] !== undefined)
      notSupported(`The embed field "${key}"`);
  if (data.type !== undefined && data.type !== "rich")
    notSupported(`A ${String(data.type)} embed`, "Send a rich embed.");
  const out: Json = {};
  if (data.title !== undefined) out.title = String(data.title);
  if (data.description !== undefined)
    out.description = String(data.description);
  if (data.url !== undefined) out.url = String(data.url);
  if (data.color !== undefined && data.color !== null)
    out.color = Number(data.color);
  if (data.author) {
    if (pick(data.author, "icon_url", "iconURL"))
      notSupported("An embed author icon");
    if (data.author.url) notSupported("An embed author link");
    out.author = { name: String(data.author.name) };
  }
  if (data.fields?.length)
    out.fields = data.fields.map((field: Json) => ({
      name: String(field.name),
      value: String(field.value),
      ...(field.inline ? { inline: true } : {}),
    }));
  if (data.footer) {
    if (pick(data.footer, "icon_url", "iconURL"))
      notSupported("An embed footer icon");
    out.footer = { text: String(data.footer.text) };
  }
  if (data.timestamp !== undefined && data.timestamp !== null)
    out.timestamp = new Date(data.timestamp).toISOString();
  return out;
}

// ------------------------------------------------------ components

const BUTTON_STYLES: Record<number, string> = {
  1: "primary",
  2: "secondary",
  3: "success",
  4: "danger",
  5: "link",
};
const emojiName = (emoji: unknown) => {
  if (emoji === undefined || emoji === null) return undefined;
  if (typeof emoji === "string") return emoji;
  const value = emoji as Json;
  if (value.id) notSupported("Custom emoji", "Use a standard Unicode emoji.");
  return value.name ? String(value.name) : undefined;
};
function toHubsComponent(input: unknown): Json {
  const data = json(input);
  switch (Number(data.type)) {
    case 2: {
      if (Number(data.style) === 6 || data.sku_id)
        notSupported("Premium buttons", "Hubs has no app purchases.");
      const style = BUTTON_STYLES[Number(data.style)];
      if (!style)
        throw new TypeError(`Unknown button style: ${String(data.style)}.`);
      const out: Json = {
        type: "button",
        style,
        label: String(data.label ?? ""),
      };
      const customId = pick(data, "custom_id", "customId");
      if (customId !== undefined) out.customId = String(customId);
      if (data.url !== undefined) out.url = String(data.url);
      const emoji = emojiName(data.emoji);
      if (emoji) out.emoji = emoji;
      if (data.disabled) out.disabled = true;
      return out;
    }
    case 3: {
      const out: Json = {
        type: "select",
        customId: String(pick(data, "custom_id", "customId")),
        options: (data.options ?? []).map((raw: unknown) => {
          const option = json(raw);
          if (option.emoji)
            notSupported(
              "Emoji on select menu options",
              "Put the emoji in the label.",
            );
          return {
            label: String(option.label),
            value: String(option.value),
            ...(option.description
              ? { description: String(option.description) }
              : {}),
            ...(option.default ? { default: true } : {}),
          };
        }),
      };
      if (data.placeholder !== undefined)
        out.placeholder = String(data.placeholder);
      const min = pick(data, "min_values", "minValues");
      const max = pick(data, "max_values", "maxValues");
      if (min !== undefined) out.minValues = Number(min);
      if (max !== undefined) out.maxValues = Number(max);
      if (data.disabled) out.disabled = true;
      return out;
    }
    case 4:
      return notSupported(
        "Text inputs outside a modal",
        "Put text inputs in a ModalBuilder.",
      );
    case 5:
    case 6:
    case 7:
    case 8:
      return notSupported(
        "User, role, mentionable and channel select menus",
        "Use a string select menu, or a slash command option.",
      );
    default:
      if (Number(data.type) >= 9)
        return notSupported(
          "Components V2 layouts",
          "Use embeds and action rows of buttons or a select menu.",
        );
      throw new TypeError(`Unknown component type: ${String(data.type)}.`);
  }
}
export function toHubsComponents(rows: unknown[]): Json[] {
  return rows.map((raw) => {
    const row = json(raw);
    if (Number(row.type) !== 1)
      notSupported(
        "Components outside an action row",
        "Put buttons and select menus in an ActionRowBuilder.",
      );
    return {
      type: "row",
      components: (row.components ?? []).map(toHubsComponent),
    };
  });
}

// ---------------------------------------------------------- modals

export function toHubsModal(input: unknown): Json {
  const data = json(input);
  const fields: Json[] = [];
  for (const raw of data.components ?? []) {
    const row = json(raw);
    const items = Number(row.type) === 1 ? (row.components ?? []) : [row];
    for (const item of items.map(json)) {
      if (Number(item.type) !== 4)
        notSupported(
          "Components other than text inputs in a modal",
          "A Hubs form holds text fields only.",
        );
      const field: Json = {
        customId: String(pick(item, "custom_id", "customId")),
        label: String(item.label ?? ""),
        style: Number(item.style) === 2 ? "paragraph" : "short",
        required: item.required !== false,
      };
      if (item.placeholder !== undefined)
        field.placeholder = String(item.placeholder);
      const min = pick(item, "min_length", "minLength");
      const max = pick(item, "max_length", "maxLength");
      if (min !== undefined) field.minLength = Number(min);
      if (max !== undefined) field.maxLength = Number(max);
      if (item.value !== undefined) field.value = String(item.value);
      fields.push(field);
    }
  }
  return {
    customId: String(pick(data, "custom_id", "customId")),
    title: String(data.title ?? ""),
    fields,
  };
}

// --------------------------------------------------------- messages

export interface HubsMessageBody {
  content?: string;
  embeds?: Json[];
  components?: Json[];
  ephemeral?: boolean;
  replyToId?: string | null;
  nonce?: string;
}
const MESSAGE_KEYS = new Set([
  "content",
  "embeds",
  "components",
  "ephemeral",
  "flags",
  "reply",
  "nonce",
  "enforceNonce",
  "files",
  "attachments",
  "tts",
  "allowedMentions",
  "stickers",
  "poll",
  "fetchReply",
  "withResponse",
]);

/** discord.js send, reply and edit options (or a plain string) as a Hubs
 * message body. `where` says which call it is for the error text. */
export function toHubsMessage(
  input: unknown,
  where: "send" | "edit" | "interaction" = "send",
): HubsMessageBody {
  if (typeof input === "string") return { content: input };
  if (input === null || typeof input !== "object")
    throw new TypeError("Send a string or a message options object.");
  const data = input as Json;
  if (
    data instanceof Object &&
    typeof data.toJSON === "function" &&
    !("content" in data)
  )
    notSupported(
      "Sending a builder directly",
      "Pass { embeds: [embed] } instead.",
    );
  for (const key of Object.keys(data))
    if (!MESSAGE_KEYS.has(key) && data[key] !== undefined)
      notSupported(`The message option "${key}"`);
  if (data.files?.length || data.attachments?.length)
    notSupported(
      "Files and attachments from bots",
      "Link to the file instead.",
    );
  if (data.tts) notSupported("Text to speech messages");
  if (data.stickers?.length) notSupported("Stickers from bots");
  if (data.poll) notSupported("Polls from bots");
  if (data.allowedMentions !== undefined)
    notSupported(
      "allowedMentions",
      "Hubs bots never ping @everyone or roles; remove the option.",
    );
  if (data.fetchReply || data.withResponse)
    notSupported(
      "fetchReply on interaction replies",
      "Listen for the message in messageCreate, or use followUp, which returns the message.",
    );
  let ephemeral = data.ephemeral === true;
  if (data.flags !== undefined && data.flags !== null) {
    const flags = Number(data.flags);
    if (flags & ~MessageFlags.Ephemeral)
      notSupported("Message flags other than Ephemeral");
    if (flags & MessageFlags.Ephemeral) ephemeral = true;
  }
  if (ephemeral && where !== "interaction")
    notSupported(
      "Ephemeral messages outside interactions",
      "Only interaction replies can be private.",
    );
  const out: HubsMessageBody = {};
  if (data.content !== undefined && data.content !== null)
    out.content = String(data.content);
  if (data.embeds !== undefined)
    out.embeds = (data.embeds ?? []).map(toHubsEmbed);
  if (data.components !== undefined)
    out.components = toHubsComponents(data.components ?? []);
  if (ephemeral) out.ephemeral = true;
  if (data.reply) {
    if (where !== "send")
      notSupported("reply options here", "Use message.reply.");
    out.replyToId = String(
      data.reply.messageReference?.id ?? data.reply.messageReference,
    );
  }
  if (data.nonce !== undefined) out.nonce = String(data.nonce);
  return out;
}
