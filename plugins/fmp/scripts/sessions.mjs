// Session reader for /fmp:import.
//
// Reads Claude Code session logs on this machine (projects/*/*.jsonl under
// CLAUDE_CONFIG_DIR, or ~/.claude) so Claude can pick lessons out of them.
// Node built-ins only and no network: nothing here sends anything anywhere.
// The only file it writes is the imported-sessions record in fmp/ under the
// same base folder, kept on this machine.
//
//   node sessions.mjs list [--all] [--days N]
//   node sessions.mjs read <id>
//   node sessions.mjs mark <id...>
import { lstatSync, readdirSync, readFileSync, openSync, writeSync, closeSync, renameSync, mkdirSync, chmodSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const ID_RE = /^[0-9a-f-]{36}$/;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_LIST = 200;
const DEFAULT_DAYS = 30;
const MSG_MAX = 2000;
const ERROR_MAX = 500;
const TOTAL_MAX = 60_000;
const CODE_MAX_LINES = 20;

const base = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"));
const projectsDir = path.join(base, "projects");
const fmpDir = path.join(base, "fmp");
const recordFile = path.join(fmpDir, "imported-sessions.json");

function fail(code = 1) {
  process.exit(code);
}

function lstatOrNull(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

/** Every session file: real files only, no symlinked files or folders, none over 50 MB. */
function sessionFiles() {
  const out = [];
  const top = lstatOrNull(projectsDir);
  if (!top || !top.isDirectory()) return out;
  let dirs = [];
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return out;
  }
  for (const d of dirs) {
    const dir = path.join(projectsDir, d);
    const ds = lstatOrNull(dir);
    if (!ds || !ds.isDirectory()) continue;
    let files = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const id = f.slice(0, -".jsonl".length);
      if (!ID_RE.test(id)) continue;
      const file = path.join(dir, f);
      const st = lstatOrNull(file);
      if (!st || !st.isFile() || st.size > MAX_FILE_BYTES) continue;
      out.push({ id, file, mtime: st.mtime });
    }
  }
  return out;
}

/** Parsed lines; a malformed line is skipped, never fatal. */
function readLines(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && typeof o === "object") rows.push(o);
    } catch {
      // skip
    }
  }
  return rows;
}

function collapseCode(text) {
  return text.replace(/```[^\n]*\n([\s\S]*?)```/g, (whole, inner) => {
    const body = inner.replace(/\n$/, "");
    const n = body === "" ? 0 : body.split("\n").length;
    return n > CODE_MAX_LINES ? `[code block, ${n} lines]` : whole;
  });
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((c) => c && c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
  }
  return "";
}

/** One condensed message, or null when nothing in it is kept. */
function condense(row) {
  if (row.type !== "user" && row.type !== "assistant") return null;
  if (row.isSidechain === true || row.isMeta === true) return null;
  const content = row.message && row.message.content;
  const parts = [];
  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
      else if (c.type === "tool_result" && c.is_error === true) {
        const t = resultText(c.content).slice(0, ERROR_MAX);
        if (t.trim()) parts.push(`[tool error] ${t}`);
      }
      // thinking, tool_use inputs, images and ok tool results are dropped.
    }
  }
  const text = collapseCode(parts.join("\n").trim());
  if (!text) return null;
  const clipped = text.length > MSG_MAX ? `${text.slice(0, MSG_MAX - 12)} [clipped]` : text;
  return { role: row.type === "user" ? "Person" : "AI", text: clipped };
}

function summarize(entry) {
  const rows = readLines(entry.file);
  let cwd = null;
  let started = null;
  let messages = 0;
  for (const r of rows) {
    if (!cwd && typeof r.cwd === "string") cwd = r.cwd;
    if (typeof r.timestamp === "string" && !Number.isNaN(Date.parse(r.timestamp))) {
      if (!started || Date.parse(r.timestamp) < Date.parse(started)) started = new Date(r.timestamp).toISOString();
    }
    if (condense(r)) messages++;
  }
  return { id: entry.id, cwd, started: started ?? entry.mtime.toISOString(), messages };
}

function loadRecord() {
  const st = lstatOrNull(recordFile);
  if (!st || !st.isFile()) return { version: 1, sessions: {} };
  try {
    const o = JSON.parse(readFileSync(recordFile, "utf8"));
    if (o && o.version === 1 && o.sessions && typeof o.sessions === "object" && !Array.isArray(o.sessions)) {
      const sessions = {};
      for (const [k, v] of Object.entries(o.sessions)) if (ID_RE.test(k) && typeof v === "string") sessions[k] = v;
      return { version: 1, sessions };
    }
  } catch {
    // a broken record starts fresh
  }
  return { version: 1, sessions: {} };
}

function currentFolder() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function cmdList(args) {
  const all = args.includes("--all");
  let days = DEFAULT_DAYS;
  const i = args.indexOf("--days");
  if (i !== -1) {
    const n = Number(args[i + 1]);
    if (!Number.isFinite(n) || n <= 0) fail(2);
    days = n;
  }
  const here = currentFolder();
  const since = Date.now() - days * 86_400_000;
  const record = loadRecord();
  const sessions = [];
  for (const entry of sessionFiles()) {
    const s = summarize(entry);
    if (!s.cwd) continue;
    if (!all && path.resolve(s.cwd) !== here) continue;
    if (Date.parse(s.started) < since) continue;
    sessions.push({ ...s, imported: Boolean(record.sessions[s.id]) });
  }
  sessions.sort((a, b) => Date.parse(b.started) - Date.parse(a.started));
  process.stdout.write(JSON.stringify({ run: randomUUID(), sessions: sessions.slice(0, MAX_LIST) }) + "\n");
}

function cmdRead(args) {
  const id = args[0];
  if (args.length !== 1 || typeof id !== "string" || !ID_RE.test(id)) fail(2);
  const entry = sessionFiles().find((e) => e.id === id);
  if (!entry) fail(1);
  const rows = readLines(entry.file);
  const cwd = rows.find((r) => typeof r.cwd === "string")?.cwd ?? "unknown";
  const END = "\n[transcript cut at 60,000 characters]\n";
  let out = `Session ${id} in ${cwd}\n`;
  for (const r of rows) {
    const m = condense(r);
    if (!m) continue;
    const block = `\n${m.role}: ${m.text}\n`;
    if (out.length + block.length > TOTAL_MAX - END.length) {
      out += block.slice(0, Math.max(0, TOTAL_MAX - END.length - out.length)) + END;
      break;
    }
    out += block;
  }
  process.stdout.write(out);
}

function cmdMark(args) {
  if (args.length === 0 || !args.every((a) => ID_RE.test(a))) fail(2);
  const dirStat = lstatOrNull(fmpDir);
  if (dirStat && !dirStat.isDirectory()) fail(1);
  if (!dirStat) mkdirSync(fmpDir, { recursive: true, mode: 0o700 });
  const existing = lstatOrNull(recordFile);
  if (existing && !existing.isFile()) fail(1);
  const record = loadRecord();
  const now = new Date().toISOString();
  for (const id of args) record.sessions[id] = now;
  const tmp = path.join(fmpDir, `.imported-sessions.${process.pid}.${randomUUID()}.tmp`);
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, JSON.stringify(record, null, 2) + "\n");
    } finally {
      closeSync(fd);
    }
    chmodSync(tmp, 0o600);
    renameSync(tmp, recordFile);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean
    }
    fail(1);
  }
  process.stdout.write(JSON.stringify({ marked: args.length }) + "\n");
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "list") cmdList(rest);
  else if (cmd === "read") cmdRead(rest);
  else if (cmd === "mark") cmdMark(rest);
  else fail(2);
} catch {
  fail(1);
}
