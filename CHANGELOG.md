# Changelog

All notable changes to hubs-discord-compat. Versions follow semantic versioning; while the version starts with 0, a minor version may change behavior, and each change says so here.

## 0.3.1

Publishing moved to npm trusted publishing; no code changes.

## 0.3.0

The first public release.

- `HubsNotSupportedError` messages link to the porting guide at its public address ([docs/PORTING.md](docs/PORTING.md)), and `PORTING_GUIDE` holds that address.
- MIT license.
- Context menu commands: `ContextMenuCommandBuilder` with `setType(2)` (user) or `setType(3)` (message), and raw JSON with `type` 2 or 3. People find them in the Apps part of a person's profile and a message's menu. They arrive as `UserContextMenuCommandInteraction` (`targetUser`, `targetMember`, `targetId`) and `MessageContextMenuCommandInteraction` (`targetMessage`, `targetId`); `isContextMenuCommand()` and its two partners answer true. Behavior change: these used to throw.
- Attachment options: `addAttachmentOption` and option type 11. `options.getAttachment(name)` returns `{ id, name, contentType, size, url, proxyURL, expiresAt }`; the address needs no token and works for 10 minutes. Behavior change: these used to throw.
- Commands in direct messages: `setContexts` (0 hubs, 1 direct messages, 2 group DMs), `setIntegrationTypes` and `setDMPermission(true)` convert to Hubs `contexts`. Global commands only. `interaction.guildId` and `interaction.guild` are `null` there, `inGuild()` is false, and `interaction.context` says where it was used. Behavior change: these used to throw.
- HTTP interactions: `verifyKey` (Ed25519 over timestamp plus body), `createInteractionVerifier` (adds a 5 minute window and refuses a request it already saw) and `handleInteractionRequest`, which answers PING and turns the first `reply`, `deferReply`, `showModal`, `update` or `respond` into the response body.
- The port checker reports context menu commands, attachment options and commands in direct messages as mapping, and HTTP interactions as partly mapping.
- Entry point commands (type 4) throw `HubsNotSupportedError`.

## 0.2.0

Not published.

- Subcommands and subcommand groups: `addSubcommand`, `addSubcommandGroup`, `SlashCommandSubcommandBuilder`, `SlashCommandSubcommandGroupBuilder`, and `getSubcommand()` and `getSubcommandGroup()` on interaction options. Raw JSON with option types 1 and 2 converts too.
- Role and mentionable options: `addRoleOption`, `addMentionableOption`, `getRole()` (a hub community role) and `getMentionable()` (a user or a role).
- Channel type filters: `addChannelTypes` with text (0), voice (2) and announcement (5) channels. Other channel types throw `HubsNotSupportedError` when the command is converted.
- `setDefaultMemberPermissions`: `null` means everyone who can post in the channel; any permission bits mean the hub's owner and admins only. Hub admins can change it per command in Manage, Bots. Behavior change: this used to throw.
- `getSubcommand()` with no subcommand now throws a `TypeError` (as discord.js does) instead of `HubsNotSupportedError`. `getRole()` returns `null` for a missing option instead of throwing.
- The port checker reports subcommands, role and mentionable options and channel types as mapping, and default member permissions as partly mapping.
- `version` export.
- Package metadata for publishing: `files`, `exports` with types, `keywords`, `repository`, `publishConfig`, and `prepack` and `prepublishOnly` scripts.

## 0.1.0

Not published. The first build.

- `Client` with intents, login, events, and hub, channel and user caches on the Hubs bot gateway.
- Messages, channels, members, roles (hub roles), reactions, embeds, buttons, string select menus, modals, slash commands with string, integer, number, boolean, user and channel options, choices, autocomplete and interactions.
- discord.js-style `REST` and `Routes` on the Hubs developer API.
- `checkDiscordBotSource` and `formatPortReport`, the port checker.
- `HubsNotSupportedError` for everything Hubs cannot do, with what to do instead.
