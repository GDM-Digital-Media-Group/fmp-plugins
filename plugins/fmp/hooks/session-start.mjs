// SessionStart hook for the fmp plugin. It runs at startup, resume, clear and
// after a compact.
//
// It only adds context: a line naming the folder, so Claude calls the fmp
// mem_index tool for it over the MCP connection it already has, then the
// live auto-save rule. The rule applies only when the fmp save_mem tool lists
// an auto_saved field, so a server without auto-save never gets lessons saved
// as ordinary memories.
//
// Until the plugin is signed in (/fmp:sign-in) it reads no files, holds no
// credentials and makes no network call: it only checks whether the sign-in
// file exists. Once signed in, it loads ../scripts/context.mjs, which asks
// FixMyPrompt for the person's company pages and session note for this
// folder, and puts that text first, followed by the session note rule.
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";

const SIGNED_OUT_LINE = "Your FixMyPrompt plugin sign-in has ended. Run /fmp:sign-in to sign in again.";
const SOURCES = ["startup", "resume", "clear", "compact"];
// Claude Code moves any hook text over 10,000 characters into a file, so stay under it.
const MAX_CONTEXT_CHARS = 10_000;
const STDIN_WAIT_MS = 500;

function liveRule(name) {
  return [
    "Saving lessons on your own: do this only if the fmp save_mem tool lists an auto_saved field. If it does not, never save on your own.",
    "While you work, watch for a lesson: a mistake, then a correction (from the person, a failing test, a build error or the docs), then the version that worked.",
    "Typos and one-turn slips are not lessons.",
    "When a lesson completes, first call the fmp similar_mem tool; if the same lesson is already saved, do not save it again.",
    `Otherwise call save_mem with auto_saved "live", kind "note", project "${name}", and the lesson's title, use_when, steps, check and avoid.`,
    "Never include code over 10 lines, never secrets (passwords, keys or tokens), and never the conversation itself.",
    "Then say one line, Saved a lesson: <title>, and do not interrupt the work.",
    "If FMP answers that auto-save is off, stop saving lessons for this session.",
  ].join(" ");
}

function noteRule(name) {
  return [
    "Keeping a session note: do this only if the fmp save_note tool is listed.",
    `Keep one short note for this folder with save_note, folder "${name}": what you are doing, decisions made, fixes that worked and what is next.`,
    "Update it after each real milestone (a decision, a fix that worked, a change of direction), not every turn.",
    "Never include code, secrets or the conversation itself.",
    "Keep it under 1,200 characters.",
    "Do not mention the note unless asked.",
  ].join(" ");
}

function folderName() {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.basename(path.resolve(dir));
}

function todayText(name) {
  return (
    `This folder is ${name}. Before you start work, call the fmp mem_index tool ` +
    `with project "${name}" and use what it lists. ` + liveRule(name)
  );
}

function signInFile() {
  const base = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"));
  return path.join(base, "fmp", "plugin.json");
}

/** The hook input's source, or startup when stdin is missing, slow or not JSON. */
function readSource() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("startup");
    let raw = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.pause();
      let source = "startup";
      try {
        const v = JSON.parse(raw);
        if (v && SOURCES.includes(v.source)) source = v.source;
      } catch {
        // not JSON: startup
      }
      resolve(source);
    };
    const timer = setTimeout(finish, STDIN_WAIT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      raw += c;
      if (raw.length > 65_536) finish();
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

/** today's text, plus the signed-in parts when there is a sign-in. */
async function context(name) {
  const today = todayText(name);
  const file = signInFile();
  if (!existsSync(file)) return today;
  try {
    const { readPluginFile, fetchContext } = await import("../scripts/context.mjs");
    const signIn = readPluginFile(file);
    if (!signIn) return today;
    const source = await readSource();
    const got = await fetchContext({ file: signIn, folder: name, source, timeoutMs: 3000 });
    if (!got) return today;
    if (got.signedOut) return `${today} ${SIGNED_OUT_LINE}`;
    const rest = `${today} ${noteRule(name)}`;
    const text = got.text.trim();
    if (!text || text.length + 2 + rest.length > MAX_CONTEXT_CHARS) return rest;
    return `${text}\n\n${rest}`;
  } catch {
    return today;
  }
}

try {
  const name = folderName();
  if (name) {
    const additionalContext = await context(name);
    const out = { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } };
    process.stdout.write(JSON.stringify(out) + "\n");
  }
} catch {
  // Never block a session over this hook.
}
process.exit(0);
