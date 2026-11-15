/*
 * Example: a discord.js moderation bot ported to Hubs.
 *
 * What changed from the Discord version (each marked PORT below):
 * 1. The import is "hubs-discord-compat" instead of "discord.js".
 * 2. The token is a Hubs bot token, and the client gets the Hubs address.
 * 3. The Discord ids in the config are mapped to Hubs names with hubs.names.
 * 4. Deleting someone else's message throws HubsNotSupportedError on Hubs,
 *    so the bot falls back to a warning and a mod log entry.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Colors,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  HubsNotSupportedError,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
} from "../src/index.js"; // PORT: from "discord.js"

// The ids from the bot's Discord config, unchanged.
export const MOD_LOG_CHANNEL_ID = "900000000000000001";
export const WELCOME_CHANNEL_ID = "900000000000000002";
export const MODERATOR_ROLE_ID = "900000000000000003";

export interface ModerationBotOptions {
  baseUrl?: string;
  bannedWords?: string[];
}

export function createModerationBot(options: ModerationBotOptions = {}) {
  const bannedWords = (options.bannedWords ?? ["spoiler", "scam"]).map((w) =>
    w.toLowerCase(),
  );
  const warnings = new Map<string, number>();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    // PORT: where Hubs is, and which Hubs names the old Discord ids mean.
    hubs: {
      baseUrl: options.baseUrl,
      names: {
        channels: {
          [MOD_LOG_CHANNEL_ID]: "mod-log",
          [WELCOME_CHANNEL_ID]: "welcome",
        },
        roles: { [MODERATOR_ROLE_ID]: "admin" },
      },
    },
  });

  const commands = [
    new SlashCommandBuilder()
      .setName("warnings")
      .setDescription("Show how many warnings someone has")
      .addUserOption((o) =>
        o.setName("member").setDescription("Who").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("clearwarnings")
      .setDescription("Clear someone's warnings")
      .addUserOption((o) =>
        o.setName("member").setDescription("Who").setRequired(true),
      ),
  ];

  const modLog = (guildId: string | null) =>
    guildId
      ? client.guilds.cache.get(guildId)?.channels.cache.get(MOD_LOG_CHANNEL_ID)
      : undefined;

  async function check(message: Message) {
    if (message.author.bot || !message.inGuild()) return;
    const text = message.content.toLowerCase();
    const word = bannedWords.find((w) => text.includes(w));
    if (!word) return;
    const count = (warnings.get(message.author.id) ?? 0) + 1;
    warnings.set(message.author.id, count);
    await message.react("👀"); // PORT: was ⚠️, which is not in the Hubs reaction set
    try {
      await message.delete();
    } catch (error) {
      // PORT: Hubs bots cannot delete other people's messages yet.
      if (!(error instanceof HubsNotSupportedError)) throw error;
      await message.reply(
        `${message.author}, please keep it friendly. That is warning ${count}.`,
      );
    }
    await modLog(message.guildId)?.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Flagged message")
          .setColor(Colors.Orange)
          .setDescription(message.content.slice(0, 500))
          .addFields(
            { name: "Member", value: message.author.toString(), inline: true },
            {
              name: "Channel",
              value: message.channel.toString(),
              inline: true,
            },
            { name: "Warnings", value: String(count), inline: true },
          )
          .setTimestamp(),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`reviewed:${message.id}`)
            .setLabel("Mark reviewed")
            .setStyle(ButtonStyle.Success),
        ),
      ],
    });
  }

  client.once(Events.ClientReady, async (ready) => {
    for (const guild of ready.guilds.cache.values())
      await guild.commands.set(commands.map((c) => c.toJSON()));
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    const welcome = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    await welcome?.send(`Welcome, ${member}! Read the rules and say hi.`);
    await modLog(member.guild.id)?.send(`${member.user.username} joined.`);
  });
  client.on(Events.GuildMemberRemove, async (member) => {
    await modLog(member.guild.id)?.send(`${member.user.username} left.`);
  });
  client.on(Events.MessageCreate, check);
  client.on(Events.MessageUpdate, (_old, updated) => check(updated));
  client.on(Events.MessageDelete, async (message) => {
    if (message.author?.id === client.user?.id) return;
    await modLog(message.guildId)?.send(
      `A message was deleted in ${message.channel}.`,
    );
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) return command(interaction);
    if (interaction.isButton()) return button(interaction);
  });

  async function command(interaction: ChatInputCommandInteraction) {
    if (!interaction.member?.roles.cache.has(MODERATOR_ROLE_ID))
      return interaction.reply({
        content: "Only moderators can use this.",
        flags: MessageFlags.Ephemeral,
      });
    const user = interaction.options.getUser("member", true)!;
    if (interaction.commandName === "warnings") {
      const count = warnings.get(user.id) ?? 0;
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Warnings for ${user.username}`)
            .setDescription(`${count} so far.`),
        ],
        ephemeral: true,
      });
    }
    if (interaction.commandName === "clearwarnings")
      return interaction.reply({
        content: `Clear ${warnings.get(user.id) ?? 0} warnings for ${user}?`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`clear:${user.id}`)
              .setLabel("Clear")
              .setStyle(ButtonStyle.Danger),
          ),
        ],
        ephemeral: true,
      });
  }

  async function button(interaction: ButtonInteraction) {
    const [action, id] = interaction.customId.split(":");
    if (action === "clear") {
      warnings.delete(id);
      return interaction.update({
        content: "Warnings cleared.",
        components: [],
      });
    }
    if (action === "reviewed")
      return interaction.update({
        content: `Reviewed by ${interaction.user}.`,
        components: [],
      });
  }

  return { client, warnings };
}

// Run directly: HUBS_BOT_TOKEN=hbot_... HUBS_BASE_URL=https://thehubs.gg node moderation-bot.js
if (import.meta.url === `file://${process.argv[1]}`)
  void createModerationBot().client.login();
