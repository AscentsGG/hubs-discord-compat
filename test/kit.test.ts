import assert from "node:assert/strict";
import test from "node:test";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  CommandInteractionOptionResolver,
  ChannelSelectMenuBuilder,
  checkDiscordBotSource,
  Client,
  Collection,
  Colors,
  ContextMenuCommandBuilder,
  createInteractionVerifier,
  EmbedBuilder,
  formatPortReport,
  GatewayIntentBits,
  handleInteractionRequest,
  HubsAPIError,
  HubsNotSupportedError,
  HubsRest,
  IntentsBitField,
  MentionableSelectMenuBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  RoleSelectMenuBuilder,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  toHubsCommand,
  toHubsComponents,
  toHubsEmbed,
  toHubsMessage,
  toHubsModal,
  UserSelectMenuBuilder,
  verifyKey,
} from "../src/index.js";

/*
 * The port kit on its own, with no server: builders turn into the Hubs
 * shapes, Discord-only features throw HubsNotSupportedError (never a quiet
 * no-op), the REST client waits out 429s, and the checker reads bot source.
 */

const TOKEN = `hbot_${"a".repeat(46)}`;
const notSupported = (fn: () => unknown, feature?: RegExp) =>
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HubsNotSupportedError, String(error));
    assert.equal(error.code, "HUBS_NOT_SUPPORTED");
    assert.match(error.message, /is not supported on Hubs\./);
    assert.match(error.message, /docs\/PORTING\.md/);
    if (feature) assert.match(error.feature, feature);
    return true;
  });
const rejectsNotSupported = (promise: Promise<unknown>, feature?: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HubsNotSupportedError, String(error));
    if (feature) assert.match(error.feature, feature);
    return true;
  });

test("embeds: EmbedBuilder turns into a Hubs embed; pictures from other sites throw", () => {
  const embed = new EmbedBuilder()
    .setTitle("Rules")
    .setDescription("Be kind.")
    .setURL("https://example.com/rules")
    .setColor("Red")
    .setAuthor({ name: "Moderators" })
    .addFields({ name: "One", value: "Be kind", inline: true }, [
      { name: "Two", value: "No spam" },
    ])
    .setFooter({ text: "Thanks" })
    .setTimestamp(new Date("2026-10-11T12:00:00Z"));
  assert.deepEqual(toHubsEmbed(embed), {
    title: "Rules",
    description: "Be kind.",
    url: "https://example.com/rules",
    color: Colors.Red,
    author: { name: "Moderators" },
    fields: [
      { name: "One", value: "Be kind", inline: true },
      { name: "Two", value: "No spam" },
    ],
    footer: { text: "Thanks" },
    timestamp: "2026-10-11T12:00:00.000Z",
  });
  assert.equal(new EmbedBuilder().setColor("#00ff00").data.color, 0x00ff00);
  assert.equal(new EmbedBuilder().setColor([1, 2, 3]).data.color, 0x010203);
  assert.equal(
    new EmbedBuilder().setColor(0x123456).setColor(null).data.color,
    undefined,
  );
  assert.throws(() => new EmbedBuilder().setColor(0x1000000), RangeError);
  const spliced = new EmbedBuilder()
    .setFields({ name: "a", value: "1" }, { name: "b", value: "2" })
    .spliceFields(0, 1);
  assert.deepEqual(spliced.data.fields, [{ name: "b", value: "2" }]);
  assert.equal(EmbedBuilder.from(embed).data.title, "Rules");
  notSupported(
    () => new EmbedBuilder().setImage("https://example.com/a.png"),
    /setImage/,
  );
  notSupported(
    () => new EmbedBuilder().setThumbnail("https://example.com/a.png"),
    /setThumbnail/,
  );
  notSupported(
    () =>
      new EmbedBuilder().setAuthor({
        name: "A",
        iconURL: "https://example.com/a.png",
      }),
    /author icon/,
  );
  notSupported(
    () =>
      new EmbedBuilder().setAuthor({ name: "A", url: "https://example.com" }),
    /author link/,
  );
  notSupported(
    () =>
      new EmbedBuilder().setFooter({
        text: "A",
        iconURL: "https://example.com/a.png",
      }),
    /footer icon/,
  );
  // Raw Discord JSON is checked the same way.
  notSupported(
    () =>
      toHubsEmbed({ title: "x", image: { url: "https://example.com/a.png" } }),
    /image/,
  );
  notSupported(
    () =>
      toHubsEmbed({
        title: "x",
        thumbnail: { url: "https://example.com/a.png" },
      }),
    /thumbnail/,
  );
  notSupported(
    () => toHubsEmbed({ title: "x", video: { url: "https://example.com" } }),
    /video/,
  );
  notSupported(
    () => toHubsEmbed({ title: "x", provider: { name: "y" } }),
    /provider/,
  );
  notSupported(
    () =>
      toHubsEmbed({
        title: "x",
        footer: { text: "y", icon_url: "https://example.com/a.png" },
      }),
    /footer icon/,
  );
  notSupported(() => toHubsEmbed({ title: "x", type: "gifv" }), /gifv/);
});

test("components: buttons, link buttons and string select menus map; other selects throw", () => {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("yes")
      .setLabel("Yes")
      .setStyle(ButtonStyle.Success)
      .setEmoji("👍"),
    new ButtonBuilder()
      .setCustomId("no")
      .setLabel("No")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(),
    new ButtonBuilder()
      .setLabel("Rules")
      .setStyle(ButtonStyle.Link)
      .setURL("https://example.com/rules"),
    new ButtonBuilder()
      .setCustomId("p")
      .setLabel("P")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("s")
      .setLabel("S")
      .setStyle(ButtonStyle.Secondary),
  );
  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("color")
      .setPlaceholder("Pick")
      .setMinValues(1)
      .setMaxValues(2)
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Red")
          .setValue("red")
          .setDescription("Warm")
          .setDefault(),
        { label: "Blue", value: "blue" },
      ),
  );
  assert.deepEqual(toHubsComponents([row, menu]), [
    {
      type: "row",
      components: [
        {
          type: "button",
          style: "success",
          label: "Yes",
          customId: "yes",
          emoji: "👍",
        },
        {
          type: "button",
          style: "danger",
          label: "No",
          customId: "no",
          disabled: true,
        },
        {
          type: "button",
          style: "link",
          label: "Rules",
          url: "https://example.com/rules",
        },
        { type: "button", style: "primary", label: "P", customId: "p" },
        { type: "button", style: "secondary", label: "S", customId: "s" },
      ],
    },
    {
      type: "row",
      components: [
        {
          type: "select",
          customId: "color",
          placeholder: "Pick",
          minValues: 1,
          maxValues: 2,
          options: [
            { label: "Red", value: "red", description: "Warm", default: true },
            { label: "Blue", value: "blue" },
          ],
        },
      ],
    },
  ]);
  notSupported(
    () => new ButtonBuilder().setStyle(ButtonStyle.Premium),
    /Premium/,
  );
  notSupported(() => new ButtonBuilder().setSKUId("1"), /Premium/);
  notSupported(
    () => new ButtonBuilder().setEmoji("<:party:123456789012345678>"),
    /Custom emoji/,
  );
  notSupported(
    () => new ButtonBuilder().setEmoji({ id: "123", name: "party" }),
    /Custom emoji/,
  );
  notSupported(
    () => new StringSelectMenuOptionBuilder().setEmoji("👍"),
    /Emoji on select/,
  );
  for (const Builder of [
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    MentionableSelectMenuBuilder,
  ])
    notSupported(() => new Builder(), /select menus/);
  notSupported(
    () =>
      toHubsComponents([
        { type: 1, components: [{ type: 5, custom_id: "u" }] },
      ]),
    /select menus/,
  );
  notSupported(
    () =>
      toHubsComponents([
        { type: 1, components: [{ type: 4, custom_id: "t" }] },
      ]),
    /Text inputs outside a modal/,
  );
  notSupported(
    () => toHubsComponents([{ type: 2, custom_id: "b", style: 1 }]),
    /outside an action row/,
  );
  notSupported(
    () => toHubsComponents([{ type: 17, components: [] }]),
    /outside an action row/,
  );
  notSupported(
    () => toHubsComponents([{ type: 1, components: [{ type: 10 }] }]),
    /Components V2/,
  );
});

test("modals: ModalBuilder with text inputs becomes a Hubs form", () => {
  const modal = new ModalBuilder()
    .setCustomId("feedback")
    .setTitle("Feedback")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("topic")
          .setLabel("Topic")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(40)
          .setPlaceholder("What about"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("body")
          .setLabel("Details")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMinLength(2)
          .setValue("Hi"),
      ),
    );
  assert.deepEqual(toHubsModal(modal), {
    customId: "feedback",
    title: "Feedback",
    fields: [
      {
        customId: "topic",
        label: "Topic",
        style: "short",
        required: true,
        placeholder: "What about",
        maxLength: 40,
      },
      {
        customId: "body",
        label: "Details",
        style: "paragraph",
        required: false,
        minLength: 2,
        value: "Hi",
      },
    ],
  });
  notSupported(
    () =>
      toHubsModal({
        custom_id: "m",
        title: "M",
        components: [
          { type: 1, components: [{ type: 3, custom_id: "s", options: [] }] },
        ],
      }),
    /text inputs/,
  );
});

test("slash commands: SlashCommandBuilder and raw JSON become Hubs commands; Discord-only parts throw", () => {
  const roll = new SlashCommandBuilder()
    .setName("roll")
    .setDescription("Roll some dice")
    .setDMPermission(false)
    .setDefaultMemberPermissions(null)
    .setNSFW(false)
    .addIntegerOption((o) =>
      o
        .setName("sides")
        .setDescription("Sides")
        .setRequired(true)
        .setMinValue(2)
        .setMaxValue(100),
    )
    .addStringOption((o) =>
      o
        .setName("style")
        .setDescription("Style")
        .addChoices({ name: "Plain", value: "plain" }),
    )
    .addStringOption((o) =>
      o
        .setName("game")
        .setDescription("Game")
        .setAutocomplete(true)
        .setMinLength(1)
        .setMaxLength(20),
    )
    .addNumberOption((o) =>
      o.setName("bonus").setDescription("Bonus").setMinValue(0.5),
    )
    .addBooleanOption((o) => o.setName("secret").setDescription("Secret"))
    .addUserOption((o) => o.setName("for").setDescription("For"))
    .addChannelOption((o) => o.setName("where").setDescription("Where"));
  assert.deepEqual(toHubsCommand(roll), {
    name: "roll",
    description: "Roll some dice",
    options: [
      {
        type: "integer",
        name: "sides",
        description: "Sides",
        required: true,
        minValue: 2,
        maxValue: 100,
      },
      {
        type: "string",
        name: "style",
        description: "Style",
        choices: [{ name: "Plain", value: "plain" }],
      },
      {
        type: "string",
        name: "game",
        description: "Game",
        autocomplete: true,
        minLength: 1,
        maxLength: 20,
      },
      { type: "number", name: "bonus", description: "Bonus", minValue: 0.5 },
      { type: "boolean", name: "secret", description: "Secret" },
      { type: "user", name: "for", description: "For" },
      { type: "channel", name: "where", description: "Where" },
    ],
  });
  assert.deepEqual(toHubsCommand({ name: "ping", description: "Ping" }), {
    name: "ping",
    description: "Ping",
  });
  const builder = () =>
    new SlashCommandBuilder().setName("x").setDescription("x");
  // Subcommands, groups, roles, mentionables and channel types map.
  assert.deepEqual(
    toHubsCommand(
      builder()
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addSubcommand((sub) =>
          sub
            .setName("show")
            .setDescription("Show")
            .addRoleOption((o) =>
              o.setName("role").setDescription("Role").setRequired(true),
            )
            .addChannelOption((o) =>
              o
                .setName("where")
                .setDescription("Where")
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement,
                ),
            ),
        )
        .addSubcommandGroup((group) =>
          group
            .setName("tags")
            .setDescription("Tags")
            .addSubcommand((sub) =>
              sub
                .setName("add")
                .setDescription("Add")
                .addMentionableOption((o) =>
                  o.setName("who").setDescription("Who"),
                ),
            ),
        ),
    ),
    {
      name: "x",
      description: "x",
      access: "admins",
      options: [
        {
          type: "subcommand",
          name: "show",
          description: "Show",
          options: [
            { type: "role", name: "role", description: "Role", required: true },
            {
              type: "channel",
              name: "where",
              description: "Where",
              channelTypes: ["chat", "announcements"],
            },
          ],
        },
        {
          type: "subcommand_group",
          name: "tags",
          description: "Tags",
          options: [
            {
              type: "subcommand",
              name: "add",
              description: "Add",
              options: [
                { type: "mentionable", name: "who", description: "Who" },
              ],
            },
          ],
        },
      ],
    },
  );
  assert.equal(
    toHubsCommand(builder().setDefaultMemberPermissions(null)).access,
    undefined,
  );
  // 0.3.0: attachment options, contexts and context menu commands map.
  assert.deepEqual(
    toHubsCommand(
      builder()
        .addAttachmentOption((o) => o.setName("file").setDescription("A file"))
        .setContexts(0, 1)
        .setIntegrationTypes(0, 1),
    ).options.at(-1),
    { type: "attachment", name: "file", description: "A file" },
  );
  notSupported(
    () =>
      toHubsCommand(
        builder().addChannelOption((o) =>
          o
            .setName("c")
            .setDescription("c")
            .addChannelTypes(ChannelType.GuildForum),
        ),
      ),
    /channel type 15/,
  );
  assert.deepEqual(toHubsCommand(builder().setDMPermission(true)).contexts, [
    "hub",
    "dm",
  ]);
  assert.deepEqual(toHubsCommand(builder().setContexts(0, 2)).contexts, [
    "hub",
    "dm",
    "group_dm",
  ]);
  assert.equal(
    toHubsCommand(builder().setDMPermission(false)).contexts,
    undefined,
  );
  notSupported(() => builder().setNSFW(), /Age restricted/);
  notSupported(() => builder().setNameLocalizations({}), /localizations/);
  notSupported(
    () => builder().setDescriptionLocalizations({}),
    /localizations/,
  );
  assert.deepEqual(
    toHubsCommand(
      new ContextMenuCommandBuilder().setName("Report message").setType(3),
    ),
    { name: "Report message", description: "", type: "message" },
  );
  assert.deepEqual(toHubsCommand({ name: "Wave", type: 2, contexts: [1] }), {
    name: "Wave",
    description: "",
    type: "user",
    contexts: ["dm"],
  });
  notSupported(() => toHubsCommand({ name: "go", type: 4 }), /Entry point/);
  assert.deepEqual(
    toHubsCommand({
      name: "x",
      description: "x",
      default_member_permissions: "8",
      options: [{ type: 1, name: "sub", description: "Sub" }],
    }),
    {
      name: "x",
      description: "x",
      access: "admins",
      options: [
        { type: "subcommand", name: "sub", description: "Sub", options: [] },
      ],
    },
  );
  assert.equal(
    toHubsCommand({
      name: "x",
      description: "x",
      options: [{ type: 11, name: "f" }],
    }).options[0].type,
    "attachment",
  );
  notSupported(
    () =>
      toHubsCommand({
        name: "x",
        description: "x",
        name_localizations: { fr: "y" },
      }),
    /localizations/,
  );
  assert.throws(
    () =>
      toHubsCommand({
        name: "x",
        description: "x",
        options: [{ type: 99, name: "q" }],
      }),
    TypeError,
  );
});

test("message options: content, embeds, components, ephemeral and replies map; the rest throws", () => {
  assert.deepEqual(toHubsMessage("hi"), { content: "hi" });
  assert.deepEqual(
    toHubsMessage({
      content: "hi",
      embeds: [new EmbedBuilder().setTitle("T")],
      components: [],
      reply: { messageReference: "m1" },
      nonce: "n1",
    }),
    {
      content: "hi",
      embeds: [{ title: "T" }],
      components: [],
      replyToId: "m1",
      nonce: "n1",
    },
  );
  assert.deepEqual(
    toHubsMessage({ content: "s", ephemeral: true }, "interaction"),
    { content: "s", ephemeral: true },
  );
  assert.deepEqual(
    toHubsMessage(
      { content: "s", flags: MessageFlags.Ephemeral },
      "interaction",
    ),
    { content: "s", ephemeral: true },
  );
  assert.deepEqual(
    toHubsMessage({ content: "s", files: [], attachments: [] }),
    { content: "s" },
  );
  notSupported(
    () => toHubsMessage({ content: "s", ephemeral: true }),
    /Ephemeral messages outside/,
  );
  notSupported(
    () =>
      toHubsMessage(
        { content: "s", flags: MessageFlags.SuppressEmbeds },
        "interaction",
      ),
    /flags/,
  );
  notSupported(
    () => toHubsMessage({ content: "s", files: ["a.png"] }),
    /Files/,
  );
  notSupported(
    () => toHubsMessage({ content: "s", attachments: [{ id: "1" }] }),
    /Files/,
  );
  notSupported(
    () => toHubsMessage({ content: "s", tts: true }),
    /Text to speech/,
  );
  notSupported(
    () => toHubsMessage({ content: "s", stickers: ["1"] }),
    /Stickers/,
  );
  notSupported(
    () => toHubsMessage({ content: "s", poll: { question: { text: "?" } } }),
    /Polls/,
  );
  notSupported(
    () => toHubsMessage({ content: "s", allowedMentions: { parse: [] } }),
    /allowedMentions/,
  );
  notSupported(
    () => toHubsMessage({ content: "s", fetchReply: true }, "interaction"),
    /fetchReply/,
  );
  notSupported(
    () => toHubsMessage({ content: "s", withResponse: true }, "interaction"),
    /fetchReply/,
  );
  notSupported(
    () => toHubsMessage({ content: "s", somethingElse: 1 }),
    /somethingElse/,
  );
  notSupported(
    () => toHubsMessage(new EmbedBuilder().setTitle("x")),
    /builder directly/,
  );
  assert.throws(() => toHubsMessage(42), TypeError);
});

test("client options: Hubs tokens only, supported intents only, clear errors for the rest", async () => {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ];
  const client = new Client({
    intents,
    hubs: { baseUrl: "http://127.0.0.1:9" },
    partials: [],
    sweepers: {},
  });
  assert.equal(client.intents, 1 | 512 | 32768);
  assert.deepEqual(client.hubsIntents, [
    "HUBS",
    "HUB_MESSAGES",
    "MESSAGE_CONTENT",
  ]);
  assert.equal(new Client({ intents: ["Guilds", "GuildMembers"] }).intents, 3);
  assert.equal(
    new Client({
      intents: new IntentsBitField([GatewayIntentBits.Guilds]).add(
        "GuildMessageReactions",
      ),
    }).intents,
    1025,
  );
  assert.equal(new IntentsBitField(3).remove(1).has(2), true);
  notSupported(
    () =>
      new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.GuildVoiceStates,
        ],
      }),
    /GuildVoiceStates, DirectMessages/,
  );
  notSupported(
    () => new Client({ intents: [GatewayIntentBits.GuildPresences] }),
    /GuildPresences/,
  );
  notSupported(
    () => new Client({ intents: 1, allowedMentions: { parse: [] } }),
    /allowedMentions/,
  );
  notSupported(
    () => new Client({ intents: 1, presence: { status: "online" } }),
    /presence/,
  );
  assert.throws(
    () => new Client({ intents: 1, mystery: true }),
    /Unknown client option: mystery/,
  );
  assert.throws(() => new Client({ intents: ["Nope"] }), /Unknown intent/);
  assert.throws(() => new Client(undefined as never), /Pass intents/);
  await assert.rejects(
    client.login("discord.token.value"),
    /not a Hubs bot token/,
  );
  await assert.rejects(client.login(""), /No bot token/);
});

test("REST: Authorization: Bot, errors as HubsAPIError, waits out a 429, and Routes map to Hubs paths", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let limited = 1;
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/limited") && limited-- > 0)
      return new Response(
        JSON.stringify({ error: "slow down", code: "BOT_RATE_LIMITED" }),
        { status: 429, headers: { "retry-after": "0" } },
      );
    if (url.endsWith("/missing"))
      return new Response(
        JSON.stringify({
          error: "This bot was not granted the scope.",
          code: "BOT_SCOPE_MISSING",
        }),
        { status: 403 },
      );
    if (url.endsWith("/empty")) return new Response(null, { status: 204 });
    return new Response(
      JSON.stringify({ ok: true, commands: [{ id: "c1", name: "ping" }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const rest = new HubsRest({
    baseUrl: "http://hubs.test/",
    fetch: fake,
  }).setToken(TOKEN);
  assert.deepEqual(await rest.get("/limited"), {
    ok: true,
    commands: [{ id: "c1", name: "ping" }],
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://hubs.test/api/developer/v1/limited");
  assert.equal(
    (calls[0].init.headers as Record<string, string>).authorization,
    `Bot ${TOKEN}`,
  );
  assert.equal(await rest.delete("/empty"), null);
  await assert.rejects(rest.get("/missing"), (error: unknown) => {
    assert.ok(error instanceof HubsAPIError);
    assert.equal(error.status, 403);
    assert.equal(error.code, "BOT_SCOPE_MISSING");
    return true;
  });
  await assert.rejects(new HubsRest({ fetch: fake }).get("/x"), /Set a token/);

  // discord.js REST and Routes, as a deploy-commands script uses them.
  calls.length = 0;
  const discordRest = new REST({
    version: "10",
    api: "http://hubs.test/api",
    fetch: fake,
  }).setToken(TOKEN);
  const saved = await discordRest.put(Routes.applicationCommands("123"), {
    body: [
      new SlashCommandBuilder().setName("ping").setDescription("Ping").toJSON(),
    ],
  });
  assert.deepEqual(saved, [{ id: "c1", name: "ping" }]);
  assert.equal(
    calls[0].url,
    "http://hubs.test/api/developer/v1/applications/@me/commands",
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), [
    { name: "ping", description: "Ping" },
  ]);
  await discordRest.put(Routes.applicationGuildCommands("123", "hub-1"), {
    body: [],
  });
  assert.equal(
    calls[1].url,
    "http://hubs.test/api/developer/v1/hubs/hub-1/commands",
  );
  await discordRest.post(Routes.channelMessages("chan-1"), {
    body: { content: "hi", nonce: "abc" },
  });
  assert.equal(
    calls[2].url,
    "http://hubs.test/api/developer/v1/channels/chan-1/messages",
  );
  assert.equal(
    (calls[2].init.headers as Record<string, string>)["idempotency-key"],
    "nonce:abc",
  );
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), { content: "hi" });
  await discordRest.patch(Routes.channelMessage("chan-1", "m-1"), {
    body: { content: "edited" },
  });
  assert.equal(calls[3].init.method, "PATCH");
  assert.equal(
    Routes.channelMessageOwnReaction("c", "m", "👍"),
    `/channels/c/messages/m/reactions/${encodeURIComponent("👍")}`,
  );
  assert.equal(Routes.guildMembers("h"), "/hubs/h/members");
  assert.equal(Routes.user(), "/users/@me");
  notSupported(() => Routes.user("42"), /other users/);
  notSupported(() => Routes.guildBans("h"), /Routes\.guildBans/);
  notSupported(() => Routes.webhook("1", "t"), /Routes\.webhook/);
  await rejectsNotSupported(
    discordRest.post(Routes.applicationCommands("1"), {
      body: { name: "x", description: "x" },
    }),
    /POST/,
  );
});

test("Collection: the cache helpers bots use", () => {
  const c = new Collection<string, number>([
    ["a", 1],
    ["b", 2],
    ["c", 3],
  ]);
  assert.equal(
    c.find((v) => v > 1),
    2,
  );
  assert.equal(
    c.findKey((v) => v > 1),
    "b",
  );
  assert.deepEqual([...c.filter((v) => v !== 2).keys()], ["a", "c"]);
  assert.deepEqual(
    c.map((v) => v * 2),
    [2, 4, 6],
  );
  assert.equal(c.first(), 1);
  assert.deepEqual(c.first(2), [1, 2]);
  assert.equal(c.last(), 3);
  assert.deepEqual(c.last(2), [2, 3]);
  assert.equal(c.at(-1), 3);
  assert.equal(c.firstKey(), "a");
  assert.ok(c.some((v) => v === 3) && c.every((v) => v > 0));
  assert.equal(
    c.reduce((sum, v) => sum + v, 0),
    6,
  );
  assert.ok(c.hasAll("a", "b") && c.hasAny("z", "c") && !c.hasAny("z"));
  assert.deepEqual(
    c
      .clone()
      .sort((x, y) => y - x)
      .toJSON(),
    [3, 2, 1],
  );
});

test("checker: lists what maps, partly maps and does not", () => {
  const source = [
    'const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");',
    "const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });",
    'client.on("messageCreate", async (message) => {',
    "  await message.member.ban({ reason: 'spam' });",
    "  await message.reply({ embeds: [new EmbedBuilder().setImage('https://example.com/x.png')] });",
    "});",
    'client.on("voiceStateUpdate", () => {});',
    "client.user.setActivity('games');",
    "const LOG = '123456789012345678';",
    "client.login(process.env.TOKEN);",
  ].join("\n");
  const findings = checkDiscordBotSource(source);
  const at = (line: number) =>
    findings
      .filter((f) => f.line === line)
      .map((f) => `${f.status}:${f.feature}`);
  assert.deepEqual(at(1), ["maps:discord.js import"]);
  assert.ok(at(2).includes("unsupported:Intent"));
  assert.ok(at(2).includes("maps:Intent"));
  assert.ok(at(3).includes("maps:Event"));
  assert.ok(at(4).includes("unsupported:Moderation action"));
  assert.ok(at(5).includes("unsupported:Embed pictures"));
  assert.ok(at(5).includes("maps:Interaction answer"));
  assert.ok(at(7).includes("unsupported:Event"));
  assert.ok(at(8).includes("unsupported:Presence"));
  assert.ok(at(9).includes("partly:Discord id"));
  assert.ok(at(10).includes("partly:client.login"));
  const report = formatPortReport(findings);
  assert.match(report, /^Maps: \d+, partly maps: \d+, does not map: \d+\./);
  assert.match(report, /line 4: does not map: Moderation action/);
  assert.doesNotMatch(report, /\u2014|--/);
});

test("subcommand options: getSubcommand, getSubcommandGroup, roles and mentionables", () => {
  const fake = {
    client: { users: { add: (value: unknown) => ({ user: value }) } },
    guild: { id: "hub" },
  } as never;
  const options = new CommandInteractionOptionResolver(fake, [
    {
      name: "tags",
      type: "subcommand_group",
      options: [
        {
          name: "add",
          type: "subcommand",
          options: [
            { name: "label", type: "string", value: "news" },
            {
              name: "who",
              type: "mentionable",
              value: { kind: "role", id: "r1", name: "Crew" },
            },
            {
              name: "role",
              type: "role",
              value: { id: "r2", name: "Mods" },
            },
            {
              name: "person",
              type: "mentionable",
              value: { kind: "user", id: "u1", handle: "wren" },
            },
          ],
        },
      ],
    },
  ]);
  assert.equal(options.getSubcommandGroup(), "tags");
  assert.equal(options.getSubcommand(), "add");
  assert.equal(options.getString("label"), "news");
  assert.equal(options.getRole("role")?.name, "Mods");
  assert.equal(String(options.getMentionable("who")), "@Crew");
  assert.deepEqual(options.getMentionable("person"), {
    user: { id: "u1", handle: "wren" },
  });
  const flat = new CommandInteractionOptionResolver(fake, [
    { name: "sides", type: "integer", value: 6 },
  ]);
  assert.equal(flat.getSubcommand(false), null);
  assert.throws(() => flat.getSubcommand(), /without a subcommand/);
  assert.equal(flat.getInteger("sides"), 6);
});

// 0.3.0: HTTP interactions, context menu commands, attachments and DMs.

const ed25519 = async () => {
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const pair = generateKeyPairSync("ed25519");
  const publicKey = (
    pair.publicKey.export({ format: "der", type: "spki" }) as Buffer
  )
    .subarray(-32)
    .toString("hex");
  const signed = (body: string, timestamp: string) =>
    sign(null, Buffer.from(timestamp + body), pair.privateKey).toString("hex");
  return { publicKey, signed };
};

test("HTTP interactions: verifyKey checks the Ed25519 signature over timestamp plus body", async () => {
  const { publicKey, signed } = await ed25519();
  const body = JSON.stringify({ type: "ping", id: "1" });
  const signature = signed(body, "1760000000");
  assert.equal(verifyKey(body, signature, "1760000000", publicKey), true);
  // A changed body, timestamp or signature, or another key, fails.
  assert.equal(
    verifyKey(`${body} `, signature, "1760000000", publicKey),
    false,
  );
  assert.equal(verifyKey(body, signature, "1760000001", publicKey), false);
  const flipped =
    (parseInt(signature[0], 16) ^ 1).toString(16) + signature.slice(1);
  assert.equal(verifyKey(body, flipped, "1760000000", publicKey), false);
  const other = await ed25519();
  assert.equal(
    verifyKey(body, signature, "1760000000", other.publicKey),
    false,
  );
  // Malformed input is a plain false, never a throw.
  assert.equal(verifyKey(body, "zz", "1760000000", publicKey), false);
  assert.equal(verifyKey(body, signature, "1760000000", "abc"), false);
  assert.equal(
    verifyKey(Buffer.from(body), signature, "1760000000", publicKey),
    true,
  );
});

test("HTTP interactions: the verifier refuses old, future, replayed and unsigned requests", async () => {
  const { publicKey, signed } = await ed25519();
  let now = 1_760_000_000_000;
  const verifier = createInteractionVerifier({ publicKey, now: () => now });
  const request = (payload: unknown, timestamp: number) => {
    const body = JSON.stringify(payload);
    return {
      body,
      signature: signed(body, String(timestamp)),
      timestamp: String(timestamp),
    };
  };
  const seconds = now / 1000;
  const first = request({ type: "command", id: "i1" }, seconds);
  const ok = verifier(first);
  assert.equal(ok.ok, true);
  // The same request again is a replay.
  const again = verifier(first);
  assert.equal(again.ok, false);
  assert.match(!again.ok ? again.reason : "", /already handled/);
  // Too old, or too far ahead.
  assert.equal(verifier(request({ id: "i2" }, seconds - 301)).ok, false);
  assert.equal(verifier(request({ id: "i3" }, seconds + 301)).ok, false);
  assert.equal(verifier(request({ id: "i4" }, seconds - 299)).ok, true);
  // No signature, no timestamp, a body that is not JSON or has no id.
  assert.equal(verifier({ ...first, signature: undefined }).ok, false);
  assert.equal(verifier({ ...first, timestamp: "soon" }).ok, false);
  const text = "not json";
  assert.equal(
    verifier({
      body: text,
      signature: signed(text, String(seconds)),
      timestamp: String(seconds),
    }).ok,
    false,
  );
  assert.equal(verifier(request({ type: "ping" }, seconds)).ok, false);
  // Once the window has passed, a remembered id is let go (and the old
  // timestamp is refused anyway).
  now += 400_000;
  assert.equal(verifier(first).ok, false);
});

test("HTTP interactions: handleInteractionRequest answers PING and returns the first answer inline", async () => {
  const { publicKey, signed } = await ed25519();
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    hubs: { baseUrl: "https://hubs.example" },
  });
  const verifier = createInteractionVerifier({ publicKey });
  const signedRequest = (payload: unknown) => {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    return { body, signature: signed(body, timestamp), timestamp };
  };
  assert.deepEqual(
    await handleInteractionRequest(
      client,
      verifier,
      signedRequest({ type: "ping", id: "p1" }),
    ),
    { status: 200, body: { type: "pong" } },
  );
  const forged = signedRequest({ type: "ping", id: "p2" });
  assert.equal(
    (
      await handleInteractionRequest(client, verifier, {
        ...forged,
        body: forged.body.replace("p2", "p3"),
      })
    ).status,
    401,
  );
  client.on("interactionCreate", (interaction: any) => {
    if (interaction.isMessageContextMenuCommand())
      void interaction.reply({
        content: `Quoted: ${interaction.targetMessage.content}`,
        ephemeral: true,
      });
  });
  const answered = await handleInteractionRequest(
    client,
    verifier,
    signedRequest({
      id: "i-1",
      type: "command",
      applicationId: "a",
      hubId: null,
      channelId: "c",
      context: "dm",
      user: { id: "u", handle: "pat", displayName: "Pat" },
      data: {
        id: "cmd",
        name: "Quote",
        type: "message",
        targetId: "m1",
        message: {
          id: "m1",
          channelId: "c",
          content: "Hello there",
          author: { id: "u2", handle: "sam", displayName: "Sam" },
          createdAt: "2026-10-14T12:00:00.000Z",
        },
      },
    }),
  );
  assert.equal(answered.status, 200);
  assert.deepEqual(answered.body, {
    type: "reply",
    data: {
      content: "Quoted: Hello there",
      embeds: [],
      components: [],
      ephemeral: true,
    },
  });
  // Nobody answers: a 500 after the wait, and Hubs tells the person.
  const silent = await handleInteractionRequest(
    client,
    verifier,
    signedRequest({
      id: "i-2",
      type: "command",
      hubId: null,
      channelId: "c",
      user: { id: "u" },
      data: { name: "x" },
    }),
    { answerMs: 20 },
  );
  assert.equal(silent.status, 500);
});

test("context menu commands and attachments: the interaction classes read their targets and files", async () => {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    hubs: { baseUrl: "https://hubs.example" },
  });
  const seen: any[] = [];
  client.on("interactionCreate", (interaction) => seen.push(interaction));
  const base = {
    applicationId: "a",
    channelId: "c",
    user: { id: "u", handle: "pat", displayName: "Pat" },
    createdAt: "2026-10-14T12:00:00.000Z",
  };
  // The gateway's dispatch, as a frame would reach it.
  const make = (data: Record<string, unknown>, hubId: string | null) =>
    (client as any).dispatch("INTERACTION_CREATE", {
      ...base,
      id: `i${seen.length}`,
      type: "command",
      hubId,
      context: hubId ? "hub" : "dm",
      data,
    });
  await make(
    {
      id: "1",
      name: "Wave",
      type: "user",
      targetId: "u2",
      user: { id: "u2", handle: "sam", displayName: "Sam" },
      member: { role: "member" },
    },
    "h1",
  );
  await make(
    {
      id: "2",
      name: "upload",
      type: "chat_input",
      options: [
        {
          name: "file",
          type: "attachment",
          value: {
            id: "f1",
            name: "notes.txt",
            contentType: "text/plain",
            size: 5,
            url: "/api/developer/v1/interaction-files/abc",
            expiresAt: "2026-10-14T12:10:00.000Z",
          },
        },
      ],
    },
    null,
  );
  const [user, slash] = seen;
  assert.equal(user.isUserContextMenuCommand(), true);
  assert.equal(user.isChatInputCommand(), false);
  assert.equal(user.commandType, 2);
  assert.equal(user.targetId, "u2");
  assert.equal(user.targetUser.id, "u2");
  assert.equal(user.targetMember?.id ?? user.targetMember?.user?.id, "u2");
  assert.equal(user.inGuild(), true);
  assert.equal(slash.isChatInputCommand(), true);
  assert.equal(slash.inGuild(), false);
  assert.equal(slash.guildId, null);
  assert.equal(slash.guild, null);
  assert.equal(slash.context, "dm");
  const file = slash.options.getAttachment("file");
  assert.equal(
    file.url,
    "https://hubs.example/api/developer/v1/interaction-files/abc",
  );
  assert.equal(file.name, "notes.txt");
  assert.equal(file.size, 5);
  assert.equal(slash.options.getAttachment("other"), null);
});
