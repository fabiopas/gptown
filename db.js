const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "gptown.db");

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _initSchema();
  }
  return _db;
}

function _initSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT    UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT   NOT NULL,
      is_admin     INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL DEFAULT 'New chat',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT    NOT NULL CHECK(role IN ('user','assistant','system')),
      content         TEXT    NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS prompt_templates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      system_text TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_conv_user    ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_conv     ON messages(conversation_id, created_at ASC);

    INSERT OR IGNORE INTO prompt_templates (id, name, system_text) VALUES
      ('none',    'None',    ''),
      ('code',    'Code',    ''),
      ('obsidian','Obsidian',''),
      ('text',    'Text',    '');
  `);
}

/* ── Template defaults ────────────────────────────────────── */
const TEMPLATE_DEFAULTS = {
  none: "",

  code: `You are an expert software engineer operating at the level of a senior Anthropic engineer. \
You produce production-quality code with no placeholders, no stubs, and no "TODO" shortcuts unless \
explicitly asked for them.

## Core identity
- You think carefully before writing any code. When a task is ambiguous, reason through the design \
first, then implement.
- You never guess at APIs or library signatures. If you are uncertain, say so and propose the safest \
known approach.
- You treat every change as if it will be code-reviewed by the most senior engineer on the team.

## Task process
1. **Understand first.** Re-read the full request and any provided code/context before writing a single \
line. Identify edge cases, failure modes, and security implications upfront.
2. **Think through the design.** Consider alternative approaches and briefly state why you chose the one \
you did (trade-offs: readability, performance, safety, maintainability).
3. **Implement completely.** Write the full, working solution — not a skeleton. Every function must \
have a real body.
4. **Verify mentally.** Walk through your own output for off-by-one errors, null/undefined access, \
unhandled promise rejections, and type mismatches before presenting it.
5. **Surface issues proactively.** If you notice a bug, security hole, or design smell in the \
surrounding code, flag it — even if the user didn't ask.

## Code conventions
- Match the style, naming conventions, and patterns of the existing codebase exactly.
- Never import or use a library that is not already present unless you explicitly call it out and \
justify it.
- Prefer explicit over implicit: no magic numbers, no undocumented side effects.
- Keep functions small and single-purpose. Prefer composition over inheritance.
- Write error handling for every I/O operation, async call, and external dependency.
- Default to strict null-checks; never use non-null assertions silently.

## Security
- Never write code that could enable SQL injection, XSS, SSRF, path traversal, or remote code execution.
- Sanitise and validate all external input before it touches business logic or storage.
- Use constant-time comparison for secrets and tokens.
- Flag any security concern you see in code you're asked to modify.

## Output format
- Use GitHub-flavoured Markdown with fenced code blocks and the correct language tag.
- State the file path above each code block when modifying existing files: \`path/to/file.ts\`.
- Be concise in prose — every sentence must earn its place. No filler phrases like "Certainly!" or \
"Great question!".
- If changes span multiple files, list them in dependency order (dependencies first).
- When you omit unchanged code for brevity, use a clear comment: \`// ... rest unchanged\`.

## What you never do
- Never invent function signatures, module exports, or config keys you haven't seen in the provided \
context.
- Never truncate a code block mid-implementation — if it gets long, split it across clearly labelled \
sections.
- Never suggest "just use X library" without showing the concrete integration code.
- Never leave debugging artefacts (console.log, print statements, commented-out code) in final output.`,

  obsidian: `You are an Obsidian writing assistant. Structure outputs in clear Markdown with headings, \
wikilinks, and reusable note patterns. Prefer atomic notes, evergreen titles, and explicit MOC \
(Map of Content) references where useful.`,

  text: `You are an average Bachelor of Business Administration student with average knowledge of English. Focus on clear plain-language writing, short paragraphs, \
and direct answers. No fluff, no filler phrases.`,
};

function seedTemplateDefaults() {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE prompt_templates SET system_text = ? WHERE id = ? AND system_text = ''"
  );
  for (const [id, text] of Object.entries(TEMPLATE_DEFAULTS)) {
    stmt.run(text, id);
  }
}

/* ── Seeding ──────────────────────────────────────────────── */
async function seedAdminIfEmpty(username, password) {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;
  const hash = await bcrypt.hash(password, 10);
  db.prepare(
    "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)"
  ).run(username, hash);
  console.log(`Created admin user: ${username}`);
}

/* ── Auth ─────────────────────────────────────────────────── */
async function verifyPassword(username, password) {
  const user = getDb()
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? user : null;
}

async function changePassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10);
  getDb()
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(hash, userId);
}

/* ── Users ────────────────────────────────────────────────── */
function getAllUsers() {
  return getDb()
    .prepare(
      "SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC"
    )
    .all();
}

function getUserById(id) {
  return getDb()
    .prepare("SELECT id, username, is_admin, created_at FROM users WHERE id = ?")
    .get(id);
}

async function createUser(username, password, isAdmin = false) {
  const hash = await bcrypt.hash(password, 10);
  const result = getDb()
    .prepare(
      "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)"
    )
    .run(username, hash, isAdmin ? 1 : 0);
  return result.lastInsertRowid;
}

function deleteUser(id) {
  return getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
}

/* ── Conversations ────────────────────────────────────────── */
function getConversations(userId) {
  return getDb()
    .prepare(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC"
    )
    .all(userId);
}

function getConversation(id, userId) {
  return getDb()
    .prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
    .get(id, userId);
}

function createConversation(id, userId, title = "New chat") {
  getDb()
    .prepare(
      "INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)"
    )
    .run(id, userId, title);
  return getConversation(id, userId);
}

function updateConversationTitle(id, userId, title) {
  getDb()
    .prepare(
      "UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?"
    )
    .run(title, id, userId);
}

function touchConversation(id) {
  getDb()
    .prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?")
    .run(id);
}

function deleteConversation(id, userId) {
  getDb()
    .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
    .run(id, userId);
}

/* ── Messages ─────────────────────────────────────────────── */
function getMessages(conversationId) {
  return getDb()
    .prepare(
      "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
    )
    .all(conversationId);
}

function addMessage(conversationId, role, content) {
  return getDb()
    .prepare(
      "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)"
    )
    .run(conversationId, role, content);
}

/* ── Prompt templates ─────────────────────────────────────── */
function getPromptTemplates() {
  return getDb()
    .prepare("SELECT id, name FROM prompt_templates ORDER BY CASE id WHEN 'none' THEN 0 ELSE 1 END, name ASC")
    .all();
}

function getPromptTemplateById(id) {
  return getDb()
    .prepare("SELECT id, name, system_text FROM prompt_templates WHERE id = ?")
    .get(id);
}

function getPromptTemplatesWithPrompts() {
  return getDb()
    .prepare(
      "SELECT id, name, system_text FROM prompt_templates ORDER BY CASE id WHEN 'none' THEN 0 ELSE 1 END, name ASC"
    )
    .all();
}

function updatePromptTemplateSystemText(id, systemText) {
  const result = getDb()
    .prepare("UPDATE prompt_templates SET system_text = ? WHERE id = ?")
    .run(systemText, id);
  return result.changes > 0;
}

module.exports = {
  seedAdminIfEmpty,
  seedTemplateDefaults,
  verifyPassword,
  changePassword,
  getAllUsers,
  getUserById,
  createUser,
  deleteUser,
  getConversations,
  getConversation,
  createConversation,
  updateConversationTitle,
  touchConversation,
  deleteConversation,
  getMessages,
  addMessage,
  getPromptTemplates,
  getPromptTemplateById,
  getPromptTemplatesWithPrompts,
  updatePromptTemplateSystemText,
};
