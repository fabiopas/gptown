# Local LLM + Vite Website + Cursor API

Dieses Projekt bietet:

- moderne Vite-Webapp unter `http://localhost:5173` (Dev)
- lokale API unter `http://localhost:3000/v1`
- OpenAI-kompatible Endpoints fuer Cursor (`/v1/models`, `/v1/chat/completions`)

## 1) Voraussetzungen

- [Ollama](https://ollama.com/) installiert
- Ein lokales Modell gezogen, z. B.:

```bash
ollama pull llama3.1
```

## 2) Projekt starten

```bash
cp .env.example .env
npm install
npm run dev
```

Danach:

- Web UI (Vite): `http://localhost:5173`
- API Healthcheck: `http://localhost:3000/health`

## 3) Produktion / Single Server

Wenn du die Webapp direkt vom Express-Server ausliefern willst:

```bash
npm run build:web
npm start
```

Dann laeuft alles zusammen ueber `http://localhost:3000`.

## 4) Cursor mit lokaler API verbinden

In Cursor (OpenAI-kompatibler Provider):

- Base URL: `http://localhost:3000/v1`
- API Key: `local-dev-key` (oder dein Wert aus `.env`)
- Model: `llama3.1` (oder dein Wert aus `.env`)

## 5) API manuell testen

### Modelle

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer local-dev-key"
```

### Chat Completion

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer local-dev-key" \
  -d '{
    "model": "llama3.1",
    "messages": [
      {"role":"user","content":"Sag Hallo auf Deutsch"}
    ]
  }'
```

## Hinweise

- Wenn dein Ollama auf anderem Host/Port laeuft, passe `OLLAMA_BASE_URL` in `.env` an.
- Wenn du ein anderes Modell willst, setze `OLLAMA_MODEL` in `.env`.
