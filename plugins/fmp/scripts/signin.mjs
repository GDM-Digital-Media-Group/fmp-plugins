// Sign-in for the fmp plugin, used by /fmp:sign-in. Node built-ins only.
//
//   node signin.mjs start      -> {code, url}          shows a code, opens the approve page
//   node signin.mjs finish     -> {status: "ok", account} | {status: "pending" | "expired"}
//   node signin.mjs status     -> {signedIn, account}  no network
//   node signin.mjs sign-out   -> {signedOut: true}    revokes the sign-in, then removes it
//
// The person types the code on the FixMyPrompt page and approves it there; the
// code is never put in a URL. The secret FixMyPrompt returns can only read the
// person's pages and session note, and is kept in fmp/plugin.json under
// CLAUDE_CONFIG_DIR (or ~/.claude), mode 0600. FMP_PLUGIN_BASE is read only by
// start, and only when it is https, or http on a 127.x.x.x address.
import { lstatSync, mkdirSync, openSync, writeSync, closeSync, chmodSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { allowedBase, fmpDir, pluginFilePath, readJsonFile, readPluginFile, SECRET_PREFIX } from "./context.mjs";

const DEFAULT_BASE = "https://fixmyprompt.net";
const POLL_EVERY_MS = 3000;
const POLL_FOR_MS = 100_000;
const REQUEST_TIMEOUT_MS = 10_000;

const signinFilePath = () => path.join(fmpDir(), "plugin-signin.json");

function print(v) {
  process.stdout.write(JSON.stringify(v) + "\n");
}

function lstatOrNull(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

function removeFile(file) {
  try {
    const st = lstatSync(file);
    if (st.isFile() || st.isSymbolicLink()) unlinkSync(file);
  } catch {
    // already gone
  }
}

/** Writes JSON through a temp file and a rename, mode 0600, in a 0700 fmp folder. */
function writePrivate(file, value) {
  const dir = path.dirname(file);
  const ds = lstatOrNull(dir);
  if (ds && !ds.isDirectory()) throw new Error("fmp_dir_not_a_folder");
  if (!ds) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const existing = lstatOrNull(file);
  if (existing && !existing.isFile()) throw new Error("not_a_file");
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, JSON.stringify(value, null, 2) + "\n");
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (err) {
    removeFile(tmp);
    throw err;
  }
}

/** Opens a URL in the browser, detached; any failure is ignored. */
function openBrowser(url) {
  try {
    let cmd;
    let args;
    if (process.platform === "darwin") [cmd, args] = ["open", [url]];
    else if (process.platform === "win32") [cmd, args] = ["cmd", ["/c", "start", "", url]];
    else [cmd, args] = ["xdg-open", [url]];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is printed too, so the person can open it by hand.
  }
}

async function request(base, pathname, init = {}) {
  return fetch(new URL(pathname, base), {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cmdStart() {
  const raw = process.env.FMP_PLUGIN_BASE;
  const base = raw ? allowedBase(raw) : DEFAULT_BASE;
  if (!base) {
    print({ error: "base_refused" });
    process.exit(2);
  }
  let body;
  try {
    const res = await request(base, "/api/plugin/signin", { method: "POST" });
    if (res.status === 429) {
      print({ error: "rate_limited" });
      process.exit(1);
    }
    if (res.status !== 200) throw new Error("bad_status");
    body = await res.json();
  } catch {
    print({ error: "unavailable" });
    process.exit(1);
  }
  if (!body || typeof body.code !== "string" || typeof body.poll !== "string" || !/^[A-Z]{4}-[A-Z]{4}$/.test(body.code)) {
    print({ error: "unavailable" });
    process.exit(1);
  }
  const expiresIn = Number.isFinite(body.expiresIn) && body.expiresIn > 0 ? Math.min(body.expiresIn, 3600) : 600;
  try {
    writePrivate(signinFilePath(), { poll: body.poll, base, expires: new Date(Date.now() + expiresIn * 1000).toISOString() });
  } catch {
    print({ error: "cannot_save" });
    process.exit(1);
  }
  // The approve page on the same base, never a URL from the answer.
  const url = new URL("/app/plugin", base).toString();
  openBrowser(url);
  print({ code: body.code, url });
}

async function cmdFinish() {
  const file = signinFilePath();
  const pending = readJsonFile(file);
  const base = pending ? allowedBase(pending.base) : null;
  if (!pending || !base || typeof pending.poll !== "string") {
    removeFile(file);
    return print({ status: "expired" });
  }
  const expires = Date.parse(pending.expires);
  const end = Math.min(Date.now() + POLL_FOR_MS, Number.isFinite(expires) ? expires : Date.now() + POLL_FOR_MS);
  for (let first = true; first || Date.now() < end; first = false) {
    if (!first) await sleep(POLL_EVERY_MS);
    let res;
    let body = null;
    try {
      res = await request(base, "/api/plugin/signin/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poll: pending.poll }),
      });
      body = await res.json().catch(() => null);
    } catch {
      continue; // network trouble: try again until the time is up
    }
    if (res.status === 200 && body && body.status === "ok") {
      const secret = body.token;
      if (typeof secret !== "string" || !secret.startsWith(SECRET_PREFIX)) break;
      const account = typeof body.account?.name === "string" ? body.account.name : "your account";
      try {
        writePrivate(pluginFilePath(), { secret, base, account, at: new Date().toISOString() });
      } catch {
        print({ error: "cannot_save" });
        process.exit(1);
      }
      removeFile(file);
      return print({ status: "ok", account });
    }
    if (res.status === 410) {
      removeFile(file);
      return print({ status: "expired" });
    }
    // 202 pending, 429 or a passing error: wait and ask again.
  }
  if (Number.isFinite(expires) && Date.now() >= expires) {
    removeFile(file);
    return print({ status: "expired" });
  }
  print({ status: "pending" });
}

function cmdStatus() {
  const signIn = readPluginFile();
  print({ signedIn: Boolean(signIn), account: signIn ? signIn.account : null });
}

async function cmdSignOut() {
  const file = pluginFilePath();
  const signIn = readPluginFile(file);
  if (signIn) {
    try {
      await request(signIn.base, "/api/plugin/token", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${signIn.secret}` },
      });
    } catch {
      // Best effort: the file goes either way, and Settings can revoke it.
    }
  }
  removeFile(file);
  removeFile(signinFilePath());
  print({ signedOut: true });
}

const [cmd] = process.argv.slice(2);
try {
  if (cmd === "start") await cmdStart();
  else if (cmd === "finish") await cmdFinish();
  else if (cmd === "status") cmdStatus();
  else if (cmd === "sign-out") await cmdSignOut();
  else {
    print({ error: "usage", commands: ["start", "finish", "status", "sign-out"] });
    process.exit(2);
  }
} catch {
  print({ error: "failed" });
  process.exit(1);
}
process.exit(0);
