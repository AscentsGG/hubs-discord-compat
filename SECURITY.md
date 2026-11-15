# Security

If you find a security problem in this code, please tell us privately first, so we can fix it before it can hurt anyone.

## How to report

- Use **Report a vulnerability** on this repository's Security tab (GitHub's private reporting), or
- email **security@thehubs.gg**.

Please include what you found, how to reproduce it, and which part of the code it touches. A failing test is the most useful thing you can send.

We read every report. We will tell you when we have confirmed the problem, keep you updated while we fix it, and credit you when the fix ships unless you would rather we didn't.

## What counts

Anything in this package that could let someone act as a bot they don't control, get a bot's token, get past the signature check on interactions sent over HTTPS (`verifyKey`, `createInteractionVerifier`, `handleInteractionRequest`), replay an old interaction, or make a bot do something its code didn't ask for.

## What doesn't

Problems in the rest of Hubs (the website, the apps, the bot platform or the server) are welcome too, but please send them to the same address rather than opening an issue here.

Please don't test against other people's accounts, hubs or bots, and don't run load or denial of service tests against our servers.
