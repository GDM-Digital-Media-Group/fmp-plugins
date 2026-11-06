# FixMyPrompt plugins for Claude Code

This marketplace holds one plugin, `fmp`. It connects Claude Code to your FixMyPrompt memories, so a session can start from what you already worked out for a folder instead of working it out again.

Using it needs a FixMyPrompt account on the Pro plan, since memories over MCP are part of Pro.

## Install

In Claude Code, run:

```
/plugin marketplace add GDM-Digital-Media-Group/fmp-plugins
/plugin install fmp@fmp-plugins
```

Then restart Claude Code so the plugin loads.

## Sign in

The plugin adds an MCP server named `fmp` that points at `https://fixmyprompt.net/api/mcp`. Nothing secret is stored in the plugin files.

The first time Claude Code uses it, run `/mcp`, pick `fmp`, and choose to sign in. Your browser opens FixMyPrompt, you approve the connection, and you are done. You only do this once per machine.

## What the hook does

When a session starts, a small hook adds context for Claude. It starts with this line:

> This folder is `<folder name>`. Before you start work, call the fmp mem_index tool with project "`<folder name>`" and use what it lists.

The folder name is the last part of the folder Claude Code was opened in. Claude then asks FixMyPrompt for a short index of the memories saved for that folder and fetches a full memory only when one fits the task. If nothing is saved for the folder yet, the index says so and nothing is created.

Until you sign the plugin in, the hook reads no files, holds no credentials and makes no network call. Once you run `/fmp:sign-in`, the hook also fetches your company pages and your session note for this folder from FixMyPrompt at session start and after each compact, and puts them in directly, so Claude does not have to look them up. The sign-in is kept in `~/.claude/fmp/plugin.json` on this machine, is tied to one FixMyPrompt account, can only read your pages and session note, and can be revoked in FixMyPrompt under Settings, MCP connections.

## Sign in the plugin

Signing in the plugin is separate from the `fmp` connection above, and only needed for company pages and session notes. Run:

```
/fmp:sign-in
```

Claude shows you an 8 letter code and opens FixMyPrompt in your browser. Check that you are in the account you want, type the code from your terminal, and press Approve. Only approve a code you just started on your own computer. Back in Claude Code, the sign-in finishes and Claude tells you which account it is signed in to.

From then on, each session starts with your company's approved pages (the company rules, your role's page and your own rules) and your session note for the folder, and they come back after each compact. Ask Claude to check the plugin sign-in to see the account, or to sign the plugin out to end it on this machine. You can also revoke it in FixMyPrompt under Settings, MCP connections. A sign-in stops working when it is revoked, when you leave the company, or after 180 days unused.

## Session note

Claude keeps one short, private note for each folder: what you are doing, decisions made, fixes that worked and what is next. It updates the note at real milestones, not every turn, and it never holds code, secrets or the conversation itself. The note is yours only; teammates in the same company never see it.

A note expires 3 days after it was last saved, unless you keep it from the Context page in FixMyPrompt, which saves it as one of your private memories. Session notes work in Claude Code only, through this plugin.

## Auto-save lessons

After that line, the hook asks Claude to save lessons on its own while it works. A lesson is a mistake, then a correction (from you, a failing test, a build error or the docs), then the version that worked. Typos and one-turn slips do not count. Claude checks what is already saved first, saves the lesson for this folder, and says one line, `Saved a lesson: <title>`, without stopping the work. It never saves code over 10 lines, secrets or the conversation itself.

Each one lands in FixMyPrompt as a draft marked "Auto-saved, needs a look". The next session already reads it. Open Memories to keep, edit, merge or delete it.

Auto-save and import are part of Pro and up. To turn auto-save off, open Settings in FixMyPrompt and turn off "Save lessons on their own". FixMyPrompt then refuses auto-saved lessons, and Claude stops trying for the rest of the session. A company owner can turn it off for the whole company.

## Import past sessions

`/fmp:import` reads your past Claude Code sessions for the current folder on this machine (the logs under `~/.claude/projects`) and saves the lessons in them as the same kind of draft. It lists the sessions from the last 30 days first and asks which to read; by default those not imported yet.

Claude reads the logs on your machine and sends FixMyPrompt only the lessons it picks, never code, logs or whole sessions. The session reader is a small script in the plugin that uses no network. It keeps a list of the sessions already imported in `~/.claude/fmp/imported-sessions.json`, on your machine only, so running the import again skips them. When it is done, Claude tells you how many lessons were saved and how many were left out, and why.

## Check your agent files

`/fmp:doctor` runs the FixMyPrompt Agent Doctor on the agent instruction files in your repo: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.cursor/rules/*` and `.github/copilot-instructions.md` in the folder and its parents, plus `~/.claude/CLAUDE.md`. It also sends `package.json` and the name of your lockfile, so the check knows your stack. It never sends source code.

Claude shows you the report, asks you a few short questions about rules your files lack (a skipped question becomes a TODO line, never a guess), then shows the full change list and writes the fixed files with its normal Edit or Write tool, so your permission settings decide whether you are asked first. Unless the repo is clean in git, each old file is copied to `<name>.fmp-backup` first.

The Agent Doctor is part of Pro.

## Turn it off

To stop the session-start hook, auto-save and the `fmp` server, disable the plugin:

```
/plugin disable fmp@fmp-plugins
```

Run `/plugin enable fmp@fmp-plugins` to turn it back on, or `/plugin uninstall fmp@fmp-plugins` to remove it.

If you want the memory tools without the session-start line, uninstall the plugin and add the server by hand instead:

```
claude mcp add --transport http fmp https://fixmyprompt.net/api/mcp
```

## Help

Questions or problems: support@fixmyprompt.net
