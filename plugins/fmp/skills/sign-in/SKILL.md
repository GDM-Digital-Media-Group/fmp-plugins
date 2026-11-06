---
name: sign-in
description: Sign the fmp plugin in to FixMyPrompt, so each session starts with the person's company pages and their session note for the folder. Use when the person asks to sign the plugin in, check its sign-in, or sign it out.
---

Sign the fmp plugin in to the person's FixMyPrompt account. Once signed in, the session-start hook adds their approved company pages and their session note for this folder at the start of each session and after each compact. The sign-in can only read those; it never writes anything.

The commands below use `${CLAUDE_PLUGIN_ROOT}`, the fmp plugin's folder. Claude Code fills it in. In other apps, such as Codex, it is the folder two levels above this SKILL.md: put that path in its place before you run a command.

If the person asks whether the plugin is signed in, run only `status` (step 4). If they ask to sign out, run only `sign-out` (step 5).

## 1. Start

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/signin.mjs" start
```

It prints one JSON line with `code` (shown as `XXXX-XXXX`) and `url`, and opens that page in the browser. If it prints `error`, tell the person it could not start the sign-in and to try again in a minute; with `base_refused`, say the FMP_PLUGIN_BASE setting is not allowed and stop.

## 2. Ask the person to approve

Show the person the code and the URL. Ask them to open the page if it did not open, check that they are in the FixMyPrompt account they want, type the code from the terminal (the page never fills it in) and press Approve. Tell them to approve only a code they just started here themselves. Wait for them to say they are done.

## 3. Finish

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/signin.mjs" finish
```

It checks every few seconds for up to 100 seconds and prints one JSON line:

- `{"status": "ok", "account": ...}`: say the plugin is signed in to that account, and that the next session (or the next compact) starts with their pages and session note.
- `pending`: the code was not approved yet. Ask the person to approve it, then run `finish` once more. If it is still `pending`, tell them to run the fmp sign-in again (/fmp:sign-in in Claude Code).
- `expired`: the code ran out or was already used. Tell them to run the fmp sign-in again (/fmp:sign-in in Claude Code).

Never show the secret the sign-in saves, and never copy it anywhere.

## 4. Status

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/signin.mjs" status
```

It prints `signedIn` and the `account` name, from this machine only.

## 5. Sign out

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/signin.mjs" sign-out
```

It ends the sign-in at FixMyPrompt when it can, then removes it from this machine, and prints `{"signedOut": true}`. A sign-in can also be revoked in FixMyPrompt under Settings, MCP connections.
