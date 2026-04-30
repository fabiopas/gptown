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
        new LLMInputModal(this.app, async (promptText) => {
          await this.callLocalLLM(promptText, editor);
        }).open();
      }
    });
  }
  async callLocalLLM(prompt, editor) {
    new import_obsidian.Notice("Sende Anfrage an lokales LLM...");
    const noteContent = editor.getValue();
    try {
      const response = await (0, import_obsidian.requestUrl)({
        url: "https://flow-social/v1/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          // 2. NEU: Wir schicken den Notizinhalt als System-Nachricht mit
          messages: [
            {
              role: "system",
              content: `Du bist ein hilfreicher Assistent in Obsidian. Hier ist der aktuelle Inhalt der Notiz des Nutzers:

---
${noteContent}
---

Bitte antworte auf die folgende Frage oder Anweisung des Nutzers. Ber\xFCcksichtige dabei den Inhalt der Notiz, falls es f\xFCr die Antwort relevant ist.`
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.7
        })
      });
      if (response.status === 200) {
        const reply = response.json?.choices?.[0]?.message?.content || response.text;
        if (reply) {
          const cursor = editor.getCursor();
          editor.replaceRange(`

${reply}

`, cursor);
          new import_obsidian.Notice("LLM-Antwort erfolgreich eingef\xFCgt!");
        } else {
          new import_obsidian.Notice("Fehler: Keine g\xFCltige Antwort vom LLM erhalten.");
        }
      } else {
        new import_obsidian.Notice(`Fehler: API gab Statuscode ${response.status} zur\xFCck.`);
      }
    } catch (error) {
      console.error("LLM API Fehler:", error);
      new import_obsidian.Notice("Verbindungsfehler. Ist dein lokales LLM gestartet? Details in der Konsole.");
    }
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
      text: "\u{1F4A1} Der aktuelle Inhalt dieser Notiz wird automatisch als Kontext an das LLM mitgesendet.",
      cls: "modal-hint"
    });
    hintEl.style.fontSize = "0.85em";
    hintEl.style.color = "var(--text-muted)";
    hintEl.style.marginBottom = "10px";
    const textArea = contentEl.createEl("textarea", {
      attr: {
        rows: "6",
        placeholder: "Was soll das LLM tun? (z.B. 'Fasse den Text zusammen' oder 'Schreibe den n\xE4chsten Absatz')..."
      }
    });
    textArea.style.width = "100%";
    textArea.style.marginBottom = "15px";
    textArea.style.resize = "vertical";
    const submitBtn = contentEl.createEl("button", { text: "Absenden" });
    submitBtn.style.backgroundColor = "var(--interactive-accent)";
    submitBtn.style.color = "var(--text-on-accent)";
    submitBtn.addEventListener("click", () => {
      const text = textArea.value.trim();
      if (text.length > 0) {
        this.onSubmit(text);
        this.close();
      } else {
        new import_obsidian.Notice("Bitte gib einen Text ein.");
      }
    });
  }
  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
};
