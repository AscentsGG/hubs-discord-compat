/*
 * hubs-discord-compat: the common discord.js surface on top of the Hubs bot
 * gateway and developer API. Change `from "discord.js"` to
 * `from "hubs-discord-compat"`, use a Hubs bot token, and see the porting
 * guide (docs/PORTING.md) for what maps and what does not.
 */
export {
  Client,
  ChannelManager,
  GuildManager,
  IntentsBitField,
  UserManager,
  resolveIntents,
} from "./client.js";
export type { ClientOptions, HubsClientOptions } from "./client.js";
export { Collection } from "./collection.js";
export * from "./constants.js";
export * from "./builders.js";
export {
  toHubsCommand,
  toHubsComponents,
  toHubsEmbed,
  toHubsMessage,
  toHubsModal,
} from "./convert.js";
export {
  HubsAPIError,
  HubsNotSupportedError,
  PORTING_GUIDE,
} from "./errors.js";
/** discord.js's name for API errors. */
export { HubsAPIError as DiscordAPIError } from "./errors.js";
export { HubsGateway } from "./gateway.js";
export {
  AutocompleteInteraction,
  BaseInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  CommandInteractionOptionResolver,
  ContextMenuCommandInteraction,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitFields,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "./interactions.js";
export type { Attachment } from "./interactions.js";
export {
  createInteractionVerifier,
  handleInteractionRequest,
  verifyKey,
} from "./http-interactions.js";
export type {
  InteractionRequest,
  InteractionVerifierOptions,
  VerifiedInteraction,
} from "./http-interactions.js";
export { HubsRest, REST, Routes, DEFAULT_BASE_URL } from "./rest.js";
export {
  ClientUser,
  CommandManager,
  Guild,
  GuildChannelManager,
  GuildMember,
  GuildMemberManager,
  HUB_ROLES,
  MappedCollection,
  Message,
  MessageManager,
  MessageReaction,
  Role,
  RoleManager,
  TextChannel,
  User,
} from "./structures.js";
export { checkDiscordBotSource, formatPortReport } from "./checker.js";
export type { PortFinding, PortStatus } from "./checker.js";
/** This package's version, as discord.js exports its own. Kept equal to
 * package.json by test/package.test.ts. */
export const version = "0.3.0";
