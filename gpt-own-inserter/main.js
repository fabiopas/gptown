var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LocalLLMPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var LocalLLMPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.addCommand({
      id: "open-llm-popup",
      name: "\xD6ffne lokales LLM Popup (mit Notiz-Kontext)",
      editorCallback: (editor, view) => {
        new LLMInputModal(this.app, async (promptText, mode) => {
          await this.callLocalLLM(promptText, editor, mode);
        }).open();
      }
    });
  }
  async callLocalLLM(prompt, editor, mode = "auto") {
    const noteContent = editor.getValue();
    const selectedTextRaw = editor.getSelection();
    const selectedText = selectedTextRaw.trim();
    const hasSelection = selectedText.length > 0;
    const effectiveMode = this.resolveEffectiveMode(mode, hasSelection);
    const spinnerFrames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
    let frameIndex = 0;
    const spinnerNotice = new import_obsidian.Notice("", 0);
    spinnerNotice.noticeEl.setText(`${spinnerFrames[0]}  GPTown denkt\u2026`);
    const spinnerInterval = setInterval(() => {
      frameIndex = (frameIndex + 1) % spinnerFrames.length;
      spinnerNotice.noticeEl.setText(`${spinnerFrames[frameIndex]}  GPTown denkt\u2026`);
    }, 80);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3 * 60 * 1e3);
      const rawResponse = await fetch("https://flow-social.de/v1/obisidan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer gptown-api-key"
        },
        body: JSON.stringify({
          prompt,
          noteContent,
          selectedText,
          mode: effectiveMode,
          temperature: 0.7
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      clearInterval(spinnerInterval);
      spinnerNotice.hide();
      if (rawResponse.ok) {
        const data = await rawResponse.json();
        const reply = data?.choices?.[0]?.message?.content;
        if (reply) {
          await this.showCheckboxAnimation();
          await this.applyReply(editor, reply, effectiveMode);
        } else {
          new import_obsidian.Notice("Fehler: Keine g\xFCltige Antwort erhalten.");
        }
      } else {
        new import_obsidian.Notice(`Fehler: API Statuscode ${rawResponse.status}`);
      }
    } catch (error) {
      clearInterval(spinnerInterval);
      spinnerNotice.hide();
      console.error("LLM API Fehler:", error);
      if (error instanceof Error && error.name === "AbortError") {
        new import_obsidian.Notice("Timeout: Keine Antwort nach 3 Minuten.");
      } else {
        new import_obsidian.Notice("Verbindungsfehler. Ist dein lokales LLM gestartet? Details in der Konsole.");
      }
    }
  }
  resolveEffectiveMode(mode, hasSelection) {
    if (mode !== "auto") return mode;
    return hasSelection ? "selection" : "note_replace";
  }
  async applyReply(editor, reply, mode) {
    if (mode === "selection") {
      const from = editor.getCursor("from");
      const to = editor.getCursor("to");
      editor.replaceRange("", from, to);
      await this.typewriterInsert(editor, reply, from);
      return;
    }
    const start = { line: 0, ch: 0 };
    const lastLine = Math.max(editor.lineCount() - 1, 0);
    const end = { line: lastLine, ch: editor.getLine(lastLine)?.length ?? 0 };
    editor.replaceRange("", start, end);
    await this.typewriterInsert(editor, `${reply}
`, start);
  }
  async showCheckboxAnimation() {
    const frames = [
      "\u2610  Antwort kommt\u2026",
      "[/]  Antwort kommt\u2026",
      "\u2611  Antwort bereit!",
      "\u2713  Los geht's!"
    ];
    const notice = new import_obsidian.Notice("", 0);
    for (const frame of frames) {
      notice.noticeEl.setText(frame);
      await this.sleep(200);
    }
    notice.hide();
  }
  async typewriterInsert(editor, text, start) {
    let pos = { ...start };
    for (const char of text) {
      editor.replaceRange(char, pos);
      if (char === "\n") {
        pos = { line: pos.line + 1, ch: 0 };
      } else {
        pos = { line: pos.line, ch: pos.ch + 1 };
      }
      await this.sleep(8);
    }
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};
var LLMInputModal = class extends import_obsidian.Modal {
  onSubmit;
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Lokales LLM befragen" });
    const hintEl = contentEl.createEl("p", {
      text: "\u{1F4A1} Der aktuelle Inhalt dieser Notiz wird automatisch als Kontext mitgesendet.",
      cls: "modal-hint"
    });
    hintEl.style.fontSize = "0.85em";
    hintEl.style.color = "var(--text-muted)";
    hintEl.style.marginBottom = "10px";
    const textArea = contentEl.createEl("textarea", {
      attr: {
        rows: "6",
        placeholder: "Was soll das LLM tun? (z.B. 'Fasse den Text zusammen' oder 'Schreibe den n\xE4chsten Absatz')\u2026"
      }
    });
    textArea.style.width = "100%";
    textArea.style.marginBottom = "15px";
    textArea.style.resize = "vertical";
    const quickRow = contentEl.createEl("div");
    quickRow.style.display = "flex";
    quickRow.style.gap = "8px";
    quickRow.style.flexWrap = "wrap";
    quickRow.style.marginBottom = "12px";
    this.createQuickButton(quickRow, "Note versch\xF6nern", "beautify", "Verbessere die gesamte Notiz sprachlich und strukturell.");
    this.createQuickButton(quickRow, "Zusammenfassen", "summarize", "Fasse die gesamte Notiz kompakt zusammen.");
    this.createQuickButton(quickRow, "Korrigieren", "fix", "Korrigiere Rechtschreibung und Grammatik.");
    const submitBtn = contentEl.createEl("button", { text: "Absenden" });
    submitBtn.style.backgroundColor = "var(--interactive-accent)";
    submitBtn.style.color = "var(--text-on-accent)";
    submitBtn.addEventListener("click", () => {
      const text = textArea.value.trim();
      if (text.length > 0) {
        this.onSubmit(text, "auto");
        this.close();
      } else {
        new import_obsidian.Notice("Bitte gib einen Text ein.");
      }
    });
  }
  createQuickButton(container, label, mode, promptTemplate) {
    const button = container.createEl("button", { text: label });
    button.style.padding = "6px 10px";
    button.addEventListener("click", () => {
      this.onSubmit(promptTemplate, mode);
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
