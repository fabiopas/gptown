import { App, Editor, MarkdownView, Modal, Notice, Plugin, requestUrl } from 'obsidian';

export default class LocalLLMPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: 'open-llm-popup',
			name: 'Öffne lokales LLM Popup (mit Notiz-Kontext)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new LLMInputModal(this.app, async (promptText) => {
					await this.callLocalLLM(promptText, editor);
				}).open();
			}
		});
	}

	async callLocalLLM(prompt: string, editor: Editor) {
		new Notice('Sende Anfrage an lokales LLM...');
		
		// 1. NEU: Lese den gesamten Text der aktuellen Notiz aus
		const noteContent = editor.getValue();

		try {
			const response = await requestUrl({
				url: 'https://flow-social/v1/obisidan',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Bearer local-dev-key'
				},
				body: JSON.stringify({
					prompt,
					noteContent,
					temperature: 0.7
				})
			});

			if (response.status === 200) {
				const reply = response.json?.choices?.[0]?.message?.content || response.text;

				if (reply) {
					// Füge die Antwort an der aktuellen Cursorposition ein
					const cursor = editor.getCursor();
					
					// Ein paar Leerzeilen zur sauberen Trennung einfügen
					editor.replaceRange(`\n\n${reply}\n\n`, cursor);
					new Notice('LLM-Antwort erfolgreich eingefügt!');
				} else {
					new Notice('Fehler: Keine gültige Antwort vom LLM erhalten.');
				}
			} else {
				new Notice(`Fehler: API gab Statuscode ${response.status} zurück.`);
			}
		} catch (error) {
			console.error("LLM API Fehler:", error);
			new Notice('Verbindungsfehler. Ist dein lokales LLM gestartet? Details in der Konsole.');
		}
	}
}

class LLMInputModal extends Modal {
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		
		contentEl.createEl("h2", { text: "Lokales LLM befragen" });
		
		// Kleiner Hinweis für den Nutzer, dass der Kontext mitgesendet wird
		const hintEl = contentEl.createEl("p", { 
			text: "💡 Der aktuelle Inhalt dieser Notiz wird automatisch als Kontext an das LLM mitgesendet.",
			cls: "modal-hint" 
		});
		hintEl.style.fontSize = "0.85em";
		hintEl.style.color = "var(--text-muted)";
		hintEl.style.marginBottom = "10px";

		const textArea = contentEl.createEl("textarea", {
			attr: {
				rows: "6",
				placeholder: "Was soll das LLM tun? (z.B. 'Fasse den Text zusammen' oder 'Schreibe den nächsten Absatz')..."
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
				new Notice("Bitte gib einen Text ein.");
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}