/*
 * discord.js constants with Discord's own values, so `import { ... } from
 * "discord.js"` keeps compiling after the import changes. Values Hubs does
 * not act on are still exported; using them where they would matter throws
 * HubsNotSupportedError.
 */

/** Gateway intents, with Discord's bits. Hubs uses the same bits for the
 * five it supports (see SUPPORTED_INTENTS). */
export const GatewayIntentBits = {
  Guilds: 1 << 0,
  GuildMembers: 1 << 1,
  GuildModeration: 1 << 2,
  GuildBans: 1 << 2,
  GuildExpressions: 1 << 3,
  GuildEmojisAndStickers: 1 << 3,
  GuildIntegrations: 1 << 4,
  GuildWebhooks: 1 << 5,
  GuildInvites: 1 << 6,
  GuildVoiceStates: 1 << 7,
  GuildPresences: 1 << 8,
  GuildMessages: 1 << 9,
  GuildMessageReactions: 1 << 10,
  GuildMessageTyping: 1 << 11,
  DirectMessages: 1 << 12,
  DirectMessageReactions: 1 << 13,
  DirectMessageTyping: 1 << 14,
  MessageContent: 1 << 15,
  GuildScheduledEvents: 1 << 16,
  AutoModerationConfiguration: 1 << 20,
  AutoModerationExecution: 1 << 21,
  GuildMessagePolls: 1 << 24,
  DirectMessagePolls: 1 << 25,
} as const;

/** Discord intent name to the Hubs intent with the same bit. */
export const HUBS_INTENT_NAMES: Record<number, string> = {
  [1 << 0]: "HUBS",
  [1 << 1]: "HUB_MEMBERS",
  [1 << 9]: "HUB_MESSAGES",
  [1 << 10]: "HUB_MESSAGE_REACTIONS",
  [1 << 15]: "MESSAGE_CONTENT",
};
export const SUPPORTED_INTENTS = Object.keys(HUBS_INTENT_NAMES).reduce(
  (sum, bit) => sum | Number(bit),
  0,
);

export const Partials = {
  User: 0,
  Channel: 1,
  GuildMember: 2,
  Message: 3,
  Reaction: 4,
  GuildScheduledEvent: 5,
  ThreadMember: 6,
  SoundboardSound: 7,
} as const;

export const Events = {
  ClientReady: "clientReady",
  Error: "error",
  Debug: "debug",
  ShardResume: "shardResume",
  MessageCreate: "messageCreate",
  MessageUpdate: "messageUpdate",
  MessageDelete: "messageDelete",
  MessageReactionAdd: "messageReactionAdd",
  MessageReactionRemove: "messageReactionRemove",
  InteractionCreate: "interactionCreate",
  GuildMemberAdd: "guildMemberAdd",
  GuildMemberRemove: "guildMemberRemove",
  GuildCreate: "guildCreate",
  GuildUpdate: "guildUpdate",
  GuildDelete: "guildDelete",
  ChannelCreate: "channelCreate",
  ChannelUpdate: "channelUpdate",
  ChannelDelete: "channelDelete",
} as const;

export const ButtonStyle = {
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
  Premium: 6,
} as const;

export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
} as const;

export const TextInputStyle = { Short: 1, Paragraph: 2 } as const;

export const MessageFlags = {
  Crossposted: 1 << 0,
  IsCrosspost: 1 << 1,
  SuppressEmbeds: 1 << 2,
  SourceMessageDeleted: 1 << 3,
  Urgent: 1 << 4,
  HasThread: 1 << 5,
  Ephemeral: 1 << 6,
  Loading: 1 << 7,
  FailedToMentionSomeRolesInThread: 1 << 8,
  SuppressNotifications: 1 << 12,
  IsVoiceMessage: 1 << 13,
  IsComponentsV2: 1 << 15,
} as const;

export const ApplicationCommandType = {
  ChatInput: 1,
  User: 2,
  Message: 3,
  PrimaryEntryPoint: 4,
} as const;

export const ApplicationCommandOptionType = {
  Subcommand: 1,
  SubcommandGroup: 2,
  String: 3,
  Integer: 4,
  Boolean: 5,
  User: 6,
  Channel: 7,
  Role: 8,
  Mentionable: 9,
  Number: 10,
  Attachment: 11,
} as const;

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ApplicationCommandAutocomplete: 4,
  ModalSubmit: 5,
} as const;

export const ChannelType = {
  GuildText: 0,
  DM: 1,
  GuildVoice: 2,
  GroupDM: 3,
  GuildCategory: 4,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  GuildStageVoice: 13,
  GuildDirectory: 14,
  GuildForum: 15,
  GuildMedia: 16,
} as const;

/** Discord permission bits. Hubs has no per-command or per-member
 * permission bits for bots, so passing one anywhere throws. */
export const PermissionFlagsBits = {
  CreateInstantInvite: 1n << 0n,
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  AddReactions: 1n << 6n,
  ViewAuditLog: 1n << 7n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  MentionEveryone: 1n << 17n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  UseApplicationCommands: 1n << 31n,
  ManageThreads: 1n << 34n,
  ModerateMembers: 1n << 40n,
} as const;

/** discord.js's named colors, for EmbedBuilder.setColor("Red"). */
export const Colors = {
  Default: 0x000000,
  White: 0xffffff,
  Aqua: 0x1abc9c,
  Green: 0x57f287,
  Blue: 0x3498db,
  Yellow: 0xfee75c,
  Purple: 0x9b59b6,
  LuminousVividPink: 0xe91e63,
  Fuchsia: 0xeb459e,
  Gold: 0xf1c40f,
  Orange: 0xe67e22,
  Red: 0xed4245,
  Grey: 0x95a5a6,
  Navy: 0x34495e,
  DarkAqua: 0x11806a,
  DarkGreen: 0x1f8b4c,
  DarkBlue: 0x206694,
  DarkPurple: 0x71368a,
  DarkVividPink: 0xad1457,
  DarkGold: 0xc27c0e,
  DarkOrange: 0xa84300,
  DarkRed: 0x992d22,
  DarkGrey: 0x979c9f,
  DarkerGrey: 0x7f8c8d,
  LightGrey: 0xbcc0c0,
  DarkNavy: 0x2c3e50,
  Blurple: 0x5865f2,
  Greyple: 0x99aab5,
  DarkButNotBlack: 0x2c2f33,
  NotQuiteBlack: 0x23272a,
} as const;
