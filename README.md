# Research Reader

Research Reader is an AI-powered PDF reader built with Tauri + React + TypeScript.

It supports:

- Smooth PDF viewing (scroll, zoom, navigation)
- Highlights, sticky notes, and annotation sidebar
- AI chat panel with document-aware context
- Voice input (push-to-talk) and TTS output
- Markdown + LaTeX rendering in AI responses

## Tech Stack

- Tauri 2
- React + TypeScript + Vite
- Zustand
- PDF.js via `react-pdf`

## Local Development

1. Clone the repository:

```bash
git clone git@github.com:ayushdeolasee/research-reader.git
cd research-reader
```

2. Install dependencies:

```bash
npm install
```

3. Run the desktop app in development mode:

```bash
npm run tauri dev
```

## Notes

- AI features use BYOK (bring your own API key) from the in-app AI settings panel.
