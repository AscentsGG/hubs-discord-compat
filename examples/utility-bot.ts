/*
 * Example: a discord.js slash-command utility bot ported to Hubs.
 *
 * What changed from the Discord version (each marked PORT below):
 * 1. The import is "hubs-discord-compat" instead of "discord.js".
 * 2. The token is a Hubs bot token, and REST and the client get the Hubs
 *    address. The deploy step is unchanged otherwise.
 * 3. client.user.setActivity was removed: Hubs bots have no status line.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "../src/index.js"; // PORT: from "discord.js"

const ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "Asia/Tokyo",
];

export const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check that the bot is awake"),
  new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll dice")
    .addIntegerOption((o) =>
      o
        .setName("sides")
        .setDescription("Sides")
        .setRequired(true)
        .setMinValue(2)
        .setMaxValue(100),
    )
    .addIntegerOption((o) =>
      o
        .setName("count")
        .setDescription("How many")
        .setMinValue(1)
        .setMaxValue(5),
    ),
  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Ask a yes or no question")
    .addStringOption((o) =>
      o.setName("question").setDescription("The question").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("feedback")
    .setDescription("Send feedback to the team"),
  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Set a reminder")
    .addIntegerOption((o) =>
      o
        .setName("minutes")
        .setDescription("In how many minutes")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("note").setDescription("What about").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("timezone")
    .setDescription("Show a time zone")
    .addStringOption((o) =>
      o
        .setName("zone")
        .setDescription("Zone")
        .setRequired(true)
        .setAutocomplete(true),
    ),
  new SlashCommandBuilder()
    .setName("pick")
    .setDescription("Pick a game for tonight"),
];

/** The usual deploy-commands script, ported. */
export async function deployCommands(
  token: string,
  applicationId: string,
  baseUrl?: string,
) {
  const rest = new REST({
    version: "10",
    api: baseUrl ? `${baseUrl}/api` : undefined,
  }).setToken(token); // PORT: api
  return rest.put(Routes.applicationCommands(applicationId), {
    body: commands.map((c) => c.toJSON()),
  });
}

export function createUtilityBot(options: { baseUrl?: string } = {}) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    hubs: { baseUrl: options.baseUrl }, // PORT: where Hubs is
  });
  const votes = new Map<string, Map<string, "yes" | "no">>();
  const feedback: { from: string; topic: string; details: string }[] = [];
  const tally = (messageId: string) => {
    const all = [...(votes.get(messageId)?.values() ?? [])];
    return `Yes ${all.filter((v) => v === "yes").length}, No ${all.filter((v) => v === "no").length}`;
  };
  const pollButtons = () =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("poll:yes")
        .setLabel("Yes")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("poll:no")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger),
    );

  client.once(Events.ClientReady, (ready) => {
    // PORT: ready.user.setActivity("with dice") removed.
    void ready;
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.content.startsWith("!echo "))
      await message.channel.send(message.content.slice("!echo ".length));
    if (message.content === "!help")
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("Commands")
            .setDescription(
              commands.map((c) => `/${c.name}: ${c.description}`).join("\n"),
            ),
        ],
      });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      const typed = String(interaction.options.getFocused()).toLowerCase();
      return interaction.respond(
        ZONES.filter((zone) => zone.toLowerCase().includes(typed)).map(
          (zone) => ({ name: zone, value: zone }),
        ),
      );
    }
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case "ping":
          return interaction.reply(`Pong! Gateway ping ${client.ws.ping} ms.`);
        case "roll": {
          const sides = interaction.options.getInteger("sides", true)!;
          const count = interaction.options.getInteger("count") ?? 1;
          const results = Array.from(
            { length: count },
            (_, i) => ((i * 7 + 3) % sides) + 1,
          );
          return interaction.reply({
            embeds: [
              new EmbedBuilder().setTitle(`${count}d${sides}`).addFields(
                { name: "Results", value: results.join(", ") },
                {
                  name: "Total",
                  value: String(results.reduce((a, b) => a + b, 0)),
                },
              ),
            ],
          });
        }
        case "poll":
          return interaction.reply({
            content: `${interaction.options.getString("question", true)} (Yes 0, No 0)`,
            components: [pollButtons()],
          });
        case "feedback":
          return interaction.showModal(
            new ModalBuilder()
              .setCustomId("feedback")
              .setTitle("Feedback")
              .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                  new TextInputBuilder()
                    .setCustomId("topic")
                    .setLabel("Topic")
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(60),
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                  new TextInputBuilder()
                    .setCustomId("details")
                    .setLabel("Details")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false),
                ),
              ),
          );
        case "remind": {
          await interaction.deferReply({ ephemeral: true });
          const minutes = interaction.options.getInteger("minutes", true);
          const note = interaction.options.getString("note", true);
          await interaction.editReply(
            `Reminder set: "${note}" in ${minutes} minutes.`,
          );
          return interaction.followUp({
            content: "Tip: reminders show here, only for you.",
            ephemeral: true,
          });
        }
        case "timezone":
          return interaction.reply({
            content: `Time zone: ${interaction.options.getString("zone", true)}`,
            ephemeral: true,
          });
        case "pick":
          return interaction.reply({
            content: "What should we play tonight?",
            components: [
              new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId("game")
                  .setPlaceholder("Choose a game")
                  .addOptions(
                    { label: "Chess", value: "chess" },
                    { label: "Go", value: "go" },
                  ),
              ),
            ],
          });
      }
    }
    if (interaction.isButton() && interaction.customId.startsWith("poll:")) {
      const id = interaction.message.id;
      const map = votes.get(id) ?? new Map();
      map.set(
        interaction.user.id,
        interaction.customId === "poll:yes" ? "yes" : "no",
      );
      votes.set(id, map);
      const question = interaction.message.content.replace(
        / \(Yes \d+, No \d+\)$/,
        "",
      );
      return interaction.update({
        content: `${question} (${tally(id)})`,
        components: [pollButtons()],
      });
    }
    if (interaction.isStringSelectMenu() && interaction.customId === "game")
      return interaction.update({
        content: `Tonight we play ${interaction.values[0]}.`,
        components: [],
      });
    if (interaction.isModalSubmit() && interaction.customId === "feedback") {
      const entry = {
        from: interaction.user.username,
        topic: interaction.fields.getTextInputValue("topic"),
        details: interaction.fields.getTextInputValue("details"),
      };
      feedback.push(entry);
      await interaction.reply({
        content: "Thanks for the feedback!",
        ephemeral: true,
      });
      return interaction.followUp(`New feedback about "${entry.topic}".`);
    }
  });

  return { client, votes, feedback };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.HUBS_BOT_TOKEN!;
  const { client } = createUtilityBot();
  void client
    .login(token)
    .then(() => deployCommands(token, client.application!.id));
}
