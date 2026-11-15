# hubs-discord-compat

Run a discord.js bot on [Hubs](https://thehubs.gg). This package gives you the common discord.js surface (Client, events, messages, channels, members, embeds, buttons, select menus, modals, slash commands with subcommands, and interactions) on top of the Hubs bot gateway and developer API. Most simple bots move over by changing the import, the token and the address.

Anything Hubs cannot do throws `HubsNotSupportedError` with the feature's name and what to do instead. It never does nothing quietly.

## Install

The kit is on [npm](https://www.npmjs.com/package/hubs-discord-compat):

```sh
npm install hubs-discord-compat
```

You need Node 22.4 or later (the kit uses the WebSocket built into Node). There are no runtime dependencies, and the types ship with the package.

To build it yourself instead: clone this repository, then `npm ci`, `npm run build` and `npm pack`.

## Before you start

1. Make an application in the [Hubs developer portal](https://thehubs.gg/developers), list the scopes your bot needs, and reset its token. A Hubs token starts with `hbot_`.
2. Install it in a hub with the install link from the portal.
3. Run the port checker on your bot's source to see what maps before you change anything:

```js
import { readFileSync } from "node:fs";
import { checkDiscordBotSource, formatPortReport } from "hubs-discord-compat";

console.log(
  formatPortReport(checkDiscordBotSource(readFileSync("bot.js", "utf8"))),
);
```

## Use

```js
import { Client, Events, GatewayIntentBits } from "hubs-discord-compat"; // was "discord.js"

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  hubs: { baseUrl: "https://thehubs.gg" },
});
client.on(Events.MessageCreate, async (message) => {
  if (message.content === "!ping") await message.reply("Pong.");
});
await client.login(process.env.HUBS_BOT_TOKEN); // a Hubs token, hbot_...
```

Slash commands with subcommands work as in discord.js:

```js
import { SlashCommandBuilder } from "hubs-discord-compat";

const tags = new SlashCommandBuilder()
  .setName("tags")
  .setDescription("Manage tags")
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("Show a tag")
      .addStringOption((o) =>
        o.setName("name").setDescription("Which tag").setRequired(true),
      ),
  );
await client.application?.commands.set([tags]);

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.options.getSubcommand() === "show")
    await interaction.reply(`Tag: ${interaction.options.getString("name")}`);
});
```

Message and user commands (the Apps part of a message's menu and a person's profile), attachment options and commands in direct messages work too:

```js
import { ContextMenuCommandBuilder } from "hubs-discord-compat";

const quote = new ContextMenuCommandBuilder().setName("Quote").setType(3);
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isMessageContextMenuCommand())
    await interaction.reply(`> ${interaction.targetMessage.content}`);
});
```

A bot can take interactions as signed HTTPS requests instead of over the gateway. Set the address in the developer portal (Install tab), then answer each request with the kit:

```js
import {
  createInteractionVerifier,
  handleInteractionRequest,
} from "hubs-discord-compat";

const verifier = createInteractionVerifier({
  publicKey: process.env.HUBS_PUBLIC_KEY,
});
// In your HTTP handler, with the raw body as a string:
const { status, body } = await handleInteractionRequest(client, verifier, {
  body: rawBody,
  signature: request.headers["x-signature-ed25519"],
  timestamp: request.headers["x-signature-timestamp"],
});
```

`verifyKey(body, signature, timestamp, publicKey)` checks one signature on its own; the verifier also refuses requests older than 5 minutes and ones it already saw.

## Porting guide

[docs/PORTING.md](docs/PORTING.md) has what changes, the full supported and not supported tables, how to keep your old Discord ids in config, and two worked examples: a moderation bot and a slash-command utility bot (both in [examples/](examples/)). Changes between versions are in [CHANGELOG.md](CHANGELOG.md).

## Layout

| Path                       | What                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `src/client.ts`            | `Client`, intents, login, the event mapping, hub, channel and user caches               |
| `src/gateway.ts`           | The live connection: identify, heartbeats, resume, reconnect                            |
| `src/rest.ts`              | The developer API client, and discord.js-style `REST` and `Routes`                      |
| `src/structures.ts`        | `Guild`, `TextChannel`, `Message`, `GuildMember`, `Role`, `User`, managers              |
| `src/interactions.ts`      | Commands, subcommands, menu commands, autocomplete, buttons, menus and modal submits    |
| `src/http-interactions.ts` | Signature checks and answers for interactions over HTTPS                                |
| `src/builders.ts`          | `EmbedBuilder`, `ButtonBuilder`, `ActionRowBuilder`, `SlashCommandBuilder` and the rest |
| `src/convert.ts`           | Discord-shaped JSON to the Hubs shapes                                                  |
| `src/checker.ts`           | The port checker                                                                        |
| `examples/`                | A moderation bot and a slash-command utility bot                                        |
| `test/`                    | Unit tests that need no server, and the package checks                                  |

## Develop

```sh
npm ci             # the type checker and test runner
npm test           # unit tests
npm run typecheck  # the package, its examples and tests
npm run build      # compiles to dist/ with types
npm pack --dry-run # what a release ships
```

## Reporting problems

Bug reports and questions are welcome as issues. For anything security related, use [SECURITY.md](SECURITY.md) instead. We don't merge code from outside contributors into this repository, but a pull request that shows a problem is still useful: we'll read it and make the fix ourselves.

## License

Copyright 2026 Ascent Collective LLC. Licensed under the [MIT License](LICENSE).

Discord and discord.js are the names of their owners. This package is not made by, affiliated with or endorsed by Discord Inc. or the discord.js project.
