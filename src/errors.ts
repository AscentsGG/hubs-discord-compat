/*
 * Errors the port kit throws. Anything Hubs cannot do throws
 * HubsNotSupportedError with the feature's name and what to do instead, so a
 * ported bot fails loudly in testing instead of silently doing nothing.
 */

/** The porting guide, with what maps and what to do instead. */
export const PORTING_GUIDE =
  "https://github.com/AscentsGG/hubs-discord-compat/blob/main/docs/PORTING.md";

export class HubsNotSupportedError extends Error {
  readonly code = "HUBS_NOT_SUPPORTED";
  readonly feature: string;
  readonly hint: string | null;
  constructor(feature: string, hint?: string) {
    super(
      `${feature} is not supported on Hubs.${hint ? ` ${hint}` : ""} See ${PORTING_GUIDE}.`,
    );
    this.name = "HubsNotSupportedError";
    this.feature = feature;
    this.hint = hint ?? null;
  }
}

/** Throws HubsNotSupportedError. Typed `never` so callers can return it. */
export function notSupported(feature: string, hint?: string): never {
  throw new HubsNotSupportedError(feature, hint);
}

/** An error answer from the Hubs developer API, like discord.js's
 * DiscordAPIError. `code` is the Hubs code (for example BOT_SCOPE_MISSING). */
export class HubsAPIError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly method: string;
  readonly url: string;
  constructor(
    message: string,
    status: number,
    code: string | null,
    method: string,
    url: string,
  ) {
    super(message);
    this.name = "HubsAPIError";
    this.status = status;
    this.code = code;
    this.method = method;
    this.url = url;
  }
}
