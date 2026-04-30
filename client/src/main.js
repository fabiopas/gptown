import "./styles.css";
import "highlight.js/styles/github-dark.min.css";
import { marked } from "marked";
import hljs from "highlight.js/lib/core";

import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import cpp from "highlight.js/lib/languages/cpp";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);

marked.setOptions({ breaks: true, gfm: true });

/* ── Markdown ────────────────────────────────────────────── */
function renderMarkdown(text) {
  const tmp = document.createElement("div");
  tmp.innerHTML = marked.parse(text);

  tmp.querySelectorAll("pre code").forEach((codeEl) => {
    const langClass = [...codeEl.classList].find((c) => c.startsWith("language-"));
    const lang = langClass ? langClass.replace("language-", "") : "";

    if (lang && hljs.getLanguage(lang)) {
      hljs.highlightElement(codeEl);
    } else {
      hljs.highlightElement(codeEl);
    }

    const pre = codeEl.parentElement;
    if (!pre) return;

    const container = document.createElement("div");
    container.className = "code-block";

    const header = document.createElement("div");
    header.className = "code-header";
    header.innerHTML = `<span class="code-lang">${lang || "code"}</span><button class="copy-btn">Copy</button>`;

    pre.parentNode.insertBefore(container, pre);
    container.append(header, pre);
  });

  tmp.querySelectorAll("a").forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });

  return tmp.innerHTML;
}

/* ── Element refs ────────────────────────────────────────── */
const loginScreen      = document.getElementById("login-screen");
const loginForm        = document.getElementById("login-form");
const usernameEl       = document.getElementById("username");
const passwordEl       = document.getElementById("password");
const loginBtn         = document.getElementById("login-btn");
const loginError       = document.getElementById("login-error");

const appEl            = document.getElementById("app");
const sidebarEl        = document.getElementById("sidebar");
const sidebarOverlay   = document.getElementById("sidebar-overlay");
const chatListEl       = document.getElementById("chat-list");
const newChatBtn       = document.getElementById("new-chat-btn");
const sidebarToggleBtn = document.getElementById("sidebar-toggle");
const logoutBtn        = document.getElementById("logout-btn");
const adminBtn         = document.getElementById("admin-btn");
const userAvatarEl     = document.getElementById("user-avatar");
const userDisplayName  = document.getElementById("user-display-name");
const statusEl         = document.getElementById("status");
const dotEl            = document.getElementById("status-dot");
const currentModelEl   = document.getElementById("current-model");
const templateSelectEl = document.getElementById("template-select");

const chatEl           = document.getElementById("chat");
const formEl           = document.getElementById("chat-form");
const inputEl          = document.getElementById("message");
const sendBtn          = document.getElementById("send-btn");
const stopBtn          = document.getElementById("stop-btn");
const newChatTopbarBtn = document.getElementById("new-chat-topbar");

const adminModal       = document.getElementById("admin-modal");
const closeAdminBtn    = document.getElementById("close-admin-modal");
const usersListEl      = document.getElementById("users-list");
const addUserForm      = document.getElementById("add-user-form");
const newUsernameEl    = document.getElementById("new-username");
const newPasswordEl    = document.getElementById("new-password");
const newIsAdminEl     = document.getElementById("new-is-admin");
const addUserError     = document.getElementById("add-user-error");
const addUserBtn       = document.getElementById("add-user-btn");
const templateAdminListEl = document.getElementById("template-admin-list");

/* ── Session / state ─────────────────────────────────────── */
const SESSION_KEY  = "gptown_token";
const CURRENT_KEY  = "gptown_current_conv";
const TEMPLATE_KEY = "gptown_template_id";

let currentUser = null;   // { username, isAdmin }
let currentConvId = null; // string | null
let currentConvIsEmpty = true;
let currentTemplateId = "none";

function getToken()   { return sessionStorage.getItem(SESSION_KEY); }
function saveToken(t) { sessionStorage.setItem(SESSION_KEY, t); }
function clearToken() { sessionStorage.removeItem(SESSION_KEY); }

function authedHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };
}

function getLastConvId() { return sessionStorage.getItem(CURRENT_KEY) || ""; }
function setLastConvId(id) {
  if (id) sessionStorage.setItem(CURRENT_KEY, id);
  else sessionStorage.removeItem(CURRENT_KEY);
}

function getTemplateId() { return sessionStorage.getItem(TEMPLATE_KEY) || "none"; }
function setTemplateId(id) {
  const normalized = id || "none";
  sessionStorage.setItem(TEMPLATE_KEY, normalized);
  currentTemplateId = normalized;
}

function templateLabel(templateId) {
  return templateId === "none" ? "gemma4" : `gemma4-${templateId}`;
}

/* ── API helpers ─────────────────────────────────────────── */
async function apiFetch(path, opts = {}) {
  const res = await fetch(path, { headers: authedHeaders(), ...opts });
  if (res.status === 401) { clearToken(); showLogin(); throw new Error("Session expired"); }
  return res;
}

/* ── Status ──────────────────────────────────────────────── */
function setStatus(text, state) {
  statusEl.textContent = text;
  dotEl.className = "status-dot" + (state ? ` ${state}` : "");
}

async function checkHealth() {
  try {
    const res = await fetch("/health");
    const data = await res.json();
    const model = data.model || "Online";
    setStatus(model, "online");
    currentModelEl.textContent = model;
  } catch {
    setStatus("Offline", "error");
  }
}

async function loadTemplates() {
  let templates = [];
  try {
    const res = await apiFetch("/api/templates");
    if (!res.ok) throw new Error("Failed to load templates");
    templates = await res.json();
  } catch {
    templateSelectEl.innerHTML = `<option value="none">${templateLabel("none")}</option>`;
    setTemplateId("none");
    return;
  }

  if (!Array.isArray(templates) || templates.length === 0) {
    templateSelectEl.innerHTML = `<option value="none">${templateLabel("none")}</option>`;
    setTemplateId("none");
    return;
  }

  templateSelectEl.innerHTML = templates
    .map((t) => `<option value="${t.id}">${templateLabel(t.id)}</option>`)
    .join("");

  const preferred = getTemplateId();
  const exists = templates.some((t) => t.id === preferred);
  const selected = exists ? preferred : "none";
  templateSelectEl.value = selected;
  setTemplateId(selected);
}

/* ── Conversation list ───────────────────────────────────── */
async function renderChatList() {
  let convs = [];
  try {
    const res = await apiFetch("/api/conversations");
    convs = await res.json();
  } catch { return; }

  chatListEl.innerHTML = "";

  if (convs.length === 0) {
    chatListEl.innerHTML = `<p class="no-chats">No conversations yet</p>`;
    return;
  }

  convs.forEach((conv) => {
    const item = document.createElement("div");
    item.className = "chat-item" + (conv.id === currentConvId ? " active" : "");
    item.dataset.id = conv.id;

    const title = document.createElement("span");
    title.className = "chat-item-title";
    title.textContent = conv.title;

    const del = document.createElement("button");
    del.className = "chat-item-delete";
    del.title = "Delete";
    del.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

    item.append(title, del);
    chatListEl.appendChild(item);
  });
}

chatListEl.addEventListener("click", async (e) => {
  const del = e.target.closest(".chat-item-delete");
  const item = e.target.closest(".chat-item");

  if (del && item) {
    e.stopPropagation();
    const id = item.dataset.id;
    try { await apiFetch(`/api/conversations/${id}`, { method: "DELETE" }); }
    catch { return; }
    if (id === currentConvId) {
      currentConvId = null;
      setLastConvId("");
      chatEl.innerHTML = "";
      showEmptyState();
    }
    await renderChatList();
    return;
  }

  if (item) {
    await switchConversation(item.dataset.id);
    closeSidebar();
  }
});

/* ── Switch / load conversation ──────────────────────────── */
async function switchConversation(id) {
  chatEl.innerHTML = "";
  currentConvId = id;
  setLastConvId(id);

  let messages = [];
  try {
    const res = await apiFetch(`/api/conversations/${id}/messages`);
    messages = await res.json();
  } catch { return; }

  currentConvIsEmpty = messages.length === 0;

  if (messages.length === 0) {
    showEmptyState();
  } else {
    messages.forEach((m) => appendMessage(m.role, m.content));
  }

  await renderChatList();
}

/* ── Empty state ─────────────────────────────────────────── */
function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getSuggestionPool() {
  return [
    "Break down this architecture in plain English",
    "Draft a clean PR description from my git diff",
    "Write tests for this function edge-case by edge-case",
    "Turn this rough idea into a product spec",
    "Find likely bugs in this snippet and explain why",
    "Generate SQL to answer this analytics question",
    "Refactor this code for readability first, performance second",
    "Create a launch checklist for this feature",
  ];
}

function showEmptyState() {
  if (chatEl.querySelector(".empty-state")) return;
  const greeting = `${getTimeGreeting()}${currentUser?.username ? `, ${currentUser.username}` : ""}`;
  const intro = "Pick a direction and I will help you move fast.";
  const suggestions = getSuggestionPool().sort(() => Math.random() - 0.5).slice(0, 4);

  const es = document.createElement("div");
  es.className = "empty-state";
  es.innerHTML = `
    <div class="empty-logo"><span class="logo-mark logo-mark-lg">G</span></div>
    <h2 class="empty-title">${greeting}</h2>
    <p class="empty-subtitle">${intro}</p>
    <div class="suggestions">
      ${suggestions.map((text) => `<button class="suggestion-btn">${text}</button>`).join("")}
    </div>
  `;
  chatEl.appendChild(es);
}

/* ── Message DOM ─────────────────────────────────────────── */
function createThinkingBlock(thinking = "") {
  const panel = document.createElement("details");
  panel.className = "thinking-panel";

  const summary = document.createElement("summary");
  summary.className = "thinking-summary";
  summary.innerHTML = `<span>Thinking</span><span class="thinking-caret">▾</span>`;

  const body = document.createElement("div");
  body.className = "thinking-content";
  body.textContent = thinking;

  panel.append(summary, body);
  return { panel, body };
}

function appendMessage(role, content, options = {}) {
  chatEl.querySelector(".empty-state")?.remove();

  const row = document.createElement("div");
  row.className = `msg-row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? (currentUser?.username?.[0]?.toUpperCase() || "U") : "G";

  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.dataset.rawContent = content;
  let thinkingBody = null;

  if (role === "assistant") {
    if (options.thinking?.trim()) {
      const { panel, body } = createThinkingBlock(options.thinking.trim());
      wrap.appendChild(panel);
      thinkingBody = body;
    }
    bubble.innerHTML = renderMarkdown(content);
  } else {
    bubble.textContent = content;
  }

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  actions.innerHTML = `<button class="msg-copy-btn">Copy</button>`;

  wrap.append(bubble, actions);
  row.append(avatar, wrap);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;

  return { bubble, thinkingBody };
}

function addStreamingRow() {
  chatEl.querySelector(".empty-state")?.remove();

  const row = document.createElement("div");
  row.className = "msg-row assistant";
  row.id = "streaming-row";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "G";

  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap";

  const { panel: thinkingPanel, body: thinkingBody } = createThinkingBlock("");
  thinkingPanel.classList.add("streaming");
  thinkingBody.innerHTML = `
    <div class="thinking-loader">
      <span></span><span></span><span></span>
    </div>
  `;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<div class="typing-bubble"><span></span><span></span><span></span></div>`;

  wrap.append(thinkingPanel, bubble);
  row.append(avatar, wrap);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;

  return { row, bubble, wrap, thinkingPanel, thinkingBody };
}

function finalizeStreamingRow({ row, bubble, wrap, thinkingPanel, thinkingBody }, content, thinking) {
  row.removeAttribute("id");
  bubble.dataset.rawContent = content;
  bubble.style.whiteSpace = "";
  if (content) {
    bubble.innerHTML = renderMarkdown(content);
  } else {
    bubble.innerHTML = "";
  }

  if (thinking?.trim()) {
    thinkingBody.textContent = thinking.trim();
    thinkingPanel.classList.remove("streaming");
  } else {
    thinkingPanel.remove();
  }

  if (!wrap.querySelector(".msg-actions")) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML = `<button class="msg-copy-btn">Copy</button>`;
    wrap.appendChild(actions);
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

/* ── Event delegation ────────────────────────────────────── */
chatEl.addEventListener("click", (e) => {
  const copyCodeBtn = e.target.closest(".copy-btn");
  if (copyCodeBtn) {
    const code = copyCodeBtn.closest(".code-block")?.querySelector("code")?.textContent || "";
    navigator.clipboard.writeText(code).catch(() => {});
    copyCodeBtn.textContent = "Copied!";
    setTimeout(() => { copyCodeBtn.textContent = "Copy"; }, 2000);
    return;
  }

  const msgCopyBtn = e.target.closest(".msg-copy-btn");
  if (msgCopyBtn) {
    const bubble = msgCopyBtn.closest(".bubble-wrap")?.querySelector(".bubble");
    const text = bubble?.dataset.rawContent || bubble?.textContent || "";
    navigator.clipboard.writeText(text).catch(() => {});
    msgCopyBtn.textContent = "Copied!";
    setTimeout(() => { msgCopyBtn.textContent = "Copy"; }, 2000);
    return;
  }

  const suggestion = e.target.closest(".suggestion-btn");
  if (suggestion) {
    inputEl.value = suggestion.textContent;
    inputEl.dispatchEvent(new Event("input"));
    inputEl.focus();
  }
});

/* ── Sidebar toggle ──────────────────────────────────────── */
function openSidebar()  { sidebarEl.classList.add("open"); sidebarOverlay.hidden = false; }
function closeSidebar() { sidebarEl.classList.remove("open"); sidebarOverlay.hidden = true; }

sidebarToggleBtn.addEventListener("click", () => {
  sidebarEl.classList.contains("open") ? closeSidebar() : openSidebar();
});
sidebarOverlay.addEventListener("click", closeSidebar);

/* ── New chat ────────────────────────────────────────────── */
async function startNewChat() {
  try {
    const res = await apiFetch("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ title: "New chat" }),
    });
    const conv = await res.json();
    currentConvId = conv.id;
    setLastConvId(conv.id);
    currentConvIsEmpty = true;
    chatEl.innerHTML = "";
    showEmptyState();
    await renderChatList();
  } catch { /* session error already handled */ }
  closeSidebar();
  inputEl.focus();
}

newChatBtn.addEventListener("click", startNewChat);
newChatTopbarBtn.addEventListener("click", startNewChat);

/* ── Loading / abort ─────────────────────────────────────── */
let abortController = null;

function setLoading(on) {
  sendBtn.disabled = on;
  sendBtn.classList.toggle("is-loading", on);
  stopBtn.hidden = !on;
  inputEl.disabled = on;
  if (on) setStatus("Generating…", "loading");
}

stopBtn.addEventListener("click", () => { abortController?.abort(); });
templateSelectEl.addEventListener("change", () => {
  setTemplateId(templateSelectEl.value);
});

/* ── Auto-resize textarea ────────────────────────────────── */
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = `${inputEl.scrollHeight}px`;
});

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

/* ── Send message ────────────────────────────────────────── */
formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = inputEl.value.trim();
  if (!message) return;

  if (!currentConvId) {
    await startNewChat();
    if (!currentConvId) return;
  }

  const isFirst = currentConvIsEmpty;
  currentConvIsEmpty = false;

  appendMessage("user", message);
  sendBtn.classList.remove("send-pop");
  void sendBtn.offsetWidth;
  sendBtn.classList.add("send-pop");

  if (isFirst) {
    const title = message.length > 46 ? message.slice(0, 46) + "…" : message;
    apiFetch(`/api/conversations/${currentConvId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }).then(() => renderChatList()).catch(() => {});
  }

  inputEl.value = "";
  inputEl.style.height = "auto";
  setLoading(true);

  const streamEl = addStreamingRow();
  let fullReply = "";
  let fullThinking = "";
  abortController = new AbortController();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: authedHeaders(),
      body: JSON.stringify({
        conversation_id: currentConvId,
        message,
        stream: true,
        template_id: currentTemplateId,
      }),
      signal: abortController.signal,
    });

    if (res.status === 401) { clearToken(); showLogin(); return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(err.error || "Request failed");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const { token, thinking } = JSON.parse(data);
          if (token) {
            fullReply += token;
            streamEl.bubble.textContent = fullReply;
            streamEl.bubble.style.whiteSpace = "pre-wrap";
            chatEl.scrollTop = chatEl.scrollHeight;
          }
          if (thinking) {
            fullThinking += thinking;
            streamEl.thinkingBody.textContent = fullThinking;
            chatEl.scrollTop = chatEl.scrollHeight;
          }
        } catch { /* skip */ }
      }
    }

    finalizeStreamingRow(streamEl, fullReply, fullThinking);
  } catch (err) {
    if (err.name === "AbortError") {
      if (fullReply) {
        finalizeStreamingRow(streamEl, fullReply, fullThinking);
      } else {
        streamEl.row.remove();
      }
    } else {
      finalizeStreamingRow(streamEl, `Error: ${err.message}`, fullThinking);
    }
  } finally {
    setLoading(false);
    checkHealth();
  }
});

/* ── Admin panel ─────────────────────────────────────────── */
async function openAdminModal() {
  adminModal.hidden = false;
  await refreshUsersList();
  await refreshTemplatePrompts();
}

function closeAdminModal() {
  adminModal.hidden = true;
  addUserForm.reset();
  addUserError.hidden = true;
}

async function refreshUsersList() {
  usersListEl.innerHTML = `<p class="loading-text">Loading…</p>`;
  try {
    const res = await apiFetch("/api/admin/users");
    const users = await res.json();

    usersListEl.innerHTML = "";
    users.forEach((u) => {
      const row = document.createElement("div");
      row.className = "user-row";

      const info = document.createElement("div");
      info.className = "user-row-info";

      const ava = document.createElement("div");
      ava.className = "user-row-avatar" + (u.is_admin ? " admin" : "");
      ava.textContent = u.username[0].toUpperCase();

      const meta = document.createElement("div");
      meta.className = "user-row-meta";

      const name = document.createElement("span");
      name.className = "user-row-name";
      name.textContent = u.username;
      if (u.username === currentUser?.username) {
        name.textContent += " (you)";
      }

      const role = document.createElement("span");
      role.className = "user-row-role";
      role.textContent = u.is_admin ? "Admin" : "User";

      meta.append(name, role);
      info.append(ava, meta);
      row.appendChild(info);

      if (u.username !== currentUser?.username) {
        const del = document.createElement("button");
        del.className = "user-delete-btn";
        del.title = "Delete user";
        del.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;
        del.addEventListener("click", async () => {
          if (!confirm(`Delete user "${u.username}"? This also deletes all their conversations.`)) return;
          try {
            const r = await apiFetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
            if (!r.ok) {
              const d = await r.json();
              alert(d.error || "Failed to delete");
              return;
            }
            await refreshUsersList();
          } catch { /* handled */ }
        });
        row.appendChild(del);
      }

      usersListEl.appendChild(row);
    });
  } catch {
    usersListEl.innerHTML = `<p class="loading-text">Failed to load users.</p>`;
  }
}

async function refreshTemplatePrompts() {
  templateAdminListEl.innerHTML = `<p class="loading-text">Loading…</p>`;
  try {
    const res = await apiFetch("/api/admin/templates");
    const templates = await res.json();
    if (!res.ok) {
      templateAdminListEl.innerHTML = `<p class="loading-text">Failed to load templates.</p>`;
      return;
    }

    templateAdminListEl.innerHTML = "";
    templates.forEach((template) => {
      const card = document.createElement("div");
      card.className = "template-admin-item";

      const title = document.createElement("div");
      title.className = "template-admin-title";
      title.textContent = template.id === "none" ? "model" : `model-${template.id}`;

      const textarea = document.createElement("textarea");
      textarea.className = "template-admin-textarea";
      textarea.value = template.system_text || "";
      textarea.placeholder = "System prompt for this template…";

      const row = document.createElement("div");
      row.className = "template-admin-actions";

      const status = document.createElement("span");
      status.className = "template-admin-status";

      const saveBtn = document.createElement("button");
      saveBtn.className = "login-btn template-save-btn";
      saveBtn.type = "button";
      saveBtn.textContent = "Save";
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        status.textContent = "";
        try {
          const saveRes = await apiFetch(`/api/admin/templates/${template.id}`, {
            method: "PATCH",
            body: JSON.stringify({ system_text: textarea.value }),
          });
          const saveData = await saveRes.json().catch(() => ({}));
          if (!saveRes.ok) {
            status.textContent = saveData.error || "Save failed";
            return;
          }
          status.textContent = "Saved";
          await loadTemplates();
          if (template.id === currentTemplateId) {
            setStatus("Template updated", "online");
          }
        } catch {
          status.textContent = "Request failed";
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
        }
      });

      row.append(status, saveBtn);
      card.append(title, textarea, row);
      templateAdminListEl.appendChild(card);
    });
  } catch {
    templateAdminListEl.innerHTML = `<p class="loading-text">Failed to load templates.</p>`;
  }
}

adminBtn.addEventListener("click", openAdminModal);
closeAdminBtn.addEventListener("click", closeAdminModal);
adminModal.addEventListener("click", (e) => {
  if (e.target === adminModal) closeAdminModal();
});

addUserForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = newUsernameEl.value.trim();
  const password = newPasswordEl.value;
  const isAdmin = newIsAdminEl.checked;

  addUserBtn.disabled = true;
  addUserBtn.textContent = "Adding…";
  addUserError.hidden = true;

  try {
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, password, isAdmin }),
    });
    const data = await res.json();
    if (!res.ok) {
      addUserError.textContent = data.error || "Failed";
      addUserError.hidden = false;
      return;
    }
    addUserForm.reset();
    await refreshUsersList();
  } catch {
    addUserError.textContent = "Request failed";
    addUserError.hidden = false;
  } finally {
    addUserBtn.disabled = false;
    addUserBtn.textContent = "Add User";
  }
});

/* ── Login ───────────────────────────────────────────────── */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in…";
  loginError.hidden = true;

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameEl.value.trim(),
        password: passwordEl.value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");

    saveToken(data.token);
    currentUser = { username: data.username, isAdmin: data.isAdmin };
    await showApp();
  } catch (err) {
    loginError.textContent =
      err?.message === "Failed to fetch"
        ? "API is not reachable. Is npm run dev running?"
        : "Wrong username or password.";
    loginError.hidden = false;
    passwordEl.value = "";
    passwordEl.focus();
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign in";
  }
});

/* ── Logout ──────────────────────────────────────────────── */
logoutBtn.addEventListener("click", async () => {
  try { await fetch("/api/logout", { method: "POST", headers: authedHeaders() }); }
  catch { /* ignore */ }
  clearToken();
  currentUser = null;
  showLogin();
});

/* ── View transitions ────────────────────────────────────── */
async function showApp() {
  loginScreen.style.opacity = "0";
  loginScreen.style.transition = "opacity 0.3s ease";

  await new Promise((r) => setTimeout(r, 280));

  loginScreen.hidden = true;
  loginScreen.style.opacity = "";
  loginScreen.style.transition = "";
  appEl.hidden = false;

  userAvatarEl.textContent = currentUser.username[0].toUpperCase();
  userDisplayName.textContent = currentUser.username;
  adminBtn.hidden = !currentUser.isAdmin;

  await renderChatList();
  await loadTemplates();

  const lastId = getLastConvId();
  if (lastId) {
    await switchConversation(lastId).catch(() => {
      currentConvId = null;
      showEmptyState();
    });
  } else {
    showEmptyState();
  }

  checkHealth();
}

function showLogin() {
  appEl.hidden = true;
  adminModal.hidden = true;
  loginScreen.hidden = false;
  chatEl.innerHTML = "";
  currentConvId = null;
  currentTemplateId = "none";
  usernameEl.value = "";
  passwordEl.value = "";
  loginError.hidden = true;
  usernameEl.focus();
}

/* ── Boot ────────────────────────────────────────────────── */
async function boot() {
  const token = getToken();
  if (!token) { showLogin(); return; }

  try {
    const res = await fetch("/api/me", { headers: authedHeaders() });
    if (!res.ok) throw new Error("invalid");
    const data = await res.json();
    currentUser = { username: data.username, isAdmin: data.isAdmin };
    await showApp();
  } catch {
    clearToken();
    showLogin();
  }
}

boot();
