# Porting a discord.js bot to Hubs

Hubs bots work like Discord bots: an application with a bot account, a token, scopes and permissions approved per hub, a live gateway with intents and heartbeats, slash commands, buttons, select menus, modals and private (ephemeral) replies. The [Hubs developer docs](https://thehubs.gg/developers/docs) describe the platform itself.

This package, `hubs-discord-compat`, gives a discord.js bot the same names on top of the Hubs gateway and developer API. Most simple bots port by changing the import, the token and the address. Anything Hubs cannot do throws a `HubsNotSupportedError` that names the feature and says what to do instead. The kit never quietly drops a call.

## Before you start

1. Make an application in the Hubs developer portal ([thehubs.gg/developers](https://thehubs.gg/developers)), list the scopes your bot needs, and reset its token. A Hubs token starts with `hbot_`.
2. Install it in a hub with the install link from the portal. Ask for the scopes your intents and calls need (see the tables below).
3. Run the checker on your bot's source to see what maps before you change anything:

```js
import { readFileSync } from "node:fs";
import { checkDiscordBotSource, formatPortReport } from "hubs-discord-compat";

console.log(
  formatPortReport(checkDiscordBotSource(readFileSync("bot.js", "utf8"))),
);
// Maps: 14, partly maps: 3, does not map: 2.
// line 12: does not map: Moderation action. Hubs bots have no moderation powers yet; ...
```

## What changes

| On Discord                            | On Hubs                                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `import { Client } from "discord.js"` | `import { Client } from "hubs-discord-compat"`                                                                          |
| A Discord token                       | A Hubs bot token (`hbot_...`). `client.login()` reads `HUBS_BOT_TOKEN` when no token is passed                          |
| `https://discord.com/api`             | Your Hubs address: `hubs: { baseUrl }` on the client, `api` on `REST`, or `HUBS_BASE_URL`. Default `https://thehubs.gg` |
| `Authorization: Bot <discord token>`  | `Authorization: Bot <hubs token>` (the kit does this)                                                                   |
| Snowflake ids                         | Hubs ids are UUIDs. Keep old ids in config and map them with `hubs.idMap` or `hubs.names` (below)                       |
| Guild                                 | Hub (a place). `client.guilds` lists the hubs the bot is installed in                                                   |
| Roles with permission bits            | The member's hub role: `owner`, `admin`, `member` or `guest`, plus `@everyone` (the hub id)                             |
| Channel permission overwrites         | The hub's channel rules for the bot's role. `channel.canPost` says whether the bot may post                             |

Intents keep Discord's names and bits. The kit sends them to Hubs as they are:

| discord.js intent       | Hubs intent             | Scope the hub must grant |
| ----------------------- | ----------------------- | ------------------------ |
| `Guilds`                | `HUBS`                  | `channels:read`          |
| `GuildMembers`          | `HUB_MEMBERS`           | `members:read`           |
| `GuildMessages`         | `HUB_MESSAGES`          | `messages:read`          |
| `GuildMessageReactions` | `HUB_MESSAGE_REACTIONS` | `messages:read`          |
| `MessageContent`        | `MESSAGE_CONTENT`       | `messages:read`          |

Every other intent (direct messages, voice states, presences, typing, moderation, invites and so on) makes `new Client` throw, naming the intents to remove. The application also needs the `gateway` scope, `messages:write` to send, `reactions:write` to react, and `commands` for slash commands and components.

### Mapping Discord ids

```js
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  hubs: {
    baseUrl: "https://thehubs.gg",
    // Discord id to Hubs id.
    idMap: { "900000000000000010": "8c1d6a0e-2f7b-4f62-9d43-1b0f8e1a2c3d" },
    // Discord id to a Hubs name: a hub name, a channel name, a hub role or a member's handle.
    names: {
      channels: { "900000000000000001": "mod-log" },
      roles: { "900000000000000003": "admin" },
    },
  },
});
client.channels.cache.get("900000000000000001"); // the #mod-log channel
member.roles.cache.has("900000000000000003"); // true for hub admins
```

Every cache `get` and `has`, `client.channels.fetch`, `guild.members.fetch` and the command managers accept the mapped ids.

## Supported and not supported

"Partly" means it works with the difference noted.

### Client, events and caches

| discord.js                                                                | On Hubs   | Notes                                                                                                         |
| ------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `new Client({ intents, partials })`, `IntentsBitField`                    | Supported | `partials` and cache tuning options are accepted; events always carry what Hubs sends                         |
| `client.login(token)`, `client.destroy()`, `client.isReady()`, `ws.ping`  | Supported | `login` resolves when the client is ready                                                                     |
| `ready` / `clientReady`                                                   | Supported | Channels (and members, with `GuildMembers`) are loaded first, as Discord's guild events do                    |
| `messageCreate`, `messageUpdate`, `messageDelete`                         | Supported | Without `MessageContent`, content is empty except the bot's own messages and messages that mention its handle |
| `messageReactionAdd`, `messageReactionRemove`                             | Supported |                                                                                                               |
| `interactionCreate`                                                       | Supported | Commands, autocomplete, buttons, string select menus, modal submits                                           |
| `guildMemberAdd`, `guildMemberRemove`                                     | Supported |                                                                                                               |
| `channelCreate`, `channelUpdate`, `channelDelete`                         | Supported | Chat and announcement channels only                                                                           |
| `guildCreate`, `guildUpdate`, `guildDelete`                               | Supported | Installing and removing the bot                                                                               |
| `shardResume`, `error`, `debug`                                           | Supported | A dropped connection resumes and replays missed events. A revoked token emits `error`                         |
| `client.guilds`, `client.channels`, `client.users` caches and `fetch`     | Supported | `users.fetch` finds people in the bot's hubs only                                                             |
| Voice, presence, typing, threads, invites, emoji, bans and AutoMod events | No        | Hubs does not send them to bots                                                                               |
| `client.user.setActivity`, `setPresence`, `setStatus`, `presence` option  | No        | Throws. Hubs bots have no status line                                                                         |
| `allowedMentions` (client or message)                                     | No        | Throws. Hubs bots never ping `@everyone` or roles                                                             |
| Several shards in one client                                              | No        | Throws. Run one client per shard with `hubs: { shard: [id, count] }`                                          |

### Messages and channels

| discord.js                                                                                                                         | On Hubs   | Notes                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `channel.send(text or options)`                                                                                                    | Supported | `content`, `embeds`, `components`; `nonce` becomes the Idempotency-Key, so a retry is one message     |
| `message.reply(...)`                                                                                                               | Supported | Linked to the message                                                                                 |
| `message.edit(...)`, `message.delete()`                                                                                            | Partly    | The bot's own messages only. Someone else's throws `HubsNotSupportedError`                            |
| `message.react(emoji)`, `reaction.users.remove()` for the bot                                                                      | Partly    | Unicode emoji from the Hubs reaction set (for example 👍 ❤️ 😂 🔥 🎉 👀 ✅ ❌). Custom emoji throw    |
| `channel.messages.fetch(id)`, `fetch({ limit, before })`                                                                           | Supported | `after` and `around` throw                                                                            |
| `message.author`, `member`, `channel`, `guild`, `reference`, `reactions`, `attachments`, `mentions.users`, `createdAt`, `editedAt` | Supported | Attachments have names, types and sizes; `mentions` are `@handle` mentions of people the bot has seen |
| `message.fetchReference()`                                                                                                         | Supported |                                                                                                       |
| `ephemeral` outside an interaction                                                                                                 | No        | Throws. Only interaction replies can be private                                                       |
| Files, attachments, stickers, polls, TTS                                                                                           | No        | Throws. Link to files instead                                                                         |
| `bulkDelete`, deleting or editing other people's messages                                                                          | No        | Throws (see Not supported yet, below)                                                                 |
| `pin`, `unpin`, `crosspost`, `startThread`, `suppressEmbeds`, `removeAttachments`                                                  | No        | Throws                                                                                                |
| `sendTyping`, collectors, `awaitMessages`, `awaitReactions`, `awaitMessageComponent`                                               | No        | Throws. Use client events and match ids                                                               |
| Channel create, edit, delete, slow mode, webhooks, invites, `permissionsFor`                                                       | No        | Throws. Hub admins manage channels in Manage                                                          |

### Hubs, members and roles

| discord.js                                                                                             | On Hubs   | Notes                                                                                     |
| ------------------------------------------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------- |
| `guild.members.fetch()`, `fetch(id)`, `fetch({ user })`, `me`                                          | Supported | Needs `members:read`. `fetch({ query })` throws                                           |
| `guild.fetchOwner()`, `memberCount`                                                                    | Supported | `memberCount` counts members seen (all of them after `members.fetch()`)                   |
| `member.roles.cache`, `roles.highest`, `guild.roles.cache`                                             | Partly    | The hub role and `@everyone`. `member.hubRole` and `member.isHubAdmin` are Hubs additions |
| `member.kickable`, `bannable`, `moderatable`, `manageable`                                             | Supported | Always `false`: a bot cannot moderate on Hubs yet                                         |
| `member.kick`, `ban`, `timeout`, `setNickname`, `roles.add/remove/set`                                 | No        | Throws                                                                                    |
| `member.permissions`, `permissionsIn`                                                                  | No        | Throws. Check `member.roles.cache.has("admin")` or `member.isHubAdmin`                    |
| `guild.bans`, `invites`, `emojis`, `scheduledEvents`, `autoModerationRules`, `fetchAuditLogs`, `leave` | No        | Throws                                                                                    |
| `user.send`, `createDM`, `member.send`                                                                 | No        | Throws. Bots cannot send direct messages on Hubs                                          |

### Builders

| discord.js                                                                                                                | On Hubs   | Notes                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `EmbedBuilder`                                                                                                            | Partly    | Title, description, URL, color, author name, fields, footer text, timestamp. Pictures throw                             |
| `ActionRowBuilder`, `ButtonBuilder` (all styles but Premium)                                                              | Supported | Unicode emoji only                                                                                                      |
| `StringSelectMenuBuilder`, `StringSelectMenuOptionBuilder`                                                                | Supported | Emoji on options throw                                                                                                  |
| User, role, channel and mentionable select menus                                                                          | No        | Throws. Use a string menu or a command option                                                                           |
| `ModalBuilder`, `TextInputBuilder`                                                                                        | Supported | Up to 5 text fields                                                                                                     |
| `SlashCommandBuilder` with string, integer, number, boolean, user and channel options, choices, autocomplete, min and max | Supported | `setDMPermission(false)`, `setDefaultMemberPermissions(null)` and `setNSFW(false)` are accepted because they match Hubs |
| Subcommands and groups (`addSubcommand`, `addSubcommandGroup`), role and mentionable options                              | Supported | Roles are the hub's community roles                                                                                     |
| `addChannelTypes`                                                                                                         | Partly    | Text (0), voice (2) and announcement (5); other types throw                                                             |
| `setDefaultMemberPermissions(bits)`                                                                                       | Partly    | Any bits mean the hub's owner and admins only; hub admins can change it per command in Manage, Bots                     |
| `addAttachmentOption` (0.3.0)                                                                                             | Supported | The person picks a file; the bot gets an address that works for 10 minutes                                              |
| `setContexts`, `setIntegrationTypes`, `setDMPermission(true)` (0.3.0)                                                     | Supported | Global commands only. 0 hub channels, 1 direct messages, 2 group DMs and other DMs                                      |
| `ContextMenuCommandBuilder` with `setType(2)` or `setType(3)` (0.3.0)                                                     | Supported | Items in the Apps part of a person's profile and a message's menu, up to 5 of each type                                 |
| Localizations, entry point commands (type 4)                                                                              | No        | Throws                                                                                                                  |

### Commands and interactions

| discord.js                                                                                                   | On Hubs   | Notes                                                                        |
| ------------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------- |
| `client.application.commands.set/fetch/create/edit/delete`                                                   | Supported | `set(commands, guildId)` targets one hub                                     |
| `guild.commands.set/fetch/create/edit/delete`                                                                | Supported | A hub command replaces a global one with the same name in that hub           |
| `new REST().setToken()`, `rest.put(Routes.applicationCommands(...))`, `Routes.applicationGuildCommands(...)` | Supported | `Routes.channelMessages` and `channelMessage` work too; other routes throw   |
| `interaction.reply`, `deferReply`, `editReply`, `followUp`                                                   | Supported | `followUp` and `editReply` return the message (or `{ ephemeral: true, id }`) |
| `ephemeral: true` or `flags: MessageFlags.Ephemeral`                                                         | Supported | Other message flags throw                                                    |
| `interaction.update`, `deferUpdate` (buttons, menus, modal submits)                                          | Supported |                                                                              |
| `interaction.showModal`, `fields.getTextInputValue`                                                          | Supported |                                                                              |
| `interaction.respond` (autocomplete), `options.getFocused`                                                   | Supported |                                                                              |
| `options.getString/Integer/Number/Boolean/User/Member/Channel`                                               | Supported | `getMember` reads the member cache                                           |
| `isChatInputCommand`, `isButton`, `isStringSelectMenu`, `isModalSubmit`, `isAutocomplete`, `isRepliable`     | Supported |                                                                              |
| `fetchReply`, `deleteReply`, `fetchReply: true`, `withResponse`                                              | No        | Throws. `followUp` and `editReply` return the message                        |
| `getSubcommand()`, `getSubcommandGroup()`, `getRole`, `getMentionable`                                       | Supported | `getSubcommand()` with none used throws a `TypeError`, as in discord.js      |
| `getAttachment` (0.3.0)                                                                                      | Supported | `{ id, name, contentType, size, url, proxyURL, expiresAt }`                  |
| `isContextMenuCommand`, `isUserContextMenuCommand`, `isMessageContextMenuCommand` (0.3.0)                    | Supported | `targetId`, `targetUser`, `targetMember`, `targetMessage`                    |
| Interactions in direct messages (0.3.0)                                                                      | Supported | `guildId` and `guild` are `null`, `inGuild()` is false, `context` says where |
| HTTP interactions: `verifyKey`, interactions endpoint (0.3.0)                                                | Supported | `verifyKey`, `createInteractionVerifier` and `handleInteractionRequest`      |

## Worked example 1: a moderation bot

The full bot is [examples/moderation-bot.ts](../examples/moderation-bot.ts). It welcomes new members, flags messages with banned words (including edits), keeps warning counts, writes a mod log with a "Mark reviewed" button, and has `/warnings` and `/clearwarnings` for moderators.

The changes from its Discord version:

```diff
-import { Client, GatewayIntentBits, ... } from "discord.js";
+import { Client, GatewayIntentBits, HubsNotSupportedError, ... } from "hubs-discord-compat";

 const client = new Client({
   intents: [Guilds, GuildMembers, GuildMessages, GuildMessageReactions, MessageContent],
+  hubs: {
+    baseUrl: process.env.HUBS_BASE_URL,
+    names: {
+      channels: { [MOD_LOG_CHANNEL_ID]: "mod-log", [WELCOME_CHANNEL_ID]: "welcome" },
+      roles: { [MODERATOR_ROLE_ID]: "admin" },
+    },
+  },
 });

-  await message.react("⚠️");
-  await message.delete();
+  await message.react("👀");
+  try {
+    await message.delete();
+  } catch (error) {
+    if (!(error instanceof HubsNotSupportedError)) throw error;
+    await message.reply(`${message.author}, please keep it friendly. That is warning ${count}.`);
+  }
```

Everything else (the embed for the mod log, the buttons, `member.roles.cache.has(MODERATOR_ROLE_ID)`, ephemeral replies, `interaction.update`, the member join and leave handlers, `guild.commands.set`) is unchanged.

We run it end to end against a Hubs test server with a test hub and test accounts: a flagged message gets a reaction, a warning reply and a mod log card; an edit into a flagged message counts; a hub admin reads and clears warnings; a member is turned away privately; the card is marked reviewed; joins, leaves and deletes are logged.

## Worked example 2: a slash-command utility bot

The full bot is [examples/utility-bot.ts](../examples/utility-bot.ts): `/ping`, `/roll` with an embed, `/poll` with Yes and No buttons that update the message, `/pick` with a select menu, `/feedback` with a modal, an ephemeral reply and a public follow-up, `/remind` with a private deferred reply, `/timezone` with autocomplete, and the `!echo` and `!help` prefix commands. Commands are deployed with the usual `REST` and `Routes` script.

The changes from its Discord version:

```diff
-import { Client, REST, Routes, ... } from "discord.js";
+import { Client, REST, Routes, ... } from "hubs-discord-compat";

-const rest = new REST({ version: "10" }).setToken(token);
+const rest = new REST({ version: "10", api: `${process.env.HUBS_BASE_URL}/api` }).setToken(token);
 await rest.put(Routes.applicationCommands(applicationId), { body: commands.map((c) => c.toJSON()) });

 const client = new Client({
   intents: [Guilds, GuildMessages, MessageContent],
+  hubs: { baseUrl: process.env.HUBS_BASE_URL },
 });
-client.once(Events.ClientReady, (c) => c.user.setActivity("with dice"));
```

Our end to end run uses every command as a person would in the message box, votes on a poll from three accounts, submits the modal, and checks what each person sees.

## Errors

- `HubsNotSupportedError` (`code: "HUBS_NOT_SUPPORTED"`, with `feature` and `hint`): a discord.js feature Hubs does not have. Builders and options throw at once; async methods reject. The message names the feature, says what to do, and links to this guide.
- `HubsAPIError` (also exported as `DiscordAPIError`, with `status` and the Hubs `code`): an error answer from Hubs, for example `BOT_SCOPE_MISSING` when the hub did not grant a scope, `BOT_NOT_MESSAGE_AUTHOR` when editing someone else's message, or `BOT_RATE_LIMITED` after the kit has waited out `Retry-After` three times. A gateway close that cannot be resumed (a revoked token, for example) rejects `login` or emits `error` with the close code as `status`.

## Limits that stay the same

The kit goes through the same bot API as any Hubs bot, so the same limits hold: 120 calls a minute per bot, 30 of them writes (sends, edits, deletes, reactions, interaction answers), answers within 3 seconds, follow-ups for 15 minutes, and every call held to the hub's channel rules for the bot's role.

## Not supported yet

Hubs bots can't do these today, so the kit throws `HubsNotSupportedError` for them:

1. **Moderation.** Deleting other people's messages, timeouts, kicks and bans. A moderation bot can flag, warn and log, but not remove.
2. **Starting direct messages** (`user.send`, `createDM`). Commands in direct messages work: in conversations the bot takes part in, and anywhere for people who added it to their account.
3. **Sending files.** Bots can receive files through attachment options, but not upload them.
4. **Custom emoji** and reactions outside the Hubs reaction set.
