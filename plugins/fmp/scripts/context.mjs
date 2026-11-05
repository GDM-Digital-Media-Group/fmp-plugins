// The fmp plugin's one network reader, for the session-start hook.
//
// Once the plugin is signed in (signin.mjs), fmp/plugin.json under
// CLAUDE_CONFIG_DIR (or ~/.claude) holds a read-only secret and the base it
// was issued by. fetchContext asks only that base for this person's approved
// company pages and session note for the folder. It never writes a note and
// never sends the secret anywhere but the stored base. Node built-ins only.
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const SECRET_PREFIX = "fmpc_";
const SOURCES = ["startup", "resume", "clear", "compact"];
const MAX_FILE_BYTES = 4096;
const MAX_BODY_CHARS = 64_000;

export function configDir() {
  return path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"));
}

export function fmpDir() {
  return path.join(configDir(), "fmp");
}

export function pluginFilePath() {
  return path.join(fmpDir(), "plugin.json");
}

/**
 * The origin of an allowed base, or null. Allowed: https on fixmyprompt.net
 * or one of its subdomains, or http on a 127.x.x.x address (a local server for
 * testing). Any other host is refused, so a project setting cannot point the
 * sign-in or the hook at someone else's server.
 */
export function allowedBase(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === "https:" && /^(?:[a-z0-9-]+\.)*fixmyprompt\.net$/.test(u.hostname)) return u.origin;
  if (u.protocol === "http:" && /^127\.\d+\.\d+\.\d+$/.test(u.hostname)) return u.origin;
  return null;
}

/** A small regular file's JSON, or null. Symlinks and folders are refused. */
export function readJsonFile(file) {
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The stored sign-in, or null when there is none or it does not look right. */
export function readPluginFile(file = pluginFilePath()) {
  const v = readJsonFile(file);
  if (!v || typeof v !== "object") return null;
  const base = allowedBase(v.base);
  if (!base || typeof v.secret !== "string" || !v.secret.startsWith(SECRET_PREFIX) || v.secret.length > 200) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(v.secret)) return null;
  return { secret: v.secret, base, account: typeof v.account === "string" ? v.account : null, at: typeof v.at === "string" ? v.at : null };
}

/**
 * The session text for this folder: { text } on a good answer, { signedOut: true }
 * on 401, null on anything else (another status, a bad body, a timeout, no network).
 */
export async function fetchContext({ file, folder, source, timeoutMs = 3000 }) {
  try {
    const base = allowedBase(file?.base);
    if (!base || typeof file.secret !== "string") return null;
    const url = new URL("/api/plugin/context", base);
    if (folder) url.searchParams.set("folder", String(folder).slice(0, 1000));
    url.searchParams.set("source", SOURCES.includes(source) ? source : "startup");
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${file.secret}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) return { signedOut: true };
    if (res.status !== 200) return null;
    const raw = await res.text();
    if (raw.length > MAX_BODY_CHARS) return null;
    const body = JSON.parse(raw);
    if (!body || typeof body.text !== "string") return null;
    return { text: body.text };
  } catch {
    return null;
  }
}
