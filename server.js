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

function logRouteError(route, error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : "";
  const cause = error instanceof Error ? error.cause : undefined;
  let causeDetails = "";
  if (cause && typeof cause === "object") {
    const code = cause.code ? ` code=${cause.code}` : "";
    const errno = cause.errno ? ` errno=${cause.errno}` : "";
    const syscall = cause.syscall ? ` syscall=${cause.syscall}` : "";
    const address = cause.address ? ` address=${cause.address}` : "";
    const port = cause.port ? ` port=${cause.port}` : "";
    const causeMessage = cause.message ? ` message=${cause.message}` : "";
    causeDetails = `${code}${errno}${syscall}${address}${port}${causeMessage}`.trim();
  } else if (cause !== undefined) {
    causeDetails = String(cause);
  }
  console.error(`[${route}] ${message}${causeDetails ? ` | cause: ${causeDetails}` : ""}`);
  if (stack) {
    console.error(stack);
  }
}

/* ── Session store: token → { userId, username, isAdmin } ─── */
const sessions = new Map();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const clientBuildCandidates = [
  path.join(__dirname, "client", "dist"),
  path.join(__dirname, "client", "client", "dist"),
];
const distPath = clientBuildCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, "index.html"))
);
const hasBuiltClient = Boolean(distPath);
if (hasBuiltClient) {
  app.use(express.static(distPath));
} else {
  const devClientPath = path.join(__dirname, "client");
  app.use(express.static(devClientPath));
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
async function callOllamaChat({ model, messages, stream, tools }) {
  const body = { model: model || DEFAULT_MODEL, messages, stream };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
  }
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const body2 = await response.text();
    throw new Error(`Ollama error ${response.status}: ${body2}`);
  }

  return response;
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (typeof part.text === "string") return part.text;
          if (typeof part.content === "string") return part.content;
          if (typeof part.input_text === "string") return part.input_text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  return String(content);
}

function normalizeMessagesForOllama(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((msg) => {
    const normalized = {
      role: msg?.role || "user",
      content: normalizeMessageContent(msg?.content),
    };
    // Assistant messages that contain tool_calls (convert OpenAI → Ollama format)
    if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
      normalized.tool_calls = msg.tool_calls.map((tc) => ({
        function: {
          name: tc.function?.name || "",
          arguments:
            typeof tc.function?.arguments === "string"
              ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })()
              : (tc.function?.arguments ?? {}),
        },
      }));
    }
    return normalized;
  });
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

app.get("/api/templates", requireSession, (_req, res) => {
  return res.json(db.getPromptTemplates());
});

/* ── Chat (UI) ────────────────────────────────────────────── */
app.post("/api/chat", requireSession, async (req, res) => {
  try {
    const { conversation_id, message, stream = false, template_id = "none" } = req.body || {};

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
    const template = db.getPromptTemplateById(String(template_id || "none"));
    if (!template) {
      return res.status(400).json({ error: "Invalid template_id" });
    }
    const messagesForModel = template.system_text
      ? [{ role: "system", content: template.system_text }, ...messages]
      : messages;

    const ollamaResponse = await callOllamaChat({
      model: DEFAULT_MODEL,
      messages: messagesForModel,
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
    logRouteError("POST /api/chat", error);
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

app.get("/api/admin/templates", requireSession, requireAdmin, (_req, res) => {
  return res.json(db.getPromptTemplatesWithPrompts());
});

app.patch("/api/admin/templates/:id", requireSession, requireAdmin, (req, res) => {
  const { system_text } = req.body || {};
  if (typeof system_text !== "string") {
    return res.status(400).json({ error: "system_text must be a string" });
  }

  const updated = db.updatePromptTemplateSystemText(req.params.id, system_text);
  if (!updated) {
    return res.status(404).json({ error: "Template not found" });
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
    const { model, messages, stream, tools, tool_choice } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: { message: "messages must be an array" } });
    }

    const normalizedMessages = normalizeMessagesForOllama(messages);
    const ollamaResponse = await callOllamaChat({
      model,
      messages: normalizedMessages,
      stream: Boolean(stream),
      tools,
    });

    const resolvedModel = model || DEFAULT_MODEL;

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const completionId = `chatcmpl-local-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);

      const writeChunk = (delta, finishReason = null) => {
        const payload = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: resolvedModel,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      // First chunk must carry role so Cursor recognises the stream
      writeChunk({ role: "assistant", content: "" });

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
            try {
              const chunk = JSON.parse(line);
              const token = chunk.message?.content || "";
              const ollamaToolCalls = chunk.message?.tool_calls;

              if (chunk.done === true) {
                if (Array.isArray(ollamaToolCalls) && ollamaToolCalls.length > 0) {
                  // Convert Ollama tool_calls → OpenAI format and send in one delta
                  const toolCalls = ollamaToolCalls.map((tc, idx) => ({
                    index: idx,
                    id: `call_${completionId}_${idx}`,
                    type: "function",
                    function: {
                      name: tc.function?.name || "",
                      arguments:
                        typeof tc.function?.arguments === "object"
                          ? JSON.stringify(tc.function.arguments)
                          : (tc.function?.arguments || "{}"),
                    },
                  }));
                  writeChunk({ tool_calls: toolCalls });
                  writeChunk({}, "tool_calls");
                } else {
                  writeChunk({}, "stop");
                }
              } else if (token) {
                writeChunk({ content: token });
              }
            } catch { /* skip malformed lines */ }
          }

          newlineIndex = buffer.indexOf("\n");
        }
      }

      res.write("data: [DONE]\n\n");
      return res.end();
    }

    const json = await ollamaResponse.json();
    const content = json.message?.content || "";
    const ollamaToolCalls = json.message?.tool_calls;

    if (Array.isArray(ollamaToolCalls) && ollamaToolCalls.length > 0) {
      const toolCalls = ollamaToolCalls.map((tc, idx) => ({
        id: `call_${Date.now()}_${idx}`,
        type: "function",
        function: {
          name: tc.function?.name || "",
          arguments:
            typeof tc.function?.arguments === "object"
              ? JSON.stringify(tc.function.arguments)
              : (tc.function?.arguments || "{}"),
        },
      }));
      return res.json({
        id: `chatcmpl-local-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: resolvedModel,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null, tool_calls: toolCalls },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }

    return res.json({
      id: `chatcmpl-local-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: resolvedModel,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (error) {
    logRouteError("POST /v1/chat/completions", error);
    return res.status(500).json({ error: { message: error.message } });
  }
});

/* ── Obsidian one-shot endpoint ───────────────────────────── */
async function handleObsidianRequest(req, res) {
  try {
    const {
      model,
      prompt,
      noteContent = "",
      selectedText = "",
      mode = "auto",
      messages,
      stream = false,
    } = req.body || {};

    let userMessages = [];
    if (Array.isArray(messages) && messages.length > 0) {
      userMessages = messages;
    } else if (typeof prompt === "string" && prompt.trim().length > 0) {
      userMessages = [{ role: "user", content: prompt.trim() }];
    } else {
      return res.status(400).json({ error: { message: "prompt or messages is required" } });
    }

    const template = db.getPromptTemplateById("obsidian");
    const templateText = template?.system_text || "You are an Obsidian writing assistant.";
    const noteContext = String(noteContent || "").trim();
    const selectedContext = String(selectedText || "").trim();
    const hasSelection = selectedContext.length > 0;
    const effectiveMode = mode === "auto" ? (hasSelection ? "selection" : "note_replace") : mode;

    const modeInstructionByType = {
      selection:
        "Task: selection edit. Return ONLY the edited replacement text for the selected fragment. No conversational filler, no markdown fences.",
      note_replace:
        "Task: full note rewrite. Return ONLY the final full note content. No explanations, no markdown fences.",
      beautify:
        "Task: beautify. Improve style, clarity, and structure. Return ONLY the improved content. No explanations, no markdown fences.",
      summarize:
        "Task: summarize. Return a concise structured summary in markdown.",
      fix:
        "Task: correction. Fix grammar, spelling, and clarity. Return ONLY the corrected content. No explanations, no markdown fences.",
      tikz_figure:
        `Task: tikz figure. Generate a TikZ figure based on prompt and context. Create the figure with simple logic, so it will definitely compile!
        
        Good example:
        \`\`\`tikz
\\begin{document}
\\begin{tikzpicture}[scale=1.5]
    % 1. Verbindungslinien (Trichter) - Zuerst zeichnen, damit sie im Hintergrund sind
    % Verbindet den Input-Patch direkt mit der Output-Zelle
    \\draw[dashed, blue, thick] (2,4) -- (11,3);
    \\draw[dashed, blue, thick] (2,2) -- (11,2);

    % 2. Input Matrix (4x4 Bild)
    \\draw[fill=blue!50] (2,2) rectangle (4,4); % Blaue Füllung für 2x2 Patch
    \\draw[step=1cm, black, thin] (0,0) grid (4,4); % Gitter darüberlegen
    \\draw[blue, very thick] (2,2) rectangle (4,4); % Blaue Umrandung für Patch
    
    % Datenwerte für Input (gleiche Werte wie oben)
    \\node at (0.5, 3.5) {3}; \\node at (1.5, 3.5) {7}; \\node at (2.5, 3.5) {2}; \\node at (3.5, 3.5) {5};
    \\node at (0.5, 2.5) {1}; \\node at (1.5, 2.5) {8}; \\node at (2.5, 2.5) {4}; \\node at (3.5, 2.5) {6};
    \\node at (0.5, 1.5) {9}; \\node at (1.5, 1.5) {2}; \\node at (2.5, 1.5) {10}; \\node at (3.5, 1.5) {1};
    \\node at (0.5, 0.5) {0}; \\node at (1.5, 0.5) {5}; \\node at (2.5, 0.5) {3}; \\node at (3.5, 0.5) {7};
    
    \\node[anchor=south] at (2, 4.2) {\\textbf{Input (Image)}};

    % 3. Operations-Label in der Mitte (anstelle des Kernels)
    \\node at (7.5, 1.5) {\\textbf{Average Pooling}};
    \\node at (7.5, 1.2) {\\small \\textbf{Avg(2, 5, 4, 6)}};

    % 4. Output Matrix (2x2 Pooled Map)
    \\draw[fill=red!50] (11,2) rectangle (12,3);
    \\draw[step=1cm, gray, thin] (10,1) grid (12,3);
    \\draw[red, very thick] (11,2) rectangle (12,3);
    
    % Datenwerte für Output (Ergebnisse des Average Pooling)
    \\node at (11.5, 2.5) {\\large 4.75}; \\node at (10.5, 2.5) {4.25};
    \\node at (11.5, 1.5) {4}; \\node at (10.5, 1.5) {5.25};
    
    \\node[anchor=south] at (11, 3.2) {\\textbf{Pooled Map}};
    \\node at (11.5, 2.5) {\\large \\textbf{4.75}}; % Hervorheben des Ergebnisses
\\end{tikzpicture}
\\end{document}
\`\`\`
        `
    };


    const modeInstruction =
      modeInstructionByType[effectiveMode] || modeInstructionByType.note_replace;

    const systemParts = [templateText, modeInstruction];
    if (noteContext) {
      systemParts.push(`Current note content:\n---\n${noteContext}\n---`);
    }
    if (hasSelection) {
      systemParts.push(`Current selected text:\n---\n${selectedContext}\n---`);
    }
    const systemContent = systemParts.join("\n\n");

    const ollamaResponse = await callOllamaChat({
      model,
      messages: [{ role: "system", content: systemContent }, ...userMessages],
      stream: Boolean(stream),
    });

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
    logRouteError("POST /v1/obisidan", error);
    return res.status(500).json({ error: { message: error.message } });
  }
}

app.post("/v1/obisidan", authIfNeeded, handleObsidianRequest);
app.post("/v1/obsidian", authIfNeeded, handleObsidianRequest);

/* ── SPA fallback ─────────────────────────────────────────── */
app.get("*", (req, res, next) => {
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/v1") ||
    req.path === "/health"
  ) {
    return next();
  }
  if (hasBuiltClient) {
    return res.sendFile(path.join(distPath, "index.html"));
  }
  return res.sendFile(path.join(__dirname, "client", "index.html"));
});

/* ── Start ────────────────────────────────────────────────── */
async function start() {
  await db.seedAdminIfEmpty(UI_USER, UI_PASSWORD);
  db.seedTemplateDefaults();
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
