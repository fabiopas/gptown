import { App, Editor, MarkdownView, Modal, Notice, Plugin } from 'obsidian';

type EditMode = 'auto' | 'selection' | 'note_replace' | 'beautify' | 'summarize' | 'fix' | 'tikz_figure';

export default class LocalLLMPlugin extends Plugin {
	async onload() {
		this.addCommand({
			id: 'open-llm-popup',
			name: 'Öffne lokales LLM Popup (mit Notiz-Kontext)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new LLMInputModal(this.app, async (promptText, mode) => {
					await this.callLocalLLM(promptText, editor, mode);
				}).open();
			}
		});
	}

	async callLocalLLM(prompt: string, editor: Editor, mode: EditMode = 'auto') {
		const noteContent = editor.getValue();
		const selectedTextRaw = editor.getSelection();
		const selectedText = selectedTextRaw.trim();
		const hasSelection = selectedText.length > 0;
		const effectiveMode = this.resolveEffectiveMode(mode, hasSelection);

		// Spinner while waiting for response
		const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
		let frameIndex = 0;
		const spinnerNotice = new Notice('', 0);
		spinnerNotice.noticeEl.setText(`${spinnerFrames[0]}  GPTown denkt…`);

		const spinnerInterval = setInterval(() => {
			frameIndex = (frameIndex + 1) % spinnerFrames.length;
			spinnerNotice.noticeEl.setText(`${spinnerFrames[frameIndex]}  GPTown denkt…`);
		}, 80);

		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 3 * 60 * 1000);

			const rawResponse = await fetch('https://flow-social.de/v1/obisidan', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Bearer gptown-api-key'
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
					new Notice('Fehler: Keine gültige Antwort erhalten.');
				}
			} else {
				new Notice(`Fehler: API Statuscode ${rawResponse.status}`);
			}
		} catch (error) {
			clearInterval(spinnerInterval);
			spinnerNotice.hide();
			console.error('LLM API Fehler:', error);
			if (error instanceof Error && error.name === 'AbortError') {
				new Notice('Timeout: Keine Antwort nach 3 Minuten.');
			} else {
				new Notice('Verbindungsfehler. Ist dein lokales LLM gestartet? Details in der Konsole.');
			}
		}
	}

	resolveEffectiveMode(mode: EditMode, hasSelection: boolean): EditMode {
		if (mode !== 'auto') return mode;
		return hasSelection ? 'selection' : 'note_replace';
	}

	async applyReply(editor: Editor, reply: string, mode: EditMode) {
		if (mode === 'tikz_figure') {
			const cursor = editor.getCursor();
			const tikzBlock = `\n\\begin{tikzpicture}\n${reply.trim()}\n\\end{tikzpicture}\n`;
			await this.typewriterInsert(editor, tikzBlock, cursor);
			return;
		}

		if (mode === 'selection') {
			const from = editor.getCursor('from');
			const to = editor.getCursor('to');
			editor.replaceRange('', from, to);
			await this.typewriterInsert(editor, reply, from);
			return;
		}

		// replace full note by default for full-note modes
		const start = { line: 0, ch: 0 };
		const lastLine = Math.max(editor.lineCount() - 1, 0);
		const end = { line: lastLine, ch: editor.getLine(lastLine)?.length ?? 0 };
		editor.replaceRange('', start, end);
		await this.typewriterInsert(editor, `${reply}\n`, start);
	}

	async showCheckboxAnimation() {
		const frames = [
			'☐  Antwort kommt…',
			'[/]  Antwort kommt…',
			'☑  Antwort bereit!',
			'✓  Los geht\'s!',
		];
		const notice = new Notice('', 0);
		for (const frame of frames) {
			notice.noticeEl.setText(frame);
			await this.sleep(200);
		}
		notice.hide();
	}

	async typewriterInsert(editor: Editor, text: string, start: { line: number; ch: number }) {
		let pos = { ...start };
		for (const char of text) {
			editor.replaceRange(char, pos);
			if (char === '\n') {
				pos = { line: pos.line + 1, ch: 0 };
			} else {
				pos = { line: pos.line, ch: pos.ch + 1 };
			}
			await this.sleep(8);
		}
	}

	sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

class LLMInputModal extends Modal {
	onSubmit: (result: string, mode: EditMode) => void;

	constructor(app: App, onSubmit: (result: string, mode: EditMode) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.style.padding = '6px 2px';

		const titleEl = contentEl.createEl('h2', { text: 'GPTown for Obsidian' });
		titleEl.style.marginBottom = '4px';

		const hintEl = contentEl.createEl('p', {
			text: 'Nutze Prompt + Aktionen. Mit Markierung wird nur der selektierte Bereich ersetzt, sonst die gesamte Note.',
			cls: 'modal-hint'
		});
		hintEl.style.fontSize = '0.9em';
		hintEl.style.color = 'var(--text-muted)';
		hintEl.style.marginBottom = '14px';

		const textArea = contentEl.createEl('textarea', {
			attr: {
				rows: '6',
				placeholder: "Was soll das LLM tun? (z.B. 'Fasse den Text zusammen' oder 'Schreibe den nächsten Absatz')…"
			}
		});
		textArea.style.width = '100%';
		textArea.style.marginBottom = '12px';
		textArea.style.borderRadius = '10px';
		textArea.style.padding = '10px';
		textArea.style.border = '1px solid var(--background-modifier-border)';
		textArea.style.resize = 'vertical';

		const quickTitle = contentEl.createEl('div', { text: 'Schnellaktionen' });
		quickTitle.style.fontSize = '0.82em';
		quickTitle.style.fontWeight = '600';
		quickTitle.style.color = 'var(--text-muted)';
		quickTitle.style.marginBottom = '8px';

		const quickRow = contentEl.createEl('div');
		quickRow.style.display = 'flex';
		quickRow.style.gap = '8px';
		quickRow.style.flexWrap = 'wrap';
		quickRow.style.marginBottom = '14px';

		this.createQuickButton(quickRow, 'Note verschönern', 'beautify', 'Verbessere die gesamte Notiz sprachlich und strukturell.');
		this.createQuickButton(quickRow, 'Zusammenfassen', 'summarize', 'Fasse die gesamte Notiz kompakt zusammen.');
		this.createQuickButton(quickRow, 'Korrigieren', 'fix', 'Korrigiere Rechtschreibung und Grammatik.');
		this.createQuickButton(
			quickRow,
			'TikZ Figure',
			'tikz_figure',
			'Erstelle eine passende TikZ-Figur basierend auf dem Kontext und der Anfrage.'
		);

		const submitBtn = contentEl.createEl('button', { text: 'Absenden' });
		submitBtn.style.width = '100%';
		submitBtn.style.padding = '10px 12px';
		submitBtn.style.borderRadius = '10px';
		submitBtn.style.backgroundColor = 'var(--interactive-accent)';
		submitBtn.style.color = 'var(--text-on-accent)';
		submitBtn.style.fontWeight = '600';

		submitBtn.addEventListener('click', () => {
			const text = textArea.value.trim();
			if (text.length > 0) {
				this.onSubmit(text, 'auto');
				this.close();
			} else {
				new Notice('Bitte gib einen Text ein.');
			}
		});
	}

	createQuickButton(
		container: HTMLElement,
		label: string,
		mode: EditMode,
		promptTemplate: string
	) {
		const button = container.createEl('button', { text: label });
		button.style.padding = '6px 10px';
		button.style.borderRadius = '999px';
		button.style.border = '1px solid var(--background-modifier-border)';
		button.style.backgroundColor = 'var(--background-secondary)';
		button.addEventListener('click', () => {
			this.onSubmit(promptTemplate, mode);
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
