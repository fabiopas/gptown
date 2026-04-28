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

    CREATE INDEX IF NOT EXISTS idx_conv_user    ON conversations(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_conv     ON messages(conversation_id, created_at ASC);
  `);
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

module.exports = {
  seedAdminIfEmpty,
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
};
