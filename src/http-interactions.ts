/*
 * Interactions over HTTPS instead of the gateway socket. Set an
 * interactions endpoint in the developer portal (Install tab); Hubs then
 * POSTs each interaction there, signed with Ed25519 over the timestamp
 * followed by the raw body (headers X-Signature-Ed25519 and
 * X-Signature-Timestamp), and reads your first answer from the response.
 *
 *   const verifier = createInteractionVerifier({ publicKey });
 *   // In your HTTP server, with the raw body as a string:
 *   const { status, body } = await handleInteractionRequest(client, verifier, {
 *     body: raw,
 *     signature: req.headers["x-signature-ed25519"],
 *     timestamp: req.headers["x-signature-timestamp"],
 *   });
 *   res.writeHead(status, { "Content-Type": "application/json" });
 *   res.end(JSON.stringify(body));
 *
 * Your interactionCreate handlers run as before; reply, deferReply,
 * showModal, update and respond become the response. Follow-ups and edits
 * still go over REST with the bot token.
 */
import { createPublicKey, verify } from "node:crypto";
import type { Client } from "./client.js";
import { createInteraction } from "./interactions.js";

type Json = Record<string, any>;

/** Ed25519 public keys as DER: this prefix, then the 32 raw bytes. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HEX = /^[0-9a-f]+$/i;

/** Discord's verifyKey: true when the signature is good. Nothing more is
 * checked here; createInteractionVerifier adds the time and replay checks. */
export function verifyKey(
  body: string | Uint8Array,
  signature: string,
  timestamp: string,
  publicKey: string,
): boolean {
  try {
    if (
      !HEX.test(signature) ||
      signature.length !== 128 ||
      !HEX.test(publicKey) ||
      publicKey.length !== 64
    )
      return false;
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.concat([
        Buffer.from(timestamp, "utf8"),
        typeof body === "string"
          ? Buffer.from(body, "utf8")
          : Buffer.from(body),
      ]),
      key,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

export interface InteractionVerifierOptions {
  /** The hex public key from the developer portal. */
  publicKey: string;
  /** How old a request may be. Hubs refuses older than 300 seconds. */
  maxAgeSeconds?: number;
  /** For tests. */
  now?: () => number;
}
export interface InteractionRequest {
  body: string;
  signature: string | string[] | null | undefined;
  timestamp: string | string[] | null | undefined;
}
export type VerifiedInteraction =
  { ok: true; interaction: Json } | { ok: false; status: 401; reason: string };

/**
 * Checks each request: a good signature, a timestamp within the window
 * (either side, for clock drift), and an interaction id not seen before in
 * that window, so a captured request cannot be played again.
 */
export function createInteractionVerifier(options: InteractionVerifierOptions) {
  const maxAge = options.maxAgeSeconds ?? 300;
  const clock = options.now ?? Date.now;
  const seen = new Map<string, number>();
  const one = (value: string | string[] | null | undefined) =>
    Array.isArray(value) ? value[0] : (value ?? "");
  return (request: InteractionRequest): VerifiedInteraction => {
    const signature = one(request.signature);
    const timestamp = one(request.timestamp);
    const refuse = (reason: string): VerifiedInteraction => ({
      ok: false,
      status: 401,
      reason,
    });
    if (!/^\d{1,12}$/.test(timestamp)) return refuse("No timestamp.");
    const now = Math.floor(clock() / 1000);
    if (Math.abs(now - Number(timestamp)) > maxAge)
      return refuse("The request is too old.");
    if (!verifyKey(request.body, signature, timestamp, options.publicKey))
      return refuse("The signature does not match.");
    let interaction: Json;
    try {
      interaction = JSON.parse(request.body);
    } catch {
      return refuse("The body is not JSON.");
    }
    const id = String(interaction?.id ?? "");
    if (!id) return refuse("The body has no id.");
    for (const [key, until] of seen) if (until < now) seen.delete(key);
    if (seen.has(id)) return refuse("This request was already handled.");
    seen.set(id, Number(timestamp) + maxAge);
    return { ok: true, interaction };
  };
}

/**
 * Answers one HTTP interaction request with the client's own handlers:
 * a PING gets PONG, anything else is emitted as interactionCreate and the
 * first answer is the response. No answer within `answerMs` (2.5 seconds by
 * default, inside Hubs's 3) gives a 500, and Hubs tells the person.
 */
export async function handleInteractionRequest(
  client: Client,
  verifier: ReturnType<typeof createInteractionVerifier>,
  request: InteractionRequest,
  options: { answerMs?: number } = {},
): Promise<{ status: number; body: Json }> {
  const verified = verifier(request);
  if (!verified.ok)
    return { status: verified.status, body: { error: verified.reason } };
  const data = verified.interaction;
  if (data.type === "ping") return { status: 200, body: { type: "pong" } };
  if (data.hubId) client.guilds.ensure(String(data.hubId));
  const interaction = createInteraction(client, data);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answer = await Promise.race([
    new Promise<Json>((resolve) => {
      interaction.inlineAnswer = resolve;
      client.emit("interactionCreate", interaction);
    }),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), options.answerMs ?? 2_500);
    }),
  ]);
  clearTimeout(timer);
  if (!answer) {
    interaction.inlineAnswer = null;
    return { status: 500, body: { error: "No answer in time." } };
  }
  return { status: 200, body: answer };
}
