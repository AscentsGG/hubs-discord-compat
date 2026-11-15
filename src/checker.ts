/*
 * The port checker: reads a discord.js bot's source and lists what maps to
 * Hubs, what partly maps and what does not, with the line and a note, so a
 * developer sees the work before running anything.
 */

export type PortStatus = "maps" | "partly" | "unsupported";
export interface PortFinding {
  feature: string;
  status: PortStatus;
  line: number;
  note: string;
}
interface Rule {
  pattern: RegExp;
  feature: string;
  status: PortStatus;
  note: string;
}

const RULES: Rule[] = [
  {
    pattern: /from\s+["']discord\.js["']|require\(\s*["']discord\.js["']\s*\)/,
    feature: "discord.js import",
    status: "maps",
    note: "Import from hubs-discord-compat instead.",
  },
  {
    pattern: /\.login\(/,
    feature: "client.login",
    status: "partly",
    note: "Use a Hubs bot token (hbot_...) and set HUBS_BASE_URL or hubs.baseUrl.",
  },
  {
    pattern:
      /GatewayIntentBits\.(GuildModeration|GuildBans|GuildExpressions|GuildEmojisAndStickers|GuildIntegrations|GuildWebhooks|GuildInvites|GuildVoiceStates|GuildPresences|GuildMessageTyping|DirectMessages|DirectMessageReactions|DirectMessageTyping|GuildScheduledEvents|AutoModeration\w*|\w*Polls)/,
    feature: "Intent",
    status: "unsupported",
    note: "Hubs supports Guilds, GuildMembers, GuildMessages, GuildMessageReactions and MessageContent.",
  },
  {
    pattern:
      /GatewayIntentBits\.(Guilds|GuildMembers|GuildMessages|GuildMessageReactions|MessageContent)\b/,
    feature: "Intent",
    status: "maps",
    note: "Same bit on Hubs.",
  },
  {
    pattern:
      /\.on\(\s*["'](messageCreate|messageUpdate|messageDelete|interactionCreate|guildMemberAdd|guildMemberRemove|channelCreate|channelUpdate|channelDelete|messageReactionAdd|messageReactionRemove|guildCreate|guildDelete|guildUpdate|ready|clientReady)["']/,
    feature: "Event",
    status: "maps",
    note: "Emitted by the kit.",
  },
  {
    pattern:
      /\.on\(\s*["'](voiceStateUpdate|presenceUpdate|typingStart|threadCreate|guildBanAdd|guildBanRemove|inviteCreate|emojiCreate|messageReactionRemoveAll|messageDeleteBulk|guildScheduledEvent\w*|autoModeration\w*)["']/,
    feature: "Event",
    status: "unsupported",
    note: "Hubs does not send this event to bots.",
  },
  {
    pattern:
      /\.(kick|ban|unban|timeout|disableCommunicationUntil|setNickname|bulkDelete|prune)\(/,
    feature: "Moderation action",
    status: "unsupported",
    note: "Hubs bots have no moderation powers yet; post to a staff channel instead.",
  },
  {
    pattern: /\.roles\.(add|remove|set|create)\(/,
    feature: "Role changes",
    status: "unsupported",
    note: "Hub admins give roles in Manage.",
  },
  {
    pattern: /\.permissions\.has\(|permissionsFor\(/,
    feature: "Permission bits",
    status: "partly",
    note: 'Check member.roles.cache.has("admin") or member.isHubAdmin.',
  },
  {
    pattern: /\.(setActivity|setPresence|setStatus)\(|presence\s*:/,
    feature: "Presence",
    status: "unsupported",
    note: "Remove it; Hubs bots have no status line.",
  },
  {
    pattern: /\.(setImage|setThumbnail)\(|iconURL\s*:/,
    feature: "Embed pictures",
    status: "unsupported",
    note: "Hubs never loads pictures from other sites in embeds.",
  },
  {
    pattern:
      /new\s+(EmbedBuilder|ButtonBuilder|ActionRowBuilder|StringSelectMenuBuilder|ModalBuilder|TextInputBuilder|SlashCommandBuilder)\b/,
    feature: "Builder",
    status: "maps",
    note: "Same builder on Hubs.",
  },
  {
    pattern:
      /new\s+(UserSelectMenuBuilder|RoleSelectMenuBuilder|ChannelSelectMenuBuilder|MentionableSelectMenuBuilder)\b/,
    feature: "Builder",
    status: "unsupported",
    note: "Use a string select menu or a slash command option.",
  },
  {
    pattern:
      /\.(addSubcommand|addSubcommandGroup|addRoleOption|addMentionableOption|addChannelTypes|getSubcommand|getSubcommandGroup|getRole|getMentionable)\(/,
    feature: "Command option",
    status: "maps",
    note: "Same on Hubs. Roles are the hub's community roles; channel types are text, voice and announcement.",
  },
  {
    pattern:
      /new\s+ContextMenuCommandBuilder\b|\.isContextMenuCommand\(|targetMessage|targetUser/,
    feature: "Context menu command",
    status: "maps",
    note: "Message and user commands show in the Apps part of the message and profile menus.",
  },
  {
    pattern: /\.addAttachmentOption\(|\.getAttachment\(/,
    feature: "Command option",
    status: "maps",
    note: "The person picks a file; the bot gets an address that works for 10 minutes.",
  },
  {
    pattern:
      /\.setDMPermission\(|\.setContexts\(|\.setIntegrationTypes\(|dm_permission|integration_types/,
    feature: "Commands in direct messages",
    status: "maps",
    note: "Global commands only: in DMs with the bot, or anywhere for people who added the bot to their account.",
  },
  {
    pattern: /verifyKey\(|discord-interactions|InteractionResponseType/,
    feature: "HTTP interactions",
    status: "partly",
    note: "Use verifyKey or handleInteractionRequest from the kit with the public key from the developer portal; answers use Hubs names, not numbers.",
  },
  {
    pattern: /\.setDefaultMemberPermissions\(/,
    feature: "Command permissions",
    status: "partly",
    note: "Any permission bits mean the hub's owner and admins only; hub admins can change it per command.",
  },
  {
    pattern:
      /\.(reply|deferReply|editReply|followUp|showModal|update|deferUpdate|respond)\(/,
    feature: "Interaction answer",
    status: "maps",
    note: "Same call on Hubs.",
  },
  {
    pattern: /\.(fetchReply|deleteReply)\(|fetchReply\s*:|withResponse\s*:/,
    feature: "Reply fetch or delete",
    status: "unsupported",
    note: "followUp and editReply return the message.",
  },
  {
    pattern: /\.(react|edit|delete)\(/,
    feature: "Message action",
    status: "partly",
    note: "Unicode emoji only; a bot edits and deletes only its own messages.",
  },
  {
    pattern: /\.send\(/,
    feature: "Send",
    status: "partly",
    note: "Channels map; direct messages to users do not.",
  },
  {
    pattern: /files\s*:|attachments\s*:|AttachmentBuilder/,
    feature: "Files",
    status: "unsupported",
    note: "Bots cannot upload files on Hubs yet; link to them.",
  },
  {
    pattern: /allowedMentions/,
    feature: "allowedMentions",
    status: "unsupported",
    note: "Remove it; Hubs bots never ping @everyone or roles.",
  },
  {
    pattern:
      /create\w*Collector\(|await(Messages|Reactions|MessageComponent)\(/,
    feature: "Collectors",
    status: "unsupported",
    note: "Use client events and match ids.",
  },
  {
    pattern:
      /\.(startThread|pin|unpin|crosspost|sendTyping|createWebhook|createInvite)\(|\.threads\b|joinVoiceChannel|@discordjs\/voice/,
    feature: "Threads, pins, typing, webhooks, invites, voice",
    status: "unsupported",
    note: "Not available to Hubs bots.",
  },
  {
    pattern:
      /Routes\.(applicationCommands|applicationGuildCommands|channelMessages|channelMessage)\b/,
    feature: "REST route",
    status: "maps",
    note: "Routes maps these to Hubs paths.",
  },
  {
    pattern: /\b\d{17,20}\b/,
    feature: "Discord id",
    status: "partly",
    note: "Hubs ids are UUIDs. Map it with hubs.idMap or hubs.names.",
  },
];

export function checkDiscordBotSource(source: string): PortFinding[] {
  const findings: PortFinding[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    for (const rule of RULES)
      if (rule.pattern.test(text))
        findings.push({
          feature: rule.feature,
          status: rule.status,
          line: index + 1,
          note: rule.note,
        });
  });
  return findings;
}

/** A short plain text report of the findings. */
export function formatPortReport(findings: PortFinding[]) {
  const count = (status: PortStatus) =>
    findings.filter((f) => f.status === status).length;
  const lines = [
    `Maps: ${count("maps")}, partly maps: ${count("partly")}, does not map: ${count("unsupported")}.`,
  ];
  for (const status of ["unsupported", "partly"] as PortStatus[])
    for (const finding of findings.filter((f) => f.status === status))
      lines.push(
        `line ${finding.line}: ${status === "unsupported" ? "does not map" : "partly maps"}: ${finding.feature}. ${finding.note}`,
      );
  return lines.join("\n");
}
