const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

dotenv.config();

const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma4:e4b";
const API_KEY = process.env.API_KEY || "local-dev-key";
const UI_USER = (process.env.UI_USER || "admin").trim();
const UI_PASSWORD = (process.env.UI_PASSWORD || "changeme").trim();

/* ── Session store: token → { userId, username, isAdmin } ─── */
const sessions = new Map();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const distPath = path.join(__dirname, "client", "dist");
const hasBuiltClient = fs.existsSync(path.join(distPath, "index.html"));
if (hasBuiltClient) {
  app.use(express.static(distPath));
}

/* ── Middleware ───────────────────────────────────────────── */
function authIfNeeded(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (token !== API_KEY) {
    return res.status(401).json({ error: { message: "Invalid API key" } });
  }
  return next();
}

function requireSession(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  req.user = session;
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Forbidden" });
  return next();
}

/* ── Ollama proxy helper ──────────────────────────────────── */
async function callOllamaChat({ model, messages, stream }) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model || DEFAULT_MODEL, messages, stream }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama error ${response.status}: ${body}`);
  }

  return response;
}

/* ── Auth routes ──────────────────────────────────────────── */
app.post("/api/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  const user = await db.verifyPassword(username, password);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    isAdmin: Boolean(user.is_admin),
  });

  return res.json({ token, username: user.username, isAdmin: Boolean(user.is_admin) });
});

app.post("/api/logout", requireSession, (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  sessions.delete(token);
  return res.json({ ok: true });
});

app.get("/api/me", requireSession, (req, res) => {
  return res.json({ username: req.user.username, isAdmin: req.user.isAdmin });
});

app.post("/api/me/change-password", requireSession, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  }
  await db.changePassword(req.user.userId, newPassword);
  return res.json({ ok: true });
});

/* ── Health ───────────────────────────────────────────────── */
app.get("/health", (_req, res) => {
  res.json({ ok: true, model: DEFAULT_MODEL, ollama: OLLAMA_BASE_URL });
});

/* ── Conversations ────────────────────────────────────────── */
app.get("/api/conversations", requireSession, (req, res) => {
  return res.json(db.getConversations(req.user.userId));
});

app.post("/api/conversations", requireSession, (req, res) => {
  const id = crypto.randomUUID();
  const title = String(req.body?.title || "New chat").slice(0, 120);
  const conv = db.createConversation(id, req.user.userId, title);
  return res.json(conv);
});

app.patch("/api/conversations/:id", requireSession, (req, res) => {
  const title = String(req.body?.title || "").slice(0, 120);
  if (!title) return res.status(400).json({ error: "title required" });
  db.updateConversationTitle(req.params.id, req.user.userId, title);
  return res.json({ ok: true });
});

app.delete("/api/conversations/:id", requireSession, (req, res) => {
  db.deleteConversation(req.params.id, req.user.userId);
  return res.json({ ok: true });
});

app.get("/api/conversations/:id/messages", requireSession, (req, res) => {
  const conv = db.getConversation(req.params.id, req.user.userId);
  if (!conv) return res.status(404).json({ error: "Not found" });
  return res.json(db.getMessages(req.params.id));
});

/* ── Chat (UI) ────────────────────────────────────────────── */
app.post("/api/chat", requireSession, async (req, res) => {
  try {
    const { conversation_id, message, stream = false } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }
    if (!conversation_id) {
      return res.status(400).json({ error: "conversation_id is required" });
    }

    const conv = db.getConversation(conversation_id, req.user.userId);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    db.addMessage(conversation_id, "user", message);
    db.touchConversation(conversation_id);

    const messages = db.getMessages(conversation_id);
    const ollamaResponse = await callOllamaChat({
      model: DEFAULT_MODEL,
      messages,
      stream: Boolean(stream),
    });

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = ollamaResponse.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let fullReply = "";
      let saved = false;

      const saveReply = () => {
        if (!saved) {
          saved = true;
          if (fullReply) {
            db.addMessage(conversation_id, "assistant", fullReply);
            db.touchConversation(conversation_id);
          }
        }
      };

      res.on("close", saveReply);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (line) {
              try {
                const chunk = JSON.parse(line);
                const token = chunk.message?.content || "";
                const thinking = chunk.message?.thinking || "";
                if (token || thinking) {
                  if (token) fullReply += token;
                  res.write(`data: ${JSON.stringify({ token, thinking })}\n\n`);
                }
                if (chunk.done === true) {
                  res.write("data: [DONE]\n\n");
                }
              } catch { /* skip malformed */ }
            }

            newlineIndex = buffer.indexOf("\n");
          }
        }
      } finally {
        res.off("close", saveReply);
        saveReply();
      }

      return res.end();
    }

    const json = await ollamaResponse.json();
    const reply = json.message?.content || "";
    db.addMessage(conversation_id, "assistant", reply);
    return res.json({ reply });
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
    return res.end();
  }
});

/* ── Admin routes ─────────────────────────────────────────── */
app.get("/api/admin/users", requireSession, requireAdmin, (_req, res) => {
  return res.json(db.getAllUsers());
});

app.post("/api/admin/users", requireSession, requireAdmin, async (req, res) => {
  const { username, password, isAdmin = false } = req.body || {};
  if (!username || typeof username !== "string" || username.trim().length < 2) {
    return res.status(400).json({ error: "username must be at least 2 characters" });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: "password must be at least 4 characters" });
  }
  try {
    const id = await db.createUser(username.trim(), password, Boolean(isAdmin));
    return res.json({ id, username: username.trim(), isAdmin: Boolean(isAdmin) });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Username already taken" });
    }
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/users/:id", requireSession, requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === req.user.userId) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  db.deleteUser(targetId);
  for (const [token, session] of sessions.entries()) {
    if (session.userId === targetId) sessions.delete(token);
  }
  return res.json({ ok: true });
});

/* ── OpenAI-compatible endpoints (for Cursor etc.) ────────── */
app.get("/v1/models", authIfNeeded, (_req, res) => {
  res.json({
    object: "list",
    data: [{ id: DEFAULT_MODEL, object: "model", owned_by: "local" }],
  });
});

app.post("/v1/chat/completions", authIfNeeded, async (req, res) => {
  try {
    const { model, messages, stream } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: { message: "messages must be an array" } });
    }

    const ollamaResponse = await callOllamaChat({ model, messages, stream: Boolean(stream) });

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = ollamaResponse.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line) {
            const chunk = JSON.parse(line);
            const token = chunk.message?.content || "";
            const finish = chunk.done === true;
            const payload = {
              id: `chatcmpl-local-${Date.now()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: model || DEFAULT_MODEL,
              choices: [
                {
                  index: 0,
                  delta: token ? { content: token } : {},
                  finish_reason: finish ? "stop" : null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          }

          newlineIndex = buffer.indexOf("\n");
        }
      }

      res.write("data: [DONE]\n\n");
      return res.end();
    }

    const json = await ollamaResponse.json();
    const content = json.message?.content || "";
    return res.json({
      id: `chatcmpl-local-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model || DEFAULT_MODEL,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (error) {
    return res.status(500).json({ error: { message: error.message } });
  }
});

/* ── SPA fallback ─────────────────────────────────────────── */
if (hasBuiltClient) {
  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api") ||
      req.path.startsWith("/v1") ||
      req.path === "/health"
    ) {
      return next();
    }
    return res.sendFile(path.join(distPath, "index.html"));
  });
}

/* ── Start ────────────────────────────────────────────────── */
async function start() {
  await db.seedAdminIfEmpty(UI_USER, UI_PASSWORD);
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
